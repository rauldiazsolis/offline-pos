# Contrato del Connector API v3: identidad, movimientos de caja, cobranza y bloqueos

Fecha: 2026-09-23
Estado: diseño aprobado por el usuario en la sesión de brainstorming, pendiente de plan.
Issue: #96 (Etapa 1 del epic #94). Absorbe #90.

## Contexto

El epic #94 cambia el modelo operativo del POS: sin turnos de caja, con identidad de terminal, con
avisos del backend que informan y nunca impiden. Las etapas 4 a 6 (venta, caja, cobranza) generan
eventos nuevos y dependen de su forma exacta, así que esta etapa cierra el contrato completo, lo
implementa en todos los conectores (`rest`/`rest-demo`, Google Sheets) y en el minibackend de demo,
aunque la UI que produce parte de esos eventos todavía no exista.

Principio rector (epic #94): el POS registra lo que quiera y lo pushea; el backend hace lo que quiera
con lo que recibe, pero informa lo necesario para que el POS lo muestre y el usuario decida.

La versión del contrato pasa de `2.0.0` a `3.0.0` (cambio incompatible: estados de lote renombrados,
sobre por evento, `cash-session` eliminado, `createdAt` obligatorio en el pull).

## 1. Sobre del lote e identidad

### Forma

```
PushBatchRequest { deviceId: string, events: OutboxBatchItem[] }
PullBatchRequest { deviceId: string, cursors: { products?, customers? }, pendingLotIds: string[] }

OutboxBatchItem = {
  id: string,            // id del evento (igual que hoy)
  type: string,          // discriminante
  createdAt: string,     // ISO 8601, cuándo se encoló el evento
  origin: { branch: string, pointOfSale: string },
} & <payload del tipo>
```

- **`deviceId`**: UUID de la terminal, una vez por request (push y pull). En el pull no se usa todavía;
  habilita que el backend informe lotes que la terminal perdió de vista (#90).
- **`origin`**: sucursal y punto de venta, texto libre, **estampados al encolar el evento** — se guardan
  en el `OutboxEvent` local, no se leen de la config al armar el lote. Cambiar la sucursal con eventos
  pendientes no reescribe los ya encolados (auditoría, epic #94).
- Se eligió un sobre uniforme por evento en vez de meter `branch`/`pointOfSale` dentro de cada entidad
  (`sale`, `movement`, …): igual para los 8 tipos, no ensucia el dominio y Sheets/minibackend lo leen
  del mismo lugar siempre.

### Transición en la Etapa 1

El contrato declara `deviceId`, `origin.branch` y `origin.pointOfSale` obligatorios, con una nota
explícita: **tolerados ausentes hasta la Etapa 2 (#97)**. En esta etapa:

- El POS genera el `deviceId` (`crypto.randomUUID()`) en `localStorage` bajo
  `offline-pos:device-id` si no existe, y lo reusa. **No** implementa el ciclo de vida de #97 (borrar
  lo local si falta el id): eso es de la Etapa 2.
- `/CONFIG` suma dos campos **opcionales** de terminal, "Sucursal" y "Punto de venta" (junto a
  `locale`, fuera de la unión de conectores). `origin` lleva solo los que estén cargados.
- Minibackend y Sheets guardan vacío lo que falte; nunca lo tratan como error.
- En la Etapa 2 pasan a obligatorios en `/CONFIG` (wizard).

`pos.deviceId()` (utilidades de consola, Etapa 0) se suma en esta etapa, ya que el id pasa a existir.

## 2. Estados de lote y avisos

```
BatchLotStatus =
  | { status: 'queued' }       // recibido, sin empezar
  | { status: 'processing' }
  | { status: 'ok' }
  | { status: 'issues', issues: LotIssue[] }

LotIssue = { message: string, eventId?: string }
```

- `pending` se renombra `queued` y se suma `processing`.
- `issues` pasa de `string[]` a `{ message, eventId? }[]`: texto para el humano y, opcional, el id del
  evento del lote al que se refiere.
- Un lote pedido en `pendingLotIds` que el backend no informa se trata como `processing` (lo más
  conservador).
- El backend devuelve foto y estados de lote **del mismo instante** (consistentes entre sí).
- Los avisos del backend se refieren siempre a un lote; no hay canal genérico.

**Regla del motor en la Etapa 1**: `queued` y `processing` se comportan igual que el `pending` de hoy
(se descarta el pull entero). La regla nueva (datos maestros siempre; stock/saldo reaplicando eventos
con `queued`, descartados con `processing`) es de la Etapa 3 (#98). Los lotes guardados localmente con
el shape viejo (`issues` como strings) se leen tolerando ambas formas.

## 3. Eventos

| `type` | Payload | Cambio |
|---|---|---|
| `sale` | `sale: Sale` | Ver "Cantidades e importes". |
| `stock-movement` | `movement: StockMovement` | `delta` con hasta 3 decimales. |
| `sale-void` | `saleId, voidedAt, voidReason?` | Solo el sobre. |
| `customer` | `customer: Customer` | Solo el sobre. |
| `account-hold-confirm` | `holdId, saleId` | Solo el sobre. |
| `account-hold-release` | `holdId` | Solo el sobre. |
| `cash-movement` | `movement: CashMovement` | **Nuevo.** |
| `customer-payment` | `payment: CustomerPayment` | **Nuevo.** |
| ~~`cash-session`~~ | — | **Eliminado.** |

### `cash-movement` (Etapa 5 lo genera)

```
CashMovement {
  id: string,                                  // ULID
  direction: 'in' | 'out',
  amount: number,                              // > 0, 2 decimales
  concept: string,                             // texto libre
  description?: string,
  source: 'manual' | 'count-adjustment',
  count?: { expected: number, counted: number }, // obligatorio si source = 'count-adjustment'
  createdAt: string,
}
```

- Ingreso/egreso manual: `source: 'manual'`, concepto y descripción libres.
- Arqueo: viaja **solo** si la diferencia no es 0, como un movimiento con `source: 'count-adjustment'`,
  `concept: 'Ajuste por arqueo'` (fijo), `direction` según el signo de `counted - expected` y
  `amount = |counted - expected|`. `count` lleva lo esperado y lo contado para auditoría. Un arqueo
  con diferencia 0 no genera evento (la base local del saldo es asunto de la Etapa 5).

### `customer-payment` (Etapa 6 lo genera)

```
CustomerPayment {
  id: string,              // ULID
  customerId: string,
  payments: Payment[],     // method != 'account', amount > 0
  total: number,           // suma de payments
  createdAt: string,
}
```

- Pago a favor de un cliente identificado, tenga o no cuenta corriente. Sin vuelto: lo tendido es lo
  acreditado.

### Anulaciones

Cobranzas y movimientos de caja **no se anulan**: se corrigen con otro registro (append-only, RNF-07).
`sale-void` sigue siendo solo para ventas.

### `cash-session` eliminado

- El POS deja de encolarlo al cerrar un turno; `/CAJA` sigue funcionando localmente hasta la Etapa 5.
- Eventos `cash-session` que ya estén pendientes en el outbox de una terminal se **excluyen** del lote
  y se marcan como enviados (no viajan nunca).
- Del lado del backend, cualquier tipo de evento desconocido queda como *issue* del lote (con su
  `eventId`) y nunca rompe el ack ni el resto del lote.

### Cantidades e importes

El contrato documenta (el POS genera estos valores recién en la Etapa 4, pero los conectores tienen
que aceptarlos desde ya):

- `SaleLine.qty`, `StockMovement.delta`, `StockItem.quantity`: con signo, hasta 3 decimales.
- `Sale.total`: puede ser 0 o negativo.
- `Payment.amount`: con signo, 2 decimales. Un ticket negativo es una devolución declarativa, con
  cualquier medio.
- Pago `account` **sin** `reference` (sin hold): fiado offline si es positivo, acreditación al cliente
  si es negativo. Un pago `account` negativo nunca lleva hold.
- Importes a 2 decimales, cantidades a 3 (el redondeo en el dominio es de la Etapa 4).

## 4. Pull

- `Product` y `Customer` suman:
  - `blocked?: { reason: string }` — ausente = no bloqueado; `reason` puede ser `''` (la UI muestra
    "Bloqueado" a secas).
  - `createdAt: string` — **obligatorio**, fecha de alta real.
- POS: `splitConnectorCustomer` usa `createdAt` del pull en vez de la hora del pull ("Alta: <fecha>"
  pasa a tener sentido). `blocked` se guarda en IndexedDB junto al producto/cliente (campo nuevo de la
  fila, sin migración de schema Dexie) pero **no se muestra** hasta la Etapa 4. `Product.createdAt` se
  guarda también.
- `lots`: `Record<id, BatchLotStatus>` con los cuatro estados.
- Cursores y foto completa sin cambios.

## 5. Conector REST (`rest`/`rest-demo`)

- Arma el body de push con `deviceId` y el sobre; el de pull con `deviceId`.
- Valida la respuesta del pull con los schemas Zod nuevos (bloqueo, `createdAt`, estados, `LotIssue`).
- `Connector.pushBatch`/`pullBatch` reciben el `deviceId` (parámetro nuevo del puerto); el motor lo
  lee de `sync/device-id.ts`.

## 6. Minibackend de demo (`demo-backend/`)

### Esquema

- Nuevas: `cash_movements`, `customer_payments`.
- Se va: `cash_sessions` (y su ruta del panel).
- `stock.quantity` pasa a `REAL`.
- `push_lots` suma `device_id`, `events` (JSON del lote) e `issues` como JSON `LotIssue[]`.
- Cada tabla de eventos (`sales`, `sale_voids`, `stock_movements`, `cash_movements`,
  `customer_payments`, y `customers` cuando la origina el POS) guarda `device_id`, `branch` y
  `point_of_sale`.

### Recepción y procesamiento separados

- `POST /sync/push` registra el lote como `queued` (idempotente por lote, igual que hoy) y responde el
  ack.
- `processLot(lotId)` aplica los efectos del lote y lo deja en `ok` o `issues`:
  - `stock-movement` suma `delta` a `stock.quantity` (hoy no lo hace: solo lo guarda).
  - `sale`: cada pago `account` sin `reference` suma su importe al `balance` del cliente (fiado
    offline, o acreditación si es negativo).
  - `customer-payment`: resta `total` del `balance` si el cliente tiene cuenta.
  - `account-hold-confirm`/`-release`: igual que hoy.
  - Todo cambio de `balance` actualiza `updated_at` (viaja en el pull por delta).
  - Tipo desconocido (p. ej. un `cash-session` viejo): issue con su `eventId`; el resto sigue.
- Con "Demorar lotes" **apagado** (default), `processLot` corre dentro del mismo request: se comporta
  como hoy (siempre `ok`/`issues` al primer pull).

### Panel (`/_demo`)

- Interruptor **"Demorar lotes nuevos"** (en memoria del proceso). Encendido, cada lote queda `queued`.
- Lista de lotes con estado, `deviceId`, cantidad de eventos y botones: **Empezar** (`queued` →
  `processing`), **Terminar OK** (procesa y deja `ok`) y **Terminar con aviso** (pide un texto;
  procesa y deja `issues` con ese mensaje más los issues reales del procesamiento). Stock y saldos se
  aplican recién al terminar.
- Lista de productos y clientes con **Bloquear** (pide motivo) / **Desbloquear**. Actualiza
  `updated_at`, así viaja en el pull por delta.
- Listas de movimientos de caja y cobranzas (reemplazan la de turnos). Lo registrado muestra
  dispositivo, sucursal y punto de venta.
- Fixtures: `createdAt` en productos y clientes; un producto y un cliente ya bloqueados de ejemplo.

## 7. Puente de Google Sheets (`bridge.gs` + `columnas.gs`)

Toda columna nueva lleva su clave interna y tipo en `SCHEMA` (`bridge.gs`) y su etiqueta en español en
`COLUMN_LABELS` (`columnas.gs`); los valores enumerados, en `VALUE_LABELS`. La lógica usa solo claves
internas.

### Pestañas nuevas

- **`MovimientosCaja`**: id (`movementId`), fecha, sentido (`direccion`: Ingreso/Egreso), monto,
  concepto, descripción, origen (`origenMovimiento`: Manual/Ajuste por arqueo), esperado, contado.
- **`Cobranzas`**: una fila por medio — id de cobranza, fecha, id de cliente, medio, monto, total.

Nota: los nombres de pestaña actuales ya son claves en español (`Ventas`, `Pagos`, `CuentaCorriente`),
así que las nuevas siguen ese criterio.

### Columnas nuevas en pestañas existentes

- Identidad (Dispositivo, Sucursal, Punto de venta): Ventas, Pagos, CuentaCorriente, Clientes (filas
  creadas por el POS), MovimientosCaja, Cobranzas.
- Ventas: "Sucursal de anulación", "Punto de venta de anulación" (la anulación marca filas existentes).
- Productos y Clientes: "Bloqueado" (Sí/No, lista desplegable vía `VALUE_LABELS`) y "Motivo del
  bloqueo". Productos suma "Alta".
- CuentaCorriente suma "Id de cobranza".
- Tipo de columna nuevo `quantity` (formato `#,##0.###`) para Cantidad en Ventas.

### Comportamiento

- **`ensureColumns`** (nuevo): al arrancar cada request, agrega al final de cada pestaña existente las
  columnas del `SCHEMA` que falten, con el formato y la validación en la fila plantilla. Una planilla
  anterior se actualiza sola al redesplegar, sin tocar datos. `Turnos` sale del `SCHEMA`: una pestaña
  Turnos ya existente queda intacta y el puente no la toca más.
- **Alta**: una fila de Productos/Clientes sin Alta la recibe con la fecha actual la primera vez que el
  puente la lee, y queda fija.
- **CuentaCorriente como libro completo**: holds confirmados (como hoy), más los pagos `account` sin
  hold de una venta (con signo) y las cobranzas en negativo.
- `issues` de `_PushLots` se guarda como JSON de `LotIssue[]`, con `eventId` del evento que falló.
- Sheets procesa dentro del request: nunca devuelve `queued` ni `processing` (documentado en el README).
- README: pasos de redespliegue (pegar los dos archivos, nueva versión del despliegue existente —
  misma URL `/exec` — y qué se ve en la planilla después).

## 8. Documentación

- `docs/connector-api.openapi.yaml` reescrito a v3 (sobre, eventos nuevos, estados, bloqueos, alta,
  cantidades/importes, nota de transición de identidad).
- `CLAUDE.md`: secciones "Patrón outbox", "Connector API" y "Estado del proyecto" actualizadas.

## 9. Pruebas

- Vitest: schemas del POS (sobre, eventos nuevos, pull, lotes viejos), builders del outbox con
  `origin`, exclusión de `cash-session` pendientes, conector REST (bodies y validación), `device-id`,
  motor (`queued`/`processing` descartan como antes).
- Minibackend: estados de lote, demora manual, efectos al terminar (stock, saldo), bloqueos, tipo
  desconocido como issue, identidad guardada.
- `bridge.gs` con la planilla falsa: pestañas y columnas nuevas, `ensureColumns` sobre una planilla
  vieja, Alta completada, libro de cuenta corriente, issues con `eventId`.
- e2e existentes siguen pasando.

### Prueba en navegador

App + minibackend + panel: fecha de alta real en `@`, bloquear/desbloquear en el panel y ver que el
pull lo trae (en IndexedDB / `/DIAGNOSTICO`; la UI de bloqueos es de la Etapa 4), lote demorado visto
como `queued`/`processing` en `/DIAGNOSTICO` y pull descartado, identidad (dispositivo, sucursal,
punto de venta) visible en el panel.

**No verificable en navegador en esta etapa**: `cash-movement` y `customer-payment` (sin UI hasta las
Etapas 5 y 6) — se verifican con tests del minibackend y del puente y con un `curl` de ejemplo en las
instrucciones.

## Fuera de alcance

- Ciclo de vida del id de dispositivo y campos obligatorios de identidad (Etapa 2, #97).
- Reaplicar eventos de lotes `queued` y limpieza a 1 semana (Etapa 3, #98).
- Redondeo en el dominio, cantidades negativas en el carrito, UI de bloqueos (Etapa 4, #99).
- Eliminar turnos locales, arqueo e ingresos/egresos en la UI (Etapa 5, #100).
- Cobranza y saldo del cliente en la UI; `/account-balance` sigue `documented-not-implemented`
  (Etapa 6, #101).
