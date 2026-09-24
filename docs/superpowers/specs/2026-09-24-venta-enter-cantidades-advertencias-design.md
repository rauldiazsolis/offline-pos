# Venta: Enter para cobrar, cantidades decimales/negativas, advertencias, anulación como ticket y contrato 4.0.0

Fecha: 2026-09-24
Estado: diseño aprobado por el usuario en la sesión de brainstorming; pendiente de revisión escrita.
Issue: #99 (Etapa 4 del epic #94). Cierra #12 y #61. Toma de #110 solo el criterio de qué se puede
anular (ventana y marca). Toca #100 (marca de anulado en `/RESUMEN`, saldo de efectivo). Depende de
las Etapas 1 a 3 (#96, #97, #98).

## Contexto

El issue #99 pide tres cosas: cobrar con Enter, cantidades decimales y negativas, y advertir en vez
de bloquear (stock, productos y clientes bloqueados). Los comentarios de #99 y de #110 agregan la
anulación como documento propio y la ventana de anulación. En la sesión se sumó un endpoint de versión
y estado del backend, que acompaña el cambio de major del contrato.

Lo que el código hace hoy y hay que cambiar:

1. `domain/cart.ts` exige cantidades enteras y positivas (`Number.isInteger`), rechaza restar sin
   línea previa (`cart/nothing-to-subtract`) y bloquea por stock (`sale/insufficient-stock`) en
   `addProductLine` y `setLineQuantity`.
2. El parser de la barra (`ui/keyboard/parse-command-bar.ts`) solo reconoce `^(-?\d+)\*`, y
   `CommandBarInput` solo reconoce dígitos (`ONLY_DIGITS`) para número + Enter sobre la línea.
3. `roundQuantity`/`roundAmount` existen pero viven en `domain/reapply.ts`. `calculateTotals` no
   redondea.
4. `closeSale` rechaza pagos ≤ 0. `resolveTender` supone un total positivo. El contrato v3 **ya
   acepta** montos negativos y cuenta corriente negativa sin hold, y el minibackend ya ajusta el saldo
   con un pago `account` sin `reference`.
5. `voidSale` modifica la venta en el lugar (`status: 'voided'`) y encola `sale-void` sin contenido.
   El stock se repone con movimientos `sale-void` propios, pero **el saldo de cuenta corriente y el
   efectivo nunca se revierten**, ni en el POS ni en el minibackend. `domain/reapply.ts` no le asigna
   efectos a `sale-void`.
6. `blocked` ya se guarda en `Product` y en `Customer` desde el pull, pero no se muestra en ningún lado.
7. Cobro se abre solo con `/COBRAR` o Ctrl+Enter, con los campos vacíos. Enter solo no hace nada, y el
   botón "Confirmar Cobro" parece un submit sin serlo (comentario de #99). Cobro y el carrito no
   tienen todavía el patrón teclado + mouse de la Etapa 2.

Principio rector (epic #94): el POS nunca se autobloquea. Todo lo que el backend informa (bloqueos,
falta de stock) se muestra donde el usuario decide. Nada impide vender.

## 1. Cantidades decimales y negativas

### Redondeo en un solo lugar

`domain/rounding.ts` (nuevo) exporta `roundQuantity` (3 decimales) y `roundAmount` (2 decimales),
movidos desde `domain/reapply.ts`, que pasa a importarlos. Se redondea:

- toda cantidad que resulta de una operación del carrito, incluida la suma neta (`0.1 + 0.2` da `0.3`
  exacto, y un resultado que redondea a 0 cuenta como 0);
- el total de cada línea (`calculateLineTotal`);
- cada campo de `Totals`: `subtotal`, `discountTotal`, `globalAdjustmentAmount` y `total`. El total
  se calcula a partir de los otros ya redondeados, así la tarjeta siempre suma bien a la vista.

Nunca se redondea en silencio lo que tipea el cajero. Una cantidad con más de 3 decimales es un error
(`cart/invalid-quantity`), igual que una cantidad no finita.

### Carrito (`domain/cart.ts`)

- **`addProductLine`**: suma neta sobre la línea del producto (una sola línea por producto). Puede
  crear la línea en negativo (`-2*coca` sin línea previa) o dejarla en negativo. Si el resultado es 0
  exacto, la línea se borra. Desaparecen `cart/nothing-to-subtract`, el chequeo de stock y el
  parámetro `stock` (la advertencia se calcula aparte, §3).
- **`addFreeformLine`**: acepta una cantidad negativa distinta de 0 (`-1*regalo$100`). El precio
  sigue siendo positivo: el signo lo lleva la cantidad.
- **`adjustFreeformLineQuantity`**: igual que `addProductLine`, puede dejar la línea en negativo; 0
  exacto la borra.
- **`setLineQuantity`**: acepta cualquier cantidad válida. Con 0, borra la línea (igual que Supr). Sin
  chequeo de stock: pierde el parámetro `params`.
- **Descuento por línea** (existe en el dominio pero ningún comando lo usa): `discountAmount` se
  calcula sobre el valor absoluto del subtotal de la línea y conserva su signo, así una línea negativa
  con descuento devuelve menos. `applyLineDiscount` valida contra el valor absoluto.

Errores que salen de `ErrorMeta`: `sale/insufficient-stock` y `cart/nothing-to-subtract`.

### Barra de comandos

- Cantidad válida: `-?\d+([.,]\d{1,3})?`, tanto en el prefijo `<n>*` como en número + Enter sobre la
  línea seleccionada del carrito. Con una línea seleccionada, `-2`, `1,5` y `0,250` + Enter son
  cantidades (reemplazan la de la línea). Sin línea seleccionada, `-2` sigue siendo un recargo a medio
  escribir, como hoy.
- Más de 3 decimales: error en el slot, "Hasta 3 decimales en la cantidad".
- El recargo/descuento global (`<signo><número>%`) no cambia.

### Cierre (`domain/sale-lifecycle.ts::closeSale`)

- Sigue rechazando el carrito sin líneas (`sale/empty-cart`). Acepta un total 0 o negativo.
- Todos los pagos tienen el mismo signo que el total (un pago con otro signo es
  `sale/invalid-payment-amount`):
  - total > 0: pagos > 0 que cubren el total (el vuelto ya viene descontado por `resolveTender`);
  - total < 0: pagos < 0 que suman **exactamente** el total;
  - total = 0: sin pagos.
- `customerId` sigue siendo obligatorio si hay algún pago `account`, con cualquier signo.

### Cobro de un ticket negativo (`domain/tender.ts::resolveTender`)

Con total < 0, la pantalla trabaja en **modo devolución**: el cajero tipea en positivo cuánto devuelve
por medio. `resolveTender` recibe esos montos y devuelve `Payment` negativos, sin vuelto: la suma
tiene que ser **exactamente** |total| (`sale/refund-amount-mismatch { total, tendered }`, nuevo). No
hay regla de "solo efectivo excede": nada puede exceder.

Con total 0, `resolveTender` devuelve `payments: []` y vuelto 0 si no se tipeó nada; cualquier monto
tipeado es un error (`sale/refund-amount-mismatch`).

### Stock y saldo

Los movimientos de stock de una venta son `delta = -qty`, así que una línea negativa **suma** stock.
El saldo lo mueven los pagos `account` con su signo. No hace falta tocar `domain/reapply.ts` para
esto: el stock viaja por `stock-movement` y el saldo por los pagos del evento `sale`, que ya suma con
signo.

## 2. La anulación como ticket negativo

### Dominio

`voidSale` se reemplaza por `buildVoidSale(original, { id, now, reason?, isAlreadyVoided })` →
`Result<Sale>`, que arma una **venta nueva**:

- mismas líneas con `qty` invertida (el descuento de cada línea se conserva);
- pagos invertidos; el pago `account` pierde su `reference` (un pago `account` negativo sin hold es
  una acreditación, contrato);
- `total` invertido; se copian el ajuste global y el `customerId`;
- `voidsSaleId: original.id`, y `voidReason` si vino;
- `createdAt = now`: siempre posterior al original.

Errores:

| Caso | Código |
|---|---|
| El original ya tiene una anulación (o es una venta `voided` legada) | `sale/already-voided` |
| El original es él mismo una anulación | `sale/cannot-void-a-void` (nuevo) |
| El original tiene más de 24 h | `sale/void-window-expired` (nuevo) |

Una **devolución común** (un ticket negativo sin `voidsSaleId`) sí se puede anular: su anulación es
un ticket positivo.

`isWithinVoidWindow(sale, now)` (pura): `now - createdAt < 24 h`. Ventana móvil, no día calendario:
cubre el turno noche (una venta de las 23:59 se anula a las 00:01) sin depender de la caja de #100.
Con la limpieza a 7 días (#98), nunca se anula algo que la limpieza ya borró.

`isVoided(sale, voidedSaleIds)` (pura): `sale.status === 'voided'` (legado) o `voidedSaleIds` contiene
su id.

### `Sale`

- Suma `voidsSaleId?: string`.
- Sale `voidedAt` (la fecha de la anulación es el `createdAt` del ticket que anula). `voidReason` se
  queda: lo lleva el ticket de anulación.
- `status` en el tipo local queda `'closed' | 'voided'`: `voided` solo para leer ventas guardadas antes
  de esta etapa; ningún código nuevo lo escribe. Sale `'open'`, que nunca se usó.

### Persistencia (`storage/sale-repository.ts::voidSaleAndPersist`)

En una transacción, igual que un cierre:

1. Lee el original y averigua si ya tiene anulación (índice nuevo `voidsSaleId` en `sales`, versión
   nueva del schema Dexie).
2. `buildVoidSale`.
3. Agrega la venta nueva, sus movimientos de stock (`buildStockMovementsForSale` sobre el ticket
   negativo, con `reason: 'sale-void'`; el delta sale positivo, repone), sus movimientos de cuenta
   (`applyAccountMovements`, que descuenta el saldo) y el evento `sale` en el outbox.
4. Si hay un turno de caja abierto, registra la anulación en él (`recordSaleInCashSession`), así el
   arqueo de `/CAJA` descuenta el efectivo devuelto hasta que la Etapa 5 saque los turnos. Anular **no
   exige** un turno abierto (hoy tampoco).

El original no se toca.

### Efectos derivados

- **Arqueo del turno y `/RESUMEN`**: la anulación es una venta `closed` con importes negativos, así que
  los totales, Productos y Medios de pago dan netos solos. Las ventas `voided` legadas se siguen
  excluyendo como hoy.
- **Reaplicación del pull (`domain/reapply.ts`)**: el ticket de anulación viaja como `sale`, así que
  su pago `account` negativo cuenta en el saldo y sus `stock-movement` en el stock. No hay caso
  especial. `sale-void` sale del `switch` (queda solo como tipo legado, ver §4).
- **Limpieza a 7 días (`domain/local-cleanup.ts`)**: la regla "ventas cuyo evento y cuya anulación no
  están pendientes" pasa a "cada venta por su propia edad y su propio evento" (sale
  `pendingVoidSaleIds`). El ancla del arqueo (turnos y sus ventas) no cambia: una anulación
  registrada en el turno queda protegida con el resto.
- **#100**: el saldo de efectivo ya no necesita el término "− anulaciones": alcanza con sumar los pagos
  `cash` con signo (anulaciones y devoluciones incluidas). Se anota en #100.

### `/ANULAR`

- Lista los últimos 20 tickets de las últimas 24 h, anulaciones incluidas, más nuevo primero.
- Original anulada: atenuada, con la marca "Anulada", sin acción.
- Ticket de anulación: "Anulación de HH:MM · $X" (hora y total del original), atenuado, sin acción.
- ↑/↓ y el click saltean las filas sin acción. Una lista sin ninguna fila anulable muestra el vacío de
  siempre.
- La búsqueda y el ticket completo en la confirmación siguen en #110 (con #58).

### `/RESUMEN`

La lista de Tickets marca "Anulada" y "Anulación de HH:MM" con el mismo `isVoided`. El resto de #100
(navegación por fecha y demás) no se toca.

## 3. Advertencias en vez de bloqueos

### Dominio (`domain/sale-warnings.ts`, puro)

```typescript
type SaleWarning =
  | { kind: 'insufficient-stock'; productId: string; requested: number; available: number }
  | { kind: 'blocked-product'; productId: string; reason: string }
  | { kind: 'blocked-customer'; customerId: string; reason: string };
```

- `lineWarnings(line, { product?, stockQuantity? })`: `insufficient-stock` solo para productos con
  `tracksStock`, cantidad positiva y mayor que el stock (sin fila de stock cuenta como 0); una línea
  negativa nunca advierte. `blocked-product` si el producto viene con `blocked`.
- `customerWarnings(customer)`: `blocked-customer`.
- `cartWarnings(cart, { products, stock, customer? })`: todas, en el orden del carrito y el cliente al
  final.

### Datos para la UI

`cartStockSignal` (`ui/state/`): mapa `productId → quantity` leído de Dexie solo para los productos del
carrito. Se recarga cuando cambia el conjunto de productos del carrito o su cantidad y cuando se aplica
un pull. Los bloqueos de producto salen del repositorio de catálogo, que ya los tiene en memoria.

### Dónde se ven

Color `--color-warning` (ámbar, nuevo token con su versión sobre el chrome oscuro), siempre con texto,
nunca solo color:

- **Búsqueda de artículos**: en la fila del producto, "Bloqueado: <motivo>" y "Stock: N" si la cantidad
  pedida supera lo disponible.
- **Lista de `@`**: "Bloqueado: <motivo>" en la fila del cliente.
- **Carrito**: debajo de la descripción de la línea, "⚠ Stock disponible: N" y "⚠ Bloqueado:
  <motivo>".
- **Tarjeta de Cliente**: "⚠ Bloqueado: <motivo>".
- **Cobro**: un bloque "Advertencias" arriba de los medios de pago con la lista completa. No pide
  confirmación: Enter + Ctrl+Enter no cambia.
- **Slot de la barra**: al agregar o ajustar una línea que queda con advertencia, el slot la muestra en
  ámbar ("Coca 500 ml: stock disponible 3"). Sin `.select()` (no hay nada que corregir); se borra con
  la próxima tecla, igual que un error. Vive en un signal hermano, `commandBarWarningSignal`
  (`ui/state/command-bar.ts`); un error tiene precedencia sobre una advertencia en el mismo slot.

## 4. Contrato 4.0.0

### Cambios

- **`Sale`**: suma `voidsSaleId` (opcional). `status` queda solo con `closed`. Sale `voidedAt`.
- **Sale `SaleVoidEvent`**: 7 tipos de evento. La anulación viaja como `SaleEvent` con `voidsSaleId`.
  El backend la trata como cualquier venta (stock por sus movimientos, saldo por su pago `account`
  negativo sin `reference`) y puede usar `voidsSaleId` para auditoría o para marcar el original.
- **`StockMovement.reason`** conserva `sale-void`.
- **`GET /info`** y **`X-POS-Contract-Version`** (abajo).
- Un `sale-void` que haya quedado pendiente en una terminal entra a `LEGACY_OUTBOX_TYPES`, igual que
  `cash-session`: no viaja nunca. Su stock ya viajó por sus propios `stock-movement`; se pierde solo
  el aviso de la anulación. Riesgo aceptado: no hay terminales en producción.

### `GET /info`

```
{ contractVersion: "4.0.0", status: "ok" | "maintenance", message?: string,
  backend?: { name: string, version: string } }
```

Misma autenticación que el resto. En Sheets es la acción `info` del puente.

### Versión en cada request

- REST: header `X-POS-Contract-Version: 4.0.0` en todos los requests (`/info`, `/sync/push`,
  `/sync/pull`, `/account-holds`).
- Sheets: campo `contractVersion` en el cuerpo JSON (el `doPost` de Apps Script no expone headers).

### Qué hace el backend si no es compatible

Si la versión declarada tiene un major que el backend no soporta, responde **`409`** con
`{ code: "incompatible-contract", contractVersion: "<la del backend>" }`, **sin procesar nada y sin
ack**. Sin la versión (un POS anterior a 4.0.0), queda a su criterio; el contrato recomienda tratarlo
igual.

No contradice "el backend nunca rechaza": ese principio es sobre el **contenido** y sobre no perder
nada. Acá el backend no juzga una venta: dice que no entiende el idioma. Nada se pierde: sin ack, el
lote sigue congelado en el outbox del POS con su mismo `idempotency_id` y sale cuando el backend se
actualice. Se descartó que el backend acepte y guarde en cuarentena con ack: el POS lo daría por
entregado y lo borraría a los 7 días, dejando el dato solo en una tabla cruda del backend.

### Regla de compatibilidad (`domain/contract-version.ts`, puro)

`POS_CONTRACT_VERSION = '4.0.0'`. Compatible si el backend tiene **el mismo major** y un **minor mayor
o igual**. Una versión con formato inválido es incompatible.

## 5. Estado del backend en el POS

### Puerto

`Connector.getInfo(): Promise<Result<BackendInfo>>`, con su schema Zod en `sync/connector.ts`. Los tres
conectores lo implementan (REST, `rest-demo` por reuso, Sheets). Una respuesta `409
incompatible-contract` en cualquier operación se traduce a `sync/incompatible-contract`.

### Errores nuevos (`ErrorMeta`, traducidos en `ui/errors.ts`)

- `sync/incompatible-contract { backend: string; pos: string }`
- `sync/backend-maintenance { message?: string }`

### Cuándo se chequea

- **Probar (wizard de `/CONFIG`)**: `getInfo` antes del pull. Incompatible: la prueba falla con "El
  backend usa el contrato 3.0.0; esta versión del POS necesita 4.x". Mantenimiento: falla con su
  mensaje. En los dos casos, "Reintentar" y "Corregir datos".
- **Al arrancar**, antes del primer `runPushThenPull`.
- **Después de un fallo de sync que no sea de red** (error remoto, 4xx/5xx, payload inválido), y
  siempre que llegue un `409 incompatible-contract`.

### Estado en runtime

`backendStatusSignal` (`ui/state/sync.ts`): `unknown | ok | incompatible | maintenance`, con la última
`BackendInfo`.

- Con `incompatible` o `maintenance`, **ningún push ni pull corre**. Cada ciclo programado hace solo un
  `getInfo` (liviano) y, cuando vuelve `ok`, se retoma solo.
- Un error de red en `getInfo` no cambia el estado conocido. Con `unknown` (sin red al arrancar), los
  ciclos corren como siempre.
- `/SINCRONIZAR` pregunta `getInfo` primero.
- **La venta nunca se bloquea.**
- Barra de estado, dos estados nuevos: "Backend incompatible (contrato X, se necesita 4.x)", con estilo
  de error, y "Backend en mantenimiento: <mensaje>", informativo. Precedencia: detrás de "sin
  configurar" y de offline, delante del resto.
- `/DIAGNOSTICO` muestra la última `BackendInfo` y el estado. Cada `getInfo` entra en el log de
  intentos (`logSyncAttempt`).

### Implementaciones

- **REST**: `GET /info`; header en todos los requests; 409 → `sync/incompatible-contract`.
- **Sheets (`bridge.gs`)**: acción `info` con la versión fija en una constante y `status: 'ok'`
  siempre; valida `contractVersion` del cuerpo y, si el major no coincide, responde
  `{ ok: false, code: 'incompatible-contract', contractVersion }` sin procesar nada.
- **Minibackend**: `GET /info`; valida el header en todos los endpoints. El panel `/_demo` suma
  "Modo mantenimiento" (con mensaje) y "Simular contrato 3.0.0": este último hace que `/info` informe
  3.0.0 **y** que push y pull respondan 409, para probar los dos caminos. Sale la tabla `sale_voids`,
  sube `SCHEMA_VERSION` y el panel muestra "Anula a" en las ventas.
- **Sheets, planilla**: Ventas suma la columna opcional "Anula a" (la agrega `ensureColumns`). La
  pestaña Anulaciones deja de escribirse; si ya existía, queda como está.

## 6. Enter para cobrar, Cobro y mouse

### Enter en la venta (barra vacía)

| Estado | Enter |
|---|---|
| Hay líneas (con cualquier total, y aunque haya una línea seleccionada) | Abre Cobro, igual que Ctrl+Enter (`triggerCheckout`, con sus chequeos) |
| Sin líneas, con cliente adjunto | Slot: "Cobranza sin venta: llega en una próxima versión" (la Etapa 6 lo conecta) |
| Sin líneas, sin cliente | Nada |

`/COBRAR` y Ctrl+Enter siguen mostrando su motivo cuando están deshabilitados. Con una línea
seleccionada y la barra con un número, Enter sigue siendo "cambiar cantidad" (§1). #61 se cierra: sin
nada que cobrar, Cobro no se abre por ningún camino (ya lo garantizaba la disponibilidad de `/COBRAR`
desde la Etapa 2).

### Cobro

- Efectivo arranca con |total| precargado y todo el texto seleccionado. Con total 0 no se precarga
  nada.
- Enter y ↓ pasan al campo siguiente, ↑ al anterior, sin ciclar (en el último, Enter no hace nada). Un
  campo deshabilitado (Cuenta corriente sin cliente) se saltea.
- Ctrl+Enter confirma: botón `.btn-primary` "Confirmar cobro (Ctrl+Enter)". Esc cancela: botón `.btn`
  "Cancelar (Esc)".
- Modo devolución (total < 0): título "Devolver $X", sin vista de vuelto, suma exacta. Cuenta
  corriente acredita sin pedir hold (y sigue exigiendo cliente adjunto).
- Bloque de Advertencias arriba (§3).
- Mouse (patrón de la Etapa 2): `keepFocusOnMouseDown` en el contenedor; click en un campo lo enfoca
  (es un control de texto); los botones llaman a la misma función que su tecla.

### Carrito

Click en una fila = seleccionarla (lo mismo que llegar con ↑/↓). El foco se queda en la barra.

## 7. Pruebas

- **Unit (dominio)**: redondeo; carrito con decimales, negativos, suma neta y borrado en 0; descuento
  sobre línea negativa; totales redondeados; `closeSale` con total positivo, 0 y negativo;
  `resolveTender` en modo devolución y con total 0; `buildVoidSale` (líneas, pagos, `reference`,
  errores, ventana); `isVoided` con el status legado; advertencias; `contract-version`; `reapply` con
  un ticket de anulación (saldo y stock); limpieza sin `pendingVoidSaleIds`; parser (cantidades con
  signo y decimales, más de 3 decimales).
- **Storage**: `voidSaleAndPersist` en una transacción (venta nueva, stock, cuenta, outbox, turno
  abierto, original intacto, índice `voidsSaleId`); migración de schema Dexie.
- **Controllers y pantallas**: Enter para cobrar en los tres estados; navegación de Cobro (Enter/↑/↓,
  campo deshabilitado); modo devolución; `/ANULAR` con marcas y filas sin acción; `/RESUMEN` con
  marcas; advertencias en búsqueda, carrito, cliente, cobro y slot; click en el carrito.
- **Motor**: estados `incompatible`/`maintenance`; ciclo que solo hace `getInfo`; reanudación; 409 en
  push y en pull; `unknown` sin red.
- **Conectores**: REST (header, `getInfo`, 409); Sheets (`contractVersion` en el cuerpo, acción `info`,
  columna "Anula a") con la planilla falsa.
- **Minibackend**: `/info`, toggles, 409, saldo acreditado por una anulación con cuenta corriente.
- **E2E**: Enter + Ctrl+Enter para vender; cantidad `1,5`; línea negativa y devolución; anular y ver
  las marcas.
- **Prueba manual en el navegador** con el minibackend: pasos para cada punto, incluidos los toggles de
  mantenimiento y contrato 3.0.0.

## 8. Documentación e issues

- `docs/connector-api.openapi.yaml` a 4.0.0; README del conector de Sheets; CLAUDE.md.
- Comentarios: #100 (saldo de efectivo sin "− anulaciones"; `/RESUMEN` ya marca anuladas), #110 (qué
  quedó hecho y qué sigue abierto), #61 y #12 (se cierran con el PR), checklist de #94.

## Fuera de alcance

- Búsqueda en `/ANULAR` y ticket completo en la confirmación (#110, con #58).
- Cobranza sin venta (Etapa 6, #101): Enter con cliente y sin líneas solo avisa.
- Sacar los turnos de caja (Etapa 5, #100).
- Modo mantenimiento en la planilla de Sheets (siempre `ok`).
