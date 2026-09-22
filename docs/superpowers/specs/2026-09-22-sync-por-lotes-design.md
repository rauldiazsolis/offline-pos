# Sincronización por lotes: el backend nunca rechaza, casi todo es diferible

Fecha: 2026-09-22
Estado: aprobado por el usuario (diseño completo), pendiente de plan de implementación.

## Contexto

El conector de Google Sheets funciona, pero cada operación de sync es un roundtrip HTTP propio
contra el puente Apps Script: cada uno toma el lock del script de punta a punta y pasa por el
redirect 302 que usa `doPost` (`POST /exec` → 302 → `GET script.googleusercontent.com/…echo`). Un
ciclo de push hoy hace un request **por evento pendiente** (`pushPendingEvents`, loop secuencial en
`sync/engine.ts`) y un ciclo de pull hace 3 requests separados (`pullEverything` en
`sync/pull-snapshot.ts`: productos, stock, clientes). Con varios eventos pendientes o un pull
completo, el roundtrip total se vuelve lento e inestable — y cerca de las cuotas diarias de Apps
Script (ver PR #83, que ya redujo la cadencia de 15 s a 5 min por esta misma razón).

Brainstorming del 2026-09-22 a partir de una propuesta del usuario: "el POS vende, genera la
'basura' que quiera, y el backend es responsable de aceptar cualquier cosa, registrar y dejar
reportes de auditoría" — reformula el contrato entero, no solo el transporte. Este spec reemplaza
la cadencia que se acababa de construir en los PR #83/#84 (mergeados horas antes de esta sesión de
brainstorming): el ciclo de solo envío disparado por evento (`pushOnce`, ~2 s de debounce) y el
intervalo combinado de 5 minutos + foto completa cada 1 hora quedan sin efecto una vez implementado
este diseño.

## Decisión central: el backend nunca valida ni rechaza

El backend **no evalúa el contenido** de lo que el POS manda — nunca. No hay forma de que una
venta, un cliente, un movimiento de stock o un cierre de caja sea "rechazado" por el backend. El
backend registra todo lo que llega y deja su propio rastro de auditoría; cualquier inconsistencia
de negocio se resuelve del lado del backend o a mano, nunca devolviéndole un error al POS.

Esto cierra un punto que ya estaba anotado como backlog sin resolver en `CLAUDE.md`: "que el
Connector API no debería poder 'rechazar' una venta ya cerrada de forma síncrona (debería ser una
notificación asíncrona aparte)".

**Importante, para no confundir esto con "el backend no tiene derechos"**: el backend sí puede, por
motivos propios y ajenos a la validez de los datos (cuota, contrato, decisión comercial, lo que
sea), dejar de aceptar lotes de esta terminal — "cerrar la puerta" está en su derecho. El POS
**nunca hace cumplir esa decisión por su cuenta**: no se autobloquea, no deja de operar solo. Lo
único que hace es mostrarle la advertencia al humano (cajero/dueño) a través del estado de
sincronización (ver más abajo) — la decisión de parar de vender es humana, nunca automática.

## Por qué casi todo puede esperar: funcionamiento desconectado real

El criterio de diseño es el funcionamiento desconectado del POS, que ya era el principio original
del proyecto y que el código ya cumple hoy: crear/modificar un cliente, cerrar una venta, anular
una venta, mover stock y descontar el saldo cacheado de cuenta corriente **ya se hacen localmente,
en la misma transacción Dexie** que encola el evento (`storage/sale-repository.ts`,
`storage/customer-repository.ts`), antes de que exista ninguna sincronización. El POS opera libre
todo el tiempo con esos datos locales — la sincronización nunca es una condición para vender, ver
el stock o cobrar. La única operación que sí necesita una respuesta ya para decidir el flujo del
cobro es la reserva de crédito (`requestAccountHold`, ver "Excepciones síncronas" más abajo). Por
eso el resto del contrato puede vivir en ciclos largos sin que eso le cueste nada a la terminal.

