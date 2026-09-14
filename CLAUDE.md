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

**Distinto de la venta en curso (ciclo de mejoras post-Fase 4)**: `outbox` es para eventos ya
cerrados que necesitan viajar a un backend — la venta en curso, mientras se está armando, no es
ninguna de las dos cosas (no está cerrada, no tiene por qué sincronizarse). Su persistencia vive en
una tabla propia (`draftCart`, ver "Patrones establecidos") con un criterio totalmente distinto:
sobrevivir a un refresh/crash de esta terminal, nunca viajar a ningún lado.

## Connector API

El POS no tiene lógica de ningún backend particular, solo del contrato (REST/JSON versionado,
documentado en `docs/connector-api.openapi.yaml`). El contrato completo tiene 10 recursos (por
path), y desde Fase 6 el código ya implementa los 10: `GET /products`, `GET /stock`, `POST /sales`,
`POST /stock-movements`, `POST /sales/{saleId}/void`, `GET`/`POST /customers`,
`POST /account-holds`, `POST /account-holds/{holdId}/confirm`, `DELETE /account-holds/{id}` y
`POST /cash-sessions` (Fase 6 — turnos de caja, ver más abajo). Cada operación del spec lleva
`x-pos-status` marcando en qué fase se implementó.

`POST /sales/{saleId}/void` es un recurso que §6 del doc de diseño **no** contemplaba — se agregó en
Fase 2 al descubrir el gap (RF-06 se había adelantado en Fase 1 sin que el contrato original la
tuviera prevista). Usa su **propia** `Idempotency-Key` (nunca el `id` de la venta): es una operación
distinta sobre un recurso ya enviado, no una edición (RNF-07). Fase 3 encontró dos gaps del mismo
tipo: `POST /customers` (§6 solo tenía el pull; RF-16 permite dar de alta un cliente local sin forma
de avisarle al backend) y `POST /account-holds/{holdId}/confirm` (§5 decía que la confirmación de un
hold "viaja en el outbox" pero el contrato nunca definió ese endpoint). Mismo criterio en los tres
casos: se agrega el recurso al contrato con su propia `Idempotency-Key`, documentado igual de
completo que el resto.

`POST /cash-sessions` (Fase 6) es distinto de los tres anteriores: **no** es un gap encontrado
sobre la marcha — ya estaba documentado desde que se armó el contrato completo (§6 del diseño), con
`x-pos-status: documented-not-implemented` hasta que el POS tuvo el modelo de dominio
correspondiente. Se envía una sola vez, cuando el turno ya cerró (nunca mientras está abierto,
mismo criterio que `Sale`) — `id` del turno como Idempotency-Key, la entidad ES el evento, igual
que `POST /sales`.

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
4. `cualquier cosa$monto` → línea libre de venta (con `<n>*` de prefijo, `n` es el precio unitario
   — ver detalle abajo).
5. `<n>*` o `-<n>*` de prefijo → cantidad antes de cualquier búsqueda.
6. Todo dígitos → código de barras o SKU.
7. Cualquier otro texto → búsqueda difusa por nombre **o por una línea libre ya en este ticket**
   (ver detalle abajo).

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

**Línea libre y su cantidad (`descripción$monto`, `<n>*descripción$monto`)**: el monto tipeado es
siempre precio unitario, la cantidad lo multiplica — `3*regalo$100` = 3 × $100 = $300, simétrico
con producto/código. Crear (con `$`) nunca fusiona con una línea libre existente que tenga la misma
descripción — no hay identidad de producto contra la que fusionar dos líneas libres, a diferencia
de un producto por su `id` (`domain/cart.ts::addFreeformLine`).

**Ajustar una línea libre ya existente (`<n>*descripción`/`-<n>*descripción`, sin `$`)**: esto es
otra cosa — sin `$` cae en la búsqueda de artículos (regla 7), que busca en **dos fuentes**
mezcladas en una sola lista (líneas del carrito primero): las líneas libres ya tipeadas en este
ticket que matcheen por descripción (filtro simple en memoria, no hay índice — son pocas líneas por
carrito) y el catálogo de siempre. Elegir una línea libre de esa lista y confirmar llama
`domain/cart.ts::adjustFreeformLineQuantity` (identidad por descripción exacta, qty positivo suma,
negativo resta, llegar a 0 borra la línea) en vez de `addProductLine` — mismo mecanismo de
selección/flechas de siempre, sin nada nuevo ahí. `ui/state/command-bar.ts::searchResultsSignal`
devuelve esta unión (`UnifiedSearchResult`, línea libre | producto), no solo `CatalogSearchResult`.

