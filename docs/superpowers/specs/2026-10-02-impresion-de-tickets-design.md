# Impresión de tickets: `/IMPRESORA`, 58 mm, 80 mm y A6 con `window.print()`

Fecha: 2026-10-02
Estado: diseño aprobado en el brainstorming del 2026-10-02; plan en `docs/superpowers/plans/2026-10-02-impresion-de-tickets.md`.
Ajustada después de la prueba manual del 2026-10-02 (`/IMPRESORA` con `select`s y columnas fijas, el
papel a tamaño real en pantalla, la franja de `/RESUMEN` y los avisos después de cobrar y de
reimprimir): ver "Ajustes de la prueba manual" al final.
Issues: #174 (etapa P1 del epic #182, MVP de mini contax, antes del hito 1). Anotados en este
brainstorming: #188 (ESC/POS directo, afuera de esta etapa) y un comentario en #140 (Reimprimir como
primera acción de `/RESUMEN`). Spec del MVP: `docs/superpowers/specs/2026-10-01-mvp-mini-contax-design.md`
en rauldiazsolis/mini-erp, sección "POS (offline-pos)".

## Contexto

Hoy, al cerrar una venta o una cobranza, el POS muestra el comprobante (`ui/screens/receipt-screen.tsx`).
Enter llama a `window.print()` sobre la pantalla entera, y un `@media print` (`receipt-screen.css`)
esconde todo menos la tarjeta del comprobante. No hay formatos: el ancho del papel es el de la tarjeta,
que hereda la escala de texto de la app. El ticket no lleva nada que identifique al comercio, y una
venta ya cerrada no se puede volver a imprimir.

El MVP de mini contax pide imprimir en 58 mm, 80 mm y A6 (una láser, para probar y para quien tenga
una), o no imprimir. El issue deja abierto dónde se configura, con una condición: no en `/CONFIG`.

## Decisiones

Tomadas en el brainstorming del 2026-10-02:

- **Se configura con un comando propio, `/IMPRESORA`**: es config local de esta terminal, no de la
  conexión ni del backend. La impresora es un hecho del equipo físico.
- **Encabezado y pie libres**, cargados a mano en `/IMPRESORA`. Los datos del comercio desde el
  backend quedan para después (cambio de contrato).
- **"Al cobrar" con tres opciones**: Imprimir (registra, imprime y sigue con la próxima venta),
  Mostrar el comprobante (como hoy) y Nada (vuelve directo a la venta). "Nada" es para usar el POS
  solo para registrar, y se espera que sea común.
- **Reimprimir desde `/RESUMEN`**, con la marca "COPIA". Es la primera acción sobre un documento en
  `/RESUMEN`; qué pasa con `/ANULAR` se evalúa en #140.
