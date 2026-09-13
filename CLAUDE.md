# CLAUDE.md

Guía de convenciones para trabajar en este repo. El diseño completo vive en
[`pos-web-diseno-arquitectura.md`](./pos-web-diseno-arquitectura.md) — este archivo es un resumen
operativo para no tener que releerlo entero en cada sesión; ante cualquier duda o contradicción,
el documento de diseño manda.

## Qué es esto

POS web offline-first para retail: kiosco/tienda, instalable como PWA, 100% operable con teclado
(sin mouse/touch en ningún flujo), que se integra con cualquier backend externo (ERP, e-commerce,
facturación) vía un contrato de API propio versionado — el POS no conoce ningún backend específico.

Fuera de alcance por ahora: facturación fiscal de un país específico, multi-tenant/SaaS, pasarelas
de pago y cobranzas con medios múltiples (eso es v2 — hoy el pago es solo `medio + monto`).

## Stack

| Capa | Elección |
|---|---|
| UI | Preact + `@preact/signals` |
| Pull de catálogo / cache | `fetch` + Dexie directo (ver nota) |
| Almacenamiento local | Dexie.js (sobre IndexedDB) |
| PWA / service worker | Vite + `vite-plugin-pwa` (Workbox) |
| Búsqueda local | FlexSearch o Fuse.js |
| Validación de contrato | Zod |
| Impresión / hardware | Web Serial / WebUSB (Chromium) |
| Testing | Vitest + Testing Library (preact) + Playwright |

Navegador de referencia: Chromium (Chrome/Edge). En Firefox/Safari la app sigue andando pero sin
Web Serial/WebUSB (sin impresión/cajón).

**Nota (Fase 2)**: el doc de diseño original elegía TanStack Query + persister para el pull de
catálogo. Se decidió no sumarla: el motor de sync ya necesita reintentos/backoff para el push del
outbox, y esa misma lógica se reusa para el pull (`sync/engine.ts`) — traer una librería aparte para
algo que el propio motor ya resuelve no se justificaba, dado que se prefiere minimizar dependencias.

## Estructura de proyecto

```
src/
  domain/          # entidades y lógica de negocio pura (Sale, Product, etc.)
  storage/         # Dexie schema, outbox, seed de catálogo, repositorios
  sync/            # motor de sincronización, adaptador del Connector API
  connectors/      # implementaciones de referencia (ej. REST genérico)
  ui/
    screens/       # Venta, Cobro, Caja, Historial
    components/    # inputs, tablas, paleta de comandos
    keyboard/      # gestor de foco, atajos, detección de scanner
  workers/         # service worker, background sync
```

`domain/` no importa nada de `ui/`, `storage/` ni `sync/` — es lógica pura, testeable sin DOM ni
IndexedDB. Los adaptadores (Dexie, fetch, service worker) viven en sus propias carpetas y son los
únicos lugares donde se permite `try/catch` real (ver más abajo).

## TypeScript estricto

- `any` prohibido sin excepción (`no-explicit-any` en modo error de lint).
- `unknown` solo puede aparecer en la firma de una función que recibe algo externo **y lo valida
  con Zod en la línea siguiente** — nunca se propaga `unknown` hacia el dominio.
- Toda función de negocio devuelve `Result<T>`, nunca lanza.

## Manejo de errores: `Result<T>`, nunca excepciones en el dominio

Regla general: **las funciones de negocio nunca lanzan**. Dos clases de error:

- **Error de negocio anticipado** (stock insuficiente, hold rechazado, payload de un conector mal
  formado, cualquier dato externo con forma incierta) → siempre `Result<T>`, nunca excepción.
- **Todo lo demás** (invariante rota, bug) → se deja explotar como excepción real hasta un único
  manejador global (error boundary de Preact + `window.onerror` / `unhandledrejection`). Por ahora
  ese manejador siempre muestra una pantalla bloqueante, sin retry silencioso.

`try/catch` queda limitado a los adaptadores que envuelven algo que sí lanza por naturaleza (fetch,
Dexie, `JSON.parse`) y lo convierten a `Result` en el borde — nunca como manejo de flujo de negocio.

Forma del `Result` casero — error como código string con metadata tipada por código, en un solo
registro central (`ErrorMeta`) para mantener exhaustividad en los `switch` de la UI:

```typescript
type ErrorMeta = {
  'sale/insufficient-stock': { productId: string; requested: number; available: number };
  'sale/no-line-to-reduce': undefined;
  'account/hold-rejected': { reasonCode: string };
  'account/offline-limit-exceeded': { missing: number };
  'sync/invalid-payload': { issues: { path: string; message: string }[] };
  // se va extendiendo acá, un solo registro central
};

type ErrorCode = keyof ErrorMeta;
type Failure = { [C in ErrorCode]: { ok: false; error: C; meta: ErrorMeta[C] } }[ErrorCode];
type Result<T> = { ok: true; value: T } | Failure;
```

