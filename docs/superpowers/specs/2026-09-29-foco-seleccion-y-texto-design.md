# Foco, selección y paso actual; texto legible con zoom

Fecha: 2026-09-29
Estado: diseño aprobado; plan en `docs/superpowers/plans/2026-09-29-foco-seleccion-y-texto.md`.
Issues: #112 (foco, selección y paso actual, prioritario) y #111 (tipografía con el zoom responsive).
Comparación con capturas (estado actual contra las alternativas A, B y C, y el piso de texto a
600 px): https://claude.ai/artifact/2RmD9ssHtPEGfscT8WabFw

## Contexto

#112 pide un lenguaje visual único para foco, selección y paso actual, válido para toda la app, después
de tres rondas de ajustes del wizard de `/CONFIG` que no convencieron. #111 pide que el texto no quede
ilegible cuando la app se achica con `zoom` por debajo de 1024 px.

Relevamiento del estado actual (capturas a 600, 1024 y 1440 px de venta, overlays, los pasos del
wizard, Cobro, comprobante, `/RESUMEN`, `/CAJA`, `/ANULAR` y `/DIAGNOSTICO`):

- **Seis formas de marcar "elegido"**: fondo gris sin marca (fila del carrito, sugerencias de
  `/CAJA`), gris con barra azul de 3 px (filas de `/RESUMEN` y `/ANULAR`, paso actual del wizard),
  azul sólido (overlays de la barra, selector de `/CAJA`, pestañas de `/RESUMEN`) y borde azul de 2 px
  con fondo gris (opciones del wizard).
- **El contorno azul significa dos cosas**: la opción elegida lleva borde azul, la enfocada un halo
  azul (`box-shadow` de 3 px) y el paso enfocado un anillo azul por dentro (`inset`). Foco y selección
  no se distinguen, y un paso enfocado se parece al paso actual.
- **La opción elegida cambia de grosor de borde** (1 → 2 px): el contenido se corre un píxel.
- **El hover de las opciones también es un borde azul**, y el de las filas de los overlays un filete
  azul: otra vez contorno azul con otro significado.
- **La columna de pasos recorta lo que se dibuja por fuera** (tiene scroll propio); por eso su foco se
  puso por dentro.
- **El resumen de cada paso ocupa siempre dos renglones**, aunque esté vacío o tenga uno.
- **Tipografía con zoom** (tamaño efectivo = CSS × zoom):

  | Texto | CSS | ≥ 1024 px | 800 px | 600 px |
  |---|---|---|---|---|
  | Botones de la barra de estado (`var(--font-size-xs, 12px)`: el token no existe) | 12 | 12 | 9,4 | 7,0 |
  | `--font-size-sm` (resúmenes, ayudas de atajos, labels) | 13 | 13 | 10,2 | 7,6 |
  | Selector de `/CAJA` (sin tamaño: el default del navegador) | 13,3 | 13,3 | 10,4 | 7,8 |
  | `--font-size-base` (cuerpo) | 16 | 16 | 12,5 | 9,4 |

Lo que #112 dice que quedó bien no se toca: botones `.btn-primary` / `.btn-danger`, placeholder "ej. …"
en gris claro, cursores, click en la barra de estado → `/DIAGNOSTICO`, alto fijo del diálogo.

## Decisiones

Tomadas con el usuario en el brainstorming del 2026-09-29, comparando capturas de la app real:

1. **Lenguaje A, "contorno = foco, relleno = selección"** (descartadas: B, foco en color tinta y
   selección en azul, porque el foco deja de ser azul como en la barra y `/RESUMEN`; C, selección en
   azul sólido con texto blanco en todos lados, porque pesa en el wizard y en el carrito).
2. **La primera flecha sin opción elegida elige la opción enfocada**, la que se ve.
3. **Piso de texto**: el texto deja de achicarse cuando el zoom baja de 0,85; el layout sigue
   escalando. Descartadas: subir el ancho mínimo a ~870 px (deja afuera tablets de 768 y 800 px) y un
   layout angosto con reflow (reabre la decisión del Ciclo 7 de un solo layout).
4. **El resumen de cada paso del wizard ocupa un renglón**, no dos.

## Diseño

### El lenguaje, en tres reglas

1. **Foco** (dónde van las teclas): **solo el foco dibuja un contorno azul**. Un anillo de
   `--focus-ring-width` (2 px) en `--color-focus-ring`, **por fuera** y con `--focus-ring-offset`
   (2 px) de aire, igual en botones, opciones, pasos, filas enfocables y campos de texto. Nunca un
   halo difuso, nunca un anillo por dentro, nunca otro color.
