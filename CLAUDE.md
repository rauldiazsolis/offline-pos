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

1. `/` → modo comando, filtrado por prefijo (ver detalle abajo).
2. `@` → búsqueda/alta de cliente.
3. `<signo><número>%` → recargo/descuento global sobre el total (RF-03, ver detalle abajo).
4. `cualquier cosa$monto` → línea libre de venta.
5. `<n>*` o `-<n>*` de prefijo → cantidad antes de cualquier búsqueda.
6. Todo dígitos → código de barras o SKU.
7. Cualquier otro texto → búsqueda difusa por nombre.

`Ctrl+Enter` = `/COBRAR` desde cualquier estado. Con la barra vacía, `↑/↓` navegan el carrito; con
texto, navegan resultados (producto, cliente o el menú de comandos filtrado). Errores de parseo van
en un slot de altura fija reservado (nunca corren el layout) y seleccionan todo el input (`.select()`)
para reemplazar sin retipear. El foco al montar y el `.select()` en error se resuelven con los hooks
compartidos de `ui/hooks/` (ver "Patrones establecidos") — nunca con el atributo HTML `autoFocus`,
que no dispara de forma confiable cuando Preact desmonta y vuelve a montar una pantalla (el caso
real: volver de un popup con Esc).

**Menú de "/" — filtra, navega, ejecuta sin ambigüedad**: escribir después de `/` filtra
`AVAILABLE_COMMANDS` por prefijo (`commandResultsSignal`) en vez de mostrar siempre la lista
completa. A diferencia de la búsqueda de productos/clientes (donde la fila 0 se preselecciona por
default y Enter sin tocar flechas ejecuta esa fila — bajo riesgo, flujo rápido), el menú de comandos
**no preselecciona nada**: ejecutar el comando equivocado por accidente tiene consecuencias reales.
Enter ejecuta directo solo si el filtro deja un único comando posible; con 2+ y sin haber navegado
con ↑/↓ explícitamente, no hace nada. Este menú (y las listas de resultados de producto/cliente)
se renderiza como un **overlay que se abre hacia arriba** desde el input (`position: absolute`,
`bottom: 100%`, con `maxHeight` + `overflow-y: auto`, y solo se monta cuando hay algo que mostrar) —
no participa del flujo normal del documento, así que nunca empuja el carrito ni cambia el scroll de
la página al aparecer o crecer.

**Recargo/descuento global (`<signo><número>%`)**: completa RF-03 (la parte "por línea" —
`domain/cart.ts::applyLineDiscount` — existe desde Fase 1 pero nunca se conectó a ningún comando).
El signo es obligatorio (`+10%` recarga, `-10%` descuenta) salvo para cancelar: `0%` sin signo quita
cualquier ajuste ya aplicado — no hay ambigüedad de dirección posible en cero. Un número sin signo
que no sea cero **no** es un comando (cae a búsqueda difusa, mandatory sign preservado). El ajuste
vive en `Cart.globalAdjustmentPercentage` y se recalcula en vivo en cada `calculateTotals` — agregar
una línea después de aplicarlo actualiza el monto solo, nunca es un monto congelado.

Comandos disponibles (`ui/keyboard/commands.ts`): `/COBRAR`, `/ANULAR`, `/CONFIG` (configura la
conexión con el sistema externo, runtime vía `localStorage` — no hay variables de entorno ni
pantalla de config de terminal más amplia todavía) y `/SINCRONIZAR` (fuerza un ciclo de sync ahora
mismo, RF-12 "bajo demanda" — no cambia de pantalla, el feedback es la barra de estado). `/CUENTA`
(Fase 3) es distinto: solo existe dentro de la pantalla de cobro, no en la barra de comandos
principal — por eso no está en `commands.ts`. Cobra el saldo restante a cuenta corriente contra el
cliente adjunto con `@`.

La barra de comandos vive **abajo** de la pantalla de venta, no arriba — decisión tomada con el
usuario comparando ambos extremos: `addProductLine` siempre agrega la línea nueva al final del
carrito, así que con el input abajo la línea recién agregada aparece pegada a donde se está
tipeando, en vez del salto largo de atención que había con el input arriba y el carrito creciendo
hacia abajo. La barra de estado (info pasiva) ocupa el extremo opuesto, arriba.

Barra de estado (extremo opuesto, nunca interactiva, `ui/components/StatusBar.tsx`): 4 estados reales
— `offline` (+ conteo de `outbox` pendiente), `online-idle` (+ hora de la última sync), `syncing`
(+ conteo), `sync-error` (varios reintentos fallidos seguidos, ver `isSyncStruggling` en
`domain/outbox.ts`) — más un quinto, "sin configurar", con precedencia sobre todo salvo estar
offline. Lee los signals de `ui/state/sync.ts`; no toca `navigator.onLine` directo, eso lo resuelve
`sync/engine.ts`.