Si un `ErrorCode` no necesita datos extra, `meta` es `undefined` sin costo. Si un código deja de
usarse, se saca. `neverthrow` es la alternativa a considerar solo si el encadenamiento manual de
`Result`s se vuelve incómodo — por ahora se prefiere el casero (sin dependencia extra, dominio chico).

## Modelo de dominio

IDs generados en el cliente (`Sale`, `CashSession`, `StockMovement`, `AccountHold`) son **ULID**,
siempre — así una venta existe y es identificable aunque nunca haya habido red.

Entidades: `Product`, `StockItem`, `Sale`/`SaleLine`, `Payment`, `CashSession`, `StockMovement`,
`Customer` (pura identificación), `CustomerAccount` (crédito, módulo aparte y opcional — un
`Customer` puede no tener una asociada), `AccountHold`, `AccountMovement`. Detalle completo de
campos en §4 del documento de diseño.

Dos categorías de dato, porque cambian la estrategia de sync:

- **Eventos, sin conflicto posible** (`Sale`, `Payment`, `StockMovement`, `AccountMovement`):
  siempre seguros de crear offline vía outbox.
- **Recursos con límite, conflicto posible** (`StockItem.quantity`, `CustomerAccount.balance`):
  offline es operar sobre una foto que puede estar desactualizada. Se resuelven con margen
  configurable (mismo patrón para stock multi-terminal y para cuenta corriente).

## Patrón outbox (offline-first) — implementado en Fase 2, cuenta corriente en Fase 3

Toda mutación relevante (`closeSaleAndPersist`, `voidSaleAndPersist`) escribe **primero** en la
tabla local `outbox` (`domain/outbox.ts::OutboxEvent`, unión discriminada por `type` — nunca
`payload: unknown`), en la misma transacción Dexie que el registro de negocio. La venta/anulación
ya está cerrada y operativa localmente sin importar el resultado del sync.

`sync/engine.ts::syncOnce` recorre `outbox` pendiente en orden (`createdAt`), filtrado por
`isDue` (ventana de backoff), y hace `push*` al `Connector` con `Idempotency-Key` = `id` del evento.
Confirmado → `synced`. Falla → `markFailed` (backoff exponencial con techo, `domain/outbox.ts`),
sigue `pending`. `runSyncCycle` (arma el `Connector` real desde la config guardada) corre en loop
mientras la pestaña está abierta (`setInterval` + evento `online`, `sync/engine.ts::startSyncEngine`)
— **no** es la Background Sync API de Service Worker, eso es explícitamente Fase 7. Nunca bloquea
la UI: sincronizar es efecto secundario, no condición para operar.

El catálogo es al revés (pull por delta con `since`/cursor, `sync/cursor.ts`): `syncOnce` hace
`bulkPut` de lo que llega y **reconstruye el `CatalogRepository`** (Fase 1 lo armaba una sola vez
asumiendo catálogo estático; Fase 2 rompe esa asunción a propósito). Las ventas son append-only (sin
conflicto real); el catálogo/precios sí cambian del lado externo — ahí el cliente siempre es lector,
el sistema externo manda.

Cuenta corriente (Fase 3) es el único flujo que a propósito puede requerir red síncrona: `/CUENTA`
en el cobro (`ui/keyboard/checkout-controller.ts`) llama `sync/account-hold.ts::requestAccountHoldNow`
directo — la **única** operación del `Connector` que no pasa por el outbox ni se reintenta con
backoff, porque necesita una respuesta ya para decidir el flujo (§5). Si se aprueba, el `holdId`
viaja como `Payment.reference` y se confirma con un evento `'account-hold-confirm'` propio, encolado
en la **misma transacción** que la venta (`storage/sale-repository.ts`) — así sobrevive a que la red
se corte justo después de aprobado (RF-19). Sin red, se evalúa `balance` cacheado + `creditLimit` +
`margin` (dato del backend por cliente, no config local — `domain/customer.ts::canChargeOffline`);
si no hay `CustomerAccount` cacheada todavía, se rechaza sin inventar una con crédito en cero. Un
hold aprobado que termina sin usarse (cobro cancelado) se libera con `'account-hold-release'`,
best-effort, igual que documenta §6 para el vencimiento del lado del backend.

## Connector API

