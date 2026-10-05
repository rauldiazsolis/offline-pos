# src/ui — pantallas, barra de comandos y diseño visual

Detalle de la UI. Los principios (un único input, prioridad de la barra, comandos, "el POS nunca se
autobloquea", patrón de teclado y mouse, traductor de errores) están en el
[`AGENTS.md` de la raíz](../../AGENTS.md). Otras reglas que rigen archivos de esta carpeta viven donde
está el grueso del tema:

- `ui/state/sync.ts` y los signals de sync: [`src/sync/AGENTS.md`](../sync/AGENTS.md).
- `ui/keyboard/checkout-controller.ts` y la reserva de crédito: [`src/sync/AGENTS.md`](../sync/AGENTS.md).
- `ui/keyboard/connector-actions.ts`: [`src/connectors/AGENTS.md`](../connectors/AGENTS.md).
- `ui/format-ticket.ts` (numeración): [`src/domain/AGENTS.md`](../domain/AGENTS.md).

## Barra de comandos

`Ctrl+Enter` = `/COBRAR` desde cualquier estado. **Enter con la barra vacía (#99)**: con líneas abre
Cobro igual que Ctrl+Enter (aunque haya una línea seleccionada), sin líneas y con cliente abre la
**cobranza sin venta** (#101, igual que `/COBRAR` y Ctrl+Enter en ese estado), sin nada no hace nada
(`command-bar-controller.ts::submitEmptyCommandBar`). Con la barra vacía, `↑/↓` navegan el carrito; con
texto, navegan resultados (producto, cliente o el menú de comandos filtrado). Errores de parseo van
en un slot de altura fija reservado (nunca corren el layout) y seleccionan todo el input (`.select()`)
para reemplazar sin retipear. El foco al montar y el `.select()` en error se resuelven con los hooks
compartidos de `ui/hooks/` (ver "Patrones de UI" más abajo) — nunca con el atributo HTML `autoFocus`,
que no dispara de forma confiable cuando Preact desmonta y vuelve a montar una pantalla (el caso
real: volver de un popup con Esc).

**Menú de "/"**: escribir después de `/` filtra `availableCommands()` por prefijo
(`commandResultsSignal`). La fila 0 se preselecciona, igual que en productos y clientes (#40): Enter
sin tocar flechas ejecuta el primer match. Los comandos con consecuencias tienen su propio resguardo
(`/DEMO_RESET` pide confirmación; `/DESCARTAR` descarta algo que no se había guardado).
`CommandInfo.availability` (opcional, derivada de signals) deshabilita un comando según el estado de
la venta — hoy solo `/COBRAR`, "sin artículos ni cliente": la fila se ve atenuada con su motivo, ↑/↓
la saltean, el click no hace nada y la preselección la ignora (`defaultCommandIndexSignal`;
`effectiveCommandIndexSignal` es la que ejecutaría Enter), así "/" con el carrito vacío no deja
`/COBRAR` a un Enter. Enter sobre el nombre exacto de un comando deshabilitado, o Ctrl+Enter con
`/COBRAR` deshabilitado (`triggerCheckout`), muestran el motivo en el slot de error.

**Overlays**: el menú de "/" y las listas de producto y cliente se abren **hacia arriba** desde el
input (`position: absolute`, `bottom: 100%`, `maxHeight` + `overflow-y: auto`) y solo se montan
cuando hay algo que mostrar: nunca empujan el carrito ni cambian el scroll de la página. Esc los
cierra sin tocar lo tipeado (#28): como el overlay se deriva del buffer parseado (`parsedSignal`),
`overlayDismissedSignal` (`ui/state/command-bar.ts`) guarda que se cerró a mano, y
`updateCommandBarBuffer` lo vuelve a `false` en cada tecla (seguir tipeando lo reabre). Con la barra
vacía, Esc no hace nada.

**Recargo/descuento global (`<signo><número>%`, RF-03)**: el signo es obligatorio (`+10%` recarga,
`-10%` descuenta) salvo `0%`, que quita el ajuste; un porcentaje sin signo distinto de cero no es un
comando. Vive en `Cart.globalAdjustmentPercentage` y se recalcula en cada `calculateTotals`: agregar
una línea después actualiza el monto, nunca queda congelado. El descuento por línea
(`domain/cart.ts::applyLineDiscount`) existe en el dominio pero no tiene comando.

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

**Clientes (`@`)**: `@` solo lista los clientes (`CustomerRepository.listRecent()`, que pese al
nombre ordena **alfabéticamente**) con "Consumidor Final" como primera fila
(`ui/state/command-bar.ts::CustomerOrClear`, `{ kind: 'clear' }`): es la forma de desadjuntar al
cliente. Con texto (`@algo`) esa fila no aparece, el orden es por relevancia del fuzzy match y, sin
match, se ofrece crear el cliente. Cada fila muestra documento/teléfono o, sin ninguno, "Alta:
<fecha>" (`ui/format.ts::formatDate`, con `timeZone: 'UTC'` para que el día no dependa de la zona de
la terminal), que desambigua homónimos. La lista no muestra saldo, a propósito.

**Formato de precio × cantidad en la fila de producto**: `<unitario>` resaltado (contraste
completo + negrita) con cantidad 1; `<unitario> x <cantidad> = <total>` con la parte
`x <cantidad> = <total>` resaltada (el precio unitario pasa a texto secundario) con cualquier otra
cantidad — el prefijo `<n>*` ya calcula esta cantidad, ver `parsedSignal`.

**Selección siempre visible**: `useScrollSelectedIntoView` (`ui/hooks/`) hace
`scrollIntoView({ block: 'nearest' })` cada vez que cambia el índice seleccionado del carrito o de un
overlay. Después de cada mutación del carrito, `command-bar-controller.ts::selectResultingLine(cart,
find)` selecciona la línea resultante por identidad (ninguna si la operación la borró); Supr
(`removeSelectedCartLine`) selecciona la que quedó en ese índice, o la anterior si se borró la última.
En cada tecla, `updateCommandBarBuffer` pone la selección del menú de comandos en `null` (vale la
preselección por defecto) y reindexa por identidad la de productos y clientes: si el ítem sigue en la
lista nueva se lo sigue apuntando, si no, `null`.

**Scroll**: el carrito y los overlays ocultan la scrollbar nativa y muestran `ScrollIndicatorBar`
(`ui/components/`, alimentado por `useScrollIndicator`): una barra puramente informativa
(`pointer-events: none`, nunca accionable), con "bigotes" fijos en los extremos del carril. La rueda
y el autoscroll con el botón del medio siguen andando.

La barra de comandos vive **abajo** de la pantalla de venta, no arriba — decisión tomada con el
usuario comparando ambos extremos: `addProductLine` siempre agrega la línea nueva al final del
carrito, así que con el input abajo la línea recién agregada aparece pegada a donde se está
tipeando, en vez del salto largo de atención que había con el input arriba y el carrito creciendo
hacia abajo. Desde #193 la barra de estado (info pasiva) va al pie, **debajo** de la barra de
comandos, y arriba queda el encabezado con el comercio y la caja (ver "Encabezado y barra de estado").
Antes la barra de estado ocupaba el extremo opuesto, arriba; se movió para que el título se lea solo,
sin competir con el estado de sync. Los overlays de la barra de comandos se siguen abriendo hacia
arriba, así que la barra de estado debajo no los toca.

## Cobro y advertencias (Etapa 4, #99)

- **Cobro**: Efectivo arranca con |total| precargado y seleccionado (`checkout-controller.ts::
  enterCheckout`, lo llama `triggerCheckout`); Enter y ↓ pasan al campo siguiente, ↑ al anterior, sin
  ciclar y salteando Cuenta corriente deshabilitada (`moveCheckoutField`); Ctrl+Enter confirma, Esc
  cancela. Cobrar limpia la línea seleccionada del carrito.
- **Advertencias en vez de bloqueos** (`domain/sale-warnings.ts`, `ui/format-warning.ts`, cierra #12):
  stock insuficiente (solo `tracksStock`, cantidad positiva) y productos/clientes bloqueados se
  muestran en ámbar (`--color-warning`/`--color-chrome-warning`), siempre con texto: en la búsqueda
  ("Bloqueado: …", "Stock: N"), en la lista de `@`, debajo de la línea del carrito ("⚠ Stock
  disponible: N"), en la tarjeta de Cliente, en un bloque "Advertencias" de Cobro y en el slot de la
  barra al agregar o ajustar (`commandBarWarningSignal`: no selecciona el texto, se borra con la
  próxima tecla; un error tiene precedencia). El stock sale de `ui/state/stock.ts::
  stockSnapshotSignal` (la tabla entera en memoria).

## Encabezado y barra de estado

**Encabezado (#193, `ui/components/TerminalHeader.tsx`)**: arriba de la venta, en qué comercio y en
qué caja está la terminal. La empresa (`backendCompanySignal`, de `GET /info` 4.5.0) es el título, en
`--font-size-lg`, y `<caja> - <sucursal>` va debajo, en chico; sin empresa, la caja es el título
(`ui/terminal-context.ts::terminalHeading`, con `terminalIdentitySignal`: la sucursal y la caja de la
config activa, que fijan `bootstrap`, `applyConnection` y `applyTerminalSettings`). Con la terminal en
demo, la marca **DEMO** (un recuadro ámbar al lado del título) y, a la derecha, el botón de la demo.
Si falta lugar se recortan el título y el subtítulo con "…", nunca el botón. Es información pasiva:
un click no hace nada salvo en el botón. Sin conexión activa ni demo, no se muestra. Se eligió entre
tres bocetos (título solo arriba y sync al pie; todo al pie en una línea; la empresa como título):
el usuario prefirió el último, por más atractivo. El **título de la pestaña** es `<caja> -
<sucursal>`, sin la empresa (`terminal-context.ts::startTerminalTitle`, que arranca
`main.tsx::startApp`): vale también para las pantallas sin encabezado (`/CAJA`, `/COBRAR`,
`/RESUMEN`…); sin conexión activa queda el de siempre y la segunda pestaña (#175) conserva el suyo.

Barra de estado (al pie, debajo de la barra de comandos desde #193, `ui/components/StatusBar.tsx`) — hasta la Etapa 2 de #94 era a
propósito no interactiva; esa decisión se reabrió a propósito en la prueba manual de esa etapa: un
click abre `/DIAGNOSTICO` (lo mismo que el comando, patrón "Teclado y mouse"), sin entrar en el orden
de Tab ni sacarle el foco a la barra de comandos. Desde 4.0.0 (#99), dos estados del backend
(`backendStatusSignal`), detrás de "sin configurar" y de offline y delante del resto: "Backend
incompatible (contrato X, se necesita 4.0 o posterior)" con estilo de error (el piso, 4.4.0), y "Backend en mantenimiento:
<mensaje>", informativo. 4 estados reales
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

**Desde 4.4.0 (#128)**, además del estado de sync:
- **Terminal en demo** (`demoSessionSignal`, lo pone `bootstrap` desde `SyncConfig.demo`): en el
  encabezado, la marca **DEMO** y un botón `<onboarding.label> (/ALTA)` (p. ej. "Crear mi comercio (/ALTA)")
  que llama a lo mismo que el comando (`ui/keyboard/onboarding-controller.ts::startOnboarding`: emite
  el `wipe_key` y navega al alta). No abre `/DIAGNOSTICO`. `/ALTA` solo aparece en el menú de "/" con
  la terminal en demo (`availableCommands`), igual que `/DEMO_NUEVA` (#176).
- **Demo revocada** (#176, `demoRevokedSignal`): el estado dice "La demo terminó" con el punto rojo
  (detrás de "Sin conexión" y "Sin configurar") y el botón del alta pasa a ser "Empezar una demo
  nueva (/DEMO_NUEVA)" (`onboarding-controller.ts::startNewDemo`, lo mismo que el comando: navega al
  link de demo armado con `demo.backend`, o la `baseUrl` en una demo anterior, y la plantilla).
  `/DIAGNOSTICO` muestra "Demo de <plantilla> · revocada desde <hora>" (`demoRevokedAt` de
  `collectDiagnostics`, así `pos.status()` dice lo mismo).
- **"Avisos (N)"** (`backendNoticesSignal`), a la derecha y antes de "Sin arqueo en 24 h": el color es
  el del aviso más grave (`critical` → error, `warning` → ámbar, `info` → neutro) y el click abre
  `/DIAGNOSTICO`, donde está el detalle. Sin avisos no se muestra. Nunca bloquea nada.

## Portal (#179)

Spec: `docs/superpowers/specs/2026-10-04-portal-en-el-pos-design.md`; lo de `sync/`, en "Contrato
4.6.0" de `src/sync/AGENTS.md`.

- **Qué se ofrece** (`ui/keyboard/commands.ts`): `currentPortalOffer()` = `portalOffer` con las
  capacidades, el portal guardado y `RESERVED_COMMAND_NAMES` (todos los nombres del POS, estén
  disponibles o no ahora: el núcleo, `ACTUALIZAR`, `ALTA`, `DEMO_NUEVA` y los de todos los
  conectores, así el nombre no cambia según el estado). Nada con la demo revocada (la key ya no
  sirve y el encabezado ofrece `/DEMO_NUEVA`); sí sin red, en mantenimiento o incompatible: al usarlo,
  el error dice por qué no abre. Lo usan `availableCommands` (el comando, con la etiqueta como
  descripción), `runCommand` (antes que los comandos del conector), el encabezado y `/DIAGNOSTICO`
  ("Portal: /PANEL (Panel del backend)" o "no ofrecido").
- **`openPortal(label)`** (`ui/keyboard/portal-controller.ts`, dependencias inyectadas), lo mismo
  para el comando y el botón: **pide el link primero** y recién con él abre la pestaña
  (`window.open(url, '_blank', 'noopener')`), mientras el gesto siga vigente
  (`navigator.userActivation.isActive`, unos 5 s en Chromium). Un error no abre nada: abrir la
  pestaña en blanco en el gesto y cerrarla al fallar hacía parpadear la pantalla (prueba manual).
  Si el backend tardó más que el gesto, no se intenta abrir (el bloqueador la frenaría sin avisar) y
  la barra dice "…: el backend tardó en contestar; probá de nuevo.". Los errores: "No se pudo abrir
  <label>: <motivo>." (`describeError`); con la terminal en demo, un 401/403 marca la demo revocada
  (como un ciclo de sync) y el motivo es "la demo terminó". Todo mensaje reabre el overlay de la
  barra (`overlayDismissedSignal`): el `mousedown` del botón lo cierra como un click afuera (#28), y
  si no, el error quedaba oculto (como `/CAJA` desde la barra de estado). Un pedido a la vez. El
  comando limpia la barra antes de llamarla.
- **El botón** (`TerminalHeader`): `.btn` con `<label> (/<command>)`, a la derecha, `tabIndex={-1}`
  y `keepFocusOnMouseDown`; con la demo activa va antes del de `/ALTA`, que sigue siendo el primario.
  Nunca parte su etiqueta.

## `/CAJA` y `/RESUMEN` (Etapa 5, #100 y #120)

- **`/CAJA` como modal** (`ui/screens/cash-screen.tsx`, `ui/keyboard/cash-controller.ts`, reglas en
  `ui/keyboard/cash-form-model.ts`, pura): selector Arqueo / Ingreso / Egreso con comportamiento de
  radio (Alt+1/2/3, click, ↑/↓ en el selector). El arqueo **no es ciego**: esperado, último arqueo
  ("hoy 09:12" / "ayer 18:40" / "23/09 18:40") y "Sobran/Faltan $X" en vivo. Ingreso/Egreso: Concepto
  (con sugerencias), Descripción opcional y Monto; Enter y ↓ avanzan, ↑ retrocede, Ctrl+Enter
  confirma, Esc cierra las sugerencias o cancela. Un egreso mayor que el saldo se advierte en ámbar,
  sin bloquear. Al confirmar vuelve a la venta con un aviso informativo en el slot de la barra
  (`commandBarNoticeSignal`: mismo ciclo de vida que la advertencia, sin su estilo; reabre el overlay
  aunque un click lo haya cerrado — bug real que encontró el e2e al arquear desde la barra de estado).
- **Aviso "Sin arqueo en 24 h"** en la barra de estado (`cashCountOverdueSignal`, con un reloj por
  minuto que arranca `bootstrap`): un botón ámbar, independiente del estado de sync, que abre `/CAJA`
  en Arqueo sin abrir `/DIAGNOSTICO` ni sacarle el foco a la barra de comandos.
- **`/RESUMEN` por fecha** (`storage/cash-summary-repository.ts::getDaySummary`,
  `domain/day-summary.ts`): arranca en hoy y navega de a un día con Alt+←/Alt+→ (o los botones),
  entre el día más viejo con datos locales y hoy, conservando pestaña y filtros. Pestaña
  **Movimientos** (ventas, anulaciones, ingresos, egresos y arqueos, lo más nuevo primero — #124 —
  como en `/ANULAR`, y la selección arranca en la más nueva; el buscador encuentra
  "12", "#12", conceptos y descripciones), Productos y Medios de pago. Panel lateral: total vendido,
  tickets con "(N anuladas)", desc/recargos, otros pagos, efectivo del día (cobros, ingresos, egresos,
  ajustes) y, solo hoy, el saldo actual. Las ventas se agrupan por `ticket.date` si lo tienen.
- **Reimprimir en Movimientos** (#174): con una venta o una cobranza elegida (también anuladas y
  anulaciones), Enter o el botón al lado de las pestañas reimprime una copia ahí mismo
  ("Reimprimir (Enter)"); con "No imprimir", abre la copia en el comprobante ("Ver comprobante
  (Enter)") y Esc vuelve a `/RESUMEN` en el mismo día, pestaña y búsqueda (la selección vuelve a la
  primera fila). Con un movimiento de caja o un arqueo, Enter no hace nada. Al imprimir, un renglón
  de alto fijo debajo de la franja (`cashSummaryNoticeSignal`, como el de `/ANULAR`) dice "Copia del
  Ticket #4 enviada a imprimir." y se borra con la próxima tecla, al cambiar de día o de pestaña y al
  salir. El botón siempre ocupa su lugar (oculto si la fila no se reimprime) y va en un grupo con las
  pestañas: si no entran al lado del buscador, bajan juntos al segundo renglón. Enter para anular acá
  quedó anotado en #140.

## Cobranza sin venta y saldo del cliente (Etapa 6, #101)

- **Cómo se entra**: con la barra vacía, **sin líneas y con cliente adjunto**, Enter, `/COBRAR` o
  Ctrl+Enter abren la cobranza (`triggerCheckout`); con líneas, Cobro como siempre.
- **Pantalla** (`ui/screens/collection-screen.tsx`, `ui/keyboard/collection-controller.ts`, estado en
  `ui/state/collection.ts`): el mismo diálogo que Cobro — los campos de medio de pago son un
  componente compartido (`ui/components/PaymentFields.tsx`) y los estilos del diálogo viven en
  `ui/screens/dialog-styles.ts` —, "Cobranza a <cliente>", **cinco medios sin Cuenta corriente**,
  todos vacíos, sin vuelto ni tope (pagar de más deja saldo a favor; la suma tiene que ser > 0,
  `domain/customer-payment.ts::resolveCollection`, si no "Ingresá al menos un monto."). Total y
  "Saldo actual → Después" en vivo; un cliente bloqueado se advierte en ámbar. Mismas teclas que
  Cobro; Esc vuelve a la venta con el cliente todavía adjunto.
- **Comprobante**: el mismo que el de una venta (ver "Impresión"), "Recibo de cobranza", "Recibo #3",
  cliente, pagos por medio, total y "Saldo anterior / Saldo nuevo" (los de ese momento viajan en el
  `ReceiptSource`, porque después no se pueden recalcular). Al registrarla, el cliente queda
  desadjuntado, como después de cobrar una venta.
- **Saldo en la venta**: `customerBalancesSignal` (`ui/state/customer-balance.ts`) tiene la tabla
  entera en memoria, como el stock, y se recarga en los mismos puntos más después de una cobranza. La
  tarjeta de Cliente suma una quinta fila fija, "Saldo: Debe $X / A favor $X / Sin saldo"
  (`ui/format-balance.ts`; en blanco con "Consumidor Final"). En Cobro, con monto en Cuenta corriente,
  "Saldo del cliente: antes → después" (`checkout-controller.ts::accountBalancePreview`). La lista de
  `@` no muestra saldo, a propósito.
- **`/RESUMEN`**: las cobranzas no son ventas — no suman al total vendido ni a los tickets. Panel
  "Cobranzas $X (N recibos)" y la fila "Cobranzas" en el efectivo del día; en Movimientos, "Recibo #3 ·
  Ana" con los medios (el buscador encuentra "3", "#3" y el nombre); Medios de pago con columnas
  Ventas | Cobranzas | Total. Se agrupan por `receipt.date` si lo tienen. Una cobranza anulada dice
  "· Anulada" y su anulación "· Anulación del #1" (#125), como los tickets; el panel, "(N recibos, M
  anulados)", donde N cuenta también las anulaciones.

## `/ANULAR` (#125, con #110 y #58)

- **Layout de Movimientos de `/RESUMEN`** (`ui/screens/void-screen.tsx`, `ui/keyboard/void-controller.ts`,
  estado en `ui/state/void.ts`): franja oscura con "Anular", el buscador y "Volver a la venta (Esc)", y
  la lista con las filas compartidas (`ui/components/document-rows.tsx`) y el buscador compartido
  (`ui/document-search.ts`). Ventas y cobranzas de las últimas 24 h, sin tope, lo más nuevo primero
  (`storage/void-repository.ts::listVoidCandidates`, unión `VoidCandidate` venta | cobranza). Nunca
  se muestra un ULID.
- **Filas sin acción**: la original anulada y la anulación se ven atenuadas con su marca, y se
  navegan como cualquier otra (decisión de la prueba manual de #125): ↑/↓, PageUp/PageDown y el click
  usan la mecánica de `/RESUMEN` (`useTicketListNavigation`). Enter o click sobre una de ellas no abre
  el modal: dice por qué en un slot de alto fijo debajo del buscador ("El Ticket #1 ya está anulado
  (con el Ticket #3)." / "El Ticket #3 es la anulación del Ticket #1: no se puede anular."), que se
  borra con la próxima tecla.
- **Buscador**: el único input, siempre enfocado. Tipear filtra y la selección vuelve a la primera
  fila del resultado (al abrir, la más nueva); Esc lo limpia si tiene texto y, si no, sale a la venta. Sin nada anulable,
  "No hay ventas ni cobranzas de las últimas 24 horas para anular." (arriba de las filas sin acción);
  con un filtro sin coincidencias, "Ningún documento coincide con la búsqueda.".
- **Cobranzas sin la capacidad `customer-payment-void`** (4.4.0, #128): la cobranza se sigue viendo y
  navegando, pero Enter o click no abren el modal y el slot dice "El backend no permite anular
  cobranzas." — o, si nunca se supo (terminal previa a 4.4.0 que arrancó sin red), "Todavía no se sabe
  si el backend permite anular cobranzas: probá /SINCRONIZAR." (`void-controller.ts::selectForVoid`).
  Las ventas se anulan igual.
- **Modal de confirmación** (solo sobre una fila anulable): tarjeta chica sobre la lista, con la pregunta ("¿Anular el Ticket #1?",
  "¿Anular el Recibo #1 de Ana?"; sin número, "el ticket de las 17:20"), el total y, en una cobranza
  con saldo conocido, "Saldo de Ana: A favor $500,00 → Sin saldo". "Volver (Esc)" y "Anular (Enter)";
  un error de negocio se muestra adentro. El foco se queda en el buscador y, con el modal abierto, el
  buscador no recibe texto (Enter anula, Esc vuelve con la misma selección y filtro, Tab llega a los
  botones).
- **Al anular**: vuelve a la venta con un aviso en el slot de la barra (`commandBarNoticeSignal`,
  como `/CAJA`): "Anulado el Recibo #1 con el Recibo #2". Recarga el stock y los saldos. El
  comprobante de la anulación queda en #137.

## Impresión (#174)

Spec: `docs/superpowers/specs/2026-10-02-impresion-de-tickets-design.md`.

- **`/IMPRESORA`** (`ui/screens/printer-screen.tsx`, `ui/keyboard/printer-controller.ts`, modelo puro
  en `ui/keyboard/printer-form-model.ts`, estado en `ui/state/printer.ts`): dos `select`s — en la
  prueba manual los grupos tipo radio dejaban la pantalla muy alta — **Formato** (No imprimir,
  58 mm, 80 mm, A6; tiene el foco al abrir y ↑/↓ lo cambian con el `select` cerrado) y **Al cobrar**
  (Imprimir, Mostrar el comprobante, Nada; sin papel no se ofrece Imprimir y, si estaba elegido,
  pasa a Mostrar) —, Encabezado y Pie (`textarea`s libres) y la vista previa de un ticket de ejemplo
  que se actualiza mientras se edita. Se edita una copia (`printerFormSignal`): Guardar (Ctrl+Enter,
  porque Enter en un `textarea` es salto de línea) la persiste y la pone en `printerConfigSignal`;
  Esc o Cancelar vuelven sin guardar; "Prueba de impresión (Alt+P, por la tecla física)" imprime el
  ejemplo con lo que está en pantalla, sin guardar. **Estable**: el formulario tiene un ancho máximo,
  la vista previa un marco de ancho fijo, y los botones van en dos líneas fijas (la prueba arriba,
  siempre visible y deshabilitada sin papel; Cancelar y Guardar abajo).
- **La config** (`storage/printer-config.ts`) es del equipo, no de la conexión: vive en
  `localStorage` (`storageKey('printer')`), validada con Zod; algo ausente o roto cae al default
  `{ format: 'a6', onCheckout: 'show' }` (como antes de #174). `/CONFIG` y "Borrar y cambiar" no la
  tocan; `pos.reset()` sí, como todo el prefijo.
- **`ui/print/`**: `receipt-document.ts` es el modelo puro del comprobante (`ReceiptDocument`:
  encabezado, título, marcas como "COPIA" o "PRUEBA", meta, filas y pie), con los nombres y los
  formateadores ya resueltos. `resolve-receipt.ts` lo arma desde un `ReceiptSource` (la venta, o la
  cobranza con el cliente y sus saldos, y si es copia; una copia nunca lleva saldos).
  `ReceiptView.tsx` lo dibuja en el ancho del formato, con `receipt.css` (papel blanco, sin variables
  de tema: el iframe no las tiene). `receipt-printer.ts` es el puerto `ReceiptPrinter`;
  `browser-printer.tsx`, la implementación con `window.print()` en un iframe oculto (CSS inyectado con
  `?inline` más el `@page` del formato; lo saca con `afterprint` o a los 60 s). ESC/POS (#188) va a
  ser otra implementación del puerto. En los tests, `setReceiptPrinter` pone una impresora falsa.
- **Al cobrar** (`ui/print/after-close.ts::showOrPrintReceipt`): Cobro y la cobranza registran primero
  y después, según la config: Imprimir vuelve a la venta (barra vacía y enfocada) y manda a imprimir
  sin esperar; Mostrar va al comprobante; Nada vuelve directo a la venta. Los dos que vuelven a la
  venta lo dicen en el slot de avisos de la barra (`commandBarNoticeSignal`, como `/CAJA`): "Ticket
  #4 registrado." o "… registrado y enviado a imprimir." ("enviado": el POS no sabe si el diálogo se
  canceló); en una cobranza, "Recibo #3 de Ana …" (`documentName`).
- **El comprobante** (`ui/screens/receipt-screen.tsx`, `receiptSignal = { source, returnTo }`): dibuja
  el papel (`ReceiptPreview`) en el formato configurado; "Imprimir (Enter)" solo con papel; "Continuar (Esc)"
  vuelve a `returnTo` (la venta o `/RESUMEN`).
- **El papel en pantalla** (`ui/print/ReceiptPreview.tsx`, en el comprobante y la vista previa): un
  marco de ancho fijo (el de A6 más un margen) con el papel blanco centrado sobre fondo gris, así se
  ve el ancho del rollo y nada cambia de forma con el formato. Cancela el zoom de la app
  (`.receipt-paper`, `tokens.css`): el papel va a tamaño real y su texto (9 pt en 58 mm) queda sobre
  el piso de 11 px de #111 a 600 px. Lo vigila `e2e/text-size.spec.ts`, que mide con el zoom
  acumulado de los ancestros. Un formato más ancho que A6, si llega, se achica para entrar al marco.

## Una sola pestaña (#175)

Spec: `docs/superpowers/specs/2026-10-02-una-sola-pestana-design.md`; el principio, en la raíz.

- **Coordinación** (`ui/tab-leadership.ts`, todo inyectado en `TabLeadershipDeps`, sin DOM):
  `claimTab(TAB_LOCK_NAME, deps)` pide el cerrojo con `ifAvailable` y, si lo recibe, lo retiene con
  una promesa que nunca se resuelve y escucha el canal; si no, devuelve `{ kind: 'secondary',
  takeOver }`. Puertos: `TabLocks` (lo que se usa de `navigator.locks`) y `TabChannel` (el canal,
  con mensajes validados por `parseTabMessage`: el único es `release-request`). Los fakes viven en
  `test/fake-tab-locks.ts`.
- **Traspaso**: `takeOver` pide el cerrojo en espera y manda `release-request`. La original atiende un
  solo pedido: `prepareRelease` (`ui/tab-release.ts::prepareTabRelease`: pausa el sync, toma el cerrojo
  de sync y se queda con él, espera las escrituras de IndexedDB, todo con `RELEASE_WAIT_MS` = 4 s de
  tope), marca la pestaña desplazada (`storage/tab-displaced.ts`) y se recarga. Si en
  `STEAL_AFTER_MS` (5 s) el cerrojo no llegó, la segunda aborta su pedido en espera y lo pide con
  `steal`; a una pestaña que le quitan el cerrojo se le rechaza su `request` y se recarga marcada. El
  pedido en espera se aborta solo si todavía no llegó (`isHeld`, leído sincrónicamente): nunca se le
  quita el cerrojo a sí misma.
- **Adaptadores** (`ui/tab-browser.ts::browserTabLeadershipDeps`): `navigator.locks` solo si existe
  (sin él, la pestaña manda siempre), `BroadcastChannel(TAB_LOCK_NAME)`, `location.reload`.
- **Arranque** (`main.tsx::start`): lee y borra la marca de desplazada (siempre, así una vieja no
  aparece después) y pide el cerrojo **antes de todo**: con él, `startApp` (consola `pos.*`,
  `bootstrap()` y render, como antes); sin él, `document.title` = "POS en otra pestaña" y
  `SecondaryTabScreen`, sin tocar la URL (un `?demo=…` o `#connect=…` se procesa al tomar el control).
  Al tomar el control vuelve el título y corre `startApp` sin recargar.
- **`SecondaryTabScreen`** (`ui/screens/secondary-tab-screen.tsx`): no depende de nada de la app
  (nada está inicializado). "El POS está abierto en otra pestaña", el texto que explica qué hacer y,
  si la desplazaron, "Se empezó a usar el POS en otra pestaña." arriba. El botón "Usar esta pestaña
  (Enter)" tiene el foco (Enter nativo = click) y pasa a "Tomando el control…", deshabilitado.
  `keepFocusOnMouseDown` en el contenedor. No hay link a la otra pestaña: Chromium no la deja traer al
  frente.

## Service worker y versión nueva (#54)

Spec: `docs/superpowers/specs/2026-10-03-service-worker-pwa-canal-design.md`; el canal y la
publicación, en "Publicación" de la raíz.

- **Registro** (`ui/service-worker.ts::startServiceWorker`, adaptador): lo llama `main.tsx::startApp`,
  o sea solo la pestaña que manda (#175), y solo en el build (`import.meta.env.PROD`). Registra
  `./sw.js` con el `scope` de su carpeta. Sin `navigator.serviceWorker` (contexto no seguro, como
  `http://` a una IP) no hace nada; un registro que falla no rompe el arranque.
- **Versiones nuevas**: busca al arrancar y cada hora (`UPDATE_CHECK_INTERVAL_MS`; el navegador solo
  busca al navegar, y una pestaña de POS queda abierta días). Una versión que queda esperando
  (`registration.waiting` al arrancar, o una instalación que termina con un controller activo) pasa
  `ui/state/app-update.ts::appUpdateSignal` a `available`. `serviceWorkerStateSignal`
  (`unsupported`, `installing`, `ready`) alimenta `/DIAGNOSTICO` y `pos.status()`
  (`sync/diagnostics.ts::describeOffline`: "sin conexión: lista", "preparando el modo sin conexión",
  "versión nueva descargada, falta aplicar" o "sin service worker").
- **El aviso**: "Versión nueva (/ACTUALIZAR)" en la barra de estado, primero a la derecha
  (`btn-primary`), y `/ACTUALIZAR` en el menú solo mientras `appUpdateSignal` no es `none` (como
  `/ALTA` en demo). No dice qué versión es.
- **`/ACTUALIZAR`** (`ui/keyboard/app-update-controller.ts::applyAppUpdate`, dependencias
  inyectadas): con una venta en curso (líneas, cliente o ajuste global: lo que vacía `/DESCARTAR`) no
  actualiza y avisa "Terminá o descartá la venta para actualizar." (como toda advertencia de la
  barra, se borra con la próxima tecla o al cerrar la venta: `submitCheckout`). Si no, pasa a `applying` (el
  botón dice "Actualizando…", deshabilitado), suelta como el traspaso de #175
  (`prepareTabRelease`, que devuelve con qué deshacer), le manda `skip-waiting` al service worker en
  espera y recarga con `controllerchange`. Si no llega en `APPLY_TIMEOUT_MS` (10 s): deshace la
  suelta (reanuda el sync), vuelve a `available` y avisa "No se pudo actualizar: cerrá y abrí el
  POS.". Al abrir el POS sin ninguna pestaña abierta, el navegador ya activa la versión en espera.
- **La regla de los `import()` dinámicos**: la app no tiene ninguno, un solo bundle. Por eso una
  segunda pestaña que sigue con el código viejo después de un `/ACTUALIZAR` en la original puede
  tomar el control y correr `startApp` sin que le falte nada aunque `assets/` ya no tenga los
  archivos viejos. **Si algún día se suma un `import()` dinámico, la segunda pestaña tiene que
  recargar al tomar el control en vez de correr `startApp`.**
- **El service worker** (`src/workers/sw.ts`, lógica pura en `sw-logic.ts`, sin nada de la app)
  guarda todo el build al instalarse (todo o nada), atiende las navegaciones con el `index.html` de
  la caché (la query, como `?demo=…`, la lee la app) y los archivos del build desde la caché; todo lo
  demás (el backend, `version.json`, las docs de `docs/`) va a la red: solo la carpeta (o su
  `index.html`) es el POS, la app no tiene rutas propias. Nunca hace `skipWaiting` solo. Lo compila
  `build/sw-plugin.ts` en un segundo build (`iife`, sin hash), con la lista de archivos y su hash
  inyectados (`build/precache.ts`).

## Modo entrenamiento (#177)

Spec: `docs/superpowers/specs/2026-10-04-modo-entrenamiento-design.md`; el principio, en la raíz; la
base y las claves, en `src/storage/AGENTS.md`; el sync, en `src/sync/AGENTS.md`.

- **`/ENTRENAMIENTO`** (`commands.ts::trainingCommand`, siempre en el menú; nombre reservado para el
  portal): apagado, "Practicar sin enviar nada al backend"; prendido, "Salir del entrenamiento". Lo
  mismo hace el botón de la franja (`ui/keyboard/training-controller.ts::toggleTraining`).
- **Entrar**: con una venta en curso (`ui/state/sale-in-progress.ts::saleInProgress`, la misma de
  `/ACTUALIZAR`) no entra y avisa "Terminá o descartá la venta para entrar al entrenamiento.". Si no,
  pausa el sync y abre la pantalla (`ui/screens/training-screen.tsx`, estado en
  `ui/state/training.ts`, patrón de "Abrir una demo"): qué es el modo y lo real sin enviar
  (`training-model.ts::describeTrainingPending`, "Sin enviar: 1 venta y 1 movimiento más…").
  Enter = "Entrar al entrenamiento" (`.btn-primary`): último envío de lo real (si falla, entra igual),
  copia, marca, `prepareTabRelease` y recarga. Esc = "Cancelar" (reanuda el sync).
- **Salir**: se puede con una venta de práctica a medias. La pantalla lista lo que se descarta
  (`describeTrainingDiscard`: ventas, cobranzas, movimientos de caja y arqueos, la venta en curso y
  los clientes creados, o "No hiciste nada en el entrenamiento.") y lo que vuelve. Enter = "Descartar
  y salir" (`.btn-danger`): borra las claves, deja la marca `training-exited` en `sessionStorage` y
  recarga; `bootstrap` la consume y la barra dice "Saliste del entrenamiento.". Esc = "Seguir
  entrenando".
- **La franja** (`ui/components/TrainingBanner.tsx`): arriba de todas las pantallas, dentro de
  `.app-zoom-wrapper`; con `.app-zoom-wrapper--training` (`tokens.css`) la pantalla activa toma
  `--app-height` menos `--training-banner-h`. Rayas ámbar y negro (`--color-training-*`), el texto en
  negrita que se recorta con "…" si falta lugar (nunca el botón) y la tipografía propia (vive afuera
  de las pantallas, que fijan la suya). El botón: `tabIndex={-1}` y `keepFocusOnMouseDown`.
- **El resto**: el título de la pestaña lleva "ENTRENAMIENTO · " (`terminal-context.ts::trainingTitle`);
  todo comprobante, la marca "ENTRENAMIENTO" (`print/resolve-receipt.ts`); el aviso "Sin arqueo en
  24 h" no se muestra (la caja de práctica arranca en 0); `/DIAGNOSTICO` y `pos.status()` dicen "Modo
  entrenamiento desde …"; `pos.export()` lleva `training`.
- **Cortado** (`commands.ts::TRAINING_BLOCKED_COMMANDS`): `/CONFIG`, `/ALTA`, `/DEMO_NUEVA` y
  `/DEMO_RESET` quedan deshabilitados con el motivo "en entrenamiento; salí con /ENTRENAMIENTO"; el
  botón del encabezado (alta o demo nueva) deja el mismo mensaje en la barra. Un link de demo o la
  vuelta del alta al arrancar no se procesan: se limpia la URL y la barra dice "Salí del entrenamiento
  y volvé a abrir el link." (`sync/demo-link.ts::hasOnboardingParams`). Sin id de dispositivo, primero
  se sale del entrenamiento y se recarga. `/ACTUALIZAR`, `/SINCRONIZAR` (solo el pull), el portal,
  `/RESUMEN` y `/ANULAR` andan igual, sobre la base de práctica.

## "Abrir una demo" (#176)

Spec: `docs/superpowers/specs/2026-10-02-link-de-demo-con-confirmacion-design.md`; el principio, en
"Onboarding de demo" de la raíz.

- **Cuándo**: `bootstrap` con un `confirm` de `runOnboardingFromUrl` (un link de demo con algo que
  perder) llama a `ui/keyboard/demo-confirm-controller.ts::openDemoConfirm`, que pausa el sync antes
  de su primer `await`. Sin conexión activa, el wizard requerido queda abierto debajo.
- **Estado** (`ui/state/demo-confirm.ts::demoConfirmSignal`): `checking` (último envío a la conexión
  actual con `flushPendingBeforeWipe`, con red y config legible, y los conteos), `confirming` y
  `starting`. `App` muestra la pantalla delante de todo, también sin conexión activa.
- **Qué se pierde** (`ui/keyboard/demo-confirm-model.ts::describeDemoLoss`, puro): lo sin enviar
  (destacado), la venta en curso, el historial de la terminal y la conexión actual (o la demo en
  curso); se conservan `/IMPRESORA` y el locale. El catálogo y los clientes no se listan.
- **Teclado y mouse** (`ui/screens/demo-confirm-screen.tsx`, como `/DEMO_RESET`): Enter = "Borrar y
  abrir la demo" (`.btn-danger`), Esc = "Cancelar"; mientras revisa o abre la demo, los botones están
  deshabilitados. Cancelar no toca nada y vuelve a la venta (reanuda el sync) o al wizard requerido.
  Confirmar corre `startDemo`: si sale bien, `ui/session-reset.ts::resetSessionAfterWipe` (también lo
  usa `bootstrap`) y vuelve a la venta con el aviso de plantilla; si falla, no se borró nada y el
  motivo va a la barra de comandos o al wizard.

## `/CONFIG` como wizard

**`/CONFIG` como wizard (Etapa 2 de #94)** — reemplaza para esta pantalla el criterio de #49 ("no un
wizard secuencial que oculta lo ya cargado"): lo cargado nunca se oculta, queda resumido en una
columna lateral con los 6 pasos (credenciales como `•••`; el resumen de cada paso ocupa un renglón,
recortado con "…" y completo en el `title`), y se vuelve a cualquier paso ya alcanzado.
1. **Terminal**: Sucursal y Punto de venta (obligatorios) y Locale (opcional); muestra el aviso de
   identidad perdida (`identityResetSignal`).
2. **Tipo de conexión**: las opciones de `CONNECTOR_TYPES` con su `description`; ↑/↓ + Enter o click.
   Sin nada elegido, la primera flecha elige la opción enfocada, la que se ve (#112).
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
conexión no cambió; Datos locales, si no cambió o si no hay **datos del usuario** (ventas, arqueos,
movimientos de caja, pendientes del outbox o venta en curso — `storage/local-data.ts::hasUserData`; catálogo/clientes solos
no cuentan). `ui/keyboard/config-controller.ts` solo orquesta lo async; `ui/state/sync-config.ts`
tiene el paso actual (`wizardStepSignal`), el estado async (`wizardAsyncSignal`: `idle`/`probing`/
`flushing`/`confirming-wipe`/`applying`) y `wizardModelSignal`. Navegación: Enter valida y avanza,
Alt+1…6 o click en la columna saltan a un paso alcanzable, Alt+← vuelve, Ctrl+Enter avanza hasta
donde haga falta el usuario, Esc según el estado (cancela la prueba, vuelve de la confirmación de
borrado, o sale si la terminal está `active`). Arranca en Revisar con la terminal `active`, en el
primer paso incompleto en modo requerido, y en Terminal tras perder la identidad.

**Onboarding de demo (#128)**: `configNoticeSignal` (`ui/state/sync-config.ts`) muestra arriba del
wizard por qué está abierto o qué pasó con un link ("No se pudo iniciar la demo: <motivo>."; un link
con algo que perder ya no se ignora: va a "Abrir una demo", #176). A la vuelta del alta sin `wipe_key` y con
datos del usuario, o si la prueba falla, `config-controller.ts::openWizardWithCandidate` precarga la
conexión que trajo (`rest`, URL, clave, sucursal y punto de venta) y arranca en Probar, sin borrar
nada: el operador elige Mantener o Borrar como en cualquier cambio de conexión. Con una terminal
`active`, un link fallido se avisa en el slot de la barra de comandos
(`commandBarWarningSignal`), y "La plantilla X no existe; se usó Y." como aviso informativo
(`commandBarNoticeSignal`).

## Utilidades de consola `pos.*` (Etapa 0 de #94, issue #95)

Objeto global `window.pos` para DevTools, instalado en `main.tsx` **antes** de `bootstrap()` (si el
arranque falla, `pos.export()`/`pos.reset()` siguen disponibles para recuperar la terminal), y solo
en la pestaña que manda (#175): una segunda pestaña no tiene nada inicializado que inspeccionar ni
borrar. Queda también en producción y nada pide confirmación: abrir DevTools y tipear ya es
deliberado.
`ui/console/pos-console.ts` es una capa fina con dependencias inyectadas, sin lógica propia:
`help()`, `sync()` (= `/SINCRONIZAR`, `syncNow`), `status()` (= `/DIAGNOSTICO`: pantalla y consola
leen la misma foto, `sync/diagnostics.ts::collectDiagnostics`), `outbox()`
(`storage/local-data.ts::listPendingOutbox`, el mismo que usa el motor para armar un lote),
`export()` y `reset()` (`sync/terminal-data.ts`). Las dos últimas trabajan sobre `db.tables` y
todas las claves `offline-pos:*` de `localStorage` (por prefijo, nunca una lista a mano).
`export()` descarga un JSON para soporte con las credenciales reemplazadas por `"***"` — cada
conector marca las suyas con `ConfigField.secret`. `reset()` borra **también la config de
`/CONFIG`** (a diferencia de `/DEMO_RESET`): equivale a perder el id de dispositivo, y sin él la
terminal arranca de cero. Toma el cerrojo de sync mientras borra, pausa el sync, da de baja el
service worker de esta carpeta y borra sus cachés (#54, `ui/service-worker.ts::removeOwnServiceWorker`,
nunca los de otro canal; si eso falla, igual recarga) y recarga.
`pos.deviceId()` (Etapa 1 de #94, #96) devuelve el id de dispositivo de la terminal
(`sync/terminal-identity.ts::peekDeviceId`), el mismo que muestra `/DIAGNOSTICO` y que viaja en cada
push/pull — `null` antes de que `bootstrap()` lo resuelva (la consola se instala antes del arranque).
Como vive bajo `offline-pos:*`, `reset()` también lo borra.

## Teclado y mouse: dónde se aplica

Dónde se aplica: **venta** — click en una fila de un overlay (comandos, clientes incluidos "Consumidor
Final" y "+ Crear cliente", artículos incluidas las líneas libres) es lo mismo que Enter sobre ella
(`command-bar-controller.ts::activateCommandBarRow`, mismo camino que `submitCommandBar`); click fuera
del overlay lo cierra como Esc (#28), sin tocar lo tipeado (`sale-screen.tsx`); click en una fila del
carrito la selecciona, lo mismo que llegar con ↑/↓ (`selectCartLine`, #99). **Cobro** (#99): click
en un campo lo enfoca, "Cancelar (Esc)" y "Confirmar cobro (Ctrl+Enter)". **Cobranza** (#101): lo
mismo, con "Confirmar cobranza (Ctrl+Enter)". **`/CONFIG`** (pasos, opciones y botones), **`/ANULAR`** (filas clickeables =
seleccionar + Enter, `void-controller.ts::activateVoidRow`; botones del modal), **comprobante**, **`/DIAGNOSTICO`**,
**`/DEMO_RESET`**, **`/RESUMEN`** (también los botones de día y Reimprimir), **`/IMPRESORA`**
(`select`s, campos y botones), **`/CAJA`** (selector, campos,
sugerencias y botones, Etapa 5), **"Abrir una demo"** (#176, botones), **la pantalla y la franja
de entrenamiento** (#177, botones) y la **barra de estado** (click =
`/DIAGNOSTICO`; el aviso de arqueo abre `/CAJA`; "Avisos (N)" abre `/DIAGNOSTICO`) y el
**encabezado** (el botón del alta hace `/ALTA`, #128, o `/DEMO_NUEVA` con la demo revocada, #176; el
del portal hace su comando, #179; el resto es pasivo, #193).

## Diseño visual

Reglas vigentes; cómo se llegó a cada una está en `docs/historia.md`.

- **Chrome oscuro arriba y abajo, contenido claro en el medio**: el encabezado (arriba), la barra de
  comandos y, debajo, la de estado (al pie, #193) usan los tokens `--color-chrome-*` (`tokens.css`);
  el resto de la app, los claros.
  Es un contraste fijo, no un modo oscuro conmutable.
- **Foco, selección y paso actual (#112)**: **solo el foco dibuja un contorno azul** — el anillo
  general de `tokens.css` (2 px por fuera, `--focus-ring-offset` de aire), igual en botones,
  opciones, pasos, filas y campos; nunca un halo, un anillo por dentro ni otro color. La **selección**
  (sobre qué actúa Enter, la opción elegida) y el **paso actual** son **relleno azul claro + una
  marca**: barra de 3 px en filas y pasos (`.selectable-row[data-selected]`,
  `.wizard-step-button[aria-current]`), círculo lleno en las opciones
  (`.wizard-option[aria-pressed]`); el borde de una tarjeta elegida queda neutro y del mismo grosor. El **hover** es decorativo: nunca contorno azul ni la marca.
  Excepciones: sobre el chrome oscuro y en controles compactos (overlays de la barra, selector de
  `/CAJA`, pestañas de `/RESUMEN`) la selección es relleno sólido; la barra de comandos marca su foco
  con el borde inferior. Se eligió comparando capturas de tres alternativas (spec
  `docs/superpowers/specs/2026-09-29-foco-seleccion-y-texto-design.md`).
- **Montos** en `--font-mono` con `font-variant-numeric: tabular-nums`, alineados a la derecha, en
  carrito, cobro y comprobante. Sin numeritos de atajo (`/1`, `/2`…) en el menú de comandos: el
  usuario los descartó.
- **Layout de venta único, en dos columnas**: grid `1fr clamp(320px, 33.333%, 420px)` — la columna de
  Cliente/Total es un tercio con techo de 420 px. No usar `minmax(320px, 420px)`: el grid agranda los
  tracks no flexibles hasta su máximo antes de repartir los `fr`. No hay versión angosta: por debajo
  de 1024 px se achica con zoom (ver abajo).
- **Solo la lista de artículos scrollea**: Cliente y Total son tarjetas fijas (`CustomerCard`,
  `CartTable` y `TotalsCard` en `CartView.tsx`), con el `<thead>` en `position: sticky`
  (`cart-view.css`). Total va pegado debajo de Cliente: el blanco sobrante queda al final.
- **Tarjetas que no cambian de tamaño**: Cliente siempre visible ("Consumidor Final", en cursiva, por
  defecto), con filas fijas (label, nombre, documento, teléfono y saldo) que quedan en blanco si no
  hay dato; Totales siempre visible, también con el carrito vacío, con Subtotal, Descuento (`$0,00` en
  gris sin ajuste) y un Total bastante más grande. Label chico en mayúsculas arriba de cada una
  ("CLIENTE", "RESUMEN DE VENTA", `sectionLabelStyle`). Tarjetas con `--radius-md` y `--shadow-card`.
- **El carrito es un `<table>` real**, para que las columnas de montos alineen entre filas, con aire
  (`padding-left`) entre Precio y Subtotal.
- **Altura acotada**: la raíz de cada pantalla usa `height: var(--app-height)` + `overflow`
  explícito — nunca `minHeight` solo (no pone techo) ni `100svh` directo (ver zoom).
- **`scroll-margin`** en filas e ítems (`--cart-table-head-h` en el carrito, `var(--space-2)` en los
  overlays): `scrollIntoView` no sabe que un `<thead>` sticky o un padding tapan parte del área.
  `--cart-table-head-h` se define en `.cart-view__scroll` (no en `.cart-view__scroll-inner`) para que
  lo vea `ScrollIndicatorBar`, que es hermano de la tabla; el carril del indicador arranca debajo del
  `<thead>`, y sus bigotes son más oscuros que el thumb.
- **Zoom por debajo de 1024 px, con piso de 600 px**: el layout de 1024 px se ve igual pero más
  chico, nunca reflowea. `.app-zoom-wrapper` (`tokens.css`, envuelve la pantalla activa en
  `ui/app.tsx`) mide `max(var(--app-design-width), 100%)` con `zoom: var(--app-zoom)`
  (`clamp(600px/1024px, 100vw/1024px, 1)`); `--app-height` divide `100svh` por el mismo zoom, porque
  dentro de un ancestro con `zoom` el `100svh` se achica dos veces. `zoom` no es estándar, pero
  Chromium lo soporta y evita compensar a mano un `transform: scale()`. `fatal-error.ts` queda fuera
  del wrapper a propósito (tiene que andar aunque falle el arranque). Por debajo de
  `MIN_SUPPORTED_WIDTH_PX` (600, `ui/state/viewport.ts`) se muestra `unsupported-screen.tsx`, sin
  zoom. `viewportWidthSignal` es el único lector del ancho del viewport y usa `ResizeObserver` sobre
  `document.documentElement`, no el evento `resize`. **Piso de texto (#111)**: el texto no baja del
  85 % de su tamaño — `--text-zoom-compensation` (`max(1, 0,85 / --app-zoom)`) multiplica los
  `--font-size-*`, así que a 600 px nada mide menos de 11 px efectivos; todo texto sale de un token
  (`body` toma `base`, los controles sin tamaño `sm`; no hay `--font-size-xs`). Los anchos fijos que
  envuelven texto (diálogos, la columna de pasos, campos) usan `ui/text-scale.ts::scaledPx`, y los
  botones de las franjas no parten su etiqueta (`white-space: nowrap`; si falta lugar, baja de renglón
  el grupo). Lo vigila `e2e/text-size.spec.ts` (≥ 11 px, botones enteros y sin desborde a 600 × 700;
  13 px a 1440). Pendiente: #41 (resize en el modo Responsive de DevTools).
- **Placeholder** de la barra de comandos: "Escribí para buscar · @ cliente · / comandos" (#24 sigue
  abierto para algo más completo).

## Patrones de UI

- **Un signal por responsabilidad, agrupados por concern en `ui/state/`**, cada módulo con sus signals
  y, si hace falta, su función de reset. `activeScreenSignal` (`ui/state/screen.ts`) es el switch de
  pantallas que usa `ui/app.tsx`: agregar una es sumar un valor a `ActiveScreen` y un `case`.
- **Foco imperativo solo con los hooks compartidos** (`ui/hooks/`: `useFocusOnMount`,
  `useSelectOnErrorSignal`), nunca con el atributo `autoFocus` (no dispara de forma confiable cuando
  Preact vuelve a montar una pantalla). Y con `useLayoutEffect`, nunca `useEffect` ni
  `useSignalEffect`: los dos corren diferidos y una tecla enviada justo después de montar o de un
  error se pierde o se agrega en vez de reemplazar (bugs reales, agarrados por el e2e).
- **Cargar al montar, reseteando antes del primer `await`**: cargar los datos de una pantalla es
  responsabilidad exclusiva del `useLayoutEffect` de esa pantalla (no también del controller que la
  abre), y cualquier reset de estado va síncrono, como primera línea: si va después de un `await`,
  pisa lo que el usuario ya empezó a tipear.
- **Operaciones async de la barra trackeadas contra la navegación**: `pendingBarOperation`
  (`command-bar-controller.ts`) guarda la promesa en curso de cualquier efecto async disparado desde
  la barra (hoy, crear un cliente con `@<nombre>`) y `triggerCheckout` la espera antes de cambiar de
  pantalla. Un Enter que llega con una operación en curso también la espera y decide con la barra como
  quedó (`submitCommandBar`, #146: el alta vacía la barra recién al terminar, y un segundo Enter rápido
  creaba el cliente dos veces en vez de abrir la cobranza). Un caso nuevo se suma ahí, no en un
  tracker paralelo. **Una operación async nunca pisa lo que el operador tipeó después** (#152): si
  al terminar tiene que vaciar la barra, lo hace solo si la barra todavía tiene lo que se envió
  (`createAndAttachCustomer` guarda el buffer antes del primer `await`). Si no, lo tipeado o escaneado
  mientras tanto se perdía y su Enter abría la cobranza (`e2e/customer-create.spec.ts` lo reproduce
  demorando el alta con una transacción de IndexedDB).
- **Preselección visual real**: cuando el render resalta la fila 0 por defecto sin que el signal de
  selección tenga valor todavía, el primer ↑/↓ parte de esa fila (`moveSelectionOver`,
  `assumeFirstSelected`); si no, el primer toque de flecha no se nota.
- **Una unión para "esto o la opción especial", no un caso aparte**: `CustomerOrClear` ("Consumidor
  Final" es una fila más) y `UnifiedSearchResult` (línea libre | producto). Un caso especial fuera de
  la lista deja de dispararse en silencio cuando cambia otra condición (pasó).
- **`applyCartResult` como type predicate** (`result is { ok: true; value: Cart }`), para usar
  `result.value` después del `if` sin repetir `result.ok`.
- **Persistir la venta en curso con `effect()` fuera de un componente** (`ui/state/persist-cart.ts`):
  guarda `cartSignal` en `draftCart` en cada cambio, sin debounce (cambia una vez por acción, no por
  tecla). `draftCart` no es el outbox: sobrevive a un refresh/crash de esta terminal y nunca viaja.
- **Filas de documentos compartidas** entre `/RESUMEN` y `/ANULAR` (`ui/components/document-rows.tsx`,
  con el buscador en `ui/document-search.ts`): una sola forma de dibujar un ticket o un recibo. Las
  filas reciben la selección, la marca, el ref y el click como props; `/RESUMEN` las envuelve en
  componentes propios para leer `nav.ticketRef(index)` en el nivel superior del render
  (`react-hooks/refs`).
- **Selección por atributo, no por estilo inline** (#112): una fila seleccionable lleva
  `class="selectable-row"` y `data-selected` (el estilo vive en `tokens.css`; en un `<tr>` la barra va
  en la primera celda), y un contenedor con scroll que tiene controles enfocables adentro reserva
  `--focus-room` de padding para no recortar el anillo de foco.
- **Hooks de lista reusables**: `useScrollSelectedIntoView` y `useScrollIndicator` no saben nada de
  carrito ni de overlays; cada lista los llama con su signal y sus refs. jsdom no implementa
  `scrollIntoView` ni `ResizeObserver`: los stubs globales viven en `src/test/setup.ts`.