**Cliente sin tipear nada (`@` solo)**: a diferencia de la búsqueda de artículos, `@` sin texto
muestra los clientes más recientes (`CustomerRepository.listRecent()`) en vez de una lista vacía
esperando que se tipee algo — no tiene sentido hacer esperar texto para algo tan frecuente como
adjuntar el último cliente atendido. La primera fila de esa lista siempre es "Consumidor Final"
(`ui/state/command-bar.ts::CustomerOrClear`, tipo `{ kind: 'clear' }`) — es la forma de desadjuntar
el cliente actual. Antes era un caso especial ("@" vacío + Enter sin nada seleccionado), pero desde
que la query vacía muestra clientes recientes ese caso especial dejó de dispararse (la lista ya no
está vacía) — un bug real reportado por el usuario: no había forma de sacar un cliente adjunto.
Ponerlo como fila de la lista (idea del propio usuario) lo resuelve de raíz y es más discoverable.
Con una query puntual (buscando/creando un cliente específico) no aparece — no tiene sentido
mezclarlo con el flujo de crear un cliente nuevo.

**Formato de precio × cantidad en la fila de producto**: `<unitario>` resaltado (contraste
completo + negrita) con cantidad 1; `<unitario> x <cantidad> = <total>` con la parte
`x <cantidad> = <total>` resaltada (el precio unitario pasa a texto secundario) con cualquier otra
cantidad — el prefijo `<n>*` ya calcula esta cantidad, ver `parsedSignal`.

**Selección siempre visible, cualquiera sea la causa del cambio**: `ui/hooks/use-scroll-selected
-into-view.ts` (`useScrollSelectedIntoView`, mismo patrón que `useSelectOnErrorSignal`) hace
`scrollIntoView({ block: 'nearest' })` sobre la fila correspondiente cada vez que un signal de
índice cambia — se usa cuatro veces (carrito, y los tres overlays de `CommandBarInput`), cada lista
con su propio `Map` de refs. Antes, la selección se movía igual (arrows, agregar una línea) pero
podía quedar invisible fuera del área que scrollea, dando la sensación de que "no pasaba nada".

Además de scrollear, `command-bar-controller.ts` ahora fija explícitamente qué queda seleccionado
después de cada mutación del carrito — `selectResultingLine(cart, find)` busca la línea resultante
por identidad (`null` si `find` no encuentra nada, que es lo que pasa cuando la operación restó
hasta borrarla — a propósito, sin selección). El borrado explícito con Supr
(`removeSelectedCartLine`) usa un criterio distinto: selecciona la línea que se corrió a ese mismo
índice, o la anterior si se borró la última, o nada si el carrito quedó vacío
(`Math.min(index, newLength - 1)`).

**Reset/reindexado de selección al cambiar el buffer**: `updateCommandBarBuffer` (en
`command-bar-controller.ts`, llamado desde `handleInput` en vez de tocar los signals directo)
resetea el menú de comandos a `null` en cada tecla (ejecutar el comando equivocado por accidente
tiene consecuencias reales) y reindexa por identidad la búsqueda de producto/línea libre y de
cliente — si el ítem que estaba seleccionado sigue presente en la lista filtrada nueva, se lo sigue
apuntando aunque haya cambiado de posición; si no, `null`.

**Scrollbar nativa oculta, indicador propio puramente informativo**: el carrito y los tres
overlays de `CommandBarInput` ocultan la scrollbar nativa (`scrollbar-width: none` +
`::-webkit-scrollbar { display: none }`) y en su lugar muestran `ScrollIndicatorBar`
(`ui/components/`, alimentado por `useScrollIndicator`, `ui/hooks/`) — una barra angosta,
`pointer-events: none` (nunca accionable, en ningún caso, ni click ni drag), que refleja la
proporción visible/oculta como una scrollbar normal. El wheel y el autoscroll nativo por click en
la ruedita del mouse no dependen de que la scrollbar sea visible, siguen andando igual. Reemplaza
el alcance original de la issue #34 (drag táctil + indicador de fade) — se decidió acotarlo a esto
al ver la complejidad real de lo otro (manejar mousedown/mousemove sin romper el click de
selección, ocultar la scrollbar entre navegadores con propiedades distintas, mantener wheel/
middle-click-drag, diseñar el fade).