El POS no tiene lógica de ningún backend particular, solo del contrato (REST/JSON versionado,
documentado en `docs/connector-api.openapi.yaml`). El contrato completo tiene 10 recursos (por path):
los 9 que el código ya implementa (`GET /products`, `GET /stock`, `POST /sales`,
`POST /stock-movements`, `POST /sales/{saleId}/void`, `GET`/`POST /customers`,
`POST /account-holds`, `POST /account-holds/{holdId}/confirm`, `DELETE /account-holds/{id}`) más 1
documentado para integradores pero sin código todavía (`POST /cash-sessions` — Fase 6). Cada
operación del spec lleva `x-pos-status` marcando cuál es cuál.

`POST /sales/{saleId}/void` es un recurso que §6 del doc de diseño **no** contemplaba — se agregó en
Fase 2 al descubrir el gap (RF-06 se había adelantado en Fase 1 sin que el contrato original la
tuviera prevista). Usa su **propia** `Idempotency-Key` (nunca el `id` de la venta): es una operación
distinta sobre un recurso ya enviado, no una edición (RNF-07). Fase 3 encontró dos gaps del mismo
tipo: `POST /customers` (§6 solo tenía el pull; RF-16 permite dar de alta un cliente local sin forma
de avisarle al backend) y `POST /account-holds/{holdId}/confirm` (§5 decía que la confirmación de un
hold "viaja en el outbox" pero el contrato nunca definió ese endpoint). Mismo criterio en los tres
casos: se agrega el recurso al contrato con su propia `Idempotency-Key`, documentado igual de
completo que el resto.

`sync/connector.ts` define el puerto `Connector` — vive en `sync/`, no en `domain/`, porque habla en
términos de red (cursores, Idempotency-Key, tipos como `ConnectorCustomer`/`AccountHoldResult`) que
no son vocabulario de dominio puro (`domain/customer.ts::splitConnectorCustomer` es la función pura
que sí traduce esa forma cruda a los tipos del dominio). El motor de sync (`sync/engine.ts`) consume
casi todo el puerto; la única excepción es `requestAccountHold`, invocada directo desde
`ui/keyboard/checkout-controller.ts` vía `sync/account-hold.ts` (ver "Patrón outbox" más arriba).
`connectors/rest-fetch-connector.ts` es la implementación de referencia sobre `fetch`. Todo `POST`
de eventos de negocio es idempotente vía `Idempotency-Key`. Autenticación (Bearer)
se configura por terminal vía `/CONFIG` (runtime, `localStorage` — `sync/config.ts`), desacoplada
del contrato. Un integrador nuevo implementa el contrato — nunca se toca código del POS para sumar
un backend (RNF-06).

## UX keyboard-first

Principio central: **un único input siempre enfocado** (la barra de comandos) — se elimina el
problema de foco competido en vez de gestionarlo. Nunca agregar un segundo elemento que pueda robar
foco durante la operación normal.

Prioridad de interpretación de la barra de comandos (orden fijo, ver §7 del diseño para el detalle
completo de cada regla y los casos de ambigüedad cantidad-vs-código-de-barras):

1. `/` → modo comando (lista completa de comandos con solo `/`).
2. `@` → búsqueda/alta de cliente.
3. `cualquier cosa$monto` → línea libre de venta.
4. `<n>*` o `-<n>*` de prefijo → cantidad antes de cualquier búsqueda.
5. Todo dígitos → código de barras o SKU.
6. Cualquier otro texto → búsqueda difusa por nombre.

`Ctrl+Enter` = `/COBRAR` desde cualquier estado. Con la barra vacía, `↑/↓` navegan el carrito; con
texto, navegan resultados. Errores de parseo van en un slot de altura fija reservado (nunca corren
el layout) y seleccionan todo el input (`.select()`) para reemplazar sin retipear.

Comandos disponibles (`ui/keyboard/commands.ts`, se muestran con solo `/`): `/COBRAR`, `/ANULAR`,
`/CONFIG` (configura la conexión con el sistema externo, runtime vía `localStorage` — no hay
variables de entorno ni pantalla de config de terminal más amplia todavía) y `/SINCRONIZAR` (fuerza
un ciclo de sync ahora mismo, RF-12 "bajo demanda" — no cambia de pantalla, el feedback es la barra
de estado). `/CUENTA` (Fase 3) es distinto: solo existe dentro de la pantalla de cobro, no en la
barra de comandos principal — por eso no está en `commands.ts` ni en la lista que se muestra con
`/`. Cobra el saldo restante a cuenta corriente contra el cliente adjunto con `@`.