- **ESC/POS directo queda afuera** (#188), porque no hay una impresora con la que probarlo. Con él se
  van el corte, el cajón y los transportes (Serial, USB y Bluetooth). Esta etapa deja el puerto
  listo para enchufarlo.
- **Enfoque**: un modelo del comprobante (`ReceiptDocument`) independiente de cómo se imprime, un
  solo componente que lo dibuja, y la impresión en un iframe aparte. Se descartaron extender el
  `@media print` actual (no imprime sin la pantalla del comprobante, arrastra los estilos de la app
  y obliga a rearmar el ticket para ESC/POS) y el texto de ancho fijo en `<pre>` (el A6 queda pobre
  y depende de la fuente del sistema).

## Config: `PrinterConfig`

`storage/printer-config.ts` (es el borde con `localStorage`, el único lugar con `try/catch`; guardar
devuelve `Result` con el código nuevo `printer/save-failed`), en `localStorage` con `storageKey('printer')` (prefijo por carpeta,
#148), validada con Zod al leerla:

```ts
type PrintFormat = 'none' | '58mm' | '80mm' | 'a6';
type PrinterConfig = {
  format: PrintFormat;
  onCheckout: 'print' | 'show' | 'skip'; // Imprimir · Mostrar el comprobante · Nada
  header: string; // multilínea, puede ir vacío
  footer: string; // multilínea, puede ir vacío
};
```

- **Sin config guardada, o con una que no valida**, rige el default `{ format: 'a6', onCheckout:
  'show', header: '', footer: '' }`: una terminal que actualiza se comporta como hoy (comprobante
  en pantalla y Enter imprime). Leer nunca falla: lo inválido cae al default.
- `format: 'none'` con `onCheckout: 'print'` se interpreta como `'show'`. El formulario no permite
  guardarlo, pero puede llegar a mano.
- **Cambiar la conexión no la toca**: "Borrar y cambiar" del wizard limpia solo IndexedDB.
  `pos.reset()` (`sync/terminal-data.ts::resetTerminal`) sí la borra, porque borra todo lo del
  prefijo, y `pos.export()` la incluye. No es parte de `SyncConfig` ni viaja en `#connect`.
- Un signal (`ui/state/printer.ts::printerConfigSignal`) la tiene en memoria; se carga al arrancar
  y se actualiza al guardar.

## `/IMPRESORA`

Un comando del núcleo (`CORE_COMMANDS`, "Configurar la impresión de tickets") y una pantalla nueva
(`ui/screens/printer-screen.tsx`, controller `ui/keyboard/printer-controller.ts`, modelo puro del
formulario `ui/keyboard/printer-form-model.ts`). Sigue los patrones de "Teclado y mouse":

1. **Formato**: un `select`, No imprimir · 58 mm · 80 mm · A6. Al abrir, el foco está en él; con
   el `select` cerrado, ↑/↓ cambian la opción.
2. **Al cobrar**: un `select`, Imprimir · Mostrar el comprobante · Nada. Con "No imprimir",
   "Imprimir" no aparece; si estaba elegido, pasa a "Mostrar el comprobante".
3. **Encabezado** y **Pie**: `textarea`s con placeholders "ej. …" en gris claro
   (`--color-placeholder`), sin valores por omisión.
4. **Vista previa**: un ticket de ejemplo dibujado con `ReceiptView` en el formato elegido, que se
   actualiza mientras se edita (con "No imprimir", se ve en A6).
5. Botones en dos líneas, para que nada se corra al cambiar el formato: arriba **Prueba de
   impresión (Alt+P)**, siempre visible y deshabilitada con "No imprimir"; abajo **Cancelar (Esc)** y
   **Guardar (Ctrl+Enter)**. Guardar es Ctrl+Enter y no Enter, porque en un `textarea` Enter hace
   salto de línea (como `/COBRAR`). La prueba imprime el ticket de ejemplo con lo que está en
   pantalla, sin guardar. Esc y Cancelar vuelven a la venta sin guardar.

Tab recorre los `select`s, los `textarea`s y los botones. **La pantalla no cambia de forma** al
cambiar el formato ni con una ventana más ancha: el formulario tiene un ancho máximo y la vista
previa va en una columna fija del ancho del papel más ancho (A6), con el ticket centrado.

## El modelo: `ReceiptDocument`

`ui/print/receipt-document.ts`, puro (sin DOM, sin signals, sin repositorios):

```ts
type ReceiptBlock =
  | { kind: 'row'; left: string; right: string; bold?: boolean }
  | { kind: 'text'; text: string; bold?: boolean }
  | { kind: 'divider' };

type ReceiptDocument = {
  header: string[]; // líneas del encabezado de /IMPRESORA (vacías al principio y al final, afuera)
  title: string; // "Comprobante" / "Recibo de cobranza", como hoy
  marks: string[]; // "COPIA" al reimprimir; P4 (#177) suma "ENTRENAMIENTO"
  meta: string[]; // "Ticket #12", la fecha (y el cliente, en una cobranza)
  blocks: ReceiptBlock[];
  footer: string[];
};
```

Dos constructores, uno por documento, que reciben todo ya resuelto: nombres de producto y de
cliente, y montos y fechas formateados (los formateadores de `ui/format.ts` se pasan como
parámetros, así se testean sin locale). El contenido es el del comprobante de hoy, sin cambios:

- **Venta** (`saleReceiptDocument`): título "Comprobante", meta `ticketLabel(sale)` y la fecha;
  filas `<qty> × <nombre>` con su total; recargo o descuento global si lo hay; Total en negrita; un
  renglón por pago. Un ticket negativo o de anulación sale igual, con su `ticketLabel`.
- **Cobranza** (`collectionReceiptDocument`): título "Recibo de cobranza", meta `receiptLabel`, la
  fecha y el cliente; un renglón por pago; Total en negrita; "Saldo anterior" y "Saldo nuevo" en
  negrita, **solo si se conocen** (al cerrar la cobranza sí; en una copia no, ver "Reimprimir").

Lo que se guarda al cerrar es el **origen** del comprobante (`ReceiptSource`: la venta, o la
cobranza con el nombre del cliente y los saldos de ese momento, y si es copia); el documento se arma
desde ahí cuando se muestra o se imprime (`ui/print/resolve-receipt.ts::receiptDocumentFor`). Así los
saldos de la cobranza viajan con ella, que es lo que no se puede recalcular después.

## Cómo se dibuja: `ReceiptView`

`ui/print/ReceiptView.tsx`: un componente Preact que dibuja un `ReceiptDocument` en un `PrintFormat`
(con `none`, como A6). Lo usan la pantalla del comprobante, la vista previa de `/IMPRESORA` y la
impresión, así la pantalla y el papel no difieren. Los estilos van en `ui/print/receipt.css` (por
clase de formato) y se cargan en los dos documentos: en la app, con el `import` del CSS; en el iframe,
inyectados como `<style>` (el texto del CSS se importa con `?inline` de Vite).

Medidas por formato (en el papel; en pantalla, la vista previa respeta el ancho en mm):

| Formato | `@page` | Área útil | Letra |
|---|---|---|---|
| 58 mm | `margin: 0` | ~48 mm (ancho 58 mm, padding 5 mm) | 9 pt |
| 80 mm | `margin: 0` | ~72 mm (ancho 80 mm, padding 4 mm) | 10 pt |
| A6 | `size: A6; margin: 8mm` | 89 mm | 10 pt |

**En pantalla, el papel a tamaño real**: el comprobante y la vista previa cancelan el zoom de la app
(`.receipt-paper`), así el texto del papel (9 pt en 58 mm) queda sobre el piso de 11 px de #111 a
600 px. Van en un marco de ancho fijo (el de A6 más un margen), con el papel blanco sobre un fondo
gris claro, así se ve el ancho de cada rollo y A6 no queda pegado al borde. Un formato más ancho que
A6, si llega a haber, se achica para entrar en el marco.

En las térmicas no se fija `size`: CSS no tiene "ancho fijo y largo libre" (`58mm auto` es inválido
y se ignora entero), así que el tamaño del papel lo da el driver del rollo y el ticket se dibuja en el
ancho exacto. Riesgo aceptado: cómo corta el largo depende del driver, y solo se confirma en la prueba
manual con una impresora real. Con "Guardar como PDF" se ven el ancho y el contenido.

## La impresión: el puerto `ReceiptPrinter`

`ui/print/receipt-printer.ts`:

```ts
interface ReceiptPrinter {
  print(document: ReceiptDocument, format: Exclude<PrintFormat, 'none'>): Promise<void>;
}
```

Primera implementación, `ui/print/browser-printer.ts`: crea un iframe oculto, escribe un documento
mínimo con la hoja de estilos del formato y su `@page`, monta `ReceiptView` con `render()` de
Preact, llama a `contentWindow.print()`, espera `afterprint` (con un tope de tiempo como red, por si
un navegador no lo dispara) y saca el iframe. Al ser otro documento, la impresión no hereda la escala
de texto, el tema oscuro ni ningún estilo de la app. `receipt-screen.css` y su `@media print` se van.

ESC/POS (#188) va a ser otra implementación del mismo puerto. El puerto vive en `ui/print/`, no en
`domain/`, porque el documento ya es presentación (textos formateados).

Para imprimir sin el diálogo del navegador, se documenta el flag de Chrome `--kiosk-printing` (va a
la impresora predeterminada).

## Al cobrar

`ui/print/after-close.ts::showOrPrintReceipt(source)` reemplaza lo que hoy hacen al final
`checkout-controller.ts::confirmCheckout` y `collection-controller.ts` (poner el comprobante e ir a
`'receipt'`). Primero se registra, como hoy (`closeSaleAndPersist`, `collectAndPersist`); después,
según `onCheckout`:

- **Imprimir**: vuelve a la venta, con la barra vacía y enfocada, y manda a imprimir. Mientras el
  diálogo del navegador está abierto, la app queda detrás; al cerrarlo (imprima o cancele), se sigue
  vendiendo. Un error del iframe no deshace nada: la venta ya está registrada.
- **Mostrar el comprobante**: va a `'receipt'` con el origen.
- **Nada**: vuelve directo a la venta.

En los dos casos que vuelven a la venta, el lugar de avisos de la barra (como `/CAJA` y `/ANULAR`)
dice qué pasó: "Ticket #4 registrado." con Nada, y "Ticket #4 registrado y enviado a imprimir." con
Imprimir ("enviado" y no "impreso": el POS no sabe si el diálogo se canceló). En una cobranza,
"Recibo #3 de Ana registrado…".

## La pantalla del comprobante

`ui/state/receipt.ts` pasa a tener un solo signal, `receiptSignal: { source: ReceiptSource;
returnTo: 'sale' | 'cash-summary' } | null`, en vez de `receiptSaleSignal` y `receiptCollectionSignal`.
La pantalla dibuja `ReceiptView` en el formato configurado. "Imprimir (Enter)" solo aparece si el
formato no es "No imprimir"; si es, Enter no hace nada. "Continuar (Esc)" vuelve a `returnTo`.

## Reimprimir desde `/RESUMEN`

En la pestaña Movimientos, con una fila de **venta** o **cobranza** seleccionada (incluidas las
anuladas y las anulaciones), aparece un botón con su atajo:

- Con impresora: **"Reimprimir (Enter)"** imprime la copia ahí mismo, sin salir de `/RESUMEN`.
- Con "No imprimir": **"Ver comprobante (Enter)"** abre la pantalla del comprobante con la copia
  (`returnTo: 'cash-summary'`), y Esc vuelve a `/RESUMEN` en el mismo día, pestaña y búsqueda (la
  selección vuelve a la primera fila: la navegación de Movimientos la reinicia al montarse).

Al reimprimir, un renglón de avisos de alto fijo debajo del buscador dice "Copia del Ticket #4
enviada a imprimir." y se borra con la próxima tecla.

El botón siempre ocupa su lugar (oculto si la fila no se reimprime), y si la franja no entra en un
renglón, las pestañas y el botón bajan juntos al segundo; el buscador queda en el primero.

Los movimientos de caja y los arqueos no tienen botón y Enter no hace nada. Enter está libre en
Movimientos (lo que se tipea va al buscador), como en `/ANULAR`; un botón enfocado con Tab se activa
de forma nativa, sin repetir el atajo.

La copia lleva la marca **"COPIA"**. En una cobranza reimpresa no van las líneas de saldo: el saldo
de ese momento no está guardado, y mostrar el de hoy confundiría. Van el cliente (por nombre, desde
el repositorio de clientes; si ya no está, su id), los pagos y el total.

## Pruebas

Unitarias (Vitest):

- `receipt-document.test.ts`: venta con línea libre, con recargo o descuento y con varios pagos;
  ticket negativo y anulación; cobranza con saldos; copia de una cobranza sin saldos; encabezado y
  pie vacíos y multilínea.
- `printer-config.test.ts`: sin config da el default; un JSON roto o desconocido cae al default;
  `none` + `print` se lee como `show`; guardar y leer.
- `ReceiptView.test.tsx`: la clase de cada formato, las marcas, filas en negrita.
- `browser-printer.test.ts`: crea el iframe, llama a `print`, lo saca con `afterprint` y con el
  tope de tiempo (con un `print` falso).
- Controllers: los tres caminos de "Al cobrar" en Cobro y en la cobranza; Reimprimir y "Ver
  comprobante" en `/RESUMEN`; el formulario de `/IMPRESORA` (Guardar, Cancelar, la prueba, "Imprimir"
  oculto con "No imprimir").

E2E (Playwright), `e2e/printing.spec.ts` (con un stub de `print` en el iframe vía `addInitScript`):
configura 58 mm + Imprimir, vende y comprueba que la venta quedó registrada, que se llamó a `print`
y que la barra quedó vacía y enfocada; con Nada, vuelve directo a la venta; Reimprimir desde
`/RESUMEN`. `keyboard-only.spec.ts` suma `/IMPRESORA`.

Prueba manual: "Guardar como PDF" en 58, 80 y A6 desde `/IMPRESORA` (prueba), al cobrar y al
reimprimir; con una impresora real si hay alguna.

## Documentación

- `AGENTS.md`: `/IMPRESORA` en la tabla de comandos y la impresión en el índice; la fila de estado
  al cerrar la etapa.
- `src/ui/AGENTS.md`: `/IMPRESORA`, `ui/print/`, el comprobante y Reimprimir en `/RESUMEN`.
- `docs/historia.md`, al cerrar.
- `docs/publicacion.md` (o una guía para el comercio): `--kiosk-printing` para imprimir sin diálogo.

## Afuera de esta etapa

- ESC/POS directo, corte, cajón y transportes (Serial, USB, Bluetooth): #188.
- Datos del comercio y logo en el ticket desde el backend.
- Unificar `/ANULAR` con `/RESUMEN`, o una pantalla de documentos con Reimprimir y Anular: #140.
- Comprobante de la anulación al confirmar en `/ANULAR`: #137 (puede reusar `showOrPrintReceipt`).

## Ajustes de la prueba manual (2026-10-02)

- Alt+P para la prueba de impresión (todo botón con su atajo).
- El papel a tamaño real en pantalla (sin esto, a 600 px el ticket se veía con letra de 7,8 px).
- `/IMPRESORA`: `select`s en vez de grupos tipo radio (la pantalla quedaba muy alta), columnas de
  ancho fijo, botones en dos líneas y la prueba siempre visible.
- `/RESUMEN`: la franja baja de renglón con las pestañas y Reimprimir juntos.
- Avisos después de cobrar sin comprobante y después de reimprimir.
- Enter para anular en `/RESUMEN` quedó anotado en #140 (hoy Enter reimprime).