2. **Selección** (sobre qué actúa Enter, qué opción está elegida) y **paso actual** (dónde estoy):
   **relleno azul claro + una marca**, nunca un contorno azul. La marca es una barra de acento de 3 px
   a la izquierda en filas y pasos, y el círculo lleno en las opciones tipo radio. El borde de una
   tarjeta elegida queda neutro y del mismo grosor que el de una no elegida. El paso actual del wizard
   es la selección de la lista de pasos, con el título en negrita como hoy.
3. **Hover**: decorativo, nunca un contorno azul ni la marca de selección. En superficies claras,
   `--color-surface` (o un borde neutro más oscuro en las tarjetas); en el chrome oscuro,
   `--color-chrome-surface`.

Dos excepciones, que ya son así y siguen igual:

- **Chrome oscuro y controles compactos** (overlays de la barra de comandos, selector de `/CAJA`,
  pestañas de `/RESUMEN`): la selección es **relleno sólido** de acento con texto blanco. En un
  control compacto el tinte claro no se lee, y sobre el chrome oscuro tampoco.
- **La barra de comandos** marca su foco con el borde inferior azul: está siempre enfocada, es el
  "hogar" de la venta.

Foco y selección coinciden a menudo (una opción tipo radio enfocada y elegida, una fila seleccionada
con el foco en su lista): entonces se ven las dos cosas a la vez, el relleno con su marca y el anillo
por fuera. Como no comparten forma, nunca se confunden.

### Tokens y clases (`ui/tokens.css`)

- Tokens nuevos: `--color-selected-bg` (`#dbeafe`, filas y pasos), `--color-selected-bg-subtle`
  (`#eff6ff`, tarjetas de opción, que tienen más superficie), `--color-selected-text` (`#1e40af`,
  título de una opción elegida), `--focus-ring-offset` (2 px) y `--focus-room` (4 px = ancho + aire:
  el margen que necesita un contenedor con scroll para no recortar el anillo).
- La selección deja de ser estilo inline repetido en cada pantalla: una clase compartida para las
  filas seleccionables (relleno + barra) que usan el carrito, las filas de documentos
  (`document-rows.tsx`, `/RESUMEN` y `/ANULAR`), las filas de movimientos y arqueos de `/RESUMEN` y las
  sugerencias de concepto de `/CAJA`; el estado viaja en un atributo (`aria-selected` donde el rol lo
  admite, si no `data-selected`), no en el `style`. En la tabla del carrito la barra va en la primera
  celda (`box-shadow` en un `<tr>` no es confiable).
- Se eliminan el halo de `.wizard-option:focus-visible`, el anillo `inset` de
  `.wizard-step-button:focus-visible` y el `border-color` de acento de `.wizard-input:focus`: los
  cubre la regla general de foco. `.wizard-input` sigue usando `:focus` (no solo `:focus-visible`) por
  el motivo que ya documenta su comentario.
- `--font-size-xs` no existe y no se crea: esos usos pasan a `--font-size-sm`. Ningún texto de la app
  queda con el tamaño por defecto del navegador (el selector de `/CAJA` hoy sí).

### Wizard de `/CONFIG`

- **Opciones** (Tipo de conexión, Datos locales): borde neutro de 1 px siempre; elegida = relleno
  `--color-selected-bg-subtle` + círculo lleno + título en `--color-selected-text`; enfocada = anillo
  por fuera. Enfocada y no elegida (terminal nueva) = solo el anillo, con el círculo vacío.
- **Flechas sin opción elegida**: ↑ o ↓ eligen la opción enfocada (la primera) en vez de moverse a la
  vecina (`config-controller.ts::moveTypeChoice`). Con una opción elegida, ↑/↓ se mueven como hoy.
  Enter sin nada elegido sigue diciendo "Elegí un tipo de conexión.". Datos locales siempre tiene una
  elegida (Mantener por defecto), así que no cambia.
- **Columna de pasos**: paso actual = relleno `--color-selected-bg` + barra de 3 px + título en
  negrita (hoy es gris); paso enfocado con Tab = anillo por fuera. La columna (`nav`, que scrollea)
  tiene `--focus-room` de padding para que el anillo no se corte. El resumen de cada paso ocupa **un
  renglón** fijo, recortado con "…"; el texto completo sigue en el `title`.
- **Campos**: el anillo general por fuera; la sección con scroll ya reserva margen y pasa a usar
  `--focus-room`.

### Resto de la app

- **Carrito**: la línea seleccionada pasa de gris sin marca a relleno + barra, como `/RESUMEN`. Una
  línea de devolución seleccionada muestra la selección (el tinte rojo de devolución vuelve al
  deseleccionarla), igual que hoy.
- **`/RESUMEN` y `/ANULAR`**: las filas seleccionadas pasan de gris + barra a relleno azul claro +
  barra, incluido el encabezado `sticky` del ticket. Las filas atenuadas (anuladas) conservan su
  opacidad.
