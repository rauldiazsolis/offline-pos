# Motor de sync: pull con eventos reaplicados y limpieza de datos locales a 7 días

Fecha: 2026-09-24
Estado: diseño aprobado por el usuario en la sesión de brainstorming, pendiente de plan.
Issue: #98 (Etapa 3 del epic #94). Depende de las Etapas 1 (#96, contrato v3) y 2 (#97).

## Contexto

Hoy (`sync/engine.ts::pullAndApply`) un lote de push `queued` o `processing` —o uno con ack que el
backend no informa— **descarta el pull entero**: ni datos maestros, ni bloqueos, ni stock, ni saldos.
El issue #98 pide que los datos maestros y los bloqueos se apliquen siempre, que stock y saldo se
apliquen reaplicando encima los eventos de los lotes `queued`, y que se borre lo sincronizado con más
de 7 días.

Al contrastar el issue con el código aparecieron huecos que la sesión resolvió así:

1. `AwaitingLot` (`sync/push-lot.ts`) guarda solo `{ id, sentAt, lastStatus }`: el `PushLot` sí tiene
   `eventIds`, pero se borra al recibir el ack. Sin los ids no hay qué reaplicar → §2.
2. **Un agujero que ya existe**: con eventos pendientes en el outbox que nunca viajaron (sin red, o
   antes del próximo push), un pull exitoso hace `bulkPut` del stock y del saldo del backend y **pisa**
   el descuento local de esas ventas. La reaplicación se extiende a esos eventos → §1.
3. El **lote en curso** (congelado, mandado al menos una vez, sin ack) es ambiguo: pudo haber llegado.
   Se le pregunta al backend → §1.
4. El saldo viaja **dentro del cliente** en el pull por delta: descartar el saldo y avanzar el cursor
   perdería ese cambio → §1, cursores.
5. La limpieza "alcanza con el ack" choca con reaplicar: un lote en cola necesita sus eventos → §4.
6. El puente de Sheets no trae stock (`stock: []`) ni saldo (clientes `unrestricted`) y procesa cada
   lote dentro del request: la reaplicación es un no-op ahí. El minibackend ya es consistente (SQLite
   síncrono dentro del handler de `/sync/pull`) → §3.

