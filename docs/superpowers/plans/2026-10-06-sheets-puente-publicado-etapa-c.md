# El puente de Sheets publicado en el canal (etapa C de #180) — plan

> **Para quien lo ejecute:** se ejecuta **inline** con `superpowers:executing-plans`, tarea por
> tarea con checkpoints (nunca un subagente por tarea, ver "Cómo trabajamos" en `AGENTS.md`). Los
> pasos usan checkboxes (`- [ ]`).

**Objetivo:** que un integrador encuentre el puente de Google Sheets y su guía en las docs del canal
(`/v4/docs/google-sheets/`), con `bridge.gs` y `columnas.gs` publicados tal cual y sin referencias
internas del repo.

**Arquitectura:** una guía pública nueva (`docs/integradores/google-sheets.md`) que `site/build-channel.ts`
publica en su propia carpeta junto a los dos `.gs`, con los links localizados por reemplazo literal de
prefijos (una función por destino). `renderGuidePage` gana un `docsRoot` para que el encabezado de la
página HTML apunte bien desde una subcarpeta. Los `.gs` pierden en sus comentarios las citas a issues
y archivos del repo; tests en `site/docs.test.ts` lo vigilan.

**Stack:** Node 24 (TypeScript sin compilar) + `marked` para el sitio; Vitest; Playwright contra el
sitio armado (`pnpm site:build`, `4174`).

**Spec:** `docs/superpowers/specs/2026-10-05-sheets-4-6-portal-onboarding-design.md`, sección
"Etapa C". No toca el contrato ni el código de la app.

## Restricciones globales

- Todo en español: textos, comentarios, commits.
- En los `.gs` solo cambian **comentarios**: nada de código (lo verifica `bridge.test.ts` sin cambios).
- La guía no cita issues, specs, `AGENTS.md` ni archivos del repo, salvo los links a los dos `.gs`
  (que se localizan al publicar). Sin anclas a secciones (`marked` no genera ids).
- Cada commit verificado con `pnpm lint && pnpm typecheck && pnpm test && pnpm build`; `pnpm test:e2e`
  en la tarea que toca e2e y al final, con `pnpm site:build` antes. Prettier solo sobre los
  `.ts`/`.md` tocados; los `.gs` no pasan por Prettier.
