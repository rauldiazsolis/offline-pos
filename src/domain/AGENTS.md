# src/domain — reglas de negocio

Reglas de negocio puras. Los principios (sin imports de infraestructura, `Result<T>`, modelo de
dominio, puertos) están en el [`AGENTS.md` de la raíz](../../AGENTS.md). Otras reglas que rigen
archivos de esta carpeta viven donde está el grueso del tema:

- `outbox.ts`, `push-lot.ts`, `reapply.ts`, `local-cleanup.ts`, `contract-version.ts` (sync):
  [`src/sync/AGENTS.md`](../sync/AGENTS.md).
- `customer.ts::canChargeOffline` (reserva de crédito): [`src/sync/AGENTS.md`](../sync/AGENTS.md).
- `customer-payment.ts::resolveCollection` (cobranza), `sale-warnings.ts` (advertencias),
  `tender.ts` en la pantalla de Cobro, `day-summary.ts` (`/RESUMEN`):
  [`src/ui/AGENTS.md`](../ui/AGENTS.md).
- `cart.ts` (línea libre, recargo global, `discardCart`): la barra de comandos en
  [`src/ui/AGENTS.md`](../ui/AGENTS.md).

## Venta: cantidades, tickets en 0 o negativos y anulación (Etapa 4, #99)

- **Cantidades con signo y hasta 3 decimales** (`,` o `.`), en el prefijo `<n>*` y en número + Enter
  sobre la línea seleccionada (`parse-command-bar.ts::parseQuantityText`); con más de 3 decimales se
  redondea a 3 y se avisa en el slot ("Cantidad redondeada a N"), nunca en silencio. Un `-` pegado a un
  texto vale `-1*` (`-regalo$100`, `-aceite`). El carrito
  suma neto por producto: puede crear o dejar una línea en negativo (`-2*coca` sin línea previa es una
  devolución) y 0 exacto la borra; número + Enter con 0 también. Redondeo en un solo lugar
  (`domain/rounding.ts`): cantidades a 3, importes a 2, y `calculateTotals` redondea cada campo (el
  total sale de los otros ya redondeados). Un descuento de línea va sobre el valor absoluto con el
  signo de la línea.
- **Tickets en 0 o negativos**: `closeSale` exige que todos los pagos tengan el signo del total (en
  negativo, suma exacta; en 0, sin pagos). Cobro (`domain/tender.ts::tenderMode`) en **modo
  devolución** con total negativo: título "Devolver X", se tipea en positivo cuánto se devuelve por
  medio, sin vuelto, suma exacta (`sale/refund-amount-mismatch`); cuenta corriente acredita sin pedir
  hold (sigue exigiendo cliente). Un ticket negativo suma stock (`delta = -qty`).
- **La anulación es un ticket propio** (`domain/sale-lifecycle.ts::buildVoidSale`): líneas y pagos
  invertidos, `voidsSaleId` al original (que no se toca), el pago `account` pierde su `reference`
  (acreditación); `storage/sale-repository.ts::voidSaleAndPersist` la persiste como cualquier venta
  (índice Dexie `voidsSaleId`, versión 6). Ventana de 24 h móviles (`isWithinVoidWindow`), no se
  anula dos veces (`sale/already-voided`) ni una anulación (`sale/cannot-void-a-void`); una devolución
  común sí. `/ANULAR` (`listVoidCandidates`) lista los últimos 20 tickets de 24 h, con la original
  anulada ("Anulada") y la anulación ("Anulación de HH:MM · $X") atenuadas y sin acción; `/RESUMEN`
  marca lo mismo (`isVoided`, que también reconoce el `status: 'voided'` legado).

## Caja: saldo de efectivo, conceptos y numeración (Etapa 5, #100 y #120)

- **Saldo de efectivo** (`calculateCashBalance`, pura): lo contado en el último arqueo + los pagos
  `cash` con signo de las ventas posteriores + ingresos − egresos manuales posteriores + el efectivo de
  las cobranzas posteriores (#101) ("posterior" es estricto). Los `count-adjustment` nunca suman (el `counted` ya los incluye); sin arqueo, base 0.
  Anulaciones y devoluciones restan solas. El esperado que vale al arquear es el recalculado dentro
  de la transacción (`recordCashCount`), no el que vio la pantalla.
- **Conceptos sugeridos**: una fila por `[direction+concept]` con la grafía de la primera vez; la
  comparación ignora mayúsculas y espacios. Puntaje = usos con vida media de 14 días, tope de 8, sin
  preselección (`domain/concept-ranking.ts`); con texto, primero filtra FlexSearch detrás del puerto
  `domain/concept-search.ts`. Nunca se limpia a los 7 días.
- **Numeración** (`domain/ticket-number.ts`): `Sale.ticket = { date, number }` con la fecha **local**
  de la terminal; se asigna **dentro de la transacción** de la venta y de la anulación (que consume
  número) como `max(contador de la misma fecha, último local de esa fecha) + 1`. El contador vive en
  `localStorage` (`offline-pos:ticket-counter`, `sync/ticket-counter.ts`, best-effort) y se escribe
  después del commit: cubre los datos locales borrados ("Borrar" en `/CONFIG`, `/DEMO_RESET`, pérdida
  del id), y las ventas locales cubren un contador perdido; `pos.reset()` lo borra. Una venta
  anterior no tiene número y nunca se le inventa. Se ve como "Ticket #12" en el comprobante,
  `/ANULAR` y `/RESUMEN`; una anulación dice "Anulación del #12" (o "del #12 del 23/09" si el original
  es de otra fecha; "Anulación de HH:MM" si el original no tiene número) — `ui/format-ticket.ts`.