Principio rector (epic #94): el POS nunca se autobloquea. Las advertencias sobre productos y clientes
son los `blocked` que manda el backend, que tiene autoridad para informarlos (incluidos los que surgen
de procesar un lote, aun mientras está `processing`). El único impedimento real del POS sigue siendo
un hold de cuenta corriente rechazado.

## 1. Regla del pull

### Qué se pregunta

`pendingLotIds` lleva los lotes en espera (con ack) **y, si existe, el lote en curso** (sin ack).

### Clasificación de cada lote

| Lote | Informado por el backend | Tratamiento |
|---|---|---|
| En espera (con ack) | `ok` / `issues` | Resuelto: sale de la lista; avisos a `pushLotIssuesSignal` como hoy. |
| En espera | `queued` | Sus eventos se **reaplican**. |
| En espera | `processing` | **Retiene** stock y saldo. |
| En espera | no informado | Como `processing` (contrato v3, sin cambios). |
| En espera, guardado antes de esta etapa (sin `eventIds`) | `queued` | Como `processing`: no hay eventos que reaplicar. |
| En curso (sin ack) | cualquier estado | El backend lo recibió: se trata como un **ack recuperado** (ver abajo) y después según su estado, igual que un lote en espera. |
| En curso | no informado | **No recibido**: sus eventos se reaplican como pendientes. |

**Ack recuperado**: si el backend informa el lote en curso, el POS hace lo mismo que al recibir el ack
de un push — marca sus eventos `synced`, borra el lote en curso y lo agrega a la lista de espera (con
sus `eventIds` y el estado informado; si ya vino `ok`/`issues`, se resuelve en el mismo pull). No se
reenvía. Corre dentro del cerrojo de sync del pull, así que no se cruza con un push.

### Aplicación

- **Datos maestros y bloqueos** de productos y clientes: **siempre**, con cualquier estado de lotes
  (delta con `bulkPut`, foto completa con `reconcileSnapshot`).
- **Stock y saldo**:
  - **Algún lote retiene** (`processing` o equivalente): se descarta el stock y el saldo del pull y
    quedan los locales, que ya incluyen todo lo que hizo esta terminal. Sin cálculo por ítem: el
    criterio conservador y simple elegido en la sesión.
  - **Ninguno retiene**: valor del backend **más** los efectos de los eventos a reaplicar = eventos de
    lotes `queued` ∪ lote en curso no recibido ∪ pendientes del outbox que no están en ningún lote.
    Deduplicados por id de evento.
- Todo en **una transacción Dexie**, leyendo el outbox dentro de ella: una venta cerrada mientras el
  pull estaba en vuelo queda pendiente y entra en la reaplicación.

### Efectos que se reaplican

Espejan exactamente lo que hace el backend al procesar (minibackend, `demo-backend/src/lots.ts`) y lo
que hace el POS al cerrar la venta (`storage/sale-repository.ts`):

| Evento | Stock | Saldo |
|---|---|---|
| `stock-movement` | `+delta` al `productId` | — |
| `sale` | — (su stock viaja como `stock-movement`) | `+amount` por cada pago `account` (con o sin hold) al `customerId` |
| `customer-payment` | — | `−total` al `customerId` |
| `account-hold-confirm` | — | — (el monto ya cuenta en el pago de la venta; los dos se encolan en la misma transacción, así que siempre viajan en el mismo lote) |
| `sale-void`, `customer`, `account-hold-release`, `cash-movement` | — | — |

- **Stock**: viaja siempre completo, así que se reaplica sobre todas las filas del pull. Un producto
  con efectos pero sin fila en el pull parte de 0 (mismo criterio que `applyStockMovements` local).
- **Saldo**: se reaplica solo sobre los clientes que trae el pull (delta o foto). Los que no vienen
  conservan su saldo local, que ya incluye todo lo de esta terminal. Un cliente sin cuenta
  (`CustomerAccount`) no recibe una inventada.
- Redondeo del resultado: cantidades a 3 decimales, importes a 2 (el redondeo compartido del dominio es
  de la Etapa 4; acá se redondea dentro de la función pura).

### Cursores

- **Productos**: avanza siempre (el stock viaja aparte, completo).
- **Clientes**: si se retuvo el saldo, **no avanza**; se aplican los datos maestros y los bloqueos del
  cliente conservando el `balance` (y el resto de la cuenta local sin cambios de saldo). El próximo pull
  los vuelve a traer — reaplicarlos es idempotente — y toma el saldo real cuando el lote se resuelva.

### Foto completa con un lote que retiene

Reconcilia productos y clientes (incluidas las bajas y la protección de clientes con alta pendiente),
**no toca** stock ni saldos locales (tampoco borra filas de `stock`/`customerAccounts` por ausencia, salvo
la cuenta de un cliente que se fue), fija el cursor de productos pero no el de clientes, y **no cuenta** como foto completa
hecha (`setLastFullSyncAt`/`fullRefreshDoneThisSession` sin tocar), así se vuelve a intentar.

### Resultado del pull

Un pull que retiene stock y saldo **no es un fallo**: `sync/pending-lot` se elimina de `ErrorMeta`,
de `ui/errors.ts` y del motor. El pull devuelve un resumen de cómo se aplicó:

```
PullApplication =
  | { kind: 'applied' }
  | { kind: 'reapplied'; events: number }            // > 0 eventos reaplicados
  | { kind: 'retained'; lotIds: string[] }            // lotes que retuvieron; cursor de clientes retenido
```

## 2. Lotes en espera con sus eventos

- `AwaitingLot` suma `eventIds?: string[]` (opcional: los guardados antes de esta etapa no lo tienen,
  ver la tabla de §1). `addAwaitingLot` los recibe del `PushLot` al ack (y al ack recuperado).
- Sigue en `localStorage` con el mismo criterio best-effort que los cursores: si se pierde, el POS deja
  de preguntar por esos lotes y el peor caso es tomar el valor del backend sin reaplicar.
- `updateAwaitingLots` conserva los `eventIds`.

## 3. Lo que se le exige al backend

`docs/connector-api.openapi.yaml` (versión sin cambios, 3.0.0 — solo se precisa la semántica):

- **Foto y estados del mismo instante** (ya estaba): stock, saldos y estados de lote consistentes entre
  sí. Un lote `queued` todavía no tiene ningún efecto en la foto; uno `ok`/`issues` ya los tiene todos.
- **Todo cambio de saldo mueve el cursor de ese cliente** (su `updatedAt`), así viaja en el pull por
  delta. Sin esto, el POS nunca vería el saldo de un lote que se resolvió.
- **`pendingLotIds` puede incluir un lote que nunca recibió ack**: el backend informa su estado si lo
  recibió y lo omite si no. Del lado del POS: un lote con ack no informado cuenta como `processing`; uno
  sin ack no informado, como no recibido.
- La regla de aplicación del POS se reescribe con la de §1 (datos maestros y bloqueos siempre; stock y
  saldo reaplicando o retenidos). El backend puede bloquear productos y clientes por lo que surja de
  procesar un lote, aun mientras está `processing`.

Cómo lo cumplen:

- **Minibackend**: ya cumple — handler síncrono sobre SQLite, `adjustBalance` actualiza `updated_at`,
  `lotStatusFor` devuelve `undefined` para un id desconocido. Sin cambios de código; se suma un test
  que documente el caso del lote no recibido.
- **Puente de Sheets**: ya cumple — todo el request corre con el lock del script, nunca informa
  `queued`/`processing`, no trae stock ni saldo (la reaplicación no hace nada), `findLot` omite un id
  desconocido. Sin cambios de código; el README del conector lo aclara en una línea.

## 4. Limpieza de datos locales a 7 días

### Qué se borra

Lo que tenga más de 7 días (`createdAt`) **y** esté sincronizado:

- **Eventos del outbox** `synced`, salvo los que pertenecen a un lote en espera o al lote en curso
  (hacen falta para reaplicar).
- **Ventas** cuyo evento `sale` no está pendiente (está `synced`, o ya se borró — lo pendiente nunca se
  borra, así que ausente implica sincronizado) y, si fue anulada, cuya anulación tampoco está pendiente.
- **`stockMovements` y `accountMovements`**: los que tienen `saleId` siguen a su venta (se borran con
  ella); los que no, siguen a su propio evento con el mismo criterio que las ventas.
- **Turnos de caja cerrados** con más de 7 días (no viajan desde v3: "sincronizado" no aplica), salvo el
  ancla.

### Qué no se borra nunca

- Lo pendiente del outbox, y los eventos de lotes en espera o en curso.
- **El ancla del arqueo, mientras existan los turnos (hasta la Etapa 5, #100)**: el último turno
  **cerrado**, el turno abierto, y todas las ventas de ambos (con sus movimientos), aunque tengan más de
  7 días. `/RESUMEN` y `/CAJA` siguen viendo lo mismo que hoy.
- Catálogo, stock, clientes, cuentas y la venta en curso (no son historial).
- Las estadísticas de conceptos de ingreso/egreso todavía no existen: la Etapa 5 las suma a esta lista
  y reemplaza el ancla por el último arqueo. La regla vive en un solo lugar para que eso sea un cambio
  local.

Efecto conocido y aceptado: una venta borrada deja de aparecer en `/ANULAR`.

### Cuándo corre

Al arrancar (después del primer ciclo de sync, sin demorar el arranque) y después de cada pull
exitoso, como mucho **una vez cada 24 h** (`offline-pos:cleanup:last-run`, en `localStorage`, dentro
del prefijo que ya manejan `pos.export()`/`pos.reset()`). Corre con el **cerrojo de sync** tomado,
porque toca el outbox que lee el push; si está tomado, se saltea hasta la próxima oportunidad. Todo en
una transacción Dexie. Sin comando para forzarla (si hiciera falta, `pos.cleanup()` más adelante).

### Forma

- `domain/local-cleanup.ts`: función pura que, dados los registros candidatos, `now`, los ids
  protegidos (eventos de lotes) y el ancla, devuelve qué ids borrar de cada tabla. Testeable con tablas.
- `storage/local-cleanup.ts`: lee candidatos (índices `createdAt` que ya existen), llama a la función
  pura y borra en una transacción. Devuelve los conteos.
- `sync/cleanup-schedule.ts`: la cadencia de 24 h y el cerrojo.

## 5. Módulos

- `domain/reapply.ts` (pura): `reapplyEffects(events: OutboxEvent[])` → deltas de stock por producto y
  de saldo por cliente, según la tabla de §1.
- `sync/pull-rule.ts` (pura): clasifica los lotes a partir de los en espera, el lote en curso y los
  estados informados → lotes resueltos, estados a guardar, ack recuperado, lotes que retienen, ids de
  eventos a reaplicar (sin los pendientes del outbox, que se leen en la transacción).
- `storage/apply-pull.ts`: aplica el pull en una transacción según la clasificación — delta o foto
  (`applySnapshotReconciled` recibe una opción para no tocar stock ni saldos), reaplicación leyendo el
  outbox adentro. Reemplaza el `bulkPut` suelto de `pullAndApply`.
- `sync/engine.ts::pullAndApply`: orquesta — arma `pendingLotIds` (más el lote en curso), pide,
  clasifica, recupera el ack, aplica, maneja cursores y devuelve `PullApplication`.
- `sync/push-lot.ts`: `AwaitingLot.eventIds`.

## 6. Barra de estado y `/DIAGNOSTICO`

### Barra de estado

- Un pull que retiene stock y saldo es exitoso: `online-idle`, `lastSyncedAt` actualizado.
- Con el último pull `retained`, el texto suma "· stock y saldos en espera del backend"
  (`lastPullApplicationSignal`, `ui/state/sync.ts`).
- La limpieza no se muestra.

### `/DIAGNOSTICO` y `pos.status()` (misma foto, `sync/diagnostics.ts`)

- **Lotes**: el lote en curso muestra también el estado que informó el backend, o "no recibido por el
  backend" (se guarda en el `PushLot` como `lastReportedStatus` opcional). Cada lote en espera muestra
  cuántos eventos tiene, además de su último estado.
- **Último pull**: "Aplicado completo", "Aplicado + N eventos reaplicados (lotes en cola y pendientes)"
  o "Stock y saldos retenidos: lote `<id>` procesando — cursor de clientes retenido".
- **Log de intentos**: `SyncLogEntry` de pull suma `application?: PullApplication`. `console.info` al
  retener (comportamiento esperado), `console.error` solo en fallos reales, `console.warn` con issues
  (como hoy).
- **Limpieza**: sección nueva — última ejecución (fecha; ventas, movimientos y eventos borrados) y el
  ancla vigente (el último turno cerrado, con su fecha). Se guarda junto a `last-run`.

## 7. Pruebas

### Vitest

- `reapplyEffects`: cada tipo de evento, venta con varios pagos `account`, con y sin hold, cobranza,
  tipos sin efecto, redondeo.
- `pull-rule`: la tabla de §1 completa — cada estado, lote viejo sin `eventIds`, lote en curso
  informado (cada estado) y no informado, mezcla de retenedores y `queued`.
- `apply-pull` (fake-indexeddb): delta y foto sin retención con reaplicación (stock completo, saldo
  solo de clientes que vinieron, cliente sin cuenta, producto sin fila); con retención (stock y saldo
  intactos, maestros y bloqueos aplicados, foto que no borra stock); venta cerrada durante el pull.
- Motor (`engine.test.ts`, `Connector` fake): `pendingLotIds` con el lote en curso, ack recuperado (no
  reenvía), cursores (productos avanza, clientes retenido), foto completa retenida no cuenta como hecha,
  `PullApplication`, log y consola, estado de la barra.
- Limpieza: función pura con tablas (edad, pendientes, lotes protegidos, anulación pendiente, ancla,
  turno abierto, movimientos con y sin venta); repositorio; cadencia de 24 h y cerrojo.
- Minibackend: un lote desconocido no se informa (documenta el "no recibido").

### e2e

Los existentes siguen pasando. No se suma un e2e nuevo: el comportamiento depende de estados del
backend que ya cubren los tests del motor con el conector fake.

### Prueba en navegador (cierre)

App + minibackend + panel `/_demo` con "Demorar lotes nuevos" encendido:

1. Vender un producto con stock → el stock local baja. Push → el lote queda `queued` (`/DIAGNOSTICO`).
   Pull (`/SINCRONIZAR`) → el stock sigue en el valor local ("N eventos reaplicados"); cambiar el nombre
   o bloquear un producto en el panel y ver que llega igual.
2. "Empezar" el lote en el panel → pull → "Stock y saldos retenidos", barra con "stock y saldos en
   espera del backend", bloqueos aplicados igual.
3. "Terminar OK" → pull → stock del backend (igual al local), aviso de la barra desaparece.
4. Venta a cuenta corriente (fiado offline) con el lote demorado: el saldo del cliente se sostiene igual
   que el stock.
5. Ack perdido: difícil de forzar a mano — se verifica con los tests del motor (se dice explícitamente).
6. Limpieza: se verifica con tests; opcionalmente, editar `createdAt` de una venta en IndexedDB desde
   DevTools, borrar `offline-pos:cleanup:last-run`, recargar y ver en `/DIAGNOSTICO` lo borrado.

## 8. Documentación

- `docs/connector-api.openapi.yaml`: §3.
- `CLAUDE.md`: "Patrón outbox" (regla del pull, ack recuperado, limpieza), "Connector API", "Barra de
  estado" (texto de retención), "Estado del proyecto".
- README del conector de Sheets: una línea sobre §3.

## Fuera de alcance

- Cálculo por ítem de stock y saldo con un lote `processing`, y marcas propias del POS sobre productos
  o clientes dudosos: se anota como issue `backlog` (surgió en la sesión; el criterio simple alcanza
  por ahora).
- Mostrar bloqueos en búsqueda, carrito y cobro (Etapa 4, #99).
- Sin turnos: el ancla pasa al último arqueo y se suman las estadísticas de conceptos (Etapa 5, #100).
- `sale-void` no revierte el saldo de cuenta corriente, ni en el POS ni en el minibackend (hueco
  previo, no de esta etapa).
- Rediseño de foco del wizard (#112) y prueba del conector de Sheets contra una planilla real.
