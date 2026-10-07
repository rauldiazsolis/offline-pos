# Google Sheets: la guía en dos páginas, al grano y con imágenes

Fecha: 2026-10-07
Estado: implementado (rama `claude/issue-221-dos-paginas-brppw2`).
Issue: #221. Antecedentes: #219 (la planilla lista en un paso, PR #220), etapa C del epic #180 (el
puente y su guía publicados en `/v4/docs/google-sheets/`).

## Contexto

Con #219 conectar una planilla es pegar un archivo, implementar y completar un formulario, pero la
guía publicada (`docs/integradores/google-sheets.md`) mezcla ese setup con todo lo demás: qué hace el
puente, permisos, el secreto compartido, la pestaña Configuración, el Tablero, cómo se edita la
planilla, qué guarda cada evento, el contrato del puente y las limitaciones. Pedido del usuario: ir
al grano con el setup; el resto, aparte.

## Decisiones (respuestas a las preguntas abiertas del issue)

- **Dos páginas**, no una con lo técnico plegado:
  - **Setup, para el comercio** (`docs/integradores/google-sheets.md`, publicada en
    `/v4/docs/google-sheets/`, la que abre "Con Google Sheets" desde la home del sitio): el botón
    "Copiar el código" arriba, un **índice** con un título por cada caso (instalar, preparar,
    conectar cada caja, actualizar, volver a empezar, el secreto opcional) y después, caso por caso,
    los **pasos detallados con imágenes**. Nada de explicaciones que no hagan falta para hacer el
    paso; al pie, el link a la referencia.
  - **Referencia, para integradores** (`docs/integradores/google-sheets-referencia.md`, publicada en
    `/v4/docs/google-sheets/referencia.html`): todo lo demás, sin cambios de fondo.
- **Imágenes, mixtas**:
  - Lo que es nuestro (la página de la planilla, el POS conectado) son **capturas reales** en PNG,
    sacadas con el Chromium de Playwright por `scripts/sheets-guide-images.ts`: corre los `.gs` con
    la planilla falsa de los tests (`src/test/apps-script.ts`), y para la del POS sirve el build y
    responde los pedidos al puente con el mismo `doPost`. Se corre a mano cuando cambian esas
    pantallas y los PNG se commitean (como los íconos de la PWA).
  - Las pantallas de Google (Apps Script, implementar, autorizar) son **ilustraciones SVG
    esquemáticas** hechas a mano: muestran dónde tocar y qué elegir, y no hay que rehacerlas cada vez
    que Google cambia un detalle visual. La guía lo dice: lo que importa son los nombres de los
    botones.
  - En el repo viven en `docs/integradores/img/google-sheets/`; publicadas, en
    `docs/google-sheets/img/`.
- **Anclas en las guías**: `site/guide-page.ts` les pone `id` a los `h2` y `h3` con el mismo slug que
  GitHub, así el índice anda igual en el repo y en el canal.
- **El encabezado de una guía** enlaza su propio Markdown (antes decía siempre `guia.md`).
- **Los demás textos, al grano**, con el link a la página de setup para el detalle: la cabecera de
  `pos-sheets.gs`, los pasos de la pestaña Configuración (`CONFIG_STEPS`) y el `setupHelp` de
  `/CONFIG`. La home de la aplicación web (`home.gs`) ya está al grano (un formulario y "Abrir el
  POS"): no cambia.

## Fuera de alcance

- Capturas reales de la interfaz de Google (necesitan una cuenta y se desactualizan con cada cambio
  de Google).
- Cambios en el puente, el contrato o el POS.