Comandos disponibles (`ui/keyboard/commands.ts`): `/COBRAR`, `/CAJA` (Fase 6 — abre o cierra el
turno de caja, ver más abajo), `/ANULAR`, `/CONFIG` (configura la conexión con el sistema externo,
runtime vía `localStorage` — no hay variables de entorno ni pantalla de config de terminal más
amplia todavía) y `/SINCRONIZAR` (fuerza un ciclo de sync ahora mismo, RF-12 "bajo demanda" — no
cambia de pantalla, el feedback es la barra de estado). `/CUENTA` (Fase 3) es distinto: solo existe
dentro de la pantalla de cobro, no en la barra de comandos principal — por eso no está en
`commands.ts`. Cobra el saldo restante a cuenta corriente contra el cliente adjunto con `@`.

**Turno de caja obligatorio para cobrar (Fase 6)**: `/CAJA` abre (pide el monto de apertura) o
cierra (pide el efectivo contado) el turno — con uno ya abierto, entra directo al resumen en vez de
volver a pedir la apertura. `command-bar-controller.ts::triggerCheckout` (único punto de entrada al
cobro, `/COBRAR` y `Ctrl+Enter`) rechaza cobrar sin un turno abierto — decisión explícita del
usuario, es el comportamiento típico de un POS de mostrador y le da sentido real al arqueo (todas
las ventas del turno quedan agrupadas). `storage/sale-repository.ts::closeSaleAndPersist` repite el
mismo chequeo de fondo (la verificación real; `triggerCheckout` es solo para fallar rápido) y, si
hay un turno abierto, agrega el id de la venta a su `sales[]` en la misma transacción que la cierra.
El arqueo al cerrar es **solo de efectivo** (apertura + ventas en efectivo del turno vs. lo
contado) — tarjeta/cuenta corriente no tienen equivalente físico para "contar", aunque el reporte
básico sí desglosa el total por cada medio de pago. Un turno **abierto** nunca se sincroniza (mismo
criterio que una `Sale` con `status: 'open'`, Fase 1: nace ya cerrada) — solo se encola en el
outbox al cerrarse, ya completo (ver "Connector API" más abajo).

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
se muestran como tarjetas (`--radius-md`, `--shadow-card`). Montos en `--font-mono` con
`font-variant-numeric: tabular-nums` para que alineen en columna,
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

Una ronda más de mejoras (ciclo post-Fase 4, ver "Estado del proyecto"):
- **Cliente/Total son bloques fijos, solo la lista de artículos scrollea**: antes vivían en el
  mismo flujo que la tabla dentro de un único contenedor con scroll — un carrito largo escondía el
  encabezado de columnas, y el bloque de Total se movía cada vez que cambiaba de alto
  (aparece/desaparece el recargo/descuento global). `CartView.tsx` restructurado en piezas
  (`CustomerCard`/`CartTable`/`TotalsCard`) donde solo el contenedor de la tabla tiene scroll
  propio, con `<thead>` en `position: sticky` (`cart-view.css`).