Barra de estado (extremo opuesto, nunca interactiva, `ui/components/StatusBar.tsx`): 4 estados reales
— `offline` (+ conteo de `outbox` pendiente), `online-idle` (+ hora de la última sync), `syncing`
(+ conteo), `sync-error` (varios reintentos fallidos seguidos, ver `isSyncStruggling` en
`domain/outbox.ts`) — más un quinto, "sin configurar", con precedencia sobre todo salvo estar
offline. Lee los signals de `ui/state/sync.ts`; no toca `navigator.onLine` directo, eso lo resuelve
`sync/engine.ts`.

Otros principios no negociables: todo alcanzable en ≤2 pasos sin mouse (RNF-04), foco siempre
visible (nunca depender de `:hover`), locale configurable por terminal para `Intl.NumberFormat`.

## Testing

Vitest + Testing Library para unit/componentes (sin `@testing-library/jest-dom`: su tipado no tiene
una versión compatible a la vez con Vitest 5 y con el `@testing-library/dom` que trae
`@testing-library/preact` — los tests de componentes usan aserciones planas de DOM,
`expect(x).not.toBeNull()` en vez de `toBeInTheDocument()`). Los tests de `storage/` que tocan Dexie
importan `'fake-indexeddb/auto'` al principio del archivo para darle IndexedDB a Vitest/jsdom.

Playwright (`e2e/`, config en `playwright.config.ts`, solo Chromium) para el flujo end-to-end,
corriendo contra el build real (`pnpm build && pnpm preview`, no el dev server) — en particular para
simular offline real (`context.setOffline(true)`, siempre **después** de cargar la app una vez, no
antes). `vite.config.ts` excluye `e2e/**` de Vitest para que sus `*.spec.ts` no colisionen con el
`include` por defecto. Los specs leen el estado persistido directo de IndexedDB
(`indexedDB.open('offline-pos')`) en vez de importar módulos de la app, para no acoplar el test al
código interno.

El motor de sync y el conector REST se testean sin backend real ni librería de mocking HTTP nueva:
`vi.stubGlobal('fetch', vi.fn())` para el conector, y un `Connector` fake hecho a mano (objeto
literal con los 5 métodos del puerto) para `sync/engine.ts` — así `syncOnce` se testea contra el
puerto, no contra HTTP.

## Patrones establecidos en Fase 1, 2 y 3

- **Puerto + adaptador para dependencias reemplazables**: cuando una librería concreta es
  intercambiable (ej. búsqueda difusa), el dominio define la interfaz (`domain/catalog-search.ts`)
  y la implementación concreta vive en `storage/` (`flexsearch-catalog-search.ts`) — inversión de
  dependencias, no una excepción a "domain/ no importa infraestructura". Al elegir la librería
  concreta, preferir la que no tenga dependencias propias de terceros cuando haya opciones
  equivalentes.
- **Traductor de errores exhaustivo**: `ui/errors.ts` tiene un único `switch` sobre `ErrorCode` con
  chequeo `never` en el `default` — si se agrega un código a `ErrorMeta` y no se traduce acá, no
  compila. Todo el código de UI muestra errores de negocio a través de esta función, nunca
  formateando un `Failure` a mano en otro lado.
- **Un signal por responsabilidad, agrupados por concern en `ui/state/`**: `cart.ts`,
  `command-bar.ts`, `checkout.ts`, `receipt.ts`, `screen.ts`, `void-sale.ts` — cada uno expone sus
  signals y, si hace falta, una función de reset. `activeScreenSignal` (`ui/state/screen.ts`) es un
  switch simple (`'sale' | 'checkout' | 'receipt' | 'void' | 'config'`) que `ui/app.tsx` usa para
  elegir qué pantalla montar; agregar una pantalla nueva es sumar un valor al tipo y un `case` al
  switch.
- **`useLayoutEffect`, no `useEffect`, para foco imperativo al montar una pantalla**: `useEffect` en
  Preact se difiere a un frame (vía rAF) — una tecla enviada muy rápido después de montar (un test
  e2e, o un cajero rápido con lector de código de barras) puede llegar antes de que el foco se haya
  movido y perderse. Las pantallas de cobro/comprobante/anulación usan `useLayoutEffect` (sincrónico,
  antes del paint) por esto — lo encontró un test e2e real, no es una precaución teórica.
- **Operaciones de carrito async trackeadas contra navegación**: agregar un producto implica un
  lookup de stock (async, Dexie). `command-bar-controller.ts` guarda la promesa en curso
  (`pendingCartOperation`) y `triggerCheckout` la espera antes de cambiar de pantalla — sin esto,
  `Ctrl+Enter`/`/COBRAR` disparado inmediatamente después de agregar un producto podía abrir el
  cobro (o cerrar la venta) antes de que el producto terminara de sumarse al carrito.