Otros principios no negociables: todo alcanzable en ≤2 pasos sin mouse (RNF-04), foco siempre
visible (nunca depender de `:hover`), locale configurable por terminal para `Intl.NumberFormat`
(Fase 4 — tercer paso opcional de `/CONFIG`, `ui/format.ts` lo lee en cada llamada, default
`navigator.language`). "Login de terminal 100% teclado" (PIN + Enter) es un principio del doc de
diseño que **todavía no está implementado ni asignado a ninguna fase** — no hay modelo de
usuario/terminal en el dominio (§4). Se decidió dejarlo fuera del alcance de Fase 4 a propósito
(ver Fase 4 en "Estado del proyecto"); no asumir que existe ningún tipo de autenticación.

## Diseño visual

Pase de diseño hecho sobre una referencia visual del usuario (una POS propia): **"chrome" oscuro
arriba/abajo, contenido claro en el medio** — la barra de comandos y la barra de estado usan los
tokens `--color-chrome-*` (`tokens.css`); el resto de la app (carrito, pantallas de cobro/anulación/
comprobante/config) sigue sobre los tokens claros de siempre. No es un modo oscuro conmutable, es un
contraste fijo tipo "consola arriba/abajo, documento en el medio". Cliente adjunto y resumen de venta
se muestran como tarjetas (`--radius-md`, `--shadow-card`) pero en una sola columna — no hay sidebar
ni layout en dos columnas, eso quedó descartado a propósito (pulido visual, no rediseño de layout).
Montos en `--font-mono` con `font-variant-numeric: tabular-nums` para que alineen en columna,
consistente en carrito, cobro y comprobante. Sin numeritos de atajo (`/1`, `/2`...) en el menú de
comandos — se consideraron por la referencia y el usuario los descartó explícitamente (ensucian,
aportan poco).

Dos correcciones sobre la primera versión del pase de diseño, tras una revisión más a fondo del
usuario:
- **El carrito es un `<table>` real**, no un CSS grid por fila — con grids independientes, el ancho
  de columna de "Precio"/"Subtotal" se calculaba por fila y no quedaba alineado entre renglones de
  distinto largo (`CartView.tsx`). Más `padding-left` entre esas dos columnas también, para que no
  queden pegadas (la razón de alinear montos a la derecha es justamente facilitar la lectura
  horizontal del renglón — se pierde si no hay aire entre columnas).
- **`height: '100svh'` + `overflow` explícito en la raíz de cada pantalla, nunca `minHeight` solo**:
  `min-height` no le pone un techo real al contenedor — un carrito largo hacía crecer el documento
  entero (scrollbar nativo del navegador, header/footer desplazándose con el contenido) en vez de
  quedar acotado a la pantalla con un scroll interno.

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
literal con los métodos del puerto) para `sync/engine.ts` — así `syncOnce` se testea contra el
puerto, no contra HTTP.

`e2e/keyboard-only.spec.ts` (Fase 4) es la "auditoría de accesibilidad por teclado" del roadmap
hecha verificable en CI: un test por pantalla popup, navegando solo con teclado, que confirma
explícitamente que la barra de comandos recupera el foco al volver — no una revisión manual sin
rastro.

## Patrones establecidos en Fase 1 a 4 y el ciclo de mejoras posterior

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
- **`useFocusOnMount`/`useSelectOnErrorSignal` (`ui/hooks/`, Fase 4), no código repetido por
  pantalla**: cada pantalla popup (cobro, config, anulación, comprobante) repetía el mismo
  `useLayoutEffect(() => ref.current?.focus(), [])` — `useLayoutEffect`, no `useEffect`, porque
  Preact difiere `useEffect` a un frame (vía rAF) y una tecla enviada muy rápido después de montar
  puede perderse. Se consolidó en un hook compartido. **`CommandBarInput` no tenía este patrón**:
  usaba el atributo HTML `autoFocus`, que no dispara de forma confiable cuando Preact desmonta y
  vuelve a montar un elemento (a diferencia de la carga inicial de la página) — esa inconsistencia
  era un bug real, reportado por el usuario: el foco se perdía al volver de cualquier popup con Esc.
  Lección: cualquier foco imperativo en esta app pasa por el hook compartido, nunca por `autoFocus`.
- **Operaciones async trackeadas contra navegación**: agregar un producto implica un lookup de
  stock (async, Dexie). `command-bar-controller.ts` guarda la promesa en curso
  (`pendingBarOperation`, ver más abajo por qué no se llama "cart") y `triggerCheckout` la espera
  antes de cambiar de pantalla — sin esto, `Ctrl+Enter`/`/COBRAR` disparado inmediatamente después
  de agregar un producto podía abrir el cobro (o cerrar la venta) antes de que el producto terminara
  de sumarse al carrito.
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
- **Preselección visual real, no solo simulada en el render**: `moveSelectionOver`
  (`command-bar-controller.ts`) tiene un parámetro `assumeFirstSelected` — cuando el render ya
  resalta la fila 0 por default (`selectedIndex ?? 0`, productos y clientes) sin que el signal de
  selección tenga un valor real todavía, el primer ↑/↓ tiene que partir asumiendo que esa fila 0 ya
  está "elegida", o el primer toque de flecha no se nota (mueve el signal de `null` a `0`, que ya se
  veía resaltado — un bug real, reportado por el usuario). El menú de comandos **no** usa esto a
  propósito: ahí nada se preselecciona (ver "UX keyboard-first" — ejecutar el comando equivocado por
  accidente tiene consecuencias reales), así que su `null` inicial sí significa "nada elegido".
