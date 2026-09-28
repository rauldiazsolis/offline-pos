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
hacia abajo. La barra de estado (info pasiva) ocupa el extremo opuesto, arriba.

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

## Barra de estado

Barra de estado (extremo opuesto, `ui/components/StatusBar.tsx`) — hasta la Etapa 2 de #94 era a
propósito no interactiva; esa decisión se reabrió a propósito en la prueba manual de esa etapa: un
click abre `/DIAGNOSTICO` (lo mismo que el comando, patrón "Teclado y mouse"), sin entrar en el orden
de Tab ni sacarle el foco a la barra de comandos. Desde 4.0.0 (#99), dos estados del backend
(`backendStatusSignal`), detrás de "sin configurar" y de offline y delante del resto: "Backend
incompatible (contrato X, se necesita 4.2 o posterior)" con estilo de error, y "Backend en mantenimiento:
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
- **Comprobante**: la misma pantalla (`ReceiptFrame` compartido), "Recibo de cobranza", "Recibo #3",
  cliente, pagos por medio, total y "Saldo anterior / Saldo nuevo"; lo pone
  `receiptCollectionSignal` (junto a `receiptSaleSignal`, `ui/state/receipt.ts`). Al cerrarlo, el
  cliente queda desadjuntado, como después de cobrar una venta.
- **Saldo en la venta**: `customerBalancesSignal` (`ui/state/customer-balance.ts`) tiene la tabla
  entera en memoria, como el stock, y se recarga en los mismos puntos más después de una cobranza. La
  tarjeta de Cliente suma una quinta fila fija, "Saldo: Debe $X / A favor $X / Sin saldo"
  (`ui/format-balance.ts`; en blanco con "Consumidor Final"). En Cobro, con monto en Cuenta corriente,
  "Saldo del cliente: antes → después" (`checkout-controller.ts::accountBalancePreview`). La lista de
  `@` no muestra saldo, a propósito.
- **`/RESUMEN`**: las cobranzas no son ventas — no suman al total vendido ni a los tickets. Panel
  "Cobranzas $X (N recibos)" y la fila "Cobranzas" en el efectivo del día; en Movimientos, "Recibo #3 ·
  Ana" con los medios (el buscador encuentra "3", "#3" y el nombre); Medios de pago con columnas
  Ventas | Cobranzas | Total. Se agrupan por `receipt.date` si lo tienen.

## `/CONFIG` como wizard

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
conexión no cambió; Datos locales, si no cambió o si no hay **datos del usuario** (ventas, arqueos,
movimientos de caja, pendientes del outbox o venta en curso — `storage/local-data.ts::hasUserData`; catálogo/clientes solos
no cuentan). `ui/keyboard/config-controller.ts` solo orquesta lo async; `ui/state/sync-config.ts`
tiene el paso actual (`wizardStepSignal`), el estado async (`wizardAsyncSignal`: `idle`/`probing`/
`flushing`/`confirming-wipe`/`applying`) y `wizardModelSignal`. Navegación: Enter valida y avanza,
Alt+1…6 o click en la columna saltan a un paso alcanzable, Alt+← vuelve, Ctrl+Enter avanza hasta
donde haga falta el usuario, Esc según el estado (cancela la prueba, vuelve de la confirmación de
borrado, o sale si la terminal está `active`). Arranca en Revisar con la terminal `active`, en el
primer paso incompleto en modo requerido, y en Terminal tras perder la identidad.

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

## Teclado y mouse: dónde se aplica

Dónde se aplica: **venta** — click en una fila de un overlay (comandos, clientes incluidos "Consumidor
Final" y "+ Crear cliente", artículos incluidas las líneas libres) es lo mismo que Enter sobre ella
(`command-bar-controller.ts::activateCommandBarRow`, mismo camino que `submitCommandBar`); click fuera
del overlay lo cierra como Esc (#28), sin tocar lo tipeado (`sale-screen.tsx`); click en una fila del
carrito la selecciona, lo mismo que llegar con ↑/↓ (`selectCartLine`, #99). **Cobro** (#99): click
en un campo lo enfoca, "Cancelar (Esc)" y "Confirmar cobro (Ctrl+Enter)". **Cobranza** (#101): lo
mismo, con "Confirmar cobranza (Ctrl+Enter)". **`/CONFIG`** (pasos, opciones y botones), **`/ANULAR`** (filas clickeables =
seleccionar + Enter, `void-controller.ts::activateVoidRow`), **comprobante**, **`/DIAGNOSTICO`**,
**`/DEMO_RESET`**, **`/RESUMEN`** (también los botones de día), **`/CAJA`** (selector, campos,
sugerencias y botones, Etapa 5) y la **barra de estado** (click = `/DIAGNOSTICO`; el aviso de arqueo
abre `/CAJA`).

## Diseño visual

Reglas vigentes; cómo se llegó a cada una está en `docs/historia.md`.

- **Chrome oscuro arriba y abajo, contenido claro en el medio**: la barra de comandos (abajo) y la de
  estado (arriba) usan los tokens `--color-chrome-*` (`tokens.css`); el resto de la app, los claros.
  Es un contraste fijo, no un modo oscuro conmutable.
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
  `document.documentElement`, no el evento `resize`. Pendientes: #41 (resize en el modo Responsive de
  DevTools) y #111 (tipografía chica con zoom).
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
  pantalla. Un caso nuevo se suma ahí, no en un tracker paralelo.
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
- **Hooks de lista reusables**: `useScrollSelectedIntoView` y `useScrollIndicator` no saben nada de
  carrito ni de overlays; cada lista los llama con su signal y sus refs. jsdom no implementa
  `scrollIntoView` ni `ResizeObserver`: los stubs globales viven en `src/test/setup.ts`.
