# src/sync — sincronización, contrato y conexión

Detalle de implementación del sync. Los principios (outbox, "el backend nunca rechaza",
compatibilidad del contrato, ciclo de vida de la conexión) y el índice de temas están en el
[`AGENTS.md` de la raíz](../../AGENTS.md). Estas reglas rigen también el código de `domain/` y
`storage/` que las implementa: `domain/outbox.ts`, `domain/push-lot.ts`, `domain/reapply.ts`,
`domain/local-cleanup.ts`, `domain/contract-version.ts`, `storage/apply-pull.ts`,
`storage/reconcile.ts`, `storage/local-cleanup.ts` y `storage/local-data.ts`.

## Identidad de cada evento y del dispositivo

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
**obligatorios** desde #97 (estado `incomplete`, ver "Ciclo de vida de la conexión" en la raíz): el POS los manda
siempre; un evento encolado antes puede llegar sin ellos. Un evento `cash-session` (tipo que v3
eliminó) o `sale-void` (tipo que 4.0.0 eliminó, #99: la anulación viaja como `sale`) que haya
quedado pendiente en una terminal nunca viaja: `storage/local-data.ts::listPendingOutbox` lo excluye
y lo marca como enviado (`domain/outbox.ts::LEGACY_OUTBOX_TYPES`). Un `sale-void` pendiente ya mandó
su stock por sus propios `stock-movement`; se pierde solo el aviso de la anulación (riesgo aceptado,
no hay terminales en producción).

## Push

**Push: un solo lote, un solo ack (#87)**. `sync/engine.ts::pushPendingLot` manda **toda** la cola
`pending` del outbox de una vez, con un `idempotency_id` (ULID) generado al armar el lote y
**congelado** junto con el conjunto exacto de eventos incluidos: un reintento del mismo lote (fallo
de red) reenvía siempre el mismo id y los mismos eventos, nunca recalcula agregando lo que haya
entrado al outbox mientras tanto — eso evita duplicar un lote que sí llegó pero cuyo ack se perdió.
El backend nunca rechaza el contenido de un lote (ver "Connector API" en la raíz); el ack confirma
solo que lo recibió, no que ya terminó de procesarlo. `domain/push-lot.ts` tiene el backoff
exponencial (mismo esquema que antes, ahora por lote en vez de por evento);
`sync/push-lot.ts` lo persiste en `localStorage` (mismo criterio best-effort que
`sync/cursor.ts`) junto con la lista de lotes ya enviados que todavía no confirmaron `ok`/`issues`.
**En entrenamiento (#177) `pushPendingLot` no hace nada**: es el único que llama a `pushBatch` (el
ciclo, `/SINCRONIZAR` y `flushPendingBeforeWipe`), así que es el único corte. El pull corre igual
sobre la base de práctica, con sus propias claves (`storage/training-mode.ts::operationalKey`, sin
lotes reales), y lo de entrenamiento, `pending` para siempre, se reaplica en cada pull; el conteo de
pendientes de la barra se muestra en 0 (`setPendingOutboxCount`).

## Pull

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
todas las filas (un producto con efectos y sin fila parte de 0), salvo que el backend mande
`stock: []` (#115): eso es "no mandó stock", no "todo en 0", así que ni la foto completa
(`applySnapshotReconciled` con `keepStock`) ni el delta tocan el stock local; el saldo, solo en los clientes que
vinieron con saldo (nunca se inventa una cuenta). Desde #101 el saldo vive en su propia tabla
(`customerBalances`, Dexie v8, que migró el `balance` de cada cuenta): un cliente que vino con
`balance` (tenga o no crédito) toma el del backend más los efectos; uno que vino sin `balance`
conserva el local; la foto completa borra el saldo de un cliente que ya no existe. Un pull que retiene **no es un fallo**
(`sync/pending-lot` se eliminó): devuelve `PullApplication` (`applied` / `reapplied` / `retained`,
`lastPullApplicationSignal` en `ui/state/sync.ts`). El último estado en curso informado se guarda en
el lote en espera (`AwaitingLot.lastStatus`, `sync/push-lot.ts::updateAwaitingLots`) y `/DIAGNOSTICO`
lo muestra ("en cola · N eventos"/"procesando"/"sin informar"), junto con cómo se aplicó el último
pull. Un lote que se resuelve con `issues` no bloquea nada (el POS nunca se autobloquea) — solo se
muestra al humano vía `pushLotIssuesSignal` (`ui/state/sync.ts`, `ui/errors.ts::sync/push-issues`),
formateado con el evento al que se refiere (`ui/format-lot.ts::formatLotIssue`). Pendiente, en
backlog: #113 (cálculo por ítem con un lote `processing`).

## Limpieza a 7 días

**Limpieza a 7 días (#98)**: la terminal borra lo sincronizado con más de 7 días
(`domain/local-cleanup.ts::planLocalCleanup`, pura; `storage/local-cleanup.ts::runLocalCleanup`, una
transacción): eventos `synced` del outbox salvo los de lotes en espera o en curso (hacen falta para
reaplicar, `sync/cleanup-schedule.ts::protectedEventIds`); cada venta por **su propia edad y su propio
evento** (desde #99 una anulación es otra venta, no retiene a la que anula); movimientos de stock y de
cuenta por **su propia edad** — son registros independientes de su venta, el `saleId` es solo
auditoría (con "se borran con su venta" quedaba huérfano el movimiento de la anulación reciente de
una venta vieja);
los movimientos de cuenta con una regla unificada (Etapa 6, #101): esperan a que el evento que los
lleva — el de su venta (`saleId`) o el de su cobranza (`paymentId`) — no esté pendiente, y respetan
el ancla; las cobranzas (`customerPayments`) con la misma regla que las ventas (su propia edad y su
propio evento, y sin ningún arqueo no se borran: suman al saldo de efectivo); movimientos de caja y
arqueos. Los saldos (`customerBalances`) nunca se borran: son estado, como las cuentas. Nunca se borra lo pendiente, el catálogo/stock/clientes/cuentas, la venta en curso ni la
estadística de conceptos (`cashConcepts`), ni lo que sostiene el saldo de efectivo (Etapa 5, #100):
**el ancla es el último arqueo** y todo lo creado desde su `createdAt` se conserva aunque tenga más
de 7 días (ventas, movimientos de stock, de cuenta y de caja, y el propio arqueo); **sin ningún
arqueo** no se borran ventas ni movimientos de caja (son la base 0 del saldo). Un arqueo viejo con
ajuste espera a que el evento de ese ajuste no esté pendiente. En entrenamiento (#177) no corre: la base de práctica es efímera. Cadencia (`sync/cleanup-schedule.ts`): al arrancar y después de cada pull
exitoso, como mucho cada 24 h (`offline-pos:cleanup:last-run`, validado con Zod al leerse — un
registro de la forma anterior, con turnos, se ignora y la limpieza vuelve a correr —, que guarda
también los conteos y la fecha del ancla para `/DIAGNOSTICO`), con el cerrojo de sync (si está tomado, se saltea) y nunca con
`/CONFIG` abierto. `/ANULAR` solo ofrece las últimas 24 h (#99), así que nunca se anula algo que la
limpieza ya borró.

## Log de intentos y `/DIAGNOSTICO`

**Log de intentos y `/DIAGNOSTICO`**: un usuario probando el conector de Sheets contra un
despliegue real se topó con un error de sync sin poder ver el detalle (la Console del navegador no
mostraba nada, solo la pestaña Network). `sync/sync-log.ts::logSyncAttempt` registra cada llamada real
a `connector.pushBatch`/`pullBatch`/`getInfo` (`kind` `push`/`pull`/`info`) — `request`/`result` son literalmente lo que el call site ya
tiene en la mano, sin resumir, para poder correlacionar con Network — en `syncLogSignal`
(`ui/state/sync.ts`, tope de 20, más nuevo primero, sin persistir). Un ciclo exitoso no toca la
consola; un fallo real (`sync/request-failed`, `sync/remote-error`, etc.) hace `console.error`; un
pull que retiene stock y saldo (comportamiento esperado de la regla de arriba, no un problema) hace
`console.info`; un lote resuelto con `issues` hace `console.warn`. La entrada de un pull exitoso
guarda también cómo se aplicó (`SyncLogEntry.application`). `/DIAGNOSTICO` (comando core,
`ui/screens/diagnostico-screen.tsx`) muestra ese log completo más la conexión actual, el cerrojo del
motor (`sync/engine.ts::isSyncLockHeld`), el estado del backend (contrato y `ok`/mantenimiento/
incompatible, #99), el id de dispositivo, los lotes en espera con su último
estado y su cantidad de eventos, el lote en curso "no recibido por el backend", cómo se aplicó el
último pull y la última limpieza de datos locales con su ancla — de solo lectura, mismo patrón de
teclado que `/RESUMEN`. Desde 4.4.0 (#128) también las capacidades del backend ("sin consultar",
"ninguna" o la lista), desde 4.5.0 (#193) la empresa ("Empresa: …" o "no informada") y la sección "Avisos del backend" (severidad, mensaje y `ref` como "tipo id"). Desde la Etapa 2 de #94 también se abre con un click en la barra de estado
(ver "Barra de estado" en `src/ui/AGENTS.md`).

## Cadencias

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

## Foto completa y bajas

**Foto completa y bajas**: sin cambios de fondo respecto de antes de #87 — un pull sin cursor de un
recurso es la fuente de verdad de ese recurso (`storage/reconcile.ts::applySnapshotReconciled`
dentro de la transacción de `storage/apply-pull.ts`, todo o nada, nunca toca ventas/caja/movimientos/outbox/venta en curso), cada conector declara su
`pullMode` (`connector-registry.ts`), la foto completa de un conector `delta` se repite cada 2 h
(`sync/full-refresh.ts::FULL_REFRESH_INTERVAL_MS`, antes 1 h) además de al arrancar y a pedido.

## Cuenta corriente: la reserva de crédito síncrona

Cuenta corriente (Fase 3) es el único flujo que a propósito puede requerir red síncrona: al confirmar
un cobro con monto en el campo Cuenta corriente, `ui/keyboard/checkout-controller.ts` llama `sync/account-hold.ts::requestAccountHoldNow`
directo (salvo en entrenamiento, #177: la reserva es una escritura en el backend, así que se evalúa
siempre offline) — la **única** operación del `Connector` que no pasa por el outbox ni se reintenta con
backoff, porque necesita una respuesta ya para decidir el flujo (§5). Si se aprueba, el `holdId`
viaja como `Payment.reference` y se confirma con un evento `'account-hold-confirm'` propio, encolado
en la **misma transacción** que la venta (`storage/sale-repository.ts`) — así sobrevive a que la red
se corte justo después de aprobado (RF-19). Sin red, se evalúa el saldo (`customerBalances`, sin
saldo conocido cuenta 0) + `creditLimit` + `margin` (dato del backend por cliente, no config local —
`domain/customer.ts::canChargeOffline(account, balance, amount)`, desde #101 con el saldo aparte); si
no hay `CustomerAccount` cacheada todavía, se rechaza sin inventar una con crédito en cero — **un
saldo a favor no habilita fiado**. Un
hold aprobado que termina sin usarse (cobro cancelado) se libera con `'account-hold-release'` —
antes de #87 se trataba aparte como "best-effort"; con push por lote deja de necesitar ese trato
especial, es un evento más del lote, igual que documenta §6 para el vencimiento del lado del backend.

## Contrato: qué trajo cada versión

**Contrato 4.6.0 (#178)** — aditivo (spec
`docs/superpowers/specs/2026-10-04-contrato-4-6-portal-design.md`):
- **Capacidad `portal`**: `GET /info` la declara con `portal: { command, label }` y
  `POST /portal-links` devuelve `{ url, expiresAt? }`, la URL que el backend decide según la key (link
  con autorización de un uso o de varios, o su login); la key nunca va en la URL y el link nunca viaja
  en el pull. El demo-backend la implementa con `/PANEL` (link de un solo uso, 60 s,
  `GET /_demo/portal/<token>`).
- **El portal en el POS (#179**, spec `docs/superpowers/specs/2026-10-04-portal-en-el-pos-design.md`):
  `backendInfoSchema.portal` (`command` `^[A-Z0-9_]{2,16}$`, `label` no vacío; mal formado cuenta
  como ausente, con `.catch`) y `ProbeSnapshot.portal`. `sync/backend-portal.ts` lo guarda como la
  empresa (`localStorage` por carpeta y `backendPortalSignal`; lo escriben `applyConnection` y
  `refreshBackendStatus`, si deja de venir se borra, lo restaura `bootstrap`), así el botón se ve
  aunque se arranque sin red. `portalOffer` (pura) decide qué se ofrece: hacen falta la capacidad
  **y** el objeto; un nombre que choca con uno del POS pasa a `PORTAL` (los nombres reservados los
  pasa la UI). `sync/portal-link.ts::requestPortalLink` hace el `POST /portal-links` fuera del puerto
  (`rest` y `rest-demo`; con `google-sheets`, la acción `portalLink` del puente vía `callBridge`,
  que devuelve la URL de la planilla, #180), con
  `buildHeaders` y `failedResponse` del conector REST y `sync/http-body.ts` (el `ErrorBody` y la
  lectura del JSON, compartidos con `demo-session.ts`): 404 → `portal/not-offered`, 503 →
  `sync/backend-maintenance` con su `message`, 409 → incompatible, 401/403 → `sync/request-failed`
  con su status (la UI decide si es la demo que terminó), sin red → `sync/request-failed` sin status.
  La URL tiene que pasar `isAllowedBackendUrl`; `expiresAt` mal formado se ignora. Sin reintentos;
  la URL no se guarda ni entra al log de sync. La UI, en "Portal" de `src/ui/AGENTS.md`.
- **Errores** (`ErrorBody { code, message? }`, `Retry-After`, que el backend expone por CORS):
  `503 maintenance` en push, pull, holds, demo-sessions y portal-links (el sync ya lo manejaba: no es
  fallo de red, consulta `/info`); en `/demo-sessions`, `429 rate-limited` y `503 demo-capacity`.
  `sync/demo-session.ts` los traduce a `demo/rate-limited` (con los segundos de `Retry-After`, solo
  enteros), `demo/capacity` y `sync/backend-maintenance`, sin reintentar. El demo-backend los simula
  desde el panel. Que `/account-holds` con 503 caiga a la evaluación offline sigue en #187.

**Contrato 4.5.0 (#193)** — aditivo (spec
`docs/superpowers/specs/2026-10-03-empresa-sucursal-y-caja-design.md`): `GET /info` suma
`company: { name }` opcional, el comercio de la key. El POS la guarda como las capacidades
(`sync/backend-company.ts`, `localStorage` por carpeta y `backendCompanySignal`): la actualiza con
cada `/info` exitoso (`refreshBackendStatus`), la toma de la prueba al aplicar una conexión
(`ProbeSnapshot.company`) y la borra si el backend deja de mandarla. Mal formada o con el nombre vacío
cuenta como ausente (`backendInfoSchema` con `.catch`). No es una capacidad. El demo-backend la manda
(el nombre de la demo según la plantilla con una key de demo, el del alta con la del comercio); el
puente de Sheets no, y sigue compatible por el piso. La UI, en "Barra de estado" de `src/ui/AGENTS.md`.

**Contrato 4.4.0 (#128)** — aditivo, la última versión antes del MVP (spec
`docs/superpowers/specs/2026-09-28-onboarding-demo-contrato-4-4-design.md`):
- **Piso de compatibilidad**: `domain/contract-version.ts::isCompatibleContract` compara contra
  `MIN_BACKEND_CONTRACT = '4.0.0'`, no contra `POS_CONTRACT_VERSION` (4.4.0): mismo major, minor ≥ 0.
  El mensaje de incompatible dice "se necesita 4.0 o posterior". Un backend 4.2 (como Sheets)
  vuelve a sincronizar sin tocarlo.
- **Capacidades** (`GET /info.capabilities`, ausente = `[]`): `demo-sessions` y
  `customer-payment-void` (`sync/backend-capabilities.ts`). Las del último `getInfo` exitoso se
  guardan en `offline-pos:backend-capabilities` y en `backendCapabilitiesSignal` (estado operativo
  best-effort, como los cursores): una terminal que arranca sin red las sabe igual. Las escriben la
  prueba de conexión (`ProbeSnapshot.capabilities`, vía `applyConnection`) y `refreshBackendStatus`, y
  las restaura `bootstrap`. `supportsCapability` distingue `true`/`false`/`undefined` (nunca se supo:
  terminal previa a 4.4.0 que arranca sin red). Se leen solo de la lista, nunca se deducen de la
  versión; un nombre desconocido se ignora. Hoy las usa `/ANULAR` (ver `src/ui/AGENTS.md`).
- **Avisos** (`notices` en el pull, `sync/backend-notices.ts`): la lista vigente y completa del
  backend, sin acuse ni descarte local. Cada pull aplicado la reemplaza entera
  (`offline-pos:backend-notices`, `backendNoticesSignal`; ausente = `[]`), y también la prueba al
  aplicar una conexión; un pull fallido no la toca. Se validan uno por uno: uno mal formado se
  descarta sin tirar el pull. `mostSevere` da el color de "Avisos (N)". Nunca bloquean nada. Sheets
  no los manda.
- **Tolerancias** (reglas de evolución, `sync/connector.ts`): ningún schema de red es estricto (un
  test lo fija); `status` de `/info` desconocido → `ok`; `severity` desconocida → `info`; un estado de
  lote desconocido, un `issues` con los avisos mal armados o algo sin estado → **`issues` con un aviso**
  (desvío aprobado en la Tarea 2: `processing` podría quedar colgado para siempre).
- **Stock vacío** (#115): ver "Pull" más arriba.
- `POST /demo-sessions` y la vuelta con `#connect`: ver "Onboarding de demo" más abajo.
- **Demo revocada** (#176, aclaración sin cambio de forma, sigue 4.4.0): un backend revoca una demo
  respondiendo 401 a su key; ver "Onboarding de demo" más abajo.

**Contrato 4.3.0 (#125)** — aditivo: `CustomerPayment.voidsPaymentId?`, la anulación de una cobranza
como otra cobranza negativa (mismos medios, total invertido, su propio recibo). Viaja como un
`customer-payment` más: la reaplicación (`-total`) y la limpieza ya la cubren. Un POS 4.3.0 ve
incompatible a un backend 4.2 ("se necesita 4.3 o posterior"). El minibackend la acompaña (su saldo
ya se mueve por `-total`; el panel muestra qué anula cada documento). El puente de Sheets y los backends externos que no se actualizaron quedaron en 4.2 —
compatibles de nuevo desde el piso de 4.4.0 (el puente se mantiene con piso desde el epic #166).

**Contrato 4.2.0 (#101)** — aditivo: `CustomerPayment.receipt?: { date, number }` (el número de
recibo en su día local, con contador propio) y `ConnectorCustomer.balance` pasa a ser **el saldo de
cualquier cliente, tenga o no crédito** (un `balance` sin `creditLimit`/`margin` es "saldo sin
cuenta corriente"; un backend que no lleva saldo lo omite y el POS conserva el local). Un POS 4.2.0
ve incompatible a un backend 4.1 ("se necesita 4.2 o posterior"). El minibackend lleva el saldo de
cualquier cliente (arranca en 0 con su primer movimiento) y muestra recibos y saldos en `/_demo`; el
puente de Sheets (hay que redesplegar `bridge.gs` y `columnas.gs`) escribe "Fecha del recibo" y "N°
de recibo" en Cobranzas y calcula el saldo de cada cliente sumando el libro `CuentaCorriente` (entra
en el fingerprint, así viaja en el delta).

**Contrato 4.1.0 (#120)** — aditivo: `Sale.ticket?: { date, number }`, el número del ticket en su
día local (ver "Numeración" en `src/domain/AGENTS.md`). Por la regla de compatibilidad, un POS 4.1.0
ve **incompatible** a un backend 4.0.0 (podría no guardar el número): el minibackend y el puente de
Sheets (hay que redesplegar `bridge.gs`: dos columnas opcionales nuevas en Ventas, "Fecha del
ticket" y "N° de ticket") hablan 4.1.0. El mensaje dice "se necesita 4.1 o posterior"
(`domain/contract-version.ts::contractRequirement`). `sync/connector.ts` no tiene schema de venta
(las ventas solo se empujan), así que del lado del POS no hubo nada que aceptar.

**Contrato 4.0.0 (#99)** — la anulación es un **ticket propio**: viaja como un evento `sale` más, con
líneas y pagos invertidos y `voidsSaleId` apuntando al original (sale `sale-void`: 7 tipos de evento;
`Sale.status` solo `closed`, sin `voidedAt`). `GET /info` informa `contractVersion` y `status`
(`ok`/`maintenance`, con `message?` y `backend?`); todo request lleva `X-POS-Contract-Version`
(REST: header, `sync/connector.ts::CONTRACT_VERSION_HEADER`; Sheets: `contractVersion` en el cuerpo).
Un backend que no habla ese major responde `409 { code: 'incompatible-contract', contractVersion }`
**sin procesar nada y sin ack** — no contradice "el backend nunca rechaza" (es el idioma, no el
contenido) y nada se pierde: el lote sigue congelado en el outbox. **Estado del backend en el POS**
(`sync/backend-status.ts`, `backendStatusSignal`: `unknown`/`ok`/`incompatible`/`maintenance`): se
pregunta `getInfo` al probar la conexión en el wizard (incompatible o mantenimiento hacen fallar la
prueba con su motivo), al arrancar, en `/SINCRONIZAR`, después de un fallo que no sea de red
(`backendCheckDueSignal`) y siempre que llega un 409. Con `incompatible` o `maintenance`
`withConnectorCycle` no corre ningún push ni pull: cada ciclo hace solo un `getInfo` y se retoma solo
al volver `ok`. Un error de red no cambia el estado; con `unknown` los ciclos corren como siempre.
**La venta nunca se bloquea.**

**Contrato v3 (#96)** — 8 tipos de evento: `sale`, `stock-movement`, `sale-void` (4.0.0 lo sacó), `customer`,
`account-hold-confirm`, `account-hold-release`, y dos nuevos: `cash-movement`
(`domain/cash-movement.ts`: ingreso/egreso de caja; el arqueo viaja solo como ajuste
`count-adjustment` con lo esperado y lo contado, y solo si la diferencia no es 0) y
`customer-payment` (`domain/customer-payment.ts`: cobranza sin venta, sin cuenta corriente como medio
y sin vuelto). `cash-movement` lo genera `/CAJA` desde la Etapa 5 (#100); `customer-payment`, la
cobranza sin venta desde la Etapa 6 (#101).
Ninguno se anula (se corrigen con otro registro, RNF-07). `cash-session` se eliminó, y desde la Etapa
5 tampoco existe el turno local. Cantidades con signo y hasta 3 decimales, `Sale.total`/`Payment.amount` pueden
ser negativos (el POS los genera recién en la Etapa 4, los conectores ya los aceptan); un pago
`account` sin `reference` es fiado offline (positivo) o acreditación (negativo). El pull trae
`createdAt` **obligatorio** (fecha de alta real — `splitConnectorCustomer` la usa en vez de la hora
del pull) y `blocked?: { reason }` (bloqueo informativo, nunca impide operar) en productos y clientes;
`blocked` se muestra desde la Etapa 4 como advertencia (ver "Advertencias en vez de bloqueos" en
`src/ui/AGENTS.md`). El puerto: `pushBatch(batch:
PushBatch, idempotencyId)` con `PushBatch = { deviceId, events }`, y `PullBatchParams.deviceId`. Los
schemas Zod de red que comparten los dos conectores TS (`connectorProductSchema`,
`batchLotStatusSchema`, `pullBatchResponseSchema`, `toPullBatchResult`, …) viven en
`sync/connector.ts`, no en cada conector.

## Puerto `Connector` y config de la terminal

`sync/connector.ts` define el puerto `Connector` — vive en `sync/`, no en `domain/`, porque habla en
términos de red (cursores, Idempotency-Key, tipos como `ConnectorCustomer`/`AccountHoldResult`) que
no son vocabulario de dominio puro (`domain/customer.ts::splitConnectorCustomer` es la función pura
que sí traduce esa forma cruda a los tipos del dominio). El motor de sync (`sync/engine.ts`) consume
casi todo el puerto; la única excepción es `requestAccountHold`, invocada directo desde
`ui/keyboard/checkout-controller.ts` vía `sync/account-hold.ts` (ver "Cuenta corriente: la reserva de crédito síncrona" más arriba).

La conexión se configura por terminal vía `/CONFIG` (runtime,
`localStorage` — `sync/config.ts`), desacoplada del contrato: lo guardado es `{ type, …campos del
conector, locale?, branch?, pointOfSale? }` (los tres últimos son config de terminal, fuera de la
unión por `type`; sucursal y punto de venta se estampan en cada evento — el schema los tolera
ausentes al leer, para precargar una config de la Etapa 1, pero sin ellos la terminal queda
`incomplete`), y una config guardada sin `type` (anterior al registro) se lee como
`type: 'rest'` (`z.preprocess` en `syncConfigSchema`), así ninguna terminal ya configurada pierde su
conexión al actualizar. Las implementaciones y el registro de conectores están en
`src/connectors/AGENTS.md`.

- **Config runtime vs. estado operativo interno, en módulos separados**: `sync/config.ts` (lo que edita
  el humano en `/CONFIG`, devuelve `Result`) y el estado interno del motor (`sync/cursor.ts`,
  `sync/push-lot.ts`, contadores; best-effort porque perderlo no rompe nada). Todo bajo el prefijo
  `offline-pos:` de `localStorage`.

## Ciclo de vida de la conexión: aplicar

El principio (solo se activa probada, estados, modo requerido) está en la raíz; el wizard, en
`src/ui/AGENTS.md`.

**Aplicar** — tres caminos según `applyAction`:
- **Solo terminal** (`sync/apply-connection.ts::applyTerminalSettings`, la conexión no cambió):
  guarda sucursal/punto de venta/locale conservando `verifiedAt`, sin prueba ni cerrojo ni IndexedDB.
  De `incomplete` pasa a `active`. Los eventos ya encolados conservan su `origin`.
- **Conexión cambiada, Mantener** (`applyConnection` con `local: 'keep'`): en la transacción de
  siempre, la foto se reconcilia (`storage/reconcile.ts::applySnapshotReconciled`, sin transacción
  propia — la misma que usa el pull, `storage/apply-pull.ts`) — ventas, caja, movimientos, venta en curso y outbox
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
la venta, reanuda el sync y dispara `runPushThenPull()`. Los caminos 2 y 3 también reemplazan las
capacidades y los avisos del backend por los de la prueba (4.4.0), y la empresa (4.5.0): nunca quedan
los de la conexión anterior.

## Onboarding de demo (#128)

El flujo y la excepción de borrado están en "Onboarding de demo" y "Ciclo de vida de la conexión"
del `AGENTS.md` de la raíz. Módulos:

| Módulo | Qué hace |
|---|---|
| `sync/demo-link.ts` (puro, Zod) | `readDemoEntry` (`?demo=true&backend=…&template=…`), `readConnectReturn` (`#connect=…`, base64url de JSON), `buildOnboardingUrl`, `returnUrlFor` (origin + pathname: anda en una subruta), `buildDemoLink` (el link para `/DEMO_NUEVA`, #176), `stripOnboardingParams`, `isAllowedBackendUrl` (`https:`, o `http:` a `localhost`/`127.0.0.1`/`[::1]`; misma regla para `onboarding.url` y el `baseUrl` de la vuelta). Todo `Result`; el único `try/catch` es el decodificado base64/`JSON.parse`. |
| `sync/demo-session.ts` (adaptador HTTP) | `requestDemoSession(baseUrl, template?)`: `POST /demo-sessions` sin API key y con el header de versión, a `Result` (`demo/unknown-template` con la lista, `demo/not-offered` en 404, `demo/rate-limited` y `demo/capacity` desde 4.6.0, y los errores de red de siempre). No pasa por el puerto `Connector`. |
| `sync/wipe-key.ts` | `issueWipeKey`/`consumeWipeKey`: token de un solo uso en `offline-pos:pending-wipe-key` (con su fecha), vence a las 2 h. Se consume siempre que vuelva, haga falta o no. |
| `sync/demo-revoked.ts` | Demo revocada (#176): `isDemoRevokedFailure` (puro: 401/403 con la config en demo), `markDemoRevoked`/`clearDemoRevoked`/`restoreDemoRevoked`, en `demoRevokedSignal` y best-effort en `storageKey('demo-revoked')`. La marca `noteSyncFailure` (por donde pasa todo fallo de `getInfo`, push y pull); con ella `withConnectorCycle` no corre nada, ni el `getInfo`; la borran `syncNow` (vuelve a probar) y `applyConnection`; la restaura `bootstrap`. |
| `ui/onboarding.ts` | `runOnboardingFromUrl`: la orquestación, con dependencias inyectadas. Devuelve `none`/`applied`/`failed`/`review`/`confirm` y `bootstrap` decide qué mostrar. `confirm` (#176) es un link de demo con algo que perder: no pide la demo, la pide la pantalla "Abrir una demo" con `startDemo` (exportada; también la usa el camino directo), que guarda `demo.backend`. |

`SyncConfig.demo?: { template, onboarding: { url, label }, startedAt, backend? }` (fuera de la unión
por `type`, como `branch`/`locale`; `backend` es el del link, #176, ausente en una demo anterior)
marca la terminal en demo; aplicar otra conexión desde `/CONFIG` la
guarda sin `demo`. Una terminal en demo usa el conector `rest`; `rest-demo` y `/DEMO_RESET` quedan
para quien configure a mano el minibackend.

`bootstrap` corre el onboarding **antes** de leer la config (puede cambiarla) y limpia la URL
siempre (`history.replaceState`), así un F5 no lo repite. Si aplicó (lo local se borró), vacía la
venta en curso y el cliente adjunto que ya había restaurado, y vuelve a leer el último arqueo
(`lastCashCountAtSignal`): si no, el aviso "Sin arqueo en 24 h" quedaba con el arqueo borrado. Mientras
espera, `index.html` muestra "Preparando…" dentro de `#app`. Pasar de demo a producción sin repetir el
onboarding queda para después (#143).

## Sin sincronización de fondo mientras `/CONFIG` está abierto

**Sin sincronización de fondo mientras `/CONFIG` está abierto**: un backend lento y de a un request por
vez (el puente de Sheets: cada request toma el lock del script y tarda segundos, con un 302 a
`script.googleusercontent.com` por el medio) no aguanta dos flujos a la vez (el ciclo del conector actual
compitiendo con la prueba del nuevo daba timeouts y "Planilla ocupada"). `enterConfigScreen` pone
`syncPausedSignal` (`ui/state/sync.ts`) en `true` — ningún ciclo arranca — y se reanuda al
cancelar o al aplicar la conexión nueva; y `probeConnection` toma el cerrojo de sync mientras prueba
(espera a un ciclo en curso, hasta `PROBE_LOCK_WAIT_MS`; si no termina, `connection/sync-busy`). Una
prueba cancelada con Esc sigue en vuelo hasta su timeout (el puerto `Connector` no se puede abortar),
así que el cerrojo hace que un reintento espere en vez de apilar requests. El 302 de Apps Script es
normal (POST `/exec` → 302 → GET del resultado): el navegador lo sigue solo y `callBridge` ya lo
maneja; lo que sí es un error real es una respuesta que no es JSON (página de login o de cuota), que
ahora dice qué revisar.