- **Un ajuste global vive en el carrito con signo, no como dos campos o un tipo aparte**:
  `Cart.globalAdjustmentPercentage` (RF-03) es un solo número con signo (positivo recarga, negativo
  descuenta) en vez de, por ejemplo, `discount`/`surcharge` separados o reusar el `Discount` de línea
  — evita una invariante de "nunca los dos a la vez" y el cálculo (`calculateTotals`) es una sola
  multiplicación con el signo ya resuelto. `percentage === 0` quita el campo en vez de dejarlo
  explícito, mismo criterio `exactOptionalPropertyTypes` que el resto del dominio.
- **Un overlay que no participa del flujo, en vez de reservar espacio**: el menú de comandos y las
  listas de resultados (`CommandBarInput.tsx`) se posicionan con `position: absolute` sobre el input
  y solo se montan cuando hay algo que mostrar — a diferencia del enfoque anterior (un slot con
  `minHeight` fijo, siempre en el documento), esto no tiene forma de empujar el resto de la pantalla
  ni de necesitar un `maxHeight` calculado a mano: si no cabe, el propio `overflow-y: auto` del
  overlay se hace cargo.

## Estado del proyecto

Fases 1 a 4 completas. Fase 1 (MVP de venta offline): catálogo sembrado desde fixture, carrito,
barra de comandos completa, cobro, comprobante con impresión, anulación de venta (RF-06,
adelantada). Fase 2 (motor de sync): tabla `outbox` con reintentos y backoff exponencial, puerto
`Connector` + implementación REST de referencia, pull de catálogo por delta, configuración runtime
vía `/CONFIG`, sync bajo demanda vía `/SINCRONIZAR`, barra de estado real, contrato documentado en
`docs/connector-api.openapi.yaml`. Fase 3 (clientes y cuenta corriente): identificación de cliente
vía `@` (adjuntar uno existente o crear uno local nuevo), `CustomerAccount` con pull por delta,
`/CUENTA` en el cobro con hold síncrono (con red) o evaluación de margen cacheado (sin red),
confirmación/liberación de hold vía outbox. Fase 4 (keyboard-first completo): se arregló un bug real
de foco (`CommandBarInput` no recuperaba el foco al volver de un popup con Esc — usaba `autoFocus`
nativo en vez del patrón imperativo del resto de la app), consolidado en los hooks compartidos
`ui/hooks/use-focus-on-mount.ts` y `use-select-on-error.ts`; locale configurable por terminal (tercer
paso de `/CONFIG`); auditoría de accesibilidad por teclado como tests e2e
(`e2e/keyboard-only.spec.ts`). "`/COMANDOS` completos" e "integración de scanner" ya estaban
satisfechos con lo existente, sin cambios de código. **Fuera de alcance, a propósito**: "login de
terminal" (§7) sigue sin implementar — no se le asignó ninguna fase y no hay modelo de dominio para
usuarios/terminales; no asumir que existe.

Entre Fase 4 y Fase 5, dos ciclos de mejoras (no fases del roadmap, iteraciones cortas por PR):
- Menú de "/" filtrado por prefijo con ejecución directa sin ambigüedad y navegación por flechas,
  fix de un bug de selección (la fila 0 de resultados de producto/cliente se veía preseleccionada
  pero el primer ↓ no se notaba), el comando `<signo><número>%` de recargo/descuento global (completa
  RF-03), y la primera versión del pase de diseño visual (dark chrome en barra de comandos/estado,
  carrito como tabla con SKU, tarjetas para resumen de venta).
- Una segunda ronda tras usar la app un poco más a fondo: barra de comandos movida abajo (antes
  arriba) con el menú/resultados como overlay que se abre hacia arriba, scroll acotado a cada
  pantalla en vez de al documento entero, el carrito pasado a `<table>` real para que las columnas de
  precio alineen entre filas, y la búsqueda difusa indexando también el SKU (antes solo encontraba
  productos por nombre) — ver "UX keyboard-first" y "Diseño visual" más arriba para el detalle.

**Issues marcados `backlog` en GitHub**: para separar hallazgos que valen la pena pero son más
grandes que un fix de ciclo — a definir/priorizar recién después de terminar las fases ya diseñadas
para esta primera etapa (Fase 5, 6, 7), no antes. Ejemplo: que la falta de stock no debería bloquear
una venta en un POS de mostrador, y que el Connector API no debería poder "rechazar" una venta ya
cerrada de forma síncrona (debería ser una notificación asíncrona aparte). Antes de tomar un issue
para trabajar, revisar si tiene esta etiqueta.

Sigue Fase 5 (hardware — impresión de tickets vía Web Serial/USB, apertura de cajón, fallback para
navegadores sin soporte). Antes de armar estructura o herramental nuevo, confirmar en qué fase está
el trabajo actual — no adelantar features de una fase posterior.