- Flakes conocidos (#142, #155, #169, #205, `terminal-identity.spec.ts`): volver a correr antes de
  investigar.

## Ajuste a la spec

La regex de la spec para issues en los `.gs`, `\(#\d|#\d{2,}|, #\d`, confunde un color CSS de la
página de `doGet` (`#2563eb` → `#2563`). Se usa `#\d{2,}\b` en vez de `#\d{2,}`: un color siempre
sigue con letras o dígitos hexa, un issue no (`#99)`, `#87,`, `#87 `). Sigue sin confundir
`'#,##0.00'`.

## Archivos

| Archivo | Qué cambia |
|---|---|
| `src/connectors/google-sheets/bridge.gs` | Comentarios sin issues, sin `demo-backend/src/lots.ts` ni `RNF-07` |
| `docs/integradores/google-sheets.md` (nuevo) | La guía pública del puente |
| `docs/integradores/guia.md`, `llms.txt` | Sección "Google Sheets: un backend sin servidor"; la guía y los `.gs` en `llms.txt` |
| `site/guide-page.ts`, `site/templates/guide.html` | `docsRoot` en el encabezado |
| `site/build-channel.ts` (+ test) | `DocsSources` con `sheetsGuide`, `sheetsBridge`, `sheetsColumns`; `docs/google-sheets/` con cuatro archivos; links localizados |
| `site/docs.test.ts` | `.gs` y guía sin referencias internas; misma versión; `guia.md` y `llms.txt` enlazan al puente |
| `e2e/published-site.spec.ts` | La guía del puente desde `/v4/docs/` |
| `src/connectors/google-sheets/README.md` | Lo que cubre la guía pasa a ser un link; queda lo de desarrollo |
| `AGENTS.md`, `src/connectors/AGENTS.md`, `e2e/AGENTS.md`, `docs/publicacion.md` | Dónde se publica el puente y su guía |

---

### Tarea 1: `bridge.gs` sin referencias internas

**Archivos:** modificar `src/connectors/google-sheets/bridge.gs` (solo comentarios); test en
`site/docs.test.ts`.

- [ ] **Paso 1: test que falla.** En `site/docs.test.ts`, un `describe('el puente de Google Sheets
  publicado')` con una constante compartida:

```ts
const INTERNAL = /\(#\d|#\d{2,}\b|, #\d|superpowers|AGENTS\.md|pos-web-diseno|historia\.md|demo-backend|RNF-\d/;

it.each(['bridge.gs', 'columnas.gs'])('%s no cita issues ni archivos internos', (file) => {
  expect(read(`../src/connectors/google-sheets/${file}`)).not.toMatch(INTERNAL);
});
```

- [ ] **Paso 2:** `pnpm test site/docs.test.ts` falla con `bridge.gs` (los ~18 comentarios).
- [ ] **Paso 3: los comentarios.** Criterio: se va el issue, queda la versión ("4.0.0 (#99): …" →
  "4.0.0: …", "Contrato v3 (#96): …" → "Contrato v3: …", "(antes por evento, #87)" → "(antes por
  evento)", "conector de Google Sheets, #67" → "conector de Google Sheets"); "mismo despacho que
  `demo-backend/src/lots.ts`" → "mismo despacho que un backend REST del contrato"; "no se borra,
  RNF-07" → "no se borra: un evento nunca se modifica". Revisar el diff: solo líneas de comentario.
- [ ] **Paso 4:** `pnpm test site/docs.test.ts src/connectors/google-sheets` pasa.
- [ ] **Paso 5: commit** `docs: los comentarios del puente de Sheets sin referencias internas (#180)`.

### Tarea 2: la guía pública del puente

**Archivos:** crear `docs/integradores/google-sheets.md`; modificar `guia.md` y `llms.txt`; test en
`site/docs.test.ts`.

- [ ] **Paso 1: tests que fallan** (mismo `describe`):
  - la guía empieza con `# Google Sheets: el puente de Apps Script`, enlaza
    `../../src/connectors/google-sheets/bridge.gs` y `columnas.gs`, y sin esos links no matchea
    `INTERNAL`;
  - dice el `CONTRACT_VERSION` de `bridge.gs` (leído con `/var CONTRACT_VERSION = '([\d.]+)'/`);
  - `guia.md` enlaza `google-sheets.md`; `llms.txt` enlaza `google-sheets.md` y los dos `.gs`.
- [ ] **Paso 2: la guía**, a partir del README del conector y de las etapas A y B (sin historia por
  versión: describe el puente de hoy). Secciones:
  1. Qué es: la planilla como backend sin servidor; contrato 4.6.0; capacidades
     (`customer-payment-void`, `portal` con `/PLANILLA` "Abrir planilla"; la planilla como empresa);
     qué no hace (stock, reserva de crédito síncrona, avisos).
  2. Instalar: desde un template (Hacer una copia) o desde una planilla vacía (Extensiones > Apps
     Script, los dos archivos, implementar como Web App "Cualquier persona"); permisos
     (`@OnlyCurrentDoc`, qué pide la autorización); el secreto compartido opcional.
  3. Conectar el POS: la página del Web App, el botón, el wizard precargado, sucursal y caja; la
     pestaña Configuración con la URL del POS.
  4. El portal: `/PLANILLA` abre la planilla de origen.
  5. Actualizar el puente: bajar los `.gs` del canal donde están las terminales, pegarlos y crear una
     versión nueva de la **misma** implementación (la URL no cambia).
  6. Cómo se ve y cómo se edita la planilla; qué guarda cada evento (ventas, anulaciones, caja,
     cobranzas y su anulación, cuenta corriente).
  7. El contrato del puente: transporte (`POST` `text/plain`, siempre 200, `{ ok, data | error }`) y
     acciones `info`, `pushBatch`, `pullBatch`, `portalLink`; cursor del pull.
  8. Limitaciones (cuotas de Apps Script, una implementación por planilla, lo que no hace).
- [ ] **Paso 3:** `guia.md` suma "## Google Sheets: un backend sin servidor" (antes de "Servir el POS
  desde tu propio servidor": dos párrafos y el link a `google-sheets.md`); `llms.txt` suma la guía y
  los dos `.gs` en "Docs".
- [ ] **Paso 4:** `pnpm test site/docs.test.ts` pasa; `pnpm exec prettier --write` de los tres.
- [ ] **Paso 5: commit** `docs: guía pública del puente de Google Sheets (#180)`.

### Tarea 3: `renderGuidePage` con `docsRoot`

**Archivos:** `site/guide-page.ts`, `site/templates/guide.html`; test en `site/build-channel.test.ts`
(`describe('renderGuidePage')`).

**Interfaces:**
```ts
export function renderGuidePage(markdown: string, version: string, docsRoot = ''): string;
```

- [ ] **Paso 1: test que falla:** con `docsRoot = '../'` el encabezado tiene
  `href="../connector-api.openapi.yaml"`, `href="../llms.txt"`, `href="../../../"` y sigue con
  `href="guia.md"`; sin él, como hoy.
- [ ] **Paso 2:** la plantilla usa `{{docsRoot}}` en OpenAPI, `llms.txt` y "Backends y canales"
  (`{{docsRoot}}../../`); `renderGuidePage` lo reemplaza.
- [ ] **Paso 3:** test pasa. **Commit** `feat(site): la página de una guía en una subcarpeta de docs (#180)`.

### Tarea 4: `docs/google-sheets/` en el canal

**Archivos:** `site/build-channel.ts` (+ test).

**Interfaces:**
```ts
export type DocsSources = {
  guide: string; llms: string; openapi: string;
  sheetsGuide: string; sheetsBridge: string; sheetsColumns: string;
};
```
Localización, una función por destino (reemplazo literal de prefijos):
- `localizeGuide` (`docs/guia.md`): `../connector-api.openapi.yaml` → `connector-api.openapi.yaml`;
  `](google-sheets.md)` → `](google-sheets/)`.
- `localizeLlms` (`docs/llms.txt`): lo del OpenAPI; `](google-sheets.md)` → `](google-sheets/guia.md)`;
  `../../src/connectors/google-sheets/` → `google-sheets/`.
- `localizeSheetsGuide` (`docs/google-sheets/guia.md`): `../../src/connectors/google-sheets/` → ``;
  `](guia.md)` → `](../guia.md)`. El OpenAPI (`../connector-api.openapi.yaml`) ya queda bien.

- [ ] **Paso 1: tests que fallan** en `build-channel.test.ts`: `docs/google-sheets/` con `guia.md`,
  `index.html`, `bridge.gs` y `columnas.gs`; los `.gs` idénticos a la fuente; la guía publicada sin
  `../../src/` y con `](bridge.gs)` y `](../guia.md)`; `index.html` con
  `<h1>Google Sheets: el puente de Apps Script</h1>` y `href="../connector-api.openapi.yaml"`;
  `docs/guia.md` con `](google-sheets/)`, `docs/llms.txt` con `google-sheets/guia.md` y sin `../`;
  ningún `.gs` suelto en `docs/`. El test existente del puente suelto se reemplaza.
- [ ] **Paso 2:** implementar; `DEFAULT_DOCS` con las tres rutas nuevas.
- [ ] **Paso 3:** `pnpm test site` pasa; `pnpm site:build` y mirar `dist-site/v4/docs/` (o la carpeta
  que use el script).
- [ ] **Paso 4: commit** `feat(site): el puente de Sheets y su guía en docs/google-sheets/ (#180)`.

### Tarea 5: e2e del sitio publicado

**Archivos:** `e2e/published-site.spec.ts`.

- [ ] **Paso 1:** el test de `/v4/docs/` deja de pedir los `.gs` sueltos; uno nuevo: desde
  `/v4/docs/` el link "Google Sheets…" de la guía abre la página con el `h1` del puente, y
  `bridge.gs`, `columnas.gs` y el OpenAPI del encabezado responden `ok`.
- [ ] **Paso 2:** `pnpm site:build && pnpm test:e2e e2e/published-site.spec.ts`, después
  `pnpm test:e2e` entero.
- [ ] **Paso 3: commit** `test(e2e): la guía del puente de Sheets en las docs del canal (#180)`.

### Tarea 6: README del conector y documentación del repo

- [ ] **README** (`src/connectors/google-sheets/README.md`): "Setup", "Cómo se ve y cómo se edita la
  planilla", "Qué hace cada operación", "Cursor de pull" y "Contrato del puente" pasan a un párrafo con
  el link a `docs/integradores/google-sheets.md`; las secciones de historia por versión ("Actualizar a
  la v3", "Contrato 4.0.0" … "4.6.0") se resumen en "Actualizar el puente" de la guía y se van; queda
  "Desarrollo" y su checklist.
- [ ] **`AGENTS.md`**: en "Connector API", "publicado en cada carpeta de versión" → "publicado en
  `/v4/docs/google-sheets/` con su guía"; en "Publicación", el bullet de docs suma la guía del puente.
- [ ] **`src/connectors/AGENTS.md`**: la guía pública, la regla de los comentarios sin referencias
  internas (la vigila `site/docs.test.ts`).
- [ ] **`e2e/AGENTS.md`** y **`docs/publicacion.md`**: la nueva carpeta y qué verificar.
- [ ] Verificación completa y **commit** `docs: el puente de Sheets publicado en el canal (#180)`.

### Cierre

- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm build`, `pnpm site:build`, `pnpm test:e2e`.
- [ ] Informe con la prueba manual: `pnpm site:build && pnpm site:preview`, abrir
  `http://localhost:4174/v4/docs/`, seguir el link a la guía del puente, bajar los `.gs`.
- [ ] Después de la revisión del usuario: borrar este plan, "Estado del proyecto" en `AGENTS.md`,
  PR con "Closes" y el ítem en #180.
