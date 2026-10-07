# Plan: Google Sheets, la planilla lista en un paso (#219)

Spec: `docs/superpowers/specs/2026-10-07-sheets-planilla-lista-design.md`. Rama
`claude/vibrant-pasteur-000khw`, que ya tiene la vuelta con sucursal y caja y el #212. Se ejecuta
inline, tarea por tarea; cada tarea termina con `pnpm lint && pnpm typecheck && pnpm test` (y
`pnpm build` donde toca el sitio) y su commit. El prototipo de referencia (`pos-sheets.gs` y sus partes)
está en `docs/superpowers/prototipo-sheets/`; se porta, no se copia: con tests y con los nombres
privados. Esa carpeta se borra en el PR, como este plan.

## Tarea 1: la planilla falsa sabe lo que usa lo nuevo

`src/test/fake-spreadsheet.ts`: `getSheets`, `deleteSheet`, `rename` (con `getName`),
`setActiveSheet`/`moveActiveSheet` (que respeten el orden), `insertSheet(name, index)` en su
posición, `getSheetId`, `getName` de la hoja, `getRange('A1')`/`getRange('A1:C3')`, `setFormula`
(guarda la fórmula; `getFormula` para los tests), `getValue`, `clear`, `setFontSize`, `setFontColor`,
`setColumnWidth`, `newChart`/`insertChart` de mentira y `getRangeByName` no hace falta. Tests de la
planilla falsa donde haga falta para que no mienta (orden de pestañas, A1).

## Tarea 2: funciones privadas en el puente

`bridge.gs` y `columnas.gs`: todo lo que no es `doGet`/`doPost` pasa a terminar en `_` (funciones;
las `var` globales no se pueden llamar y quedan). Test en `bridge.test.ts`: la lista exacta de
funciones públicas del contexto después de cargar los archivos. Los tests que llaman funciones
internas por nombre se actualizan.

## Tarea 3: sin `SEED`

Sale `SEED` (las pestañas nacen vacías). Los tests que contaban con los productos de ejemplo cargan
su propio catálogo (`seedCatalog`). `CONFIG_STEPS` pasa a la tarea 7: describe la home, que todavía
no existe.

## Tarea 4: los datos de prueba

`datos-ferreteria.gs`, `datos-kiosco.gs`, `datos-almacen.gs` (los del prototipo, con la cabecera sin
referencias internas). Test: forma de cada uno (ids únicos, EAN-13 válidos y sin repetir, los por
peso sin código, uno bloqueado de cada cosa).

## Tarea 5: la inicialización

`inicio.gs`: `posInicializar`, `posReiniciar`, el generador de la historia y la escritura de
Configuración. Tests de la spec ("Inicialización"), incluida la anulación cuando el día cae cerrado
(fijando la fecha con `vi.setSystemTime` en el contexto `vm`).

## Tarea 6: el tablero

`tablero.gs`: `crearTablero_`, la prueba del separador y `posAgregarTablero` (solo si falta).
Tests de la spec ("Tablero").

## Tarea 7: la home

`home.gs`: `estadoDeLaHome_`, `doGet` y la página (sale el `doGet` de `bridge.gs`), y `CONFIG_STEPS`
con el flujo nuevo. Tests del estado
y de la página con jsdom: formulario, preparar, link al POS con la caja, reiniciar, agregar el
tablero. Lista de funciones públicas final (`doGet`, `doPost`, `posInicializar`, `posReiniciar`,
`posAgregarTablero`) sobre todos los archivos.

**Checkpoint**: armo `pos-sheets.gs` en local y el usuario lo prueba en Sheets real con los tres
rubros antes de seguir con la publicación.

## Tarea 8: publicación

`site/build-channel.ts`: `docs/google-sheets/pos-sheets.gs` armado en orden fijo, sin `bridge.gs` ni
`columnas.gs` sueltos; botón "Copiar el código" en `index.html` de la guía de Sheets
(`site/guide-page.ts`). `site/home-page.ts`: la sección "Con Google Sheets". Tests de
`build-channel`, `home-page` y `docs.test.ts` sobre todos los `.gs`.

## Tarea 9: la guía y las docs del repo

`docs/integradores/google-sheets.md` reescrita (incluida la corrección sobre las tablas), README del
conector, `src/connectors/AGENTS.md` y `AGENTS.md` (Connector API, estado del proyecto, versión).
`package.json` a `0.7.0`.

**Checkpoint final**: informe y prueba manual; después, revisión del usuario, PR (Closes #219,
Closes #212) y el tag con `pnpm release:tag` cuando el usuario lo decida. El plan y
`docs/superpowers/prototipo-sheets/` se borran en el PR.
