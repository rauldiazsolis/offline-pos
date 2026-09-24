# Caja sin turnos: arqueo, ingresos/egresos, `/RESUMEN` por fecha y numeración de tickets

Fecha: 2026-09-24
Estado: aprobado en brainstorming, pendiente de plan.
Issues: #100 (Etapa 5 del epic #94, reemplaza a #57) y #120 (numeración de tickets). Depende de las
Etapas 1 a 4 (#96–#99).

## Contexto

La Etapa 5 saca los turnos de caja: se vende sin apertura ni cierre, y `/CAJA` pasa a registrar
movimientos de caja (arqueo, ingreso, egreso). `/RESUMEN` deja de mostrar "el turno" y pasa a mostrar
un día calendario. Se suma una numeración de tickets propia del POS (#120).

Lo que el código hace hoy y hay que cambiar:

1. `CashSession` (tabla `cashSessions`) agrupa ventas (`sales[]`, llenado por
   `recordSaleInCashSession` desde `closeSaleAndPersist`). Cobrar exige un turno abierto
   (`triggerCheckout` y `closeSaleAndPersist`). El arqueo es `apertura + efectivo del turno`.
2. `domain/cash-movement.ts` y el evento `cash-movement` existen desde el contrato v3, **sin UI y sin
   tabla local**: un movimiento solo existiría en el outbox, que se limpia a los 7 días.
3. `buildCountAdjustment` no genera nada cuando la diferencia es 0 (ese arqueo no viaja), pero un
   arqueo sin diferencia igual tiene que quedar localmente como base del saldo.
4. `/RESUMEN` (`storage/cash-summary-repository.ts`) muestra el turno abierto o el último cerrado, y
   los tickets se identifican por su ULID ("Ticket #01K…").
5. La limpieza a 7 días (`domain/local-cleanup.ts`) usa como ancla el último turno cerrado y el
   abierto con sus ventas.
6. La venta no tiene número legible.

Decisiones transversales (epic #94) que aplican: sin turnos; lo sincronizado se borra a los 7 días,
salvo el último arqueo y todo lo posterior; la anulación es un ticket propio (Etapa 4), así que el
saldo de efectivo no necesita un término "− anulaciones": los pagos `cash` ya vienen con signo.

## 1. Caja: modelo local

### Dos tablas: `cashMovements` y `cashCounts`

- `cashMovements` guarda los `CashMovement` **tal como los define el contrato** (`source: 'manual'` o
  `'count-adjustment'`). Todo movimiento guardado acá tiene su evento `cash-movement` en el outbox.
- `cashCounts` guarda cada arqueo, incluidos los que no tienen diferencia (que no viajan):

```typescript
// domain/cash-count.ts
export type CashCount = {
  id: string; // ULID
  expected: number;
  counted: number;
  createdAt: string; // ISO 8601
  /** El ajuste (`CashMovement` con `source: 'count-adjustment'`), si hubo diferencia. */
  adjustmentId?: string;
};
```

Se descartaron: una tabla única con una unión `movement | count` (mezcla dos formas y el
`CashMovement` local deja de ser el del contrato) y el arqueo como un `CashMovement` de monto 0 (rompe
`amount > 0` del contrato y obliga a filtrar qué viaja).

### Saldo de efectivo

`domain/cash-count.ts::calculateCashBalance({ lastCount, sales, movements })`, pura:

```
saldo = (lastCount?.counted ?? 0)
      + Σ pagos 'cash' (con signo) de las ventas posteriores a lastCount
      + Σ ingresos 'manual' posteriores − Σ egresos 'manual' posteriores
```

- "Posterior" es `createdAt > lastCount.createdAt`; sin arqueo, todo cuenta (base 0 al inicio de la
  terminal). En la práctica coincide con "el primer arqueo hace de apertura, esperado 0" si se cuenta
  antes de vender; si se vendió antes, el primer ajuste refleja solo el cambio inicial, no lo ya
  cobrado (así el backend no lo cuenta dos veces).
- Los movimientos `count-adjustment` **nunca** suman: el `counted` de su arqueo ya los incluye.
- Una venta cuenta sus pagos `cash` con su signo: anulaciones y devoluciones restan solas. `Payment.amount`
  ya es el neto aplicado desde el Ciclo 9 (el vuelto nunca está incluido).
- Las cobranzas (`customer-payment`) no tienen tabla local todavía; la Etapa 6 las suma con el mismo
  criterio.

### Arqueo

`buildCashCount({ id, adjustmentId, expected, counted, now })` devuelve `Result<{ count, adjustment? }>`
y reusa `buildCountAdjustment` (el ajuste solo existe si la diferencia no es 0). `counted` negativo o
no finito es `cash/invalid-amount`.

### Ingreso / egreso

`buildManualCashMovement({ id, direction, amount, concept, description?, now })` →
`Result<CashMovement>`: `amount > 0` (`cash/invalid-amount`), `concept` recortado no vacío
(`cash/concept-required`), `description` recortada y omitida si queda vacía. Montos redondeados a 2
decimales (`domain/rounding.ts`).

### Conceptos sugeridos

Tabla `cashConcepts` con clave compuesta `[direction+concept]`: `{ direction, concept, uses, lastUsedAt }`.
Ingreso y egreso tienen estadísticas separadas. Se actualiza en la misma transacción que el
movimiento (`uses + 1`, `lastUsedAt = now`). "Ajuste por arqueo" no entra. La limpieza a 7 días nunca
la toca; se vacía con `clearAllTables` (pérdida del id de dispositivo, "Borrar" en `/CONFIG`,
`/DEMO_RESET`).

Orden (`domain/concept-ranking.ts`, pura): puntaje = `uses` ponderado por recencia (decae con los días
desde `lastUsedAt`, vida media de 14 días). Sin texto: los más relevantes (tope 8). Con texto: primero
filtra con una búsqueda difusa (FlexSearch detrás de un puerto chico, `domain/concept-search.ts`, mismo
patrón que `CustomerSearch`) y ordena las coincidencias por el mismo puntaje. La comparación de
conceptos para la estadística ignora mayúsculas y espacios de más, y conserva la grafía de la primera
vez.

### Persistencia (`storage/cash-repository.ts`)

- `recordCashCount(counted)`: en **una** transacción lee el último arqueo, las ventas y movimientos
  posteriores, calcula el esperado **en ese momento**, guarda el `cashCount` y, si hubo diferencia, el
  `cashMovement` y su evento `cash-movement` (con `origin`).
- `recordCashMovement(input)`: el `cashMovement`, su evento y el upsert del concepto, en una
  transacción.
- `getCashBalance()`: saldo actual y fecha del último arqueo, para `/CAJA`, `/RESUMEN` y la barra de
  estado.
- `listConceptSuggestions(direction, query)`.

Dexie **versión 7**: `cashMovements: 'id, createdAt'`, `cashCounts: 'id, createdAt'`,
`cashConcepts: '[direction+concept], direction'` y `cashSessions: null` (se elimina la tabla).

## 2. Sin turnos

Se eliminan `domain/cash-session.ts` (salvo `calculateProductQuantities`, que se muda a
`domain/sales-summary.ts`), `storage/cash-session-repository.ts`, `ui/state/cash-session.ts`,
`ui/keyboard/cash-session-controller.ts`, `ui/screens/cash-session-screen.tsx`, el gate de
`triggerCheckout` y de `closeSaleAndPersist`, `recordSaleInCashSession`, el registro de la anulación en
el turno y los códigos `cash-session/*` de `ErrorMeta` (con su traducción). `hasUserData` y el resumen
de datos locales del wizard cuentan arqueos y movimientos de caja en lugar de turnos. Un turno abierto
al actualizar se pierde sin migración (no hay terminales en producción; el primer arqueo después
arranca desde base 0).

## 3. Numeración de tickets (#120)

### Modelo

`Sale.ticket?: { date: string; number: number }` — `date` es la fecha local de la terminal
(`'YYYY-MM-DD'`) con la que se numeró, `number` ≥ 1. Una venta anterior a esta etapa no lo tiene y
nunca se le inventa uno. Las anulaciones son tickets propios: consumen número.

### Asignación

`domain/ticket-number.ts`, puro:

- `localDateKey(iso)` → `'YYYY-MM-DD'` en la zona horaria de la terminal.
- `localDayRange(date)` → `{ from, to }` en ISO, para consultar por el índice `createdAt`.
- `nextTicketNumber({ date, stored, lastLocal })` → `max(stored?.date === date ? stored.last : 0,
  lastLocal ?? 0) + 1`.

`closeSaleAndPersist` y `voidSaleAndPersist`, **dentro de su transacción**, leen las ventas del día
(`createdAt` en el rango del día; se toma el mayor `ticket.number` con `ticket.date === date`) y el
contador guardado, y asignan el número. Después del commit guardan el contador en `localStorage`
(`offline-pos:ticket-counter`, `{ date, last }`, best-effort como `sync/cursor.ts`,
`sync/ticket-counter.ts`). Si algo falla entre el commit y esa escritura, la próxima venta lo deriva de
las ventas locales.

Casos:

- **Día nuevo**: el contador es de otra fecha y no hay ventas de hoy → 1.
- **Contador perdido** (clave borrada): se retoma desde el último número de la fecha entre las ventas
  locales.
- **Datos locales borrados con el mismo id** ("Borrar" en `/CONFIG`, `/DEMO_RESET`, que solo vacían
  IndexedDB): el contador sigue en `localStorage` → no se repiten números.
- **Id de dispositivo perdido**: la Etapa 2 sigue borrando lo local, pero el contador queda en
  `localStorage` y la numeración continúa. `pos.reset()` borra todo `offline-pos:*`, contador incluido
  (equivale a una terminal nueva).
- **Reloj que retrocede a una fecha anterior**: el contador es de otra fecha y se usa el último número
  local de esa fecha. Si la limpieza ya borró esas ventas, puede repetirse un número de un día de hace
  más de 7 días — riesgo aceptado.
- No depende de sucursal ni punto de venta.

### Dónde se ve

- **Comprobante**: "Ticket #12".
- **`/ANULAR`**: cada fila con su número. La anulación: "Anulación del #12" si el original es de la
  misma fecha de ticket, "Anulación del #12 del 23/09" si es de otra. Si el original no tiene número:
  "Anulación de HH:MM" como hoy. Misma regla en `/RESUMEN` y en el comprobante de la anulación
  (`ui/format-ticket.ts`).
- **`/RESUMEN`**: ver §5. Una venta sin número se muestra "Ticket" a secas.

## 4. `/CAJA` como modal

`ui/screens/cash-screen.tsx`, `ui/keyboard/cash-controller.ts`, estado en `ui/state/cash.ts`, reglas en
un modelo puro `ui/keyboard/cash-form-model.ts`. Criterios de diseño de #57: tarjeta centrada sobre
overlay, todos los campos visibles, Ctrl+Enter confirma, Esc cancela.

- **Selector** Arqueo / Ingreso / Egreso arriba, con comportamiento de radio (patrón "Teclado y
  mouse"): Alt+1/2/3 desde cualquier campo, click, o ↑/↓ con el foco en el selector. Arranca en Arqueo
  o en la opción con la que se abrió (`enterCashScreen(kind)`).
- **Botones**: "Cancelar (Esc)" y "Confirmar (Ctrl+Enter)" (`.btn-primary`).
- Al confirmar, vuelve a la venta y deja un aviso informativo en el slot de la barra de comandos
  (`commandBarNoticeSignal`, nuevo: mismo ciclo de vida que `commandBarWarningSignal` — se borra con
  la próxima tecla — pero sin estilo de advertencia): "Arqueo registrado: sobran $200",
  "Arqueo registrado: sin diferencia", "Ingreso registrado", "Egreso registrado".

### Arqueo

- Se ve el **esperado** (no es ciego) y el último arqueo: "Último arqueo: hoy 09:12" / "ayer 18:40" /
  "23/09 18:40", o "Sin arqueo previo · esperado desde el inicio de la terminal".
- Un campo **Contado**. En vivo: "Sobran $X" / "Faltan $X" / "Sin diferencia".
- Enter o Ctrl+Enter confirma. El esperado que vale es el recalculado en la transacción (§1).

### Ingreso / Egreso

- Campos **Concepto**, **Descripción** (opcional) y **Monto**. Enter y ↓ pasan al campo siguiente, ↑
  al anterior (salvo con sugerencias abiertas), Ctrl+Enter confirma — mismo patrón que Cobro.
- **Sugerencias** en un overlay propio bajo Concepto (`autocomplete="off"`): se abren al enfocar el
  campo y al tipear; ↑/↓ las recorren (sin preselección: Enter sin elegir acepta lo tipeado y pasa a
  Descripción), Enter o click sobre una la elige y pasa a Descripción, Esc cierra el overlay (con el
  overlay cerrado, Esc cancela el modal). Un concepto nuevo se tipea libre.
- **Egreso mayor que el saldo**: advertencia ámbar "El egreso supera el saldo esperado ($X)", sin
  bloquear.

### Errores y mouse

Monto inválido y concepto vacío van a un slot de error de altura fija y seleccionan el campo
(`useSelectOnErrorSignal`). `keepFocusOnMouseDown` en el contenedor; click en un campo lo enfoca.

## 5. `/RESUMEN` por fecha

`storage/cash-summary-repository.ts::getDaySummary(date)` reemplaza a `getCashSummaryContext`: lee del
rango local del día las ventas (agrupadas por `ticket.date` si lo tienen, si no por `createdAt` en hora
local), los movimientos de caja y los arqueos (por `createdAt` en hora local), más las marcas de
anulación (`loadVoidedSaleIds`, `loadVoidOriginals`) y, si el día es hoy, el saldo actual. El resumen
numérico sale de una función pura (`domain/day-summary.ts::calculateDaySummary`).

- **Navegación**: arranca en hoy. Encabezado "Resumen del día" con la fecha ("Hoy · jueves 24/09",
  "Ayer · miércoles 23/09" o la fecha) y botones "‹ Anterior (Alt+←)" y "Siguiente (Alt+→) ›". De a un
  día calendario, acotado entre el día más viejo con datos locales y hoy (los botones se deshabilitan
  en los extremos). Al cambiar de día se conservan pestaña y filtros, la selección vuelve al principio.
  Un día vacío: "Sin movimientos este día". En el día más viejo: "Los datos de más de 7 días se limpian
  de esta terminal".
- **Panel lateral**:
  - Total vendido (neto de `Sale.total`).
  - Tickets emitidos, con "(N anuladas)".
  - Desc/Recargos y Otros pagos, como hoy.
  - **Efectivo**: cobros en efectivo (neto), ingresos, egresos y ajustes por arqueo del día.
  - **Saldo de efectivo actual**, solo en hoy, con "desde el arqueo de 09:12" o "sin arqueo previo".
- **Pestaña "Movimientos"** (antes "Tickets"), una lista por hora:
  - Venta: "Ticket #12" con el detalle de líneas (sin ULID).
  - Anulación: "Ticket #13 · Anulación del #12" (regla de §3).
  - Ingreso / Egreso: "Ingreso · Cambio inicial", descripción y monto con signo.
  - Arqueo: "Arqueo · contado $X · esperado $Y · sobran/faltan $Z" o "sin diferencia".
  - El buscador encuentra también por número ("12", "#12"), concepto y descripción.
- **Productos** y **Medios de pago**: como hoy, sobre las ventas del día.
- El gate "nunca hubo turno" (`cash-session/none-ever`) desaparece.

## 6. Aviso "Sin arqueo en 24 h"

- `ui/state/cash.ts::lastCashCountAtSignal` (se carga en `bootstrap` y se actualiza al registrar un
  arqueo y después de una limpieza) y `nowMinuteSignal` (reloj por minuto) derivan
  `cashCountOverdueSignal`: no hay arqueo, o el último tiene más de 24 h.
- En `StatusBar`: un `<button>` ámbar "Sin arqueo en 24 h" a la derecha, siempre visible cuando
  corresponde (independiente del estado de sync y de la conectividad), con `tabIndex={-1}` y
  `keepFocusOnMouseDown` para no sacarle el foco a la barra de comandos. Su click hace
  `stopPropagation` (no abre `/DIAGNOSTICO`) y abre `/CAJA` en Arqueo.

## 7. Limpieza a 7 días

`domain/local-cleanup.ts::planLocalCleanup` cambia el ancla:

- **Ancla = último `cashCount`**. Todo lo creado desde su `createdAt` en adelante se conserva: ventas,
  movimientos de stock y de cuenta, movimientos de caja y arqueos (el ancla incluida).
- **Sin ningún arqueo**: no se borran ventas ni movimientos de caja (son la base 0 del saldo);
  movimientos de stock y de cuenta siguen su regla de edad.
- Lo anterior al ancla sigue la regla de siempre (sincronizado y con más de 7 días). Un movimiento de
  caja se borra si su evento no está pendiente; un arqueo no tiene evento propio, pero si tiene ajuste,
  espera a que ese evento no esté pendiente.
- `cashConcepts` nunca se limpia.
- `CleanupCounts` cambia `cashSessions` por `cashMovements` y `cashCounts`. `/DIAGNOSTICO` y la última
  limpieza guardada muestran como ancla la fecha del último arqueo.

## 8. Contrato 4.1.0, conectores y minibackend

- **OpenAPI** (`docs/connector-api.openapi.yaml`): `Sale.ticket` opcional, `{ date (YYYY-MM-DD), number
  (integer ≥ 1) }`; versión 4.1.0. `POS_CONTRACT_VERSION = '4.1.0'`. Los schemas Zod compartidos
  (`sync/connector.ts`) lo aceptan opcional.
- **Compatibilidad**: la regla actual (`domain/contract-version.ts`: mismo major y minor del backend ≥
  el del POS) **no cambia**. Un backend que siga en 4.0.0 se ve como "Backend incompatible" hasta
  actualizarse — es lo que la regla dice: el POS manda algo que un 4.0 podría no guardar. El
  minibackend y el puente de Sheets pasan a 4.1.0 en esta etapa; una planilla con el puente viejo pide
  redesplegar `bridge.gs`.
- **REST**: nada propio.
- **Google Sheets**: `bridge.gs` en 4.1.0; dos columnas opcionales nuevas en Ventas, "Fecha del ticket"
  y "N° de ticket" (`columnas.gs`), agregadas solas por `ensureColumns` al redesplegar. README
  actualizado.
- **Minibackend**: guarda `ticket` de la venta (columnas nuevas; sube `SCHEMA_VERSION`), lo muestra en
  el panel `/_demo` ("#12 · 24/09"), responde 4.1.0 en `/info`.

## 9. Pruebas

- **Dominio**: saldo (con y sin arqueo, anulaciones, ajustes excluidos), `buildCashCount`,
  `buildManualCashMovement`, numeración (día nuevo, contador de otra fecha, contador perdido, reloj que
  retrocede), ranking de conceptos, resumen del día, limpieza con el ancla nueva y sin arqueo.
- **Storage** (fake-indexeddb): transacciones de arqueo e ingreso/egreso (con y sin ajuste, evento en el
  outbox, concepto actualizado), número asignado en venta y anulación, venta sin turno, migración a la
  versión 7, `getDaySummary`.
- **Componentes y controllers**: modal de `/CAJA` (selector, sugerencias, errores, advertencia de
  egreso), aviso de la barra de estado (click abre Arqueo sin abrir `/DIAGNOSTICO`), `/RESUMEN` por día,
  comprobante y `/ANULAR` con número.
- **E2E**: se elimina `openCashSession` de `e2e/helpers.ts` y de los specs; `cash-session.spec.ts` se
  reemplaza por `cash.spec.ts` (arqueo, ingreso con concepto sugerido, egreso, `/RESUMEN` de hoy, aviso
  de 24 h que abre el arqueo, numeración con venta más anulación). `minibackend-sync` verifica que el
  ticket llegue al backend.
- **Minibackend** y **puente de Sheets** (planilla falsa): `ticket` guardado, versión 4.1.0.

## Fuera de alcance

Cobranzas sin venta (Etapa 6, el saldo deja el hueco previsto), restricciones del arqueo (ciego,
permisos), reimpresión de tickets, saldo de efectivo al cierre de un día pasado.