- **Tipo de inserción explícito en Dexie para tablas con unión discriminada**: el `EntityTable<T,
  PK>` por default de Dexie usa `Omit<T, PK>` para el tipo de inserción, y `Omit` colapsa una unión
  discriminada (pierde los campos específicos de cada variante). Para tablas así (`outbox`, ver
  `storage/db.ts`) hay que pasar el tercer type param explícito
  (`EntityTable<T, PK, T>`) cuando el `id` siempre lo genera la app (nunca autogenerado por Dexie).
- **Config runtime vs. estado operativo interno, en módulos separados**: `sync/config.ts` (lo que
  edita el humano vía `/CONFIG`, devuelve `Result` porque una config inválida es algo que el usuario
  necesita resolver) y `sync/cursor.ts` (cursor de pull, interno del motor, nunca tocado por la
  pantalla de config, best-effort porque perderlo no rompe nada) — aunque ambos usan `localStorage`,
  mezclarlos en un solo módulo haría que la pantalla de config pudiera pisar estado que no le
  corresponde.
- **`toZodIssues` centralizado**: el mapeo `ZodError.issues` → `{ path, message }[]` que usa
  `ErrorMeta` vive en `domain/zod-issues.ts` — cualquier validación nueva en el borde (seed de
  catálogo, config, pull del conector) lo reusa en vez de repetir el `.map()` a mano.
- **Operación async del command bar generalizada, no solo "de carrito"**: `pendingBarOperation`
  (antes `pendingCartOperation`) trackea cualquier efecto async disparado desde la barra de
  comandos que `triggerCheckout` deba esperar antes de cambiar de pantalla — en Fase 3 se sumó la
  creación de un cliente nuevo (`@<nombre>` sin match) al mismo mecanismo que ya cubría agregar un
  producto. Cuando aparezca un tercer caso, se agrega ahí, no se inventa un tracker paralelo.
- **Una llamada de red síncrona, deliberadamente fuera del outbox**: `requestAccountHold` es la
  única operación del `Connector` que no se encola ni se reintenta — el cobro necesita su respuesta
  ya para decidir el flujo (§5). `sync/account-hold.ts::requestAccountHoldNow` es el único lugar de
  `ui/` que arma un conector real fuera de `sync/engine.ts`, y existe justamente para que la UI
  nunca tenga que hacerlo directamente.
- **No inventar datos que no llegaron del backend**: si se aprueba un pago a cuenta corriente para
  un cliente sin `CustomerAccount` cacheada todavía (pudo pasar con red, sin pull previo de esa
  cuenta), `storage/sale-repository.ts` no crea una fila con `creditLimit`/`margin` en 0 — se deja
  que el próximo pull traiga los datos reales. Mismo espíritu que "el cliente siempre es lector" del
  catálogo: el POS no fabrica de motu propio información que le pertenece al sistema externo.
- **Puerto duplicado a propósito para una segunda búsqueda difusa**: `CustomerSearch`
  (`domain/customer-search.ts`) es una interfaz nueva, no una generalización de `CatalogSearch` —
  aunque ambas implementaciones reusan FlexSearch (`storage/flexsearch-customer-search.ts`), forzar
  una interfaz genérica de "búsqueda difusa de lo que sea" hubiera acoplado dos dominios (productos,
  clientes) que no tienen por qué evolucionar juntos.

## Estado del proyecto

Fase 1 (MVP de venta offline), Fase 2 (motor de sync) y Fase 3 (clientes y cuenta corriente)
completas. Fase 1: catálogo sembrado desde fixture, carrito, barra de comandos completa, cobro,
comprobante con impresión, anulación de venta (RF-06, adelantada). Fase 2: tabla `outbox` con
reintentos y backoff exponencial, puerto `Connector` + implementación REST de referencia, pull de
catálogo por delta, configuración runtime vía `/CONFIG`, sync bajo demanda vía `/SINCRONIZAR`, barra
de estado real, contrato documentado en `docs/connector-api.openapi.yaml`. Fase 3: identificación de
cliente vía `@` (adjuntar uno existente o crear uno local nuevo), `CustomerAccount` con pull por
delta, `/CUENTA` en el cobro con hold síncrono (con red) o evaluación de margen cacheado (sin red),
confirmación/liberación de hold vía outbox. Sigue Fase 4 (keyboard-first completo — `/COMANDOS`
completos, gestor de foco global, integración de scanner, auditoría de accesibilidad por teclado).
Antes de armar estructura o herramental nuevo, confirmar en qué fase está el trabajo actual — no
adelantar features de una fase posterior.