## El contrato: dos operaciones batch, independientes entre sí

Push y pull **no se combinan** en un solo roundtrip — quedan como dos operaciones separadas, cada
una con su propia cadencia, siguiendo el mismo criterio que ya justificó separar `pushOnce` de
`syncFull` en el PR #83: son responsabilidades distintas con necesidades de frecuencia distintas, y
combinarlas obligaría a mandar "pull vacío" en cada push o "push vacío" en cada pull.

### Push: un solo lote, un solo ack

Un método (antes N requests, uno por evento pendiente) manda **toda la cola pendiente del outbox**
de una vez: los 7 tipos de evento que ya existen hoy (`domain/outbox.ts::OutboxEventPayload`) —
`sale`, `stock-movement`, `sale-void`, `customer`, `account-hold-confirm`, `account-hold-release`,
`cash-session` — viajan todos en el mismo lote, incluido `account-hold-release` (hoy tratado aparte
como "best-effort"; deja de necesitar ese trato especial, es un evento más del lote).

El lote tiene **un solo `idempotency_id`** (no uno por evento) y la respuesta es **un solo ack**
con ese id — nunca un resultado por ítem, porque no hay nada que el backend pueda "rechazar" ítem
por ítem. El ack confirma que el servidor recibió el lote, independientemente de cuándo lo procese.

### Pull: un solo lote, parametrizado según necesidad

Un método (antes 3 requests: productos, stock, clientes) pide en una sola llamada los recursos que
hagan falta — productos, clientes, stock y saldos de cuenta — cada uno con su propio cursor
(`since`) o sin él para pedir la foto completa de ese recurso. La respuesta trae todo junto.

### Estado de los lotes (parte de la respuesta de pull)

El pull también permite consultar el estado de lotes de push que al POS le interesan (los que
mandó y todavía no confirmó), por `idempotency_id`:

```
status: 'pending' | 'ok' | 'issues'
issues?: string[]   // solo presente si status === 'issues'
```

Deliberadamente simple — nada de progreso granular (`%` de avance). `pending` es un valor propio,
no la ausencia de `ok`/`issues`: mientras un lote está `pending` no se sabe todavía si va a tener
problemas, así que no puede colapsarse en un booleano ("terminado" y "tiene errores" son dos
preguntas independientes, y la primera en `false` no contesta nada sobre la segunda).

**Regla de aplicación, la parte más importante de esta sección**: si algún lote de interés sigue
`pending`, el POS **no aplica los datos de ese pull** (ni el delta ni la foto completa) — los
descarta y reintenta más tarde. Aplicar un pull sin saber si el último push ya se procesó podría
reconciliar contra un estado que ese push todavía no reflejó (por ejemplo, una foto completa podría
borrar localmente algo que el push recién está por confirmar del otro lado).

## Cadencias