- **Layout en dos columnas en pantallas anchas — decisión reabierta a propósito**: el primer pase
  de diseño visual había descartado explícitamente el sidebar ("pulido visual, no rediseño de
  layout"); el usuario decidió revisitarla tras usar la app más a fondo. `@media (min-width: 900px)`
  en `cart-view.css` pasa Cliente/Total a una columna fija de 320px a la derecha (Cliente arriba,
  Total abajo, ambos fijos — mismo criterio de scroll que el layout angosto), en un momento donde
  todavía convivía con un layout angosto en flex aparte. **Superado en el Ciclo 7**: ver más abajo
  — el layout angosto se abandonó por completo, y el ancho fijo de 320px pasó a ser proporcional.

Ciclo 5: **la caja de totales siempre muestra Subtotal, Descuento y Total** — antes, una sola fila
condicional ("Recargo/Descuento global") aparecía solo si había un ajuste aplicado, así que la caja
cambiaba de alto según el estado. `domain/totals.ts::Totals` ya tenía todos los números necesarios
(`subtotal`, `discountTotal`, `globalAdjustmentAmount`) — no hizo falta tocar el dominio, solo
`CartView.tsx::TotalsCard`. Sin ajuste aplicado, la fila de Descuento se ve en gris con `$0,00` en
vez de ocultarse.

Ciclo 6:
- **La tarjeta de Cliente siempre se muestra, con "Consumidor Final" como default** — antes solo
  aparecía con un cliente adjunto. Documento/teléfono (mismos campos que ya muestra el overlay de
  `@`) y tamaño fijo (`min-height` en `.cart-view__customer`, alcanza para las 3 líneas posibles)
  para que no cambie de alto según cuántos de esos datos tenga el cliente.
- **En pantallas anchas, Total queda pegado debajo de Cliente, no pegado abajo de todo**:
  `.cart-view__totals` pasa de `align-self: end` a `start` — el espacio vacío que sobra en la
  columna lateral queda al final, no en el medio (issue reportada tras #19: el usuario prefería
  `[cliente][totales][blanco]` en vez de `[cliente][blanco][totales]`).
- **`scroll-margin` para que `scrollIntoView` no quede tapado por un sticky ni pierda el padding
  del contenedor**: diagnosticado en vivo con el navegador real (inyectando CSS de prueba sobre el
  build antes de tocar el código) — `scrollIntoView({ block: 'nearest' })` calcula "visible" en
  términos puramente geométricos del contenedor con scroll, sin saber que el `<thead>` sticky del
  carrito (o el padding de los overlays de `CommandBarInput`) tapan visualmente parte de ese
  espacio. Al volver a la primera fila/ítem navegando con flechas, quedaba pegado contra el borde,
  parcialmente oculto. `scroll-margin-top`/`scroll-margin` en las filas/ítems, igual al espacio que
  hay que reservar (`--cart-table-head-h` para el carrito, `var(--space-2)` para los overlays —
  mismo valor que ya usa cada uno para su propio padding/alto), resuelve los dos casos.

Ciclo 7:
- **Layout único, se abandona el diseño angosto**: decisión explícita del usuario — el enfoque de
  comandos ya asume teclado, no vale la pena mantener una versión mobile-friendly. La grilla de dos
  columnas (antes solo ≥900px) pasa a ser la única, siempre; `grid-template-columns` pasa de
  `1fr 320px` a `2fr 1fr` (productos siempre el doble de ancho que Cliente/Total, proporcional en
  vez de fijo en píxeles). La fila de Total (`--font-size-xl`) tiene `flexWrap` para no
  superponerse en un ancho muy chico — no es un intento de que se vea bien angosto, solo evita que
  se vea roto.
- **Tarjetas de Cliente y Totales rediseñadas** sobre una referencia que compartió el usuario:
  label chico en mayúsculas arriba de cada una ("CLIENTE" / "RESUMEN DE VENTA",
  `sectionLabelStyle` compartido), nombre del cliente en cursiva cuando es "Consumidor Final",
  Total bastante más grande que el resto. `CustomerCard` tiene siempre 4 filas fijas (label,
  nombre, documento, teléfono) — documento/teléfono en blanco en vez de ocultarse cuando no están:
  la posición de cada dato no se mueve según qué tenga el cliente adjunto.
- **Clientes de ejemplo con documento/teléfono**: no hay ninguna UI para tipearlos al crear un
  cliente (solo `@<nombre>`), así que ningún cliente local los tenía para mostrar en las tarjetas
  rediseñadas. `storage/seed-customers.ts::seedCustomersIfEmpty` (mismo patrón que
  `seedCatalogIfEmpty`, pero no fatal si falla — son datos de ejemplo, no algo de lo que dependa
  poder vender).

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

`e2e/helpers.ts` (Fase 6) reúne acciones de setup que varios specs repiten y que tienen que pasar
por la UI real, no por IndexedDB directo (`openCashSession`: sin turno abierto no se puede cobrar,
así que todo spec que llegue a `/COBRAR` lo necesita) — distinto de `indexed-db.ts`, que es
lectura/escritura cruda para datos que en producción vendrían de un pull (`CustomerAccount`) y que
no tiene sentido ejercitar por UI en cada test.

## Patrones establecidos en Fase 1 a 4 y los ciclos de mejoras posteriores

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
- **Identidad por descripción exacta, sin generalizar con `addProductLine`**:
  `adjustFreeformLineQuantity` (`domain/cart.ts`) ajusta la cantidad de una línea libre ya existente
  igual que `addProductLine` ajusta una de producto — pero identificada por `description` exacta en
  vez de `productId`. No se generalizaron en una función compartida: mismo criterio que
  `CustomerSearch`/`CatalogSearch` (dos búsquedas separadas a propósito aunque ambas usen FlexSearch
  por debajo) — producto y línea libre son identidades distintas, forzar una abstracción común
  encima de las dos no se justifica todavía.
- **`effect()` de `@preact/signals` fuera de un componente, para persistir estado en cada cambio**:
  primer uso en este código (`ui/state/persist-cart.ts`) — antes todos los signals se leían dentro
  de componentes o `computed()`. Se usa para guardar la venta en curso en Dexie cada vez que cambia
  (issue #17), sin debounce: a diferencia de un input de texto, `cartSignal` solo cambia una vez por
  acción confirmada, nunca en cada tecla, así que no hay riesgo de escribir de más.
- **Persistir "estado en curso" es distinto de encolar un evento en el outbox**: `draftCart`
  (`storage/db.ts`, tabla propia) guarda la venta en curso para sobrevivir a un refresh/crash de
  esta terminal — nunca viaja a ningún backend, así que no tiene `Idempotency-Key` ni pasa por
  `sync/engine.ts`. Ver "Patrón outbox" más arriba para la distinción completa.
- **Un hook de scroll, reusado en cuatro listas independientes**: `useScrollSelectedIntoView`
  (`ui/hooks/`) no sabe nada de carrito ni de overlays — recibe cualquier `Signal<number | null>` y
  un `Map` propio de refs por índice. Carrito y los tres overlays de `CommandBarInput` (comandos,
  clientes, artículos) llaman al hook una vez cada uno, en vez de repetir la lógica de
  `scrollIntoView` cuatro veces. jsdom no implementa `scrollIntoView` — el stub global vive en
  `src/test/setup.ts`, no en el test de un componente en particular, porque cualquier test que
  toque una de estas cuatro listas lo necesita.
- **`applyCartResult` como type predicate, no `boolean`**: varios callers de
  `command-bar-controller.ts` necesitan `result.value` después de confirmar éxito (para saber en
  qué índice quedó la línea resultante, issue #15) — la firma `result is { ok: true; value: Cart }`
  deja que TypeScript lo sepa después de un `if (applyCartResult(result))`, sin repetir `result.ok`
  a mano en cada caller.
- **Una unión para "esto o la opción especial de vaciar", no un caso aparte**: `CustomerOrClear`
  (`ui/state/command-bar.ts`, Ciclo 7) es el mismo patrón que `UnifiedSearchResult` (Ciclo 4) —
  "Consumidor Final" es una fila más de la lista (`{ kind: 'clear' }`), no un `if` especial fuera de
  ella. Evitar un caso especial fue justo lo que resolvió el bug real de no poder desadjuntar un
  cliente: un caso especial que dejó de dispararse en silencio cuando cambió una condición en otro
  lado (la lista dejó de estar vacía) es más fácil de romper sin darse cuenta que una fila que
  siempre está ahí.
- **Otro hook reusado en las mismas listas, siguiendo el patrón ya establecido**:
  `useScrollIndicator` (`ui/hooks/`, Ciclo 7) es análogo a `useScrollSelectedIntoView` — no sabe
  nada de carrito ni de overlays, solo escucha `scroll`/`ResizeObserver` sobre un elemento. El
  componente presentacional que lo consume (`ScrollIndicatorBar`) es deliberadamente
  `pointer-events: none` — puramente informativo, para no repetir el error de construir algo que
  "parece" un control pero no lo es. jsdom tampoco implementa `ResizeObserver` — mismo criterio que
  `scrollIntoView`, stub global en `src/test/setup.ts`.
- **Resetear un signal "de arranque" siempre antes del primer `await`, nunca después**: un bug real
  de Fase 6, agarrado corriendo el e2e repetidas veces (`--repeat-each`), no solo por revisión de
  código. `cash-session-controller.ts::loadCashScreen` limpiaba `cashBufferSignal` **después** de
  `await getOpenCashSessionSummary()` (una lectura a IndexedDB) — si el cajero ya empezó a tipear
  mientras esa lectura todavía estaba en vuelo, el reset la pisaba al resolver, sin ningún error
  visible más que "Monto inválido" más adelante. La función se reordenó para resetear
  síncronamente, como primera línea, antes de cualquier `await` — cualquier función de
  "cargar/resetear pantalla al montar" en este código sigue el mismo orden. Relacionado:
  `enterCashScreen` (el controller) y el `useLayoutEffect` de `CashSessionScreen` llamaban las dos
  a `loadCashScreen()` — doble carga, no solo redundante sino la causa original de la carrera. Se
  sacó la llamada del controller: cargar datos al entrar a una pantalla es responsabilidad
  exclusiva del `useLayoutEffect` de esa pantalla (mismo criterio que ya usaba
  `VoidSaleScreen`/`loadVoidableSales` — la lección real es que ese criterio no se estaba aplicando
  consistentemente, no que faltara inventarlo).

## Estado del proyecto

Fases 1 a 4 y 6 completas (Fase 5, hardware, pospuesta a v2 — ver más abajo). Fase 1 (MVP de venta
offline): catálogo sembrado desde fixture, carrito,
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
- Ciclo 4, tras seguir usando la app: persistencia de la venta en curso (issue #17, sobrevive
  refresh/crash — ver "Patrón outbox" y "Patrones establecidos"), la cantidad (`<n>*`/`-<n>*`)
  aplicada también a la línea libre y la posibilidad de ajustar una línea libre ya existente por
  búsqueda (#20), resultados de búsqueda enriquecidos — SKU/precio/total de producto, líneas libres
  del carrito mezcladas en la lista, clientes recientes sin tipear nada (#21), Cliente/Total fijos
  con la lista de artículos como único sector con scroll y su header sticky (#18), layout responsive
  de dos columnas en pantallas anchas que reabre a propósito la decisión de "una sola columna" del
  pase de diseño anterior (#19), y `README.md` (#22) — ver "UX keyboard-first" y "Diseño visual"
  más arriba para el detalle.
- Entre el Ciclo 4 y el 5, un fix aislado (#30, no un ciclo completo — bug de corrección de datos,
  chico): el recargo/descuento global se perdía al modificar cualquier línea del carrito porque
  `addProductLine`/`addFreeformLine`/`adjustFreeformLineQuantity`/`removeLine`/`setLineQuantity`/
  `applyLineDiscount` devolvían `{ lines }` en vez de `{ ...cart, lines }`.
- Ciclo 5, sobre observaciones del usuario tras usar el Ciclo 4: selección siempre visible al
  agregar/ajustar/borrar una línea del carrito o navegar cualquiera de las listas con flechas
  (#15, #26, #27 — `useScrollSelectedIntoView`), reset/reindexado de la selección al cambiar el
  buffer (#14), formato `<unitario>`/`<unitario> x <cantidad> = <total>` en la búsqueda de producto
  (#29), y Subtotal/Descuento/Total siempre visibles en la caja de totales (#31) — ver
  "UX keyboard-first", "Diseño visual" y "Patrones establecidos" más arriba para el detalle.
- Ciclo 6, sobre observaciones del usuario tras usar el Ciclo 5: `scroll-margin` para que
  `scrollIntoView` no quede tapado por el header sticky del carrito ni pierda el padding de los
  overlays al volver al principio de una lista navegando con flechas, tarjeta de Cliente siempre
  visible con "Consumidor Final" como default y tamaño fijo, y Total pegado debajo de Cliente en
  pantallas anchas en vez de pegado abajo de todo — ver "Diseño visual" más arriba para el detalle.
  Ocultar la scrollbar del carrito + drag táctil + indicador de fade se discutió y quedó separado
  (#34): es una feature de interacción nueva, no una corrección de este tamaño.
- Ciclo 7, sobre feedback del usuario tras usar el Ciclo 6: "Consumidor Final" como fila
  seleccionable de la lista de `@` — arregla el bug real de no poder desadjuntar un cliente (ver
  "UX keyboard-first"); tarjetas de Cliente/Totales rediseñadas con labels y posiciones fijas;
  clientes de ejemplo sembrados con documento/teléfono; layout único (se abandona el diseño
  angosto por completo) con división 2/3–1/3; indicador de scroll pasivo en el carrito y los tres
  overlays, reemplazando el alcance de #34 (que se acotó al ver la complejidad real del drag
  táctil) — ver "Diseño visual" y "Patrones establecidos" más arriba para el detalle.

**Issues marcados `backlog` en GitHub**: para separar hallazgos que valen la pena pero son más
grandes que un fix de ciclo — a definir/priorizar recién después de terminar las fases ya diseñadas
para esta primera etapa (Fase 5, 6, 7), no antes. Ejemplo: que la falta de stock no debería bloquear
una venta en un POS de mostrador, y que el Connector API no debería poder "rechazar" una venta ya
cerrada de forma síncrona (debería ser una notificación asíncrona aparte). Antes de tomar un issue
para trabajar, revisar si tiene esta etiqueta.

**Issues abiertas sin agendar todavía** (no `backlog`): #23 (detectar entrada de scanner por
velocidad de tecleo — spike aparte, ahora se puede probar sin lector real vía paste+Enter <300ms,
pero sigue necesitando calibrar el umbral), #24 (usar el espacio de la barra de comandos también
para instrucciones mínimas de uso — sin specs todavía), #28 (Esc con un desplegable abierto lo
cierra sin alterar el buffer — necesita diseño: el desplegable no tiene estado propio de
"abierto/cerrado", se deriva del buffer parseado), #36 (comando para resetear los datos "de
fábrica", con las confirmaciones necesarias — sin definir cuántos pasos de confirmación), #37
(falta UI para crear/editar documento/teléfono de un cliente — sin definir cómo).

**Fase 5 (hardware) pospuesta a v2** — decisión tomada al terminar Fase 4: depende de dispositivos
físicos reales (impresora, cajón) para poder validarse en serio, y ninguna fase posterior depende
de que esté hecha. Se avanza directo a Fase 6. Detalle completo de la decisión y el nuevo orden en
§11 del documento de diseño.

**Fase 6 completa (multi-terminal y caja)**: la reconciliación de catálogo/saldo entre terminales
ya estaba resuelta desde Fase 2/3 (cada pull sobrescribe con el dato del backend, que siempre
manda) — confirmado con el usuario antes de arrancar, no se agregó nada nuevo ahí. El trabajo real
fue turnos de caja: `domain/cash-session.ts` (`CashSession`, `openCashSession`/`closeCashSession`/
`calculateCashSessionSummary`), `storage/cash-session-repository.ts` (persistencia + outbox al
cerrar), comando `/CAJA` y pantalla nueva (`ui/screens/cash-session-screen.tsx`) para abrir/cerrar
con arqueo de efectivo, y el gate de `/COBRAR` sin turno abierto — ver "UX keyboard-first" y
"Patrones establecidos" más arriba para el detalle completo, incluida la carrera real de un reset
de buffer después de un `await` que agarró el e2e corrido repetidas veces. La reconciliación
multi-terminal solo se pudo validar contra un `Connector` fake/mockeado (no hay backend real
todavía) — mismo criterio que ya usa `sync/engine.test.ts`, no fue un bloqueante. Sigue una tanda
de ciclos de mejora de UI (mismo formato que los ciclos post-Fase 4) antes de pasar a Fase 7.

Fase 7 (publicación) tiene su alcance ampliado a propósito: además de lo que ya documentaba el
diseño (manifest PWA, flujo de actualización de service worker, documentación del Connector API,
hardening y lanzamiento), va a incluir un minibackend de demostración que implemente el contrato —
la mejor documentación posible del Connector API y la única forma de probar de punta a punta lo que
Fase 6 deja validado solo con fakes.

Antes de armar estructura o herramental nuevo, confirmar en qué fase está el trabajo actual — no
adelantar features de una fase posterior.
