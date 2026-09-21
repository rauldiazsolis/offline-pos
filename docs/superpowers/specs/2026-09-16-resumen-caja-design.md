# `/RESUMEN`: consulta del turno de caja, y simplificación de `/CAJA`

Fecha: 2026-09-16
Estado: aprobado por el usuario, pendiente de plan de implementación.

## Contexto

Sesión de brainstorming dedicada a `feature:caja`. La funcionalidad actual de `/CAJA` es muy
básica: al abrir la pantalla con un turno ya abierto, ya se ve un resumen agregado (ventas,
totales por medio de pago, efectivo esperado) antes de tipear nada para cerrar. No hay forma de
consultar tickets individuales ni cantidades de producto vendidas, y esa información se mezcla con
el trámite de cierre.

Se decidió separar completamente las dos cosas:

- **`/CAJA`** (issue [#57](https://github.com/rauldiazsolis/offline-pos/issues/57), ya actualizado
  con esta decisión) queda **puramente transaccional**: abrir/cerrar el turno, sin mostrar ningún
  agregado ni detalle salvo el trámite mismo.
- **`/RESUMEN`** (issue nuevo,
  [#64](https://github.com/rauldiazsolis/offline-pos/issues/64)) es un comando nuevo, exclusivo
  para consultar "cómo vamos": tickets con su detalle completo, cantidades de producto vendidas, y
  el desglose por medio de pago que antes vivía en `/CAJA`.

Un prototipo interactivo (fuera del repo, en un Artifact) validó en vivo la mecánica de scroll más
delicada — la navegación por teclado de la pestaña Tickets — antes de escribir este spec. El
detalle completo de esa mecánica, ya verificado con pruebas reales de teclado (incluido
auto-repeat), está en la sección correspondiente más abajo.

## `/CAJA`: alcance final (sin cambios de código respecto de lo ya documentado en el issue)

- `'opening'`: monto de apertura — sin cambios.
- `'open'`: **ya no muestra ningún resumen al entrar** — pide directo el efectivo contado. Hoy
  (`cash-session-screen.tsx`) el resumen se ve apenas se entra a la pantalla; ese bloque entero se
  saca.
- `'confirming-close'`: mantiene el preview de la diferencia con el monto tipeado (como hoy) —
  permite corregir el conteo antes de comprometerse a cerrar.
- `'closed'`: solo muestra la diferencia del arqueo (sobra/falta) — nada de desglose por medio de
  pago ni cantidad de ventas.

No hay cambios de dominio ni de `storage/` para esto — es pura poda de lo que ya se renderiza en
`cash-session-screen.tsx` (issue #57 ya lo cubre, junto con el pase visual a diálogo modal del
epic #49).

## `/RESUMEN`: gate (3 casos)

Nuevo comando en `ui/keyboard/commands.ts` (`AVAILABLE_COMMANDS`) y un `case 'RESUMEN'` en
`command-bar-controller.ts::runCommand`, resuelto por una función async `triggerCashSummary()`
(mismo patrón que `triggerCheckout`, que ya hace un chequeo async antes de cambiar de pantalla):

1. **Nunca hubo ningún turno** (ni abierto ni cerrado) en esta terminal: error en
   `commandBarErrorSignal` (nunca navega) — código nuevo `cash-session/none-ever` en
   `domain/result.ts::ErrorMeta` (`undefined`), traducido en `ui/errors.ts`
   ("No hay ningún turno de caja para consultar."). Distinto de `cash-session/none-open` (que exige
   un turno *abierto*, usado por `/COBRAR`) — acá alcanza con que exista cualquiera.
2. **Turno abierto**: navega normal, mostrando el turno en curso (aunque no tenga ventas todavía).
3. **Turno cerrado más reciente, sin uno abierto**: navega normal mostrando ese turno cerrado, con
   una nota de cortesía en el diálogo ("Turno cerrado") — así se puede seguir viendo la diferencia
   del arqueo después de cerrar, mientras no se abra uno nuevo.

`storage/cash-summary-repository.ts` (nuevo archivo — se separa de `cash-session-repository.ts`
porque este compone datos de tres repositorios distintos, mientras que el otro se mantiene enfocado
en el ciclo de vida abrir/cerrar):

```typescript
export async function getCashSummaryContext(): Promise<
  { session: CashSession; summary: CashSessionSummary; sales: Sale[]; isClosed: boolean } | undefined
> {
  const open = await getCurrentOpenCashSession();
  const session = open ?? (await getMostRecentClosedCashSession());
  if (session === undefined) return undefined;
  const sales = (await db.sales.bulkGet(session.sales)).filter((s): s is Sale => s !== undefined);
  return {
    session,
    summary: calculateCashSessionSummary(session, sales),
    sales,
    isClosed: session.closedAt !== undefined,
  };
}
```

`getMostRecentClosedCashSession()` es una función chica nueva en `cash-session-repository.ts`
(`db.cashSessions.toArray()`, filtra `closedAt !== undefined`, ordena por `closedAt` desc, toma la
primera) — mismo criterio de "nunca va a haber más que un puñado de turnos guardados" que ya
justifica `getCurrentOpenCashSession()` (sin índice Dexie dedicado).

## Dominio: dos agregados nuevos en `CashSessionSummary`

El panel lateral necesita dos números que hoy no calcula `calculateCashSessionSummary`
(`domain/cash-session.ts`):

- `totalCollected: number` — suma de `totalsByMethod` (ya se computaba ese objeto, esto es una
  reducción sobre lo mismo).
- `adjustmentTotal: number` — Desc/Recargos combinado (línea + global) de todas las ventas
  cerradas del turno. Igual que `Totals.globalAdjustmentAmount` en `domain/totals.ts` (positivo
  recarga, negativo descuenta), pero agregado sobre `Sale[]` en vez de un `Cart` — una `Sale`
  cerrada no guarda `discountTotal`/`globalAdjustmentAmount` por separado, así que se deriva como
  `sale.total - subtotalBruto(sale.lines)` por venta (`subtotalBruto` = suma de
  `line.unitPrice * line.qty` sin descuentos), sumado sobre las ventas cerradas. No hace falta
  separar descuento de línea vs. global para este único número combinado (el panel lateral muestra
  un solo valor, igual que el prototipo).

Ambos se agregan al `for` que ya recorre `closedSales` en `calculateCashSessionSummary` — sin loop
nuevo.

```typescript
export type CashSessionSummary = {
  salesCount: number;
  totalsByMethod: Record<Payment['method'], number>;
  totalCollected: number;
  adjustmentTotal: number;
  expectedCash: number;
  countedCash?: number;
  difference?: number;
};
```

### Cantidades de producto vendido — nueva función pura

```typescript
export type ProductQuantity = { productId: string; qty: number };

export function calculateProductQuantities(sales: Sale[]): ProductQuantity[] {
  const closedSales = sales.filter((s) => s.status === 'closed');
  const qtyByProduct = new Map<string, number>();
  for (const sale of closedSales) {
    for (const line of sale.lines) {
      if (line.kind !== 'product') continue; // sin identidad estable para agrupar líneas libres
      qtyByProduct.set(line.productId, (qtyByProduct.get(line.productId) ?? 0) + line.qty);
    }
  }
  return [...qtyByProduct].map(([productId, qty]) => ({ productId, qty }));
}
```

Solo agrupa líneas `kind: 'product'` — una línea libre no tiene identidad de producto contra la
que fusionar (mismo criterio ya documentado en CLAUDE.md para `addFreeformLine`). El resultado es
un array sin ordenar ni redondear: la pestaña "Resumen por producto" hace su propio orden (por
cantidad desc. por defecto, o por relevancia del filtro) y formatea el número — el dominio no sabe
de presentación.

## `storage/`: resolución de nombres, igual que el resto de la app

`ProductQuantity.productId` y `SaleLine` (de tipo `'product'`) no traen el nombre del producto —
igual que `CartView.tsx`/`receipt-screen.tsx`, que resuelven con
`getCatalogRepository().getProduct(id)?.name ?? id` **en el componente**, no en `storage/`. Mismo
criterio acá: ni `cash-summary-repository.ts` ni el dominio inventan una forma "enriquecida" con
nombres — la pantalla resuelve producto y cliente (`getCustomerRepository().getCustomer(id)?.name`)
al renderizar, con el repositorio ya cargado en memoria (síncrono).

## UI: estructura de la pantalla

**`ui/state/screen.ts`**: `ActiveScreen` suma `'cash-summary'`.

**`ui/state/cash-summary.ts`** (nuevo, un signal por responsabilidad, mismo patrón que
`cash-session.ts`):

```typescript
export const cashSummaryContextSignal = signal<CashSummaryContext | undefined>(undefined);
export const cashSummaryTabSignal = signal<'tickets' | 'products' | 'payments'>('tickets');
export const ticketFilterSignal = signal('');
export const productFilterSignal = signal('');
export const selectedTicketIndexSignal = signal(0);
export const selectedProductIndexSignal = signal<number | null>(null);
```

**`ui/keyboard/cash-summary-controller.ts`** (nuevo):

- `triggerCashSummary()`: llama `getCashSummaryContext()`; `undefined` → error en
  `commandBarErrorSignal` (gate caso 1, nunca cambia de pantalla); si no, guarda el contexto,
  `activeScreenSignal.value = 'cash-summary'`.
- `exitCashSummaryScreen()`: resetea todos los signals de arriba, vuelve a `'sale'`.
- `setCashSummaryTab(tab)`: cambia `cashSummaryTabSignal`, resetea el filtro/selección de la
  pestaña que se abandona (mismo criterio que `updateCommandBarBuffer` reindexando selección al
  cambiar contexto).
- `updateTicketFilter(value)` / `updateProductFilter(value)`: actualizan el signal de filtro
  correspondiente.

**Filtro difuso, sin puerto nuevo**: a diferencia de `CatalogSearch`/`CustomerSearch` (interfaces de
dominio con implementación FlexSearch intercambiable, pensadas para repositorios de toda la app que
viven durante toda la sesión), acá el corpus a buscar es efímero y chico — las ventas de un único
turno. `cash-summary-controller.ts` arma un `flexsearch.Index` ad-hoc al cargar el turno (uno para
tickets: `customer.name + cada nombre de línea`, indexado por `sale.id`; otro para productos:
nombre de producto, indexado por `productId`) y lo descarta al salir de la pantalla — no se define
una interfaz de dominio nueva para esto, sería una abstracción sin un segundo caso de uso real que
la justifique (mismo criterio que ya explica por qué `CustomerSearch` no se generalizó con
`CatalogSearch` estando ambas sobre FlexSearch: acá directamente no hay necesidad de un puerto,
nada de esto se reemplaza).

**`ui/screens/cash-summary-screen.tsx`** (nuevo):

- Barra superior (dark chrome, igual criterio que el resto): título, input de filtro de la pestaña
  activa (único input enfocado — `useFocusOnMount`), `[Esc] Cerrar`.
- Si `context.isClosed`: badge/nota "Turno cerrado" (cortesía, no bloquea nada).
- Panel lateral fijo, siempre visible sin importar la pestaña (tarjetas con `--radius-md` /
  `--shadow-card`, mismo estilo que el resto de la app): Total recaudado
  (`summary.totalCollected`), Tickets emitidos (`summary.salesCount`), Desc/Recargos
  (`summary.adjustmentTotal`), Efectivo (`summary.totalsByMethod.cash`), Otros pagos (suma de
  `debit + credit + transfer + qr + account`).
- Tres pestañas, alternadas con `Tab` (capturado en el `onKeyDown` del input de filtro, sin sacarle
  el foco — mismo criterio que el resto de la barra de comandos intercepta teclas sin perder foco):
  - **Tickets**: ver mecánica de scroll más abajo.
  - **Productos**: tabla simple (Código, Producto, Cant., Subtotal), filas de altura pareja — reusa
    `useScrollSelectedIntoView` + `ScrollIndicatorBar` tal cual (mismo patrón que el resto de listas
    de la app). Orden por cantidad desc. sin filtro; con filtro, orden por score de FlexSearch.
    Cantidad formateada con `ui/format.ts::formatQuantity` (nuevo — redondeo a 3 decimales, sin
    ceros de más a la derecha: `5.950` → `"5.95"`, `5.9514999` → `"5.951"`).
  - **Medios de pago**: tabla de solo 6 filas (una por `PaymentMethod`, `PAYMENT_METHOD_LABELS` ya
    existente), sin filtro ni selección — no hace falta, son pocas filas siempre visibles enteras.

## Interacción de teclado, pestaña Tickets

Esta es la única pestaña con contenido de altura muy variable por fila (un ticket puede tener 1
línea o 12) y cabecera pegajosa (`position: sticky`) — necesita un mecanismo propio, ya validado en
vivo contra un prototipo con 18 tickets de alturas dispares, con pruebas de teclado reales
(incluyendo ráfagas simulando auto-repeat). Vive en un hook nuevo,
`ui/hooks/use-ticket-list-navigation.ts` — no reutiliza `useScrollSelectedIntoView` (pensado para
filas parejas, no aplica acá) y no se reutiliza en ningún otro lado todavía, así que no se
generaliza de más.

**Selección por ticket completo**: un índice (`selectedTicketIndexSignal`) resalta el ticket
entero (cabecera + cliente + líneas + pie, ver `Diseño visual` más abajo) con fondo teñido — sirve
de referencia visual de qué ticket "se está viendo", aunque no dispare ninguna acción al
confirmarlo.

**Instantáneo, no animado**: probado en vivo — `scrollTo`/`scrollBy` con `behavior: 'smooth'` se
pisa a sí mismo con teclas repetidas rápido (el auto-repeat real de mantener apretada una flecha):
cada llamada nueva parte de un `scrollTop` que todavía no reflejó la animación anterior, así que
varias teclas seguidas colapsan en un solo paso visual. Con salto instantáneo no hay animación en
vuelo con la que pelear, y con la frecuencia de las teclas se siente igual de fluido que el scroll
nativo del navegador sobre un contenedor con foco (que tampoco anima cada tick).

**`indexAtScrollPosition(pos)`, geométrico puro**: qué ticket corresponde a una posición de scroll
dada. Busca el último ticket cuyo `offsetTop <= pos`, con una corrección: la cabecera de ese ticket
no puede quedar pegada más allá del borde inferior de su propio contenedor (`position: sticky` no
sale del padding-box de su padre) — se empuja afuera una franja tan ancha como la propia cabecera,
*antes* de llegar al `offsetTop` del siguiente. Si `pos` ya cruzó ese punto
(`offsetTop + offsetHeight - headerHeight`), el elegido es el siguiente ticket. Sin esta corrección,
la selección queda visualmente atrasada (bug real encontrado probando: un ticket ya totalmente
scrolleado fuera de vista seguía "seleccionado").

**`stepScroll(direction)` (↑/↓)**: intenta un paso de `STEP_PX` (64px). Si ese paso saltearía la
ventana de selección de un ticket entero (ventana angosta — típico de un ticket corto, más angosta
que `STEP_PX`), se recorta para parar justo al principio del siguiente/anterior ticket en vez de
seguir de largo — sin este recorte, un ticket corto puede quedar sin seleccionarse nunca (bug real
encontrado probando). Un ticket alto sigue avanzando de a pasos normales dentro de su propia
ventana, sin este recorte (eso es lo que da el efecto de "leer" un ticket largo de a poco).

Si el paso propuesto no mueve el scroll (ya está en el tope o el fondo real), pero **todavía quedan
tickets** de ese lado — pasa cerca del final de la lista, donde el contenido que queda después de
un ticket es más corto que el propio viewport, así que ningún ticket ahí llega a pegar su cabecera
del todo arriba — la selección avanza directo, un ticket a la vez, sin acompañarse de ningún cambio
de scroll (no hay ninguno posible). Sin este camino, el cursor se queda trabado antes de llegar a
los últimos tickets (bug real encontrado probando con un viewport alto — un intento anterior forzaba
"si el scroll llegó al máximo, elegir el último ticket", que es **incorrecto** en general: llegar al
máximo no implica que el último esté arriba, puede faltar más de uno).

`curIdx` en `stepScroll` se lee de `selectedIndex` (el estado ya confirmado), nunca se recalcula
desde la posición de scroll — necesario para que, una vez "caminados" los últimos tickets sin
scroll de por medio, apretar la flecha contraria los retome uno por uno en vez de saltarlos.

**`PgDn`/`PgUp`**: saltan directo al ticket siguiente/anterior por índice (`selectIndex`, la misma
función que usa el camino de "no hay más scroll" de arriba) — alinean su `offsetTop` contra el
borde superior del contenedor cuando es alcanzable, o lo más cerca posible (limitado al scroll
máximo real) cuando no.

**Cabecera pegajosa incluye al cliente**: `Cliente: <nombre>` (cuando la venta tiene uno adjunto) es
parte del mismo bloque `position: sticky` que "Ticket #/fecha" — antes era un bloque aparte que se
scrolleaba por su cuenta, dejando el nombre del cliente afuera de la cabecera pegada.

## Diseño visual (pestaña Tickets)

- **Separador solo entre tickets**: una única línea sólida entre un ticket y el siguiente — nada de
  líneas internas (header/cliente/líneas/pie). La jerarquía interna se resuelve con tipografía y
  espaciado, no con reglas — reducir ruido visual era el pedido explícito tras ver el primer
  prototipo ("demasiadas líneas horizontales, no se sabe dónde empieza y dónde termina un ticket").
- **Resaltado de selección completo**: cabecera, cliente, líneas y pie (medio de pago + total) se
  tiñen juntos cuando el ticket está seleccionado — no solo la cabecera.
- Montos en `--font-mono` con `tabular-nums`, mismo criterio que el resto de la app.

## Testing

- `domain/cash-session.test.ts`: casos nuevos para `totalCollected`, `adjustmentTotal` y
  `calculateProductQuantities` (línea de producto vs. línea libre, venta anulada excluida).
- `storage/cash-summary-repository.test.ts` (nuevo, `fake-indexeddb/auto`): los 3 casos del gate
  (nada, turno abierto, turno cerrado más reciente sin uno abierto).
- `ui/hooks/use-ticket-list-navigation.test.ts` (nuevo, Testing Library): casos ya verificados a
  mano contra el prototipo — bajada/subida completa sin saltos ni bloqueos, ticket corto no
  salteado, tramo final sin scroll disponible camina el cursor igual, `PgDn`/`PgUp` saltan por
  índice.
- `e2e/keyboard-only.spec.ts`: sumar `/RESUMEN` a la auditoría de accesibilidad por teclado
  existente (foco recupera al volver con Esc).

## Fuera de alcance de esta spec

- Diseño visual final de las tarjetas del panel lateral y el layout exacto de pestañas (colores,
  tipografía, distribución) — se ajusta en la implementación siguiendo los tokens ya establecidos,
  no bloquea el plan.
- Una vista de "ticket individual" reutilizable desde otras pantallas (ej. una futura pantalla de
  Historial, issue #52) — `/RESUMEN` no generaliza ningún componente compartido para esto todavía.
- Cualquier cambio a `/CAJA` más allá de lo ya descripto (issue #57 sigue siendo, además, el pase a
  diálogo modal tradicional del epic #49 — eso no es parte de esta spec).
