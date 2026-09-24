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
  sync/            # motor de sincronización, config de la terminal, registro de conectores (connector-registry.ts)
  connectors/      # un subdirectorio por conector (rest/, rest-demo/, google-sheets/): su config, sus campos para /CONFIG y su factory
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
  ese manejador siempre muestra una pantalla bloqueante, sin retry silencioso. Única excepción, y no
  es de negocio sino del propio navegador: "ResizeObserver loop completed with undelivered
  notifications." (y su variante vieja "ResizeObserver loop limit exceeded") es una advertencia
  benigna de Chromium, no un bug de la app — puede llegar con `event.error === null` (bug real
  reportado por el usuario, issue #42: pantalla de error fatal mostrando literalmente "null" al abrir
  DevTools o hacer zoom fuerte del navegador, que son justo los gestos que más fácil la disparan).
  `ui/fatal-error.ts::isBenignResizeObserverLoopError` filtra este mensaje puntual antes de llegar a
  `renderFatalError` — no es una excepción general al "nunca silenciar", es reconocer que esta en
  particular nunca es un error real de la app.

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

## Patrón outbox (offline-first) — implementado en Fase 2, rediseñado a lotes en la Etapa 1 de #87

Toda mutación relevante (`closeSaleAndPersist`, `voidSaleAndPersist`) escribe **primero** en la
tabla local `outbox` (`domain/outbox.ts::OutboxEvent`, unión discriminada por `type` — nunca
`payload: unknown`), en la misma transacción Dexie que el registro de negocio. La venta/anulación
ya está cerrada y operativa localmente sin importar el resultado del sync.

