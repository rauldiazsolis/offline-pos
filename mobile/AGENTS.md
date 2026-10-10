# mobile — la vista de celular, sin teclado del sistema

La vista de celular del POS: **nunca abre el teclado del sistema**. No es otra app: es la misma
terminal que la vista de escritorio, en el mismo build y la misma carpeta (ver "Dos vistas" en el
`AGENTS.md` de la raíz); `src/main.tsx` de la raíz la elige con `ui/state/ui-mode.ts`. Misma idea, mismo
Connector API y la misma lógica que el POS de escritorio (`src/`), que acá se **reusa sin copiar y sin
modificar**: dominio, storage, sync, conectores, el arranque (`ui/bootstrap.ts`), los signals de
`ui/state/` y los controllers de `ui/keyboard/` (que, pese al nombre, son la lógica de cada pantalla
sobre signals). Lo propio del mobile es solo la vista. Las reglas de la raíz (`../AGENTS.md`) valen
acá igual, empezando por "Cómo trabajamos".

Desarrollo en una rama larga que no se mergea hasta que el mobile esté prácticamente completo
(decisión del usuario, 2026-10-09). Fuera de `mobile/` se tocó lo mínimo: configuración (workspace,
el `exclude` de Vitest de la raíz, el CI), la página de alta del demo-backend (sin `autofocus`) y,
desde que las dos vistas son una sola app (2026-10-10), la elección de vista (`src/main.tsx`,
`ui/state/ui-mode.ts`, `/MOBILE`, la pantalla no compatible e `index.html`).

## Sin teclado del sistema (la regla central)

- Ningún elemento que pida el teclado del sistema: ni `input` de texto, ni `textarea`, ni `select`,
  ni `contenteditable`. Todo se ingresa con controles propios (`src/keyboards/`): el teclado
  numérico y el de letras (con una capa de números y símbolos que alcanza para URLs y claves),
  grillas, listas, chips y la cámara.
- `e2e/no-system-keyboard.spec.ts` lo vigila en cada pantalla.
- Una entrada se pide con `openNumberEntry` u `openTextEntry` (`keyboards/entry.ts`) y la muestra
  `EntryHost`, delante de todo; una a la vez. El texto de un número usa el separador decimal del
  locale y ningún separador de miles: el mismo formato que tipea un cajero en escritorio, así los
  controllers lo leen sin cambios. Las teclas físicas también andan (una compu, un teclado conectado).

## Dependencias

`mobile/package.json` **no declara dependencias**: todo sale del `node_modules` de la raíz. Así hay
una sola copia de Preact y de `@preact/signals` (dos copias rompen la reactividad sin avisar);
`resolve.dedupe` en `vite.config.ts` lo asegura igual. Una dependencia nueva del mobile va en el
`package.json` de la raíz.

## Cómo está armado

| Carpeta           | Qué hay                                                                                                                                                                                                                                                                |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/main.tsx`    | El mismo arranque que escritorio: una sola pestaña (#175), consola `pos.*`, service worker, `bootstrap()` y el render                                                                                                                                                  |
| `src/app.tsx`     | Qué se ve: "Abrir una demo", la conexión (modo requerido), entrenamiento, y si no, el shell con pestañas Vender, Resumen, Caja y Más. Cobro, cobranza y comprobante son hojas encima de la venta, según `activeScreenSignal`                                           |
| `src/keyboards/`  | Los teclados propios (modelos puros) y la API de entradas                                                                                                                                                                                                              |
| `src/screens/`    | Una vista por pantalla de escritorio, sobre su controller: `config-screen` (el wizard), `sale-screen`, `checkout-sheets` (cobro, cobranza, comprobante), `management` (resumen, caja, anular, diagnóstico, impresora, reiniciar la demo, entrenamiento), `more-screen` |
| `src/components/` | Hoja inferior, encabezado (comercio, caja, estado de sync, DEMO, portal), ticket y su barra, avisos flotantes                                                                                                                                                          |
| `src/state/`      | Lo único con estado propio del mobile: el catálogo navegable por categoría, las acciones de la venta, la navegación y el recuento de pendientes                                                                                                                        |
| `src/camera/`     | El lector de códigos (`BarcodeDetector`, Chrome para Android) y el QR de conexión                                                                                                                                                                                      |
| `src/preview/`    | La vista previa con datos de ejemplo (ver abajo)                                                                                                                                                                                                                       |

Decisiones:

- **Las acciones de la venta** (`state/sale-actions.ts`) repiten, sobre `domain/cart.ts`, lo que en
  escritorio hace la barra de comandos con funciones internas (agregar con advertencias, cantidad,
  línea libre, ajuste, cliente). Mismos signals: el carrito persiste igual y Cobro lo lee igual.
- **"Más" corre cada comando por el despachador de escritorio** (`/NOMBRE` + Enter en
  `command-bar-controller.ts`), así los del conector y el del portal del backend andan sin código
  propio. Las pestañas cubren COBRAR, CAJA y RESUMEN.
- **Los avisos** del slot de la barra de escritorio (`commandBar{Error,Warning,Notice}Signal`) se
  muestran como aviso flotante (`components/toast.tsx`), que los limpia a los 4 s.
- **La conexión nunca se tipea si se puede evitar**: un QR (`camera/scanned-link.ts` toma el
  `?demo=…` o el `#connect=…` de cualquier link al POS y lo aplica a la dirección del mobile) o el
  link abierto en el celular. El wizard a mano queda, con el teclado propio y su capa de símbolos.
- **Cantidad previa**: el chip "× 1" es el `<n>*` de escritorio (con signo, devuelve).
- **"Sin conexión (N)"** se recuenta al cambiar de pantalla (`state/pending-count.ts`): el motor
  solo cuenta en cada ciclo y sin red no corre ninguno. En escritorio pasa lo mismo.
- **Compartir el comprobante** (Web Share) como texto de 32 columnas (`receipt-text.ts`).
- **Estilos**: todo `styles.css` va bajo `html.pos-mobile`, y lo que coincidía con escritorio lleva
  `m-` (`m-btn`, `m-btn-primary`, `m-btn-danger`, `m-btn-block`, `m-paper`, `m-spinner` y las
  animaciones): las reglas de una vista nunca tocan a la otra. Una clase nueva se escribe igual.
- **PWA**: la de la raíz (el mismo service worker y manifest): una sola app instalable.

## Vista previa

`pnpm --filter pos-mobile build:preview` arma en `dist/preview/` la app (las dos vistas) con los
productos y clientes de ejemplo del demo-backend ya cargados y una conexión a un backend que no existe
(el estado dice "Vista previa"), sin service worker. Sirve para probar en el celular donde la app no
puede llamar a un backend (un Artifact de claude.ai). La app publicada no la incluye.

## Comandos

`pnpm --filter pos-mobile <dev|build|build:preview|preview|typecheck|test|test:e2e>`. El lint es el
de la raíz (`pnpm lint` cubre `mobile/`). Los tests unitarios de la raíz excluyen `mobile/**`. Los
e2e corren en un Pixel 7 (Chromium, `es-AR`) contra **el build de la raíz** (en 4180) y un
demo-backend en memoria propio (4010); en un contenedor con otro Chromium,
`PW_CHROMIUM_EXECUTABLE=<ruta>`.

## Pendiente

- Probar en un celular real: la cámara (`BarcodeDetector`), compartir e imprimir.
- Sin equivalente todavía: el descuento por línea (tampoco tiene comando en escritorio).