| Actividad | Cuándo | Manda | Devuelve |
|---|---|---|---|
| Push (lote) | Cada 10–15 min | Toda la cola pendiente | Un ack con el `idempotency_id` del lote |
| Pull delta (`since`) | Un rato después de cada push, cuando se estima que ya se procesó | Cursores por recurso + los `idempotency_id` de push recientes | Los cambios desde el cursor de cada recurso, más el estado de esos lotes |
| Pull completo | Al configurar (`/CONFIG`), cada 2 horas, o si un pull delta avisa `issues` graves en algún lote | Sin cursor (pide todo) | El catálogo entero, para reconciliar (mismo mecanismo que `storage/reconcile.ts`, PR #84) |

## Excepciones síncronas (las únicas dos)

1. **Reserva de crédito** (`requestAccountHold`, ya existe): la única operación que necesita una
   respuesta ya, porque decide el flujo del cobro en el momento (§5 del doc de diseño original).
   Sin cambios respecto de hoy.
2. **Consulta de saldo actual** (nueva, no existe todavía): para la futura cobranza de cuenta
   corriente, alcanza con el saldo cacheado para informarle al cliente cuánto debe — síncrona por
   el mismo motivo que la reserva: hace falta la respuesta ya para decidir el flujo de esa pantalla.

`account-hold-release` **no** es una excepción síncrona pese al nombre parecido: viaja en el lote
de push como cualquier otro evento (ver arriba).

## Explícitamente fuera de alcance ahora (diseñar extensible, no implementar)

- **Cobranza de cuenta corriente** (pagar saldo deudor sin venta — issues #51/#59 del backlog): un
  evento más del outbox el día que se implemente.
- **Ingreso/egreso de caja** (movimientos manuales de efectivo no atados a una venta): ídem, otro
  tipo de evento nuevo.

Ninguna de las dos se construye en esta etapa. La razón de mencionarlas acá es que el contrato
nuevo tiene que quedar diseñado para que agregar un evento de outbox sea trivial (una variante más
en la unión discriminada, sin tocar el mecanismo de lote) — no para bloquear esta etapa hasta que
existan.

## Impacto conocido (para que el plan de implementación lo cubra)

- `sync/connector.ts` — el puerto `Connector` cambia de forma sustancial: los métodos por recurso
  (`pullProducts`, `pullStock`, `pullCustomers`, `pushSale`, `pushStockMovement`, `pushSaleVoid`,
  `pushCustomer`, `pushAccountHoldConfirm`, `releaseAccountHold` vía outbox, `pushCashSession`) se
  reemplazan por un método de push batch y uno de pull batch (con estado de lotes incluido);
  `requestAccountHold` y la futura consulta de saldo quedan como los únicos métodos síncronos.
- `sync/engine.ts` — `pushOnce`, `syncOnce`, `syncFull`, `requestPushSoon`,
  `scheduleNextRetry`/`isFullRefreshDue` (PR #83/#84) se reescriben para las cadencias nuevas
  (push cada 10–15 min, pull delta demorado, pull completo cada 2 h/al configurar/por error).
- `domain/outbox.ts` — el backoff y los reintentos eran por evento individual (`markFailed`,
  `nextRetryDelayMs`, `isDue` por evento); con un solo lote por ciclo de push, esa semántica pasa a
  ser por lote, no por evento — a resolver en el plan, no en este spec.
- `docs/connector-api.openapi.yaml` — el contrato de 10 recursos pasa a 2 operaciones batch más las
  2 excepciones síncronas; reescritura completa, no un parche.
- `demo-backend/` — implementación de referencia del contrato nuevo (hoy implementa el contrato
  viejo de 10 recursos).
- `connectors/google-sheets/bridge.gs` — implementación del contrato nuevo para Sheets. El lock del
  script dejaría de ser un detalle que el bridge expone como error ("Planilla ocupada, reintentar")
  — el conector (o el propio bridge) lo resuelve puertas adentro, sin que el POS se entere.
- `connectors/rest/` — implementación de referencia sobre el contrato nuevo.
- UI/copy: `/SINCRONIZAR` fuerza hoy una foto completa (`runSyncCycle({ full: true })`, PR #84) —
  su semántica exacta bajo el contrato nuevo (¿fuerza push+pull completo ya, o solo pide el pull
  completo antes de tiempo?) queda para el plan.

## Puntos a resolver en el plan, no en este spec

- Cómo arma el POS el `idempotency_id` de un lote de push (¿determinístico por el conjunto de ids
  de eventos incluidos, para que reintentar el mismo lote sea trivialmente idempotente, o un ULID
  nuevo por intento con otro mecanismo de dedup?).
- Cómo conviven el cerrojo de sync existente (`tryAcquireSyncLock`/`acquireSyncLockWaiting`) con
  las dos cadencias independientes nuevas.
- Alcance exacto de la reescritura de `demo-backend` y de `bridge.gs` en la primera etapa vs.
  etapas siguientes (dado el tamaño, es candidato a dividirse en varias etapas, como el epic #66).