**Identidad de cada evento (contrato v3, #96)**: al encolar, cada evento se **estampa** con su
`origin` (sucursal y punto de venta de `/CONFIG`, `sync/terminal-identity.ts::currentEventOrigin`,
que los repositorios de `storage/` leen junto al `now`) y lo guarda en el `OutboxEvent`: al armar un
lote nunca se relee la config, así que cambiar la sucursal con eventos pendientes no reescribe los ya
encolados (auditoría). `sync/engine.ts::toBatchItem` arma el sobre de red (`id`, `createdAt`,
`origin` — vacío para un evento encolado antes de v3). El id de dispositivo (UUID en `localStorage`
bajo `offline-pos:device-id`) viaja **una vez por request**, en push y en pull, no por evento.
**Ciclo de vida del id (Etapa 2 de #94, #97)**: `sync/terminal-identity.ts::resolveDeviceIdentity`
corre una sola vez, al principio de `bootstrap()`. Con id guardado lo cachea; **sin id**, la terminal
perdió su identidad: borra todas las tablas (`clearAllTables`), los cursores y el estado de lotes,
conserva la config de `/CONFIG` como precarga pero **sin `verifiedAt`** (obliga a volver a probar sin
retipear), genera un id nuevo y, si borró algo, prende `identityResetSignal` para que el wizard lo
avise. Riesgo aceptado: lo pendiente sin enviar se pierde. `getDeviceId()` devuelve el id cacheado y
**nunca crea uno** (llamarlo antes de resolver es un bug): borrar la clave a mitad de sesión no cambia
nada hasta recargar, así nunca se pushean datos viejos con un id nuevo. Sucursal y punto de venta son
**obligatorios** desde #97 (estado `incomplete`, ver "Ciclo de vida de la conexión"): el POS los manda
siempre; un evento encolado antes puede llegar sin ellos. Un evento `cash-session` que haya
quedado pendiente en una terminal (tipo que v3 eliminó) nunca viaja:
`storage/local-data.ts::listPendingOutbox` lo excluye y lo marca como enviado
(`domain/outbox.ts::isLegacyOutboxType`).

**Push: un solo lote, un solo ack (#87)**. `sync/engine.ts::pushPendingLot` manda **toda** la cola
`pending` del outbox de una vez, con un `idempotency_id` (ULID) generado al armar el lote y
**congelado** junto con el conjunto exacto de eventos incluidos: un reintento del mismo lote (fallo
de red) reenvía siempre el mismo id y los mismos eventos, nunca recalcula agregando lo que haya
entrado al outbox mientras tanto — eso evita duplicar un lote que sí llegó pero cuyo ack se perdió.
El backend nunca rechaza el contenido de un lote (ver "Connector API" más abajo); el ack confirma
solo que lo recibió, no que ya terminó de procesarlo. `domain/push-lot.ts` tiene el backoff
exponencial (mismo esquema que antes, ahora por lote en vez de por evento);
`sync/push-lot.ts` lo persiste en `localStorage` (mismo criterio best-effort que
`sync/cursor.ts`) junto con la lista de lotes ya enviados que todavía no confirmaron `ok`/`issues`.

**Pull: un solo lote, con eventos reaplicados (#87, regla de la Etapa 3 de #94 — #98)**.
`sync/engine.ts::runPullCycle` pide productos/clientes (con cursor `since` opcional por recurso, o
sin él para pedir la foto completa de ese recurso) y stock (siempre completo) en una sola llamada,
más el estado de los lotes de push que el POS todavía espera confirmar — contrato v3 (#96):
`queued` (recibido, sin empezar), `processing`, `ok` o `issues`, con los avisos como `LotIssue`
(`{ message, eventId? }`, `sync/connector.ts`). `pendingLotIds` lleva los lotes en espera **y el
lote en curso** (congelado, mandado al menos una vez, sin ack). La clasificación es pura
(`sync/pull-rule.ts::classifyLots`):
- Lote en espera `ok`/`issues`: resuelto, sale de la lista. `queued`: sus eventos se **reaplican**
  (`AwaitingLot.eventIds`, guardados al ack; un lote guardado antes de #98 sin ellos cuenta como
  `processing`). `processing` o no informado: **retiene** stock y saldo.
- Lote en curso informado: **ack recuperado** — sus eventos pasan a `synced`, sale del lote en curso y
  entra a la lista de espera con el estado informado; nunca se reenvía. No informado: **no recibido**
  (`PushLot.notReceivedAt`, solo para `/DIAGNOSTICO`), sus eventos se reaplican como pendientes y el
  lote se sigue reintentando igual.

Aplicación, en **una** transacción Dexie que lee el outbox adentro
(`storage/apply-pull.ts::applyPull`, así una venta cerrada con el pull en vuelo entra en la
reaplicación): **datos maestros y bloqueos siempre** (delta con `bulkPut`, foto completa con
`storage/reconcile.ts::applySnapshotReconciled`). Stock y saldo (`sync/pull-adjust.ts::adjustPull`):
sin retención, valor del backend **más** los efectos (`domain/reapply.ts::reapplyEffects`) de los
eventos de lotes `queued` ∪ pendientes del outbox que nunca viajaron — esto también cierra un agujero
previo: un pull pisaba el descuento local de ventas todavía sin enviar. Con retención quedan los
locales, el cursor de clientes **no avanza** (el saldo viaja dentro del cliente: el próximo delta lo
vuelve a traer) y una foto completa no cuenta como hecha (se vuelve a intentar). El stock se ajusta en
todas las filas (un producto con efectos y sin fila parte de 0); el saldo, solo en los clientes que
vinieron con saldo (nunca se inventa una cuenta). Un pull que retiene **no es un fallo**
(`sync/pending-lot` se eliminó): devuelve `PullApplication` (`applied` / `reapplied` / `retained`,
`lastPullApplicationSignal` en `ui/state/sync.ts`). El último estado en curso informado se guarda en
el lote en espera (`AwaitingLot.lastStatus`, `sync/push-lot.ts::updateAwaitingLots`) y `/DIAGNOSTICO`
lo muestra ("en cola · N eventos"/"procesando"/"sin informar"), junto con cómo se aplicó el último
pull. Un lote que se resuelve con `issues` no bloquea nada (el POS nunca se autobloquea) — solo se
muestra al humano vía `pushLotIssuesSignal` (`ui/state/sync.ts`, `ui/errors.ts::sync/push-issues`),
formateado con el evento al que se refiere (`ui/format-lot.ts::formatLotIssue`). Pendiente: #115
(foto completa con stock vacío y movimientos pendientes) y, en backlog, #113 (cálculo por ítem con un
lote `processing`).

**Limpieza a 7 días (#98)**: la terminal borra lo sincronizado con más de 7 días
(`domain/local-cleanup.ts::planLocalCleanup`, pura; `storage/local-cleanup.ts::runLocalCleanup`, una
transacción): eventos `synced` del outbox salvo los de lotes en espera o en curso (hacen falta para
reaplicar, `sync/cleanup-schedule.ts::protectedEventIds`); ventas cuyo evento y cuya anulación no están
pendientes; movimientos de stock y de cuenta por **su propia edad** — son registros independientes de
su venta, el `saleId` es solo auditoría (con "se borran con su venta" quedaba huérfano el movimiento
de la anulación reciente de una venta vieja; la anulación como documento propio se discute en #99);
un `accountMovement` sin venta se conserva (la Etapa 6 define su regla); turnos cerrados. Nunca se
borra lo pendiente, el catálogo/stock/clientes/cuentas ni la venta en curso, ni **el ancla del
arqueo** mientras existan turnos (hasta la Etapa 5, #100): el último turno cerrado, el abierto y sus
ventas con sus movimientos. Cadencia (`sync/cleanup-schedule.ts`): al arrancar y después de cada pull
exitoso, como mucho cada 24 h (`offline-pos:cleanup:last-run`, que guarda también los conteos y la
fecha del ancla para `/DIAGNOSTICO`), con el cerrojo de sync (si está tomado, se saltea) y nunca con
`/CONFIG` abierto. Efecto aceptado: una venta borrada deja de aparecer en `/ANULAR` (#110 limita
`/ANULAR` a los tickets del día).

**Log de intentos y `/DIAGNOSTICO`**: un usuario probando el conector de Sheets contra un
despliegue real se topó con un error de sync sin poder ver el detalle (la Console del navegador no
mostraba nada, solo la pestaña Network). `sync/engine.ts::logSyncAttempt` registra cada llamada real
a `connector.pushBatch`/`pullBatch` — `request`/`result` son literalmente lo que el call site ya
tiene en la mano, sin resumir, para poder correlacionar con Network — en `syncLogSignal`
(`ui/state/sync.ts`, tope de 20, más nuevo primero, sin persistir). Un ciclo exitoso no toca la
consola; un fallo real (`sync/request-failed`, `sync/remote-error`, etc.) hace `console.error`; un
pull que retiene stock y saldo (comportamiento esperado de la regla de arriba, no un problema) hace
`console.info`; un lote resuelto con `issues` hace `console.warn`. La entrada de un pull exitoso
guarda también cómo se aplicó (`SyncLogEntry.application`). `/DIAGNOSTICO` (comando core,
`ui/screens/diagnostico-screen.tsx`) muestra ese log completo más la conexión actual, el cerrojo del
motor (`sync/engine.ts::isSyncLockHeld`), el id de dispositivo, los lotes en espera con su último
estado y su cantidad de eventos, el lote en curso "no recibido por el backend", cómo se aplicó el
último pull y la última limpieza de datos locales con su ancla — de solo lectura, mismo patrón de
teclado que `/RESUMEN`. Desde la Etapa 2 de #94 también se abre con un click en la barra de estado
(ver "Barra de estado" más abajo).

**Cadencias independientes (#87)**: push cada `PUSH_INTERVAL_MS` (10-15 min) + al arrancar + por
cada evento nuevo del outbox (debounced 2 s) + al vencer el backoff del lote fallido; pull cada
`PULL_SAFETY_NET_INTERVAL_MS` (15 min) + al arrancar + un rato (`PULL_DELAY_AFTER_PUSH_MS`, 2 min)
después de cada push exitoso — a propósito **no combinados** en un solo roundtrip (responsabilidades
distintas, cadencias distintas). `/SINCRONIZAR` (`sync/engine.ts::syncNow`) fuerza las dos ya: push
ignorando su backoff, después un pull completo ignorando la cadencia de 2 h.
`tryAcquireSyncLock`/`acquireSyncLockWaiting` (sin cambios) siguen siendo el único cerrojo — cada
request individual (un push, un pull) lo toma y lo suelta alrededor de sí mismo, nunca durante todo
el intervalo entre ciclos. Push y pull nunca se disparan en simultáneo desde el mismo punto
(`sync/engine.ts::runPushThenPull`, usado al arrancar y al volver la red): como comparten el mismo
cerrojo sin espera, el que se llama primero siempre gana la carrera — un bug real encontrado
recién al escribir los tests de esta etapa.

**Foto completa y bajas**: sin cambios de fondo respecto de antes de #87 — un pull sin cursor de un
recurso es la fuente de verdad de ese recurso (`storage/reconcile.ts::applySnapshotReconciled`
dentro de la transacción de `storage/apply-pull.ts`, todo o nada, nunca toca ventas/turnos/movimientos/outbox/venta en curso), cada conector declara su
`pullMode` (`connector-registry.ts`), la foto completa de un conector `delta` se repite cada 2 h
(`sync/full-refresh.ts::FULL_REFRESH_INTERVAL_MS`, antes 1 h) además de al arrancar y a pedido.

Cuenta corriente (Fase 3) es el único flujo que a propósito puede requerir red síncrona: `/CUENTA`
en el cobro (`ui/keyboard/checkout-controller.ts`) llama `sync/account-hold.ts::requestAccountHoldNow`
directo — la **única** operación del `Connector` que no pasa por el outbox ni se reintenta con
backoff, porque necesita una respuesta ya para decidir el flujo (§5). Si se aprueba, el `holdId`
viaja como `Payment.reference` y se confirma con un evento `'account-hold-confirm'` propio, encolado
en la **misma transacción** que la venta (`storage/sale-repository.ts`) — así sobrevive a que la red
se corte justo después de aprobado (RF-19). Sin red, se evalúa `balance` cacheado + `creditLimit` +
`margin` (dato del backend por cliente, no config local — `domain/customer.ts::canChargeOffline`);
si no hay `CustomerAccount` cacheada todavía, se rechaza sin inventar una con crédito en cero. Un
hold aprobado que termina sin usarse (cobro cancelado) se libera con `'account-hold-release'` —
antes de #87 se trataba aparte como "best-effort"; con push por lote deja de necesitar ese trato
especial, es un evento más del lote, igual que documenta §6 para el vencimiento del lado del backend.

**Distinto de la venta en curso (ciclo de mejoras post-Fase 4)**: `outbox` es para eventos ya
cerrados que necesitan viajar a un backend — la venta en curso, mientras se está armando, no es
ninguna de las dos cosas (no está cerrada, no tiene por qué sincronizarse). Su persistencia vive en
una tabla propia (`draftCart`, ver "Patrones establecidos") con un criterio totalmente distinto:
sobrevivir a un refresh/crash de esta terminal, nunca viajar a ningún lado.

## Connector API

El POS no tiene lógica de ningún backend particular, solo del contrato (REST/JSON versionado,
documentado en `docs/connector-api.openapi.yaml`, **versión 3.0.0** desde la Etapa 1 del epic #94 —
#96, spec `docs/superpowers/specs/2026-09-23-contrato-connector-api-v3-design.md`). **Desde la Etapa 1 del rediseño de sync (#87,
"el backend nunca rechaza") el contrato pasó de 10 endpoints por recurso/evento a dos operaciones
batch** (`POST /sync/push`, `POST /sync/pull`) más dos excepciones síncronas: la reserva de crédito
existente (`POST /account-holds`, sin cambios) y una futura consulta de saldo
(`GET /account-balance/{customerId}`, documentada pero `x-pos-status: documented-not-implemented`
— backlog #51/#59). `sync/connector.ts::Connector` tiene, en consecuencia, solo tres métodos:
`pushBatch`, `pullBatch` y `requestAccountHold`. Principio central del contrato: **el backend nunca
evalúa el contenido de lo que el POS manda** — no hay forma de que una venta, un cliente, un
movimiento de stock o un cierre de caja sea "rechazado" de forma síncrona; el backend registra todo
y audita, y cualquier inconsistencia se resuelve de su lado o a mano. Esto cierra el punto que
`CLAUDE.md` tenía anotado como backlog (issue #13): "que el Connector API no debería poder
'rechazar' una venta ya cerrada de forma síncrona". El backend sí puede, por motivos propios (cuota,
contrato), dejar de aceptar lotes de una terminal — el POS nunca hace cumplir eso por su cuenta, solo
se lo muestra al humano vía la barra de estado (ver "Patrón outbox" más arriba).

Los tres gaps que la v1 del contrato fue encontrando sobre la marcha (`sale-void` — RF-06 adelantada
en Fase 1 sin que §6 la tuviera prevista, con su propia Idempotency-Key por ser una operación
distinta sobre un recurso ya enviado, RNF-07 —; `customer` — RF-16, alta de un cliente local sin
forma de avisarle al backend —; `account-hold-confirm` — §5 decía que "viaja en el outbox" pero el
contrato nunca había definido ese endpoint) viajan hoy como eventos del lote de `/sync/push`
(`OutboxBatchItem`, unión discriminada por `type` en `sync/connector.ts`) — ya no son endpoints HTTP
propios.

**Contrato v3 (#96)** — 8 tipos de evento: `sale`, `stock-movement`, `sale-void`, `customer`,
`account-hold-confirm`, `account-hold-release`, y dos nuevos: `cash-movement`
(`domain/cash-movement.ts`: ingreso/egreso de caja; el arqueo viaja solo como ajuste
`count-adjustment` con lo esperado y lo contado, y solo si la diferencia no es 0) y
`customer-payment` (`domain/customer-payment.ts`: cobranza sin venta, sin cuenta corriente como medio
y sin vuelto). Ninguno de los dos tiene UI todavía — los generan las Etapas 5 y 6 de #94 — pero el
dominio, el outbox, los conectores y el minibackend ya los soportan. Ninguno se anula (se corrigen
con otro registro, RNF-07). `cash-session` se eliminó: el turno local de `/CAJA` sigue hasta la Etapa
5, pero ya no viaja. Cantidades con signo y hasta 3 decimales, `Sale.total`/`Payment.amount` pueden
ser negativos (el POS los genera recién en la Etapa 4, los conectores ya los aceptan); un pago
`account` sin `reference` es fiado offline (positivo) o acreditación (negativo). El pull trae
`createdAt` **obligatorio** (fecha de alta real — `splitConnectorCustomer` la usa en vez de la hora
del pull) y `blocked?: { reason }` (bloqueo informativo, nunca impide operar) en productos y clientes;
`blocked` se guarda en IndexedDB pero no se muestra hasta la Etapa 4. El puerto: `pushBatch(batch:
PushBatch, idempotencyId)` con `PushBatch = { deviceId, events }`, y `PullBatchParams.deviceId`. Los
schemas Zod de red que comparten los dos conectores TS (`connectorProductSchema`,
`batchLotStatusSchema`, `pullBatchResponseSchema`, `toPullBatchResult`, …) viven en
`sync/connector.ts`, no en cada conector.

`sync/connector.ts` define el puerto `Connector` — vive en `sync/`, no en `domain/`, porque habla en
términos de red (cursores, Idempotency-Key, tipos como `ConnectorCustomer`/`AccountHoldResult`) que
no son vocabulario de dominio puro (`domain/customer.ts::splitConnectorCustomer` es la función pura
que sí traduce esa forma cruda a los tipos del dominio). El motor de sync (`sync/engine.ts`) consume
casi todo el puerto; la única excepción es `requestAccountHold`, invocada directo desde
`ui/keyboard/checkout-controller.ts` vía `sync/account-hold.ts` (ver "Patrón outbox" más arriba).
`connectors/rest/rest-fetch-connector.ts` es la implementación de referencia sobre `fetch`;
`connectors/google-sheets/` implementa el mismo puerto contra una planilla de Google Sheets a través
de un puente Apps Script (`bridge.gs`, ver su README). Sus dos archivos (`bridge.gs` y
`columnas.gs`) se pegan en el mismo proyecto de Apps Script: `columnas.gs` solo tiene los textos
visibles (etiquetas de columna y de valor, en español), `bridge.gs` trabaja con claves internas y
encuentra cada columna por su encabezado, no por posición (Etapa 2d, #80); se prueban en Vitest con
una planilla falsa (`src/test/fake-spreadsheet.ts`). Desde la Etapa 2 de #87, `bridge.gs` expone
solo `pushBatch`/`pullBatch` (las acciones por evento/recurso de antes quedan como funciones
internas que esas dos llaman) y resuelve el lock del script puertas adentro — antes cada evento
pendiente era un request HTTP propio, cada uno tomando el lock de punta a punta. `pullBatch` ofrece
cursor real para Productos/Clientes pese a que Sheets no trackea "última modificación" por fila:
compara el contenido de cada fila contra un fingerprint guardado en una hoja oculta (`_Snapshot`) en
vez de depender de un trigger `onEdit` (más difícil de probar y que no cubriría las escrituras del
propio bridge de todos modos) — ver el README del conector, sección "Cursor de pull". Contrato v3
(#96): pestañas nuevas `MovimientosCaja` y `Cobranzas`; columnas de identidad (Dispositivo, Sucursal,
Punto de venta) en lo que escribe, Alta/Bloqueado/Motivo del bloqueo en Productos y Clientes (Alta se
completa sola la primera vez que se lee la fila); `CuentaCorriente` pasa a ser el libro completo
(holds confirmados, pagos a cuenta sin hold con su signo, cobranzas en negativo); `Turnos` sale del
schema. Una planilla anterior se actualiza sola al redesplegar el puente: `ensureColumns` agrega al
final de cada pestaña existente las columnas **opcionales** que le faltan (una requerida que falta
sigue siendo el error de siempre — agregarla vacía haría viajar productos a $0). Sheets procesa cada
lote dentro del request: nunca informa `queued`/`processing`. Cada conector es dueño de su schema de config
y de la lista ordenada de campos que `/CONFIG` muestra (`configFields`); `sync/connector-registry.ts`
arma la unión discriminada por `type` y expone `createConnector(config)`, el único punto que elige
implementación (`sync/engine.ts::runPushCycle`/`runPullCycleNow` y
`sync/account-hold.ts::requestAccountHoldNow` ya no instancian ninguno directo). "Plugin" acá
significa un registro cerrado de conectores compilados, no
carga de código de terceros en runtime (descartada: ejecución de código arbitrario en una app que
maneja ventas y pagos) — un conector nuevo es un PR al repo. Todo `POST` de eventos de negocio es
idempotente vía `Idempotency-Key`. La conexión se configura por terminal vía `/CONFIG` (runtime,
`localStorage` — `sync/config.ts`), desacoplada del contrato: lo guardado es `{ type, …campos del
conector, locale?, branch?, pointOfSale? }` (los tres últimos son config de terminal, fuera de la
unión por `type`; sucursal y punto de venta se estampan en cada evento — el schema los tolera
ausentes al leer, para precargar una config de la Etapa 1, pero sin ellos la terminal queda
`incomplete`), y una config guardada sin `type` (anterior al registro) se lee como
`type: 'rest'` (`z.preprocess` en `syncConfigSchema`), así ninguna terminal ya configurada pierde su
conexión al actualizar. Un integrador nuevo implementa el contrato — un backend que ya habla el
contrato REST no requiere tocar código del POS (RNF-06); un backend con otro formato (como la planilla
de Sheets) entra como un conector nuevo del registro.

## Ciclo de vida de la conexión (Etapa 2b, #76; wizard desde la Etapa 2 de #94, #97)

Una conexión (conector + config) solo se activa después de **probarla**. `SyncConfig` guarda
`verifiedAt` (fecha de la última prueba exitosa); `sync/connection-state.ts::connectionState` deriva
`unconfigured` (sin config), `unverified` (config sin `verifiedAt`, incluidas las guardadas antes de
2b), `incomplete` (probada pero sin sucursal o punto de venta — una config de la Etapa 1 de #94 cae
acá; `hasTerminalIdentity`) o `active`. Si no es `active`, `ui/app.tsx` muestra **solo** `/CONFIG` en
**modo requerido** — ni venta ni barra de comandos, sin "Cancelar", Esc no sale — y ningún ciclo de
sync corre (el wizard pausa el sync). El bloqueo depende únicamente de lo guardado, nunca de la
conectividad: una terminal `active` abre y opera offline como siempre; solo el primer arranque y el
cambio de conexión necesitan red, porque probar es hacer un pull. No hay valores por omisión: los
campos arrancan vacíos y los ejemplos son `placeholder`s (`ConfigField.placeholder`) con el formato
"ej. …" y en gris claro (`--color-placeholder`), para que nunca pasen por un dato cargado.

**`/CONFIG` como wizard (Etapa 2 de #94)** — reemplaza para esta pantalla el criterio de #49 ("no un
wizard secuencial que oculta lo ya cargado"): lo cargado nunca se oculta, queda resumido en una
columna lateral con los 6 pasos (credenciales como `•••`), y se vuelve a cualquier paso ya alcanzado.
1. **Terminal**: Sucursal y Punto de venta (obligatorios) y Locale (opcional); muestra el aviso de
   identidad perdida (`identityResetSignal`).
2. **Tipo de conexión**: las opciones de `CONNECTOR_TYPES` con su `description`; ↑/↓ + Enter o click.
3. **Datos del conector**: los `configFields` del tipo más sus instrucciones (`setupHelp`).
4. **Probar** (`sync/connection.ts::probeConnection`): arranca solo al entrar; pull completo **en
   memoria**, todo o nada, con tope de tiempo — no toca IndexedDB, cursores ni config. Mientras
   espera: spinner (quieto con `prefers-reduced-motion`), qué espera (`onProgress`: `waiting-lock` o
   `pulling` a `<host>`), segundos y el tope, y con Google Sheets un aviso de que suele tardar. Esc la
   cancela (un token descarta el resultado); una falla ofrece "Reintentar" y "Corregir datos".
5. **Datos locales**: **Mantener** (preseleccionada) o **Borrar** lo local. Cambiar la conexión
   **nunca borra datos automáticamente**. Borrar hace antes un último envío del outbox a la conexión
   **actual** (`flushPendingBeforeWipe`: ignora el backoff, toma el cerrojo, con tope de tiempo) y pide
   una segunda confirmación con los conteos (lo no enviado destacado).
6. **Revisar**: todo lo cargado y qué va a pasar al aplicar; Enter aplica.

Las reglas viven en un **modelo puro** (`ui/keyboard/config-wizard-model.ts`, sin DOM ni async):
estado de cada paso (`pending`/`complete`/`error`/`skipped`), `connectionChanged` (el tipo o algún
campo del conector difiere de la config guardada **y verificada**), `originChanged` (el *origen* es el
endpoint normalizado, `originKey` — el `type` no cuenta; cambiar solo la API key, el secreto o el
locale es el mismo origen), `probeValid` (hay una prueba exitosa hecha con **exactamente** la conexión
cargada), pasos alcanzables (hasta el primero incompleto) y `applyAction`. Probar se saltea si la
conexión no cambió; Datos locales, si no cambió o si no hay **datos del usuario** (ventas, turnos,
pendientes del outbox o venta en curso — `storage/local-data.ts::hasUserData`; catálogo/clientes solos
no cuentan). `ui/keyboard/config-controller.ts` solo orquesta lo async; `ui/state/sync-config.ts`
tiene el paso actual (`wizardStepSignal`), el estado async (`wizardAsyncSignal`: `idle`/`probing`/
`flushing`/`confirming-wipe`/`applying`) y `wizardModelSignal`. Navegación: Enter valida y avanza,
Alt+1…6 o click en la columna saltan a un paso alcanzable, Alt+← vuelve, Ctrl+Enter avanza hasta
donde haga falta el usuario, Esc según el estado (cancela la prueba, vuelve de la confirmación de
borrado, o sale si la terminal está `active`). Arranca en Revisar con la terminal `active`, en el
primer paso incompleto en modo requerido, y en Terminal tras perder la identidad.

**Aplicar** — tres caminos según `applyAction`:
- **Solo terminal** (`sync/apply-connection.ts::applyTerminalSettings`, la conexión no cambió):
  guarda sucursal/punto de venta/locale conservando `verifiedAt`, sin prueba ni cerrojo ni IndexedDB.
  De `incomplete` pasa a `active`. Los eventos ya encolados conservan su `origin`.
- **Conexión cambiada, Mantener** (`applyConnection` con `local: 'keep'`): en la transacción de
  siempre, la foto se reconcilia (`storage/reconcile.ts::applySnapshotReconciled`, sin transacción
  propia — la misma que usa el pull, `storage/apply-pull.ts`) — ventas, turnos, movimientos, venta en curso y outbox
  quedan intactos. Con **otro origen** se descarta el estado de lotes del backend viejo (los
  pendientes salen en un lote nuevo al nuevo) y una tabla que llega vacía sí borra lo local (un backend
  nuevo vacío es legítimo). Con el **mismo origen** el estado de lotes se **conserva** — un lote
  congelado cuyo ack se perdió se reenvía con su mismo `idempotency_id`, en vez de duplicarse con otro
  — y la salvaguarda de tabla vacía sigue activa.
- **Conexión cambiada, Borrar** (`local: 'wipe'`): `clearAllTables` + carga de la foto; en memoria se
  vacían la venta en curso y el cliente adjunto.
Con Datos locales salteado: otro origen → `wipe` (lo que queda es catálogo ajeno), mismo origen →
`keep`. Los caminos 2 y 3 toman el cerrojo de `sync/engine.ts`, reinician los cursores, reconstruyen
los repositorios y guardan la config con `verifiedAt` **al final** — riesgo residual aceptado: el
guardado vive en `localStorage` y no puede entrar en la transacción de Dexie; si fallara justo después
del commit, el próximo arranque encontraría la config anterior con datos nuevos. Al terminar: vuelve a
la venta, reanuda el sync y dispara `runPushThenPull()`.

Un solo lugar borra lo local: `clearAllTables` (`db.tables`, así una tabla futura queda incluida sola),
compartido con `/DEMO_RESET`.

**Sin sincronización de fondo mientras `/CONFIG` está abierto**: un backend lento y de a un request por
vez (el puente de Sheets: cada request toma el lock del script y tarda segundos, con un 302 a
`script.googleusercontent.com` por el medio) no aguanta dos flujos a la vez. Antes, el ciclo del
conector **actual** seguía corriendo cada 15 s mientras se probaba el **nuevo** — timeouts, "Planilla
ocupada" y una barra de estado que mezclaba los dos. Ahora `enterConfigScreen` pone
`syncPausedSignal` (`ui/state/sync.ts`) en `true` — ningún ciclo arranca — y se reanuda al
cancelar o al aplicar la conexión nueva; y `probeConnection` toma el cerrojo de sync mientras prueba
(espera a un ciclo en curso, hasta `PROBE_LOCK_WAIT_MS`; si no termina, `connection/sync-busy`). Una
prueba cancelada con Esc sigue en vuelo hasta su timeout (el puerto `Connector` no se puede abortar),
así que el cerrojo hace que un reintento espere en vez de apilar requests. El 302 de Apps Script es
normal (POST `/exec` → 302 → GET del resultado): el navegador lo sigue solo y `callBridge` ya lo
maneja; lo que sí es un error real es una respuesta que no es JSON (página de login o de cuota), que
ahora dice qué revisar.

## Utilidades de consola `pos.*` (Etapa 0 de #94, issue #95)

Objeto global `window.pos` para DevTools, instalado en `main.tsx` **antes** de `bootstrap()` (si el
arranque falla, `pos.export()`/`pos.reset()` siguen disponibles para recuperar la terminal). Queda
también en producción y nada pide confirmación: abrir DevTools y tipear ya es deliberado.
`ui/console/pos-console.ts` es una capa fina con dependencias inyectadas, sin lógica propia:
`help()`, `sync()` (= `/SINCRONIZAR`, `syncNow`), `status()` (= `/DIAGNOSTICO`: pantalla y consola
leen la misma foto, `sync/diagnostics.ts::collectDiagnostics`), `outbox()`
(`storage/local-data.ts::listPendingOutbox`, el mismo que usa el motor para armar un lote),
`export()` y `reset()` (`sync/terminal-data.ts`). Las dos últimas trabajan sobre `db.tables` y
todas las claves `offline-pos:*` de `localStorage` (por prefijo, nunca una lista a mano).
`export()` descarga un JSON para soporte con las credenciales reemplazadas por `"***"` — cada
conector marca las suyas con `ConfigField.secret`. `reset()` borra **también la config de
`/CONFIG`** (a diferencia de `/DEMO_RESET`): equivale a perder el id de dispositivo, y sin él la
terminal arranca de cero. Toma el cerrojo de sync mientras borra, pausa el sync y recarga.
`pos.deviceId()` (Etapa 1 de #94, #96) devuelve el id de dispositivo de la terminal
(`sync/terminal-identity.ts::peekDeviceId`), el mismo que muestra `/DIAGNOSTICO` y que viaja en cada
push/pull — `null` antes de que `bootstrap()` lo resuelva (la consola se instala antes del arranque).
Como vive bajo `offline-pos:*`, `reset()` también lo borra.

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
`availableCommands()` por prefijo (`commandResultsSignal`) en vez de mostrar siempre la lista
completa. Hasta el Ciclo 7, a diferencia de la búsqueda de productos/clientes (donde la fila 0 se
preselecciona por default y Enter sin tocar flechas ejecuta esa fila — bajo riesgo, flujo rápido), el
menú de comandos no preseleccionaba nada: ejecutar el comando equivocado por accidente tiene
consecuencias reales. El issue #40 (Ciclo 8) unificó el criterio a pedido del usuario — la fila 0 se
preselecciona igual que en las otras dos listas, Enter sin tocar flechas ejecuta directo el primer
match del filtro. El riesgo que motivaba la excepción ya no aplica igual: `/DEMO_RESET` tiene su
propia pantalla de confirmación, `/DESCARTAR` descarta algo que ni se había guardado, y el resto de
los comandos no es destructivo — frenar en el menú no compraba nada, solo agregaba fricción al camino
rápido. **Comandos habilitados (Etapa 2 de #94)**: `CommandInfo.availability` (opcional, derivada de
signals) puede deshabilitar un comando según el estado de la venta — hoy solo `/COBRAR`, sin artículos
ni cliente adjunto ("sin artículos ni cliente"). `commandResultsSignal` evalúa la disponibilidad de
cada fila (`CommandResult`); una fila deshabilitada se ve atenuada con su motivo, ↑/↓ la saltean y el
click no hace nada. La fila 0 se preselecciona **solo si está habilitada**
(`defaultCommandIndexSignal`; `effectiveCommandIndexSignal` es la que ejecutaría Enter): "/" con el
carrito vacío no deja `/COBRAR` a un Enter. Enter sin selección sobre el nombre exacto de un comando
deshabilitado, y Ctrl+Enter con `/COBRAR` deshabilitado (`triggerCheckout`), muestran el motivo en el
slot de error. Este menú (y las listas de resultados de producto/cliente) se renderiza como un **overlay que
se abre hacia arriba** desde el input (`position: absolute`, `bottom: 100%`, con `maxHeight` +
`overflow-y: auto`, y solo se monta cuando hay algo que mostrar) — no participa del flujo normal del
documento, así que nunca empuja el carrito ni cambia el scroll de la página al aparecer o crecer.

**Esc cierra el overlay sin tocar el buffer (issue #28, Ciclo 8)**: antes, Esc con el menú de "/", la
lista de "@" o los resultados de búsqueda abiertos no hacía nada — el overlay se deriva puramente del
buffer parseado (`parsedSignal`), así que no alcanza con "no hacer nada" para ocultarlo: hace falta un
estado aparte de verdad "abierto/cerrado". `overlayDismissedSignal`
(`ui/state/command-bar.ts`) es ese estado — `true` cuando el usuario lo cerró a mano con Esc.
`command-bar-controller.ts::updateCommandBarBuffer` lo resetea a `false` en cada tecla, así que seguir
tipeando reabre el overlay que corresponda al contenido nuevo (cerrar no es lo mismo que "olvidar" lo
tipeado). Con la barra vacía (nada para cerrar), Esc no hace nada — vaciar el buffer entero es un
alcance distinto, no lo que pedía este issue.

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
muestra una lista (`CustomerRepository.listRecent()`) en vez de una lista vacía esperando que se
tipee algo — no tiene sentido hacer esperar texto para algo tan frecuente como adjuntar un cliente. La
primera fila de esa lista siempre es "Consumidor Final" (`ui/state/command-bar.ts::CustomerOrClear`,
tipo `{ kind: 'clear' }`) — es la forma de desadjuntar el cliente actual. Antes era un caso especial
("@" vacío + Enter sin nada seleccionado), pero desde que la query vacía muestra esta lista ese caso
especial dejó de dispararse (la lista ya no está vacía) — un bug real reportado por el usuario: no
había forma de sacar un cliente adjunto. Ponerlo como fila de la lista (idea del propio usuario) lo
resuelve de raíz y es más discoverable. Con una query puntual (buscando/creando un cliente
específico) no aparece — no tiene sentido mezclarlo con el flujo de crear un cliente nuevo.

`listRecent()` ordena **alfabéticamente** por nombre, no por fecha de alta (Ciclo 8, punto 1 —
`storage/customer-repository.ts`; el nombre de la función quedó de cuando sí ordenaba por fecha, el
contrato de "sin necesidad de query" no cambió) — más fácil ubicar un nombre conocido a ojo en una
lista larga. A propósito **solo** ahí: `search()` con texto (`@algo`) sigue ordenado por relevancia
del fuzzy match — forzar alfabético ahí empeoraría la búsqueda.

**Desambiguación de clientes con el mismo nombre (Ciclo 8, punto 2)**: la fila de `@` ya mostraba
documento/teléfono debajo del nombre cuando el cliente los tenía, pero casi todos los clientes se
crean con `@<nombre>` sin esos datos (no hay UI para cargarlos, issue #37) — dos "Juan Pérez" se veían
idénticos. Sin documento ni teléfono, la fila muestra "Alta: `<fecha>`" en su lugar
(`CommandBarInput.tsx`, `ui/format.ts::formatDate` — mismo locale configurable que `formatMoney`,
`timeZone: 'UTC'` a propósito para que la fecha no dependa de la zona horaria de cada terminal, un
bug real que agarró un test, no inspección visual). Desambiguación barata: el dato ya estaba en
`Customer.createdAt`, no hizo falta ningún campo nuevo.

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
turno de caja, ver más abajo), `/ANULAR`, `/DESCARTAR` (Ciclo 8 — vacía la venta en curso, ver más
abajo), `/CONFIG` (la terminal y su conexión con el sistema externo, runtime vía `localStorage` — no
hay variables de entorno; desde la Etapa 2 de #94 es un **wizard de 6 pasos** con resumen visible,
ver "Ciclo de vida de la conexión"), `/SINCRONIZAR` (fuerza push y pull ya, RF-12 "bajo demanda" — ver "Patrón outbox"
más arriba; no cambia de pantalla, el feedback es la barra de
estado), `/DEMO_RESET` (Ciclo 8 — borra los datos locales de la terminal y reinicia la demo, ver más
abajo) y `/DIAGNOSTICO` (pantalla de solo lectura sobre el estado de sincronización — conexión
actual, cerrojo del motor, último push/pull, lotes de push en espera y el log reciente de intentos,
ver "Patrón outbox" más arriba para el detalle del log). `/CUENTA` (Fase 3) es distinto: solo existe
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
criterio que una `Sale` con `status: 'open'`, Fase 1: nace ya cerrada). Hasta el contrato v2 se
encolaba en el outbox al cerrarse; desde v3 (#96) **no viaja nunca** — el turno local sigue hasta la
Etapa 5 de #94, que lo reemplaza por movimientos de caja (ver "Connector API" más abajo).

**`/DESCARTAR` (Ciclo 8)**: vacía la venta en curso completa — líneas, cliente adjunto y el % de
recargo/descuento — vía `domain/cart.ts::discardCart`. A propósito distinto de `/ANULAR`: esa anula
una venta **ya cerrada** (implicancias de auditoría, RF-06); esto descarta un carrito que ni siquiera
se había guardado, así que mezclarlos en el mismo comando confundiría el significado de "anular". Sin
confirmación — decisión explícita del usuario (una primera versión pedía escribir
`/DESCARTAR CONFIRMAR`, con un aviso en el slot de error si se tipeaba `/DESCARTAR` solo; se sacó por
pedido directo: perder un carrito no guardado es barato de rehacer, no justifica un paso extra).

**`/DEMO_RESET` (Ciclo 8, retoma el issue #36 — reescrito en Fase 7)**: pantalla de confirmación
dedicada (`ui/screens/demo-reset-screen.tsx`), mismo patrón que `/ANULAR` pero de un solo paso (no
hay nada que elegir — o se resetea todo, o no se hace nada). Desde Fase 7 los datos de demo ya no
viven en un fixture local sino en el minibackend, así que `storage/demo-reset.ts::demoReset` ya
**no** siembra nada por su cuenta — el orden pasa a ser: si hay `/CONFIG` configurado, primero
`POST /_demo/reset` contra el backend (si falla, se corta ahí sin tocar nada local — dejar la
terminal vacía sin poder repoblarla sería peor que no resetear nada); recién después borra todo lo
local (catálogo, stock, clientes, cuentas corrientes, ventas, movimientos de stock/cuenta, turnos de
caja, la venta en curso `draftCart` y el outbox pendiente) y limpia los cursores de pull
(`sync/cursor.ts::clearSyncCursors`) y el estado de lotes de push (`sync/push-lot.ts::clearPushLotState`);
si había `/CONFIG`, recién ahí dispara un push y un pull completo (`sync/engine.ts::runPushCycle`/
`runPullCycleNow`) para repoblar desde el backend ya reseteado, reusando el motor de sync existente en
vez de duplicar su lógica de pull. Sin `/CONFIG` configurado, los pasos de red se saltan y la
terminal queda **vacía**, no operable de inmediato — mismo criterio que un arranque nuevo:
`ui/bootstrap.ts` tampoco siembra nada localmente desde Fase 7 (los fixtures y
`seedCatalogIfEmpty`/`seedCustomersIfEmpty` siguen existiendo y los usan los tests, pero ya no se
llaman al arrancar la app — una terminal recién instalada, sin una conexión probada todavía,
arranca directamente en `/CONFIG`, ver "Ciclo de vida de la conexión"). A propósito **no**
toca la configuración de `/CONFIG` (URL del backend, API key, locale) — decisión explícita del
usuario: es la conexión de esta terminal, no un dato de demo, y perderla obligaría a reconfigurar el
backend en cada reset.

**Comandos por conector (Etapa 2c, #77)**: `/DEMO_RESET` ya no es un comando del núcleo — solo
existe con el conector `rest-demo` ("REST (minibackend de demo)"), un tipo propio del registro que
reusa la implementación REST (`createConnector` agrupa `'rest'` y `'rest-demo'`) y se distingue solo
por declarar ese comando. Con `rest` genérico o Google Sheets el menú de "/" no lo ofrece y tipearlo
da "Comando desconocido: /DEMO_RESET" — el `POST /_demo/reset` no es parte del contrato del
`Connector` y una config de Sheets ni siquiera tiene `baseUrl`. Mecanismo: cada tipo declara
`commands: ConnectorCommand[]` (`connectors/connector-command.ts`: `{ name, description, action }`,
con `action` de un union cerrado `ConnectorActionId`) en `CONNECTOR_TYPES`; la UI mapea cada acción a
su comportamiento en `ui/keyboard/connector-actions.ts` (`Record` exhaustivo: una acción nueva sin
implementar no compila). `ui/keyboard/commands.ts::availableCommands()` = `CORE_COMMANDS` + los del
conector activo, leído de `activeConnectorTypeSignal` (`ui/state/sync.ts`), que fijan `bootstrap`
(solo con conexión `active`) y `applyConnection`. `demoReset()` mantiene una guarda de fondo
(`demo/unavailable-for-connector`) por si se llega por otro camino. Una terminal que ya tenía config
`rest` apuntando al minibackend pierde `/DEMO_RESET` hasta reconfigurarse como `rest-demo` en
`/CONFIG` (los datos no se pierden: mismo origen, no hay borrado). La planilla nunca se resetea desde
el POS.

La barra de comandos vive **abajo** de la pantalla de venta, no arriba — decisión tomada con el
usuario comparando ambos extremos: `addProductLine` siempre agrega la línea nueva al final del
carrito, así que con el input abajo la línea recién agregada aparece pegada a donde se está
tipeando, en vez del salto largo de atención que había con el input arriba y el carrito creciendo
hacia abajo. La barra de estado (info pasiva) ocupa el extremo opuesto, arriba.

Barra de estado (extremo opuesto, `ui/components/StatusBar.tsx`) — hasta la Etapa 2 de #94 era a
propósito no interactiva; esa decisión se reabrió a propósito en la prueba manual de esa etapa: un
click abre `/DIAGNOSTICO` (lo mismo que el comando, patrón "Teclado y mouse"), sin entrar en el orden
de Tab ni sacarle el foco a la barra de comandos. 4 estados reales
— `offline` (+ conteo de `outbox` pendiente), `online-idle` (+ hora de la última sync), `syncing`
(+ conteo), `sync-error` (varios reintentos fallidos seguidos del lote de push, ver
`isPushStruggling` en `domain/push-lot.ts`, **o cualquier pull que falle**, #53) — más un quinto,
"sin configurar", con precedencia sobre todo salvo estar offline. En `sync-error` muestra el motivo
traducido (`lastSyncFailureSignal` + `describeError`) y la hora de la última sync exitosa; en
`online-idle`, lo que hay en la base local (`localCatalogCountsSignal`, contado — un pull por delta
trae solo cambios) y, si el último pull retuvo stock y saldos por un lote `processing` (#98), el
sufijo "· stock y saldos en espera del backend" (`lastPullApplicationSignal`) — sin pasar a
`sync-error`: no es un fallo. Un lote de push con `issues` (#87) no dispara `sync-error` — es informativo,
`pushLotIssuesSignal` — pero sí actualiza el texto de la barra. `runPullCycle` devuelve un
`Result<void>` y `lastSyncedAt` solo se actualiza en un ciclo completamente exitoso. Lee los signals
de `ui/state/sync.ts`; no toca `navigator.onLine`
directo, eso lo resuelve `sync/engine.ts`. Los errores de red se traducen en un solo lugar
(`ui/errors.ts`): conectividad (`Failed to fetch` y equivalentes), 401/403, 404, timeout
(`sync/timeout`) y el error del puente de Sheets (`sync/remote-error`).

Otros principios no negociables: todo alcanzable en ≤2 pasos sin mouse (RNF-04), foco siempre
visible (nunca depender de `:hover`), locale configurable por terminal para `Intl.NumberFormat`
(Fase 4 — campo opcional de `/CONFIG`, `ui/format.ts` lo lee en cada llamada, default
`navigator.language`). "Login de terminal 100% teclado" (PIN + Enter) es un principio del doc de
diseño que **todavía no está implementado ni asignado a ninguna fase** — no hay modelo de
usuario/terminal en el dominio (§4). Se decidió dejarlo fuera del alcance de Fase 4 a propósito
(ver Fase 4 en "Estado del proyecto"); no asumir que existe ningún tipo de autenticación.

## Teclado y mouse (Etapa 2 de #94)

La app sigue siendo 100% operable con teclado, y desde la Etapa 2 de #94 también con mouse, con un
patrón único (sacado de `/RESUMEN`, Ciclo 10):

- `ui/hooks/use-mouse-keeps-focus.ts::keepFocusOnMouseDown` va en el `onMouseDown` del contenedor de
  cada pantalla: con el **botón izquierdo**, cancela el `mousedown` salvo sobre controles de texto
  (`input`, `textarea`, `select`) — el foco se queda en el "hogar" de la pantalla (la barra, el
  contenedor), incluso al clickear un botón, y el `click` se dispara igual. Con cualquier otro botón
  no hace nada: la rueda y el autoscroll con el botón del medio siguen andando.
- Todo lo clickeable es un `<button>` o una fila con `onClick` que llama a **la misma función del
  controller** que su tecla. Todo atajo visible tiene su botón, con el atajo en la etiqueta ("Cerrar
  (Esc)", "Anular (Enter)"), y viceversa.
- El hover es decorativo: nunca mueve la selección.
- La acción principal de cada estado (la que dispara Enter) se ve destacada: clases `.btn` (secundario),
  `.btn-primary` (acento) y `.btn-danger` (destructiva: "Borrar y cambiar", "Anular", "Reiniciar
  demo") en `tokens.css`.
- Cursor: la flecha por defecto en toda la app (`body { cursor: default }`), el de texto solo en los
  campos editables, la mano en lo clickeable — nunca el cursor de texto sobre algo que no se edita.
- Un grupo de opciones (Tipo de conexión, Datos locales del wizard) se comporta como un radio: el foco
  está en la opción elegida y la sigue con ↑/↓, nunca en un contenedor invisible.
- Un botón enfocado con Tab se activa con Enter de forma nativa: el `onKeyDown` del contenedor no
  vuelve a ejecutar su atajo de Enter (si no, "Volver" enfocado + Enter en `/ANULAR` anulaba igual).

Dónde se aplica: **venta** — click en una fila de un overlay (comandos, clientes incluidos "Consumidor
Final" y "+ Crear cliente", artículos incluidas las líneas libres) es lo mismo que Enter sobre ella
(`command-bar-controller.ts::activateCommandBarRow`, mismo camino que `submitCommandBar`); click fuera
del overlay lo cierra como Esc (#28), sin tocar lo tipeado (`sale-screen.tsx`). El carrito todavía no
es clickeable (Etapa 4). **`/CONFIG`** (pasos, opciones y botones), **`/ANULAR`** (filas clickeables =
seleccionar + Enter, `void-controller.ts::activateVoidRow`), **comprobante**, **`/DIAGNOSTICO`**,
**`/DEMO_RESET`**, **`/RESUMEN`** y la **barra de estado** (click = `/DIAGNOSTICO`). Fuera por ahora: cobro (Etapa 4) y `/CAJA` (Etapa 5).

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

Ciclo 8:
- **Grid `1fr clamp(320px, 33.333%, 420px)`**: la columna de Cliente/Total (antes `1fr` puro, sin
  techo) ya no crece sin límite en pantallas muy anchas — sigue proporcional hacia abajo, pero no más
  ancha que 420px. Primera versión (`2fr minmax(320px, 420px)`) tenía un bug real, reportado por el
  usuario con una captura a 1024px de ancho: el algoritmo de Grid agranda los tracks no flexibles
  hasta su máximo antes de repartir el espacio sobrante entre los `fr`, así que la columna saltaba
  directo a 420px apenas había espacio de sobra, en vez de mantenerse en el tercio proporcional
  (341px a 1024px) hasta que ese tercio superara los 420px — la relación terminaba quedando ~1.4:1,
  no ~2:1. `clamp()` con un porcentaje no tiene ese problema (sale del cálculo de `fr` por completo).
- **Total siempre visible, incluso con el carrito vacío**: `TotalsCard` (`CartView.tsx`) ya no se
  oculta cuando `cart.lines.length === 0` — mismo criterio que ya tenía la tarjeta de Cliente desde el
  Ciclo 6 (siempre presente, con un default: "Consumidor Final" ahí, $0,00 acá). Distinto del fix de
  Ciclo 5 (que ya hacía que Subtotal/Descuento/Total fueran siempre visibles **dentro** de la
  tarjeta) — este cambio es sobre la tarjeta entera.
- **Más margen entre la tabla y el indicador de scroll, y "bigotes" en sus extremos**: el
  `padding-right` de `.cart-view__scroll-inner` separa el contenido del indicador, que antes quedaba
  pegado contra el borde. `ScrollIndicatorBar.tsx` suma dos marcas fijas ("bigotes") en los extremos
  del carril, arriba y abajo del thumb que se mueve — a diferencia del thumb (que cambia de alto y
  posición según cuánto se ve), los bigotes no se mueven nunca, enmarcando el carril completo para
  reforzar "hay contenido de este lado" incluso cuando el thumb, por ser chico, queda lejos de ese
  extremo. En el carrito, el carril (bigote superior incluido) arranca **debajo** del `<thead>`
  sticky, no en el borde superior del contenedor — aclaración del usuario: el bigote tiene que tener
  relación visual directa con el área de contenido de la lista, no con el header. Esto obligó a mover
  `--cart-table-head-h` de `.cart-view__scroll-inner` a `.cart-view__scroll` (`cart-view.css`): un
  custom property de CSS solo se hereda hacia adentro de donde se define, y `ScrollIndicatorBar` es
  hermano de `.cart-view__scroll-inner`, no hijo — necesitaba un ancestro común para verlo. Verificado
  con capturas y con las coordenadas reales de cada elemento (no solo a ojo), mismo método que los
  fixes de scroll anteriores. Los bigotes son de un color más oscuro/sólido que el thumb (pedido del
  usuario tras ver la primera versión, donde ambos compartían color y costaba distinguirlos), y un
  riel fino (1px) de punta a punta detrás del thumb rellena el hueco visual entre este y cada bigote
  cuando el thumb no llega hasta el extremo.
- **Placeholder en la barra de comandos**: "Escribí para buscar · @ cliente · / comandos". No cierra
  el issue #24 — se implementó como parte del lote original, pero al revisarlo el usuario consideró
  que un placeholder no alcanza para lo que pedía ese issue (queda abierto para algo más completo
  más adelante).
- **`/DESCARTAR` y `/DEMO_RESET`**: ver "UX keyboard-first" más arriba para el detalle completo de
  cada uno.
- **~22 clientes de ejemplo** (`storage/fixtures/customers.json`, antes 3) — variedad de
  documento/teléfono presentes/ausentes (incluye un par de "Juan Pérez" duplicados a propósito, para
  poder probar la desambiguación con datos reales de la demo) en vez de solo lo mínimo para no romper
  los tests.

**Zoom responsive por debajo de 1024px, con un piso de 600px (Ciclo 8) — decisión reabierta a
propósito**: el Ciclo 7 había decidido explícitamente un único layout, sin versión angosta ("el
enfoque de comandos ya asume teclado, no vale la pena mantener una versión mobile-friendly"). El
usuario volvió a plantear el caso de una ventana angosta, pero pidiendo algo distinto de lo que el
Ciclo 7 había descartado: no una segunda versión del layout (eso hubiera revivido justo la
complejidad que se evitó), sino que el layout de 1024px se vea **igual, más chico** — la proporción
2/3–1/3 nunca se rompe porque nunca reflowea.

Se resolvió con `zoom` de CSS aplicado a un wrapper (`.app-zoom-wrapper` en `tokens.css`, envolviendo
la pantalla activa en `ui/app.tsx`) fijado en `--app-design-width` (1024px) de ancho lógico —
`zoom: clamp(600px/1024px, 100vw/1024px, 1)` lo achica para que ocupe el ancho real de la ventana,
sin subir de 1 en pantallas más anchas que el diseño. `zoom` no es estándar CSS, pero Chromium (el
navegador de referencia, ver "Stack" arriba) lo soporta bien y evita la complejidad de un
`transform: scale()` (que no reserva su propio espacio de layout — hay que compensarlo a mano con
posicionamiento absoluto).

Tres problemas reales, no teóricos, que esto trajo — los tres agarrados por el usuario probando en el
navegador, no en revisión de código:

1. `100svh` dentro de un ancestro con `zoom` sigue resolviendo contra el viewport real (no contra el
   `zoom` del ancestro), así que el propio `zoom` termina achicando esa altura de nuevo al
   renderizar — cada pantalla, ya zoomeada al ancho correcto, quedaba más baja que la ventana real,
   con un espacio en blanco abajo. Confirmado con un HTML de prueba aislado en Playwright antes de
   tocar la app real (mismo método que los fixes de scroll) y corregido con `--app-height`
   (`tokens.css`): dividir `100svh` por el mismo factor de zoom cancela exactamente el achique que el
   `zoom` le aplica después — cada pantalla usa `var(--app-height)` en vez de `100svh` directo
   (`sale-screen.tsx` y el resto de `ui/screens/*.tsx`, más `error-boundary.tsx`). `fatal-error.ts` es
   la única excepción a propósito: escribe directo a `document.body`, fuera de `.app-zoom-wrapper`,
   porque tiene que seguir funcionando aunque lo que se haya roto sea el bootstrap de la
   propia app — no le conviene depender de esta lógica.
2. `.app-zoom-wrapper` con ancho fijo en `--app-design-width` a secas dejaba un espacio en blanco a
   la derecha en ventanas más anchas que 1024px (`zoom` ya clampeado a 1 ahí) — antes de este cambio,
   el grid ya ocupaba el 100% real disponible en esas pantallas, así que esto era una regresión real,
   no el comportamiento previo. `width: max(var(--app-design-width), 100%)` resuelve las dos zonas
   con una sola regla: por debajo de 1024px de viewport gana el ancho lógico fijo (lo que necesita el
   `zoom` para escalar bien); a partir de 1024px, `100%` ya es mayor o igual, así que gana el ancho
   fluido real. `--app-zoom` (`tokens.css`) quedó como variable compartida entre `.app-zoom-wrapper` y
   `--app-height`, en vez de que cada una recalculara su propia versión de la fórmula del zoom — la
   versión anterior de `--app-height` asumía el zoom sin clampear, así que por encima de 1024px de
   viewport quedaba mal compensada de todos modos (mismo bug, dos síntomas).
3. `viewportWidthSignal` (`ui/state/viewport.ts`) se actualizaba con `window.addEventListener
   ('resize', ...)` — en el modo "Responsive" de Chrome DevTools, arrastrar el handle de resize dejaba
   `window.innerWidth` desactualizado durante buena parte del arrastre (el aviso de ancho mínimo
   aparecía muy por debajo de los 600px reales, no justo ahí). Se cambió a `ResizeObserver` sobre
   `document.documentElement` — mismo criterio que `ui/hooks/use-scroll-indicator.ts`, que ya usa
   `ResizeObserver` en vez de un listener suelto por la misma razón: seguir el tamaño real que el
   navegador termina renderizando, atado a su pipeline de layout, en vez de depender de cuándo (o si)
   se dispara un evento. Verificado con un resize programático paso a paso en Playwright: el límite
   quedó exacto en 600px en las dos direcciones (antes tenía un desfasaje de unos pocos px, además del
   reportado en DevTools).

Por debajo de `MIN_SUPPORTED_WIDTH_PX` (600px, `ui/state/viewport.ts`), `ui/app.tsx` reemplaza toda la
app por `ui/screens/unsupported-screen.tsx` — a propósito **sin** `.app-zoom-wrapper`, para que el
mensaje se renderice a tamaño real en vez de forzado al ancho de diseño zoomeado (que a esa altura ya
no entraría en la ventana). `viewportWidthSignal` es el único lugar de la app que rastrea el tamaño
del viewport — mismo criterio que `navigator.onLine`/`window.addEventListener
('online', ...)` en `sync/engine.ts`: leer un global del browser en un solo punto, no repetido por la
UI.

**Preselección del menú de "/" (issue #40)**: se planteó primero como nota rápida ("anotar: …",
para cargarlo como issue a futuro) y terminó implementándose en el mismo ciclo, a pedido explícito
del usuario poco después — ver "UX keyboard-first" más arriba (sección "Menú de '/'") para el detalle
completo del cambio y su razonamiento.

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
literal con los métodos del puerto) para `sync/engine.ts` — así `pushPendingLot`/`runPullCycle` se
testean contra el puerto, no contra HTTP.

`e2e/keyboard-only.spec.ts` (Fase 4) es la "auditoría de accesibilidad por teclado" del roadmap
hecha verificable en CI: un test por pantalla popup, navegando solo con teclado, que confirma
explícitamente que la barra de comandos recupera el foco al volver — no una revisión manual sin
rastro.

`e2e/helpers.ts` (Fase 6) reúne acciones de setup que varios specs repiten y que tienen que pasar
por la UI real, no por IndexedDB directo (`openCashSession`: sin turno abierto no se puede cobrar,
así que todo spec que llegue a `/COBRAR` lo necesita) — distinto de `indexed-db.ts`, que es
lectura/escritura cruda para datos que en producción vendrían de un pull (`CustomerAccount`) y que
no tiene sentido ejercitar por UI en cada test.

`e2e/fixtures.ts` (Etapa 2b) exporta un `test` de Playwright que siembra una conexión `active`
(`ACTIVE_CONFIG`, con `verifiedAt`, sucursal y punto de venta, apuntando a un backend inalcanzable)
y un id de dispositivo (`seedDeviceIdentity`, una vez por pestaña) antes de cargar la app: sin
conexión activa la app solo muestra `/CONFIG`, así que todo spec que ejercite la app ya conectada
(y offline) importa `test`/`expect` de ahí en vez de `@playwright/test`. Los que prueban el
arranque y la configuración (`connection-lifecycle`, `minibackend-sync`) usan el de Playwright a
secas. Para los unit tests, `src/test/fake-connector.ts` da un `Connector` de mentira. Un bug real de
esta etapa, encontrado por el e2e y no por jsdom: `useSignalEffect` corre diferido y dejaba una
ventana en la que tipear tras un error agregaba texto en vez de reemplazarlo — se usa
`useLayoutEffect`.

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
- Ciclo 8, sobre una tanda de observaciones del usuario tras usar el Ciclo 7: orden alfabético y
  desambiguación por fecha de alta en la lista de `@`; `/DEMO_RESET` (retoma el issue #36) y
  `/DESCARTAR`, los dos sin confirmación de más de un paso; grid `1fr clamp(320px, 33.333%, 420px)`;
  Total siempre visible; más margen y "bigotes" en el indicador de scroll del carrito; placeholder de
  la barra de comandos (no cierra el issue #24, queda abierto); ~22 clientes de ejemplo; preselección
  de la fila 0 del menú de "/" (issue #40); Esc cierra el overlay sin tocar el buffer (issue #28); y,
  reabriendo a propósito la decisión del Ciclo 7 de un único layout, zoom responsive por debajo de
  1024px con un piso de 600px (por debajo, pantalla bloqueada) — ver "UX keyboard-first" y "Diseño
  visual" más arriba para el detalle completo de cada uno, incluidos varios bugs reales encontrados
  probando en el navegador (no solo en revisión de código) y corregidos en el mismo ciclo: el grid no
  respetaba la proporción 2/3–1/3 al ancho de diseño, el zoom no rellenaba pantallas más anchas que
  1024px, una fecha con `Intl.DateTimeFormat` sin `timeZone: 'UTC'` podía mostrar el día equivocado
  según la zona horaria de la terminal, y el tracking de ancho de viewport (`window.addEventListener
  ('resize', ...)`) tenía un desfasaje real corregido con `ResizeObserver` — aunque el caso puntual de
  arrastrar el handle de resize en el modo "Responsive" de Chrome DevTools sigue sin resolverse
  (issue #41, impacto bajo).
- Ciclo 9, sobre una sesión de brainstorming dedicada a `feature:cobro` (2026-09-16): Cobro pasa de
  un único input tipo comando (solo efectivo) a un diálogo modal con 6 campos de monto simultáneos y
  siempre visibles — Efectivo, Tarjeta de Débito, Tarjeta de Crédito, Transferencia, Código QR,
  Cuenta corriente. `Payment.method` se amplía de `'cash'|'card'|'other'|'account'` a esos 6 medios
  reales (se retira el catálogo abierto `'other'`), y `domain/tender.ts::resolveTender` (función
  pura, nueva) resuelve los `Payment[]` netos a partir de lo tipeado por medio: solo Efectivo puede
  exceder lo que falta cubrir (el excedente es vuelto), el resto de los medios nunca puede superar el
  total o es un error de validación al confirmar (Ctrl+Enter) — nunca bloquea el tipeo. Esto resuelve
  de raíz el bug del arqueo que no descontaba el vuelto entregado: `Payment.amount` pasa a ser
  siempre el neto aplicado, nunca el monto tendido. Cuenta corriente se deshabilita en el modal sin
  cliente adjunto (el margen sigue validándose recién al confirmar, igual que antes). El vuelto se
  pasa al comprobante por un signal efímero (`ui/state/receipt.ts::receiptChangeSignal`) en vez de
  persistirse en `Sale` — no hay hoy ningún consumidor (como una reimpresión desde Historial) que lo
  necesite después de mostrado el comprobante. Consolida y cierra las issues #48 (bug del vuelto),
  #50 (selección de medio de pago) y #55 (rediseño de Cobro como modal, parte del epic #49) en una
  sola — ver #55 para el diseño completo. La sesión de brainstorming dejó además dos issues de
  backlog para más adelante: #59 (cobranza de cuenta corriente, pagar deuda existente sin venta —
  dominio distinto, no toca `Sale`/`Payment`) y #60 (advertir cuando el vuelto supera la denominación
  de billete más grande, necesita config de denominaciones que no existe hoy).

- Ciclo 10, sobre una sesión de brainstorming dedicada a `feature:caja` (2026-09-16, PR #65):
  `/CAJA` pasa a ser puramente transaccional — ciego en cada paso (apertura, conteo), solo muestra
  el desglose agregado en la confirmación de cierre y, ya cerrado, únicamente la diferencia del
  arqueo. Todo lo de "cómo vamos" se muda a un comando nuevo, `/RESUMEN`
  (`ui/screens/cash-summary-screen.tsx`, `ui/keyboard/cash-summary-controller.ts`,
  `storage/cash-summary-repository.ts`): panel lateral fijo (total recaudado, tickets, desc/recargos,
  efectivo, otros pagos) + 3 pestañas — Tickets (lista con cabecera sticky y navegación por ticket,
  `useTicketListNavigation`), Productos (cantidades vendidas, `calculateProductQuantities`) y Medios
  de pago. Funciona con turno abierto o, si no hay, con el último cerrado; sin ninguno, error. El
  filtro es independiente por pestaña, busca también por SKU/código de barras y resalta
  coincidencias (`ui/highlight.tsx`). Atajos: Alt+1/2/3 y Tab/Shift+Tab cambian de pestaña; una
  tecla imprimible con el foco en un botón vuelve al buscador y continúa el texto. Esta pantalla es
  la primera que acepta mouse (filas y botones clickeables) — cada click devuelve el foco al
  buscador, y el `mousedown` sobre cualquier cosa no enfocable se cancela (si no, el foco cae a
  `<body>` y los `keydown` dejan de llegar al contenedor). "Las demás pantallas siguen sin mouse" quedó
  reemplazado por el patrón de la Etapa 2 de #94 (ver "Teclado y mouse").

- Conectores plugin (epic #66, sesión de brainstorming 2026-09-17): Etapa 1 (#67) — conector de
  Google Sheets aislado (`connectors/google-sheets/`) con un puente Apps Script; Etapa 2 (#68) —
  registro cerrado de conectores (`sync/connector-registry.ts`), `/CONFIG` como modal con selector de
  tipo (absorbe #56), config guardada sin `type` leída como REST y `/DEMO_RESET` bloqueado con
  Sheets. Al contrastar el spec con el código aparecieron tres puntos que el spec no cubría (la
  migración de la config vieja, `/DEMO_RESET` sin `baseUrl`, y que `/CONFIG` nunca precargaba lo
  guardado) — se resolvieron con el usuario, ver el plan en
  `docs/superpowers/plans/2026-09-21-registro-de-conectores-etapa-2.md`. Un bug real, encontrado por
  el e2e y no por los tests de jsdom: la selección del campo con error se aplicaba con
  `useSignalEffect` (diferido), dejando una ventana en la que tipear agregaba texto en vez de
  reemplazarlo — se pasó a `useLayoutEffect`. Etapa 2b (#76, tras la prueba manual de la Etapa 2
  contra el minibackend y una planilla reales): conexión verificada — probar antes de guardar,
  limpiar lo local al cambiar de origen con una advertencia clara (con un último intento de enviar lo
  pendiente al conector actual), arranque bloqueado sin conexión activa, sin valores por omisión y
  estado de sync honesto (cierra #53) — ver "Ciclo de vida de la conexión". Etapa 2c (#77): comandos
  declarados por conector y tipo `rest-demo` — `/DEMO_RESET` solo con ese tipo, ver "Comandos por
  conector". Etapa 2d (#80): planilla de Sheets toda en español con acceso por encabezado, pestañas de
  tamaño exacto con fila plantilla y formato por columna, fechas reales; permisos mínimos
  (`@OnlyCurrentDoc`) a propósito — un spike mostró que las tablas nativas exigen un scope más amplio y
  se descartaron. Etapa 3 (#69) cierra el epic: crédito ilimitado explícito en cuenta corriente — la
  única pieza de todo el trabajo que toca dominio compartido, no algo aislado en `connectors/`.
  `ConnectorCustomer` (`sync/connector.ts`) y `CustomerAccount` (`domain/customer.ts`) suman
  `unrestricted?: boolean`: una capacidad declarada por el backend/conector para ESE cliente puntual,
  no algo que el POS infiera de qué conector está activo. `splitConnectorCustomer` arma la cuenta
  cuando `unrestricted === true` aunque falten `creditLimit`/`margin`/`balance` (se completan en `0`,
  valores que quedan sin usar — no es "inventar crédito", ver "No inventar datos que no llegaron del
  backend"); `canChargeOffline` aprueba sin evaluar `availableCredit` si la cuenta es `unrestricted`,
  y sin cuenta cacheada sigue rechazando igual que siempre (`unrestricted` nunca fabrica una cuenta
  desde cero, solo cambia qué pasa una vez que ya hay una). El conector de Sheets (Etapa 1) puebla
  `unrestricted: true` en cada cliente de `pullCustomers` — es el único conector que lo hace hoy; REST
  también puede declararlo por cliente si el backend lo manda, sin cambios de código.

- Rediseño de sincronización por lotes (issue #87, spec
  `docs/superpowers/specs/2026-09-22-sync-por-lotes-design.md`, sesión de brainstorming 2026-09-22):
  "el POS vende... y el backend es responsable de aceptar cualquier cosa" — el contrato pasa de
  10 endpoints por recurso/evento a dos operaciones batch (`pushBatch`/`pullBatch`) con cadencias
  propias, gateadas entre sí (un pull nunca aplica datos mientras un lote de push que le interesa
  siga sin resolverse). Dividido en dos etapas como el epic #66: **Etapa 1** (PR #89, mergeado) —
  contrato nuevo, motor de sync, `demo-backend` y `connectors/rest/` de punta a punta;
  `connectors/google-sheets/` recibió primero un adaptador mecánico (mismos endpoints de `bridge.gs`
  de antes de #87, sin tocar el puente). **Etapa 2** (cierra el issue) — batch real en `bridge.gs`:
  `pushBatch`/`pullBatch` reemplazan las acciones por evento/recurso, un evento que falla dentro de
  un lote queda como *issue* del lote sin tumbar el resto ni el ack (`_PushLots`, hoja oculta,
  reemplaza a `_Idempotency` — la idempotencia pasa a ser por lote, no por evento), y se sumó cursor
  real para Productos/Clientes vía fingerprint por fila (`_Snapshot`, ver "Connector API" y el README
  del conector) — decisión del usuario, tomada contra mi recomendación inicial de dejarlo para más
  adelante como límite documentado. Reemplaza la cadencia que se acababa de construir en los
  PR #83/#84 horas antes de la sesión de brainstorming original. Cierra parcialmente el issue #13
  (ver "Connector API" más arriba) — la mitad de esa issue sobre notificación asíncrona de
  discrepancias de negocio (ej. descuadre de stock) sigue sin diseñarse, se re-scopeó ahí mismo.

- Observabilidad de sync y `/DIAGNOSTICO`: un usuario probando el conector de Sheets contra un
  despliegue real de `bridge.gs` se topó con un error de sync sin poder ver el detalle — la Console
  del navegador no mostraba nada, solo la pestaña Network. Log de los últimos 20 intentos reales de
  push/pull (`syncLogSignal`) más `console.error`/`warn`/`info` según el resultado, y un comando
  nuevo de solo lectura para verlo sin DevTools — ver "Patrón outbox" más arriba para el detalle
  completo. Clasificado como trabajo *bounded* (brainstorming): apoya en patrones ya existentes
  (`ui/errors.ts`, los signals de `ui/state/sync.ts`, comando+pantalla de `/RESUMEN`), sin spec
  aparte.

- Contrato del Connector API v3 (Etapa 1 del epic #94, issue #96, absorbe #90; spec
  `docs/superpowers/specs/2026-09-23-contrato-connector-api-v3-design.md`, plan
  `docs/superpowers/plans/2026-09-23-contrato-connector-api-v3.md`): sobre por evento con `origin`
  estampado al encolar, `deviceId` por request, estados de lote `queued`/`processing`/`ok`/`issues`
  con avisos `{ message, eventId? }`, eventos `cash-movement` y `customer-payment` (sin UI todavía),
  `cash-session` eliminado, bloqueos y `createdAt` en el pull — implementado en el dominio, el motor,
  `/CONFIG` (Sucursal y Punto de venta opcionales hasta la Etapa 2), `/DIAGNOSTICO`, `pos.deviceId()`, el conector
  REST, el de Google Sheets (lado TS y puente) y el minibackend. El minibackend separa la
  **recepción** de un lote (`queued`) de su **procesamiento** (`demo-backend/src/lots.ts`: los efectos
  — stock, saldos, filas — recién al terminar); el panel `/_demo` puede demorar los lotes nuevos y
  avanzarlos a mano (Empezar / Terminar OK / Terminar con aviso), bloquear productos y clientes, y
  lista movimientos de caja y cobranzas con su identidad. Su base SQLite lleva `SCHEMA_VERSION`
  (`PRAGMA user_version`): una base de otra versión se recrea vacía y el arranque resiembra. Una
  desviación del plan: `ensureColumns` del puente solo agrega columnas opcionales (ver "Connector
  API").

- Identidad de terminal, `/CONFIG` como wizard y teclado + mouse (Etapa 2 del epic #94, issue #97;
  spec `docs/superpowers/specs/2026-09-23-identidad-terminal-y-wizard-config-design.md`, plan
  `docs/superpowers/plans/2026-09-23-identidad-terminal-y-wizard-config.md`): ciclo de vida del id de
  dispositivo (sin id, la terminal arranca de cero con la config precargada sin probar), sucursal y
  punto de venta obligatorios (estado `incomplete`), `/CONFIG` como wizard de 6 pasos con modelo puro,
  mantener o borrar lo local a elección al cambiar de conexión (nunca se borra solo), lotes
  conservados con el mismo origen, `/COBRAR` deshabilitado sin artículos ni cliente, y el patrón
  teclado + mouse en venta, `/CONFIG`, `/ANULAR`, comprobante, `/DIAGNOSTICO`, `/DEMO_RESET` y
  `/RESUMEN` — ver "Ciclo de vida de la conexión", "Teclado y mouse" y "Menú de '/'". Los e2e siembran
  un id de dispositivo por pestaña (`e2e/fixtures.ts::seedDeviceIdentity`): sin él, cada spec con una
  config sembrada arrancaría como una terminal que perdió su identidad.

- Pull con eventos reaplicados y limpieza a 7 días (Etapa 3 del epic #94, issue #98; spec
  `docs/superpowers/specs/2026-09-24-pull-con-eventos-reaplicados-y-limpieza-design.md`, plan
  `docs/superpowers/plans/2026-09-24-pull-con-eventos-reaplicados-y-limpieza.md`): datos maestros y
  bloqueos siempre, stock y saldo del backend más los eventos que todavía no refleja (lotes `queued` y
  pendientes nunca enviados) o retenidos con un lote `processing`, ack recuperado del lote en curso, y
  limpieza de lo sincronizado con más de 7 días — ver "Patrón outbox". El contrato sigue en 3.0.0 (solo
  se precisó la semántica de `/sync/pull`); el minibackend y el puente de Sheets ya cumplían sin
  cambios. Desviaciones del plan: `withConnectorCycle` devuelve lo que devuelve el ciclo (para saber si
  el pull salió bien sin mutar una variable desde el callback), y la limpieza trata los movimientos
  como independientes de su venta (surgió al implementarla: un movimiento de anulación quedaba huérfano;
  la anulación como documento propio pasó a #99, la ventana de anulación del día a #110). Quedaron
  #115 (foto completa con stock vacío y movimientos pendientes) y la issue `backlog` #113 (cálculo por
  ítem y marcas propias del POS con un lote `processing`).

**Issues marcados `backlog` en GitHub**: para separar hallazgos que valen la pena pero son más
grandes que un fix de ciclo — a definir/priorizar recién después de terminar las fases ya diseñadas
para esta primera etapa (Fase 5, 6, 7), no antes. Ejemplo: que la falta de stock no debería bloquear
una venta en un POS de mostrador, y que el Connector API no debería poder "rechazar" una venta ya
cerrada de forma síncrona (debería ser una notificación asíncrona aparte). Antes de tomar un issue
para trabajar, revisar si tiene esta etiqueta.

**Issues abiertas sin agendar todavía** (no `backlog`): #23 (detectar entrada de scanner por
velocidad de tecleo — spike aparte, ahora se puede probar sin lector real vía paste+Enter <300ms,
pero sigue necesitando calibrar el umbral), #24 (usar el espacio de la barra de comandos también
para instrucciones mínimas de uso — el placeholder del Ciclo 8 no alcanza, el usuario quiere algo
más completo más adelante), #37 (falta UI para crear/editar documento/teléfono de un cliente — sin
definir cómo), #41 (Ciclo 8 — el zoom responsive no reacciona bien al resize interactivo dentro del
modo "Responsive" de Chrome DevTools; impacto bajo, ver "Diseño visual" más arriba), #42 (crash con
mensaje "null" al abrir DevTools o hacer zoom fuerte del navegador — diagnóstico: advertencia benigna
de ResizeObserver de Chromium tratada como fatal; fix propuesto en un branch aparte
(`fix-42-crash-devtools-zoom`), pendiente de que el usuario lo valide con DevTools real antes de
mergear — no se pudo reproducir de forma confiable en un entorno automatizado, ver "Manejo de
errores" más arriba). #28, #36 y #40 se cerraron en el Ciclo 8 (Esc cierra el overlay sin tocar el
buffer, `/DEMO_RESET`, y preselección del menú de "/", respectivamente).

**Fase 5 (hardware) pospuesta a v2** — decisión tomada al terminar Fase 4: depende de dispositivos
físicos reales (impresora, cajón) para poder validarse en serio, y ninguna fase posterior depende
de que esté hecha. Se avanza directo a Fase 6. Detalle completo de la decisión y el nuevo orden en
§11 del documento de diseño.

**Fase 6 completa (multi-terminal y caja)**: la reconciliación de catálogo/saldo entre terminales
ya estaba resuelta desde Fase 2/3 (cada pull sobrescribe con el dato del backend, que siempre
manda) — confirmado con el usuario antes de arrancar, no se agregó nada nuevo ahí. El trabajo real
fue turnos de caja: `domain/cash-session.ts` (`CashSession`, `openCashSession`/`closeCashSession`/
`calculateCashSessionSummary`), `storage/cash-session-repository.ts` (persistencia; hasta el
contrato v3 también el outbox al cerrar), comando `/CAJA` y pantalla nueva (`ui/screens/cash-session-screen.tsx`) para abrir/cerrar
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