- **`/CAJA`**: las sugerencias de concepto usan la clase de fila seleccionable; el selector
  Arqueo/Ingreso/Egreso no cambia (control compacto) salvo el tamaño de letra.
- **Overlays de la barra**: la selección sigue sólida; el hover pasa del filete azul a
  `--color-chrome-surface`.
- Cualquier otro contenedor con scroll que tenga controles enfocables adentro reserva
  `--focus-room`; el plan los releva pantalla por pantalla con las capturas.

### Texto con zoom (#111)

- En `tokens.css`, un factor `--text-zoom-compensation: max(1, calc(0.85 / var(--app-zoom)))`
  multiplica los cuatro tamaños (`--font-size-sm/base/lg/xl`). Con `--app-zoom` ≥ 0,85 (ventana de
  870 px o más) vale 1 y nada cambia; por debajo, el texto conserva el 85 % de su tamaño mientras el
  layout sigue achicándose. A 600 px: `sm` 11,1 px efectivos (hoy 7,6), `base` 13,6 (hoy 9,4).
- `body` toma `--font-size-base`, y botones y campos heredan la tipografía (`font: inherit`) salvo
  los que ya fijan su tamaño; así ningún texto escapa del factor.
- **Densidad a 600 px**: con el texto hasta un 45 % más grande en píxeles lógicos, dos pantallas se
  aprietan en las capturas de prueba: la franja de `/RESUMEN` (los botones parten su etiqueta en dos
  renglones) y la columna de pasos del wizard (los títulos se parten). Se ajustan hasta cumplir los
  criterios de abajo; la forma exacta (anchos, `white-space: nowrap`, reparto de la franja) la
  resuelve el plan con capturas.
- `ui/state/viewport.ts` (piso de 600 px) y `--app-zoom` no cambian.

## Criterios de aceptación

1. En ninguna pantalla hay un contorno azul que no sea foco (hover y selección incluidos), ni un anillo
   de foco recortado por su contenedor, a 600, 1024 y 1440 px.
2. Toda selección sobre superficie clara es relleno `--color-selected-bg(-subtle)` + marca; sobre
   chrome oscuro o en controles compactos, relleno sólido. Elegir una opción no corre nada.
3. En Tipo de conexión sin nada elegido, la primera opción se ve enfocada y vacía, y el primer ↓ (o ↑)
   la elige.
4. Cada paso de la columna ocupa un renglón de resumen.
5. A 600 × 700, en venta (con overlays), los pasos de `/CONFIG`, Cobro, cobranza, comprobante,
   `/RESUMEN` (las tres pestañas), `/CAJA`, `/ANULAR` y `/DIAGNOSTICO`, ningún texto visible mide menos
   de 11 px efectivos; ningún botón parte su etiqueta y nada se sale de la pantalla. De 1024 px para
   arriba los tamaños son los de hoy (salvo lo que estaba por debajo de `--font-size-sm`).
6. Lo que #112 dice que quedó bien se ve igual.

## Pruebas

- **Unitarias**: `moveTypeChoice` sin opción elegida (↑ y ↓ eligen la primera) y con una elegida (se
  mueve como hoy). Los tests de componentes que miraban el estilo inline de la selección pasan a
  mirar el atributo.
- **e2e nuevo** (`e2e/text-size.spec.ts`): a 600 × 700 recorre las pantallas del criterio 5 y afirma
  que el texto visible más chico mide ≥ 11 px efectivos (el script de medición de #111). A 1440 × 900,
  que `--font-size-sm` sigue en 13 px.
- **Capturas** antes/después a 600, 1024 y 1440 px con el mismo script de Playwright del
  brainstorming, para el informe final y la prueba manual del usuario.
- Los chequeos de siempre: `pnpm lint && pnpm typecheck && pnpm test && pnpm build` y
  `pnpm test:e2e`.

## Documentación

- `src/ui/AGENTS.md`, "Diseño visual": las tres reglas del lenguaje con sus excepciones y el piso de
  texto (reemplaza el "Pendientes: … #111"). "Patrones de UI": la clase de fila seleccionable y el
  `--focus-room` en contenedores con scroll. `/CONFIG` como wizard: las flechas sin opción elegida y el
  resumen de un renglón.
- `AGENTS.md` de la raíz: "Estado del proyecto" e "Issues abiertas" al cerrar #112 y #111.
- `docs/historia.md`: cómo se llegó (las tres rondas de #97, el relevamiento y la elección de A).

## Fuera de alcance

- Modo oscuro conmutable, rediseño de los botones, nuevos colores de estado.
- #41 (resize en el modo Responsive de DevTools) y #57 (usabilidad del modal de `/CAJA`).
- Cambiar el piso de 600 px o el diseño de 1024 px lógicos.
