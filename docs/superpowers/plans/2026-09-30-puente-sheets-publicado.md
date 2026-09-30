# El puente de Google Sheets publicado por versión — plan de implementación

> **Para agentes:** se ejecuta inline con superpowers:executing-plans, tarea por tarea y con
> checkpoints (convención del repo: nunca un subagente por tarea). Los pasos usan checkboxes
> (`- [ ]`).

**Objetivo:** que cada carpeta `/<x.y.z>/` del deploy traiga `docs/google-sheets/` con la guía
pública del puente (Markdown y HTML), `bridge.gs` y `columnas.gs`, enlazada desde la guía para
integradores y desde `llms.txt`.

**Arquitectura:** una guía nueva en `docs/integradores/google-sheets.md`; `site/build-version.ts` la
copia con los dos `.gs` y reescribe sus links; `renderGuidePage` gana la ruta hasta `docs/` para
que el encabezado de la página funcione desde la subcarpeta. Los `.gs` se publican tal cual, así
que sus comentarios dejan de citar issues en el repo.

**Stack:** Node 24 (TypeScript sin compilar) en `site/`, `marked`, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-30-puente-sheets-publicado-design.md`

## Restricciones globales

- Todo en español: textos, comentarios, commits.
- Sin versión nueva: `package.json` queda en `0.1.0`.
- Lo publicado no cita issues (`#NN`), specs (`superpowers`), `AGENTS.md`, `pos-web-diseno`,
  `historia.md`, `demo-backend` ni requisitos del doc de diseño (`RNF-07`).
- Los `.gs` publicados son copia exacta de los del repo.
- Verificación por commit: `pnpm lint && pnpm typecheck && pnpm test && pnpm build` (desde
  PowerShell: en este Windows pnpm no anda desde Bash). Formatear con Prettier solo lo que se toca
  (`pnpm exec prettier --write <archivos>`; el repo no pasa `format:check`, #135).
- Commits con heredoc desde Bash (`git commit -F - <<'EOF'`), terminando con
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Flakes conocidos: #142 (`pnpm test`), #155 y #169 (e2e): volver a correr antes de investigar.

## Archivos

| Archivo | Qué cambia |
|---|---|
| `src/connectors/google-sheets/bridge.gs` | 18 comentarios sin issues ni archivos internos (solo comentarios) |
| `docs/integradores/google-sheets.md` | **Nuevo**: la guía pública del puente |
| `site/docs.test.ts` | Tests de lo publicado: `.gs` limpios, guía del puente limpia y con la versión, enlaces |
| `site/guide-page.ts`, `site/templates/guide.html` | Parámetro `docsRoot` para el encabezado |
| `site/build-version.ts`, `site/build-version.test.ts` | Publica `docs/google-sheets/` y reescribe links |
| `docs/integradores/guia.md`, `docs/integradores/llms.txt` | Enlaces a la guía del puente |
| `e2e/published-site.spec.ts` | La guía del puente en el sitio armado |
| `src/connectors/google-sheets/README.md` | Lo que cubre la guía pública pasa a ser un link |
| `AGENTS.md`, `docs/publicacion.md`, `src/connectors/AGENTS.md` | Documentación al día |

---

### Tarea 1: `bridge.gs` sin referencias internas

**Archivos:**
- Modificar: `src/connectors/google-sheets/bridge.gs` (líneas 12, 20, 47, 95, 97, 124, 139, 150,
  155, 164, 253, 261, 387, 657, 673, 709, 863, 1009)
- Test: `site/docs.test.ts`

**Interfaces:**
- Produce: las constantes `BRIDGE`, `COLUMNS` e `INTERNAL` en `site/docs.test.ts`, que usa la
  Tarea 2.

- [ ] **Paso 1: test que falla.** En `site/docs.test.ts`, después de la constante `read`, agregar:

```ts
const BRIDGE = '../src/connectors/google-sheets/bridge.gs';
const COLUMNS = '../src/connectors/google-sheets/columnas.gs';
/** Referencias que a un integrador no le dicen nada: specs, reglas del repo, requisitos del diseño. */
const INTERNAL = /superpowers|AGENTS\.md|pos-web-diseno|historia\.md|demo-backend|RNF-\d/;
```

y un `describe` nuevo al final del archivo:

```ts
describe('puente de Google Sheets publicado (#166)', () => {
  it('los .gs no citan issues ni archivos internos (se publican tal cual)', () => {
    for (const path of [BRIDGE, COLUMNS]) {
      const source = read(path);
      // No confunde los formatos de Sheets ('#,##0.00') con un issue.
      expect(source).not.toMatch(/\(#\d|#\d{2,}|, #\d/);
      expect(source).not.toMatch(INTERNAL);
    }
  });
});
```

- [ ] **Paso 2: correrlo y ver que falla.**
  Run (PowerShell): `pnpm exec vitest run site/docs.test.ts`
  Esperado: FAIL en "los .gs no citan issues" (`bridge.gs` tiene `(#101`).

- [ ] **Paso 3: limpiar los comentarios.** Desde Bash:

```bash
sed -i \
  -e 's/que habla este puente (4\.2\.0 desde #101; 4\.1\.0, #120; 4\.0\.0, #99)\. Un request/que habla este puente. Un request/' \
  -e 's/(conector de Google Sheets, #67)\./(conector de Google Sheets del POS)./' \
  -e 's/Contrato v3 (#96):/Contrato v3:/' \
  -e 's/(contrato v3, #96)/(contrato v3)/' \
  -e 's/4\.0\.0 (#99):/4.0.0:/' \
  -e 's/4\.1\.0 (#120):/4.1.0:/' \
  -e 's/4\.2\.0 (#101):/4.2.0:/' \
  -e 's/(4\.0\.0, #99)/(4.0.0)/' \
  -e 's/(4\.2\.0, #101)/(4.2.0)/' \
  -e 's/(antes por evento, #87)/(antes era por evento)/' \
  -e 's/trigger onEdit (#87) —/trigger onEdit —/' \
  -e 's/Contrato batch (#87):/Contrato batch:/' \
  -e 's/lotes de push (#87)/lotes de push/' \
  -e 's/— mismo despacho que `demo-backend\/src\/lots\.ts`\./— el mismo despacho que el backend de referencia del contrato./' \
  -e 's/(no se borra, RNF-07)/(no se borra: un evento nunca se modifica)/' \
  src/connectors/google-sheets/bridge.gs
grep -nE '\(#[0-9]|#[0-9]{2,}|, #[0-9]|demo-backend|RNF-' src/connectors/google-sheets/bridge.gs
```

  Esperado: el `grep` no imprime nada. Mirar `git diff`: solo cambian comentarios. Si la línea 12
  quedó muy corta, dejarla así (Prettier no toca `.gs`).

- [ ] **Paso 4: correr los tests.**
  Run (PowerShell): `pnpm exec vitest run site/docs.test.ts src/connectors/google-sheets`
  Esperado: PASS (incluido `bridge.test.ts`, sin tocarlo).

- [ ] **Paso 5: verificar y commitear.**
  Run (PowerShell): `pnpm lint; if ($?) { pnpm typecheck }; if ($?) { pnpm test }; if ($?) { pnpm build }`

```bash
git add src/connectors/google-sheets/bridge.gs site/docs.test.ts
git commit -F - <<'EOF'
chore: bridge.gs sin issues en sus comentarios, para publicarlo (#166)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Tarea 2: la guía pública del puente

**Archivos:**
- Crear: `docs/integradores/google-sheets.md`
- Test: `site/docs.test.ts`

**Interfaces:**
- Consume: `BRIDGE`, `INTERNAL` (Tarea 1).
- Produce: `docs/integradores/google-sheets.md`, cuyo primer renglón es
  `# Google Sheets: el puente de Apps Script`, con links a
  `../../src/connectors/google-sheets/bridge.gs`, `../../src/connectors/google-sheets/columnas.gs`,
  `guia.md` y `../connector-api.openapi.yaml` (la Tarea 3 los reescribe al publicar); la constante
  `SHEETS_GUIDE` en `site/docs.test.ts`.

- [ ] **Paso 1: tests que fallan.** En `site/docs.test.ts`, junto a las otras constantes:

```ts
const SHEETS_GUIDE = '../docs/integradores/google-sheets.md';
const SHEETS_SOURCE = '../../src/connectors/google-sheets/';
```

y dentro del `describe('puente de Google Sheets publicado (#166)')`:

```ts
  it('la guía del puente no manda a issues ni archivos internos, salvo los links a los .gs', () => {
    const guide = read(SHEETS_GUIDE);
    expect(guide.startsWith('# Google Sheets: el puente de Apps Script\n')).toBe(true);
    expect(guide).not.toMatch(/#\d+/);
    expect(guide).not.toMatch(INTERNAL);
    expect(guide).toContain(`](${SHEETS_SOURCE}bridge.gs)`);
    expect(guide).toContain(`](${SHEETS_SOURCE}columnas.gs)`);
    expect(guide.replaceAll(SHEETS_SOURCE, '')).not.toContain('src/');
  });

  it('la guía del puente dice la versión del contrato que habla bridge.gs', () => {
    const version = /var CONTRACT_VERSION = '([\d.]+)';/.exec(read(BRIDGE))?.[1];
    expect(version).toBeDefined();
    expect(read(SHEETS_GUIDE)).toContain(`contrato **${version}**`);
  });
```

- [ ] **Paso 2: correrlos y ver que fallan.**
  Run: `pnpm exec vitest run site/docs.test.ts`
  Esperado: FAIL con `ENOENT` (no existe `google-sheets.md`).

- [ ] **Paso 3: escribir la guía.** Crear `docs/integradores/google-sheets.md` con este contenido:

````markdown
# Google Sheets: el puente de Apps Script

Para un comercio sin ERP, el backend del POS puede ser una **planilla de Google Sheets**: el
catálogo y los clientes se cargan en la planilla, y las ventas, cobranzas y movimientos de caja
aparecen ahí como filas. No hace falta ningún servidor: un **puente** escrito en Apps Script
(`bridge.gs` y `columnas.gs`), desplegado como Web App de la propia planilla, recibe lo que manda
el POS y le devuelve el catálogo.

El puente de esta carpeta habla el contrato **4.2.0** del Connector API. Es compatible con
cualquier POS que hable un contrato 4.x (el piso es 4.0.0): ver
"Compatibilidad y capacidades" en la [guía para integradores](guia.md).
El POS lo usa con su propio tipo de conexión, **Google Sheets**, no con la conexión REST.

Lo que el puente no hace:

- No declara capacidades: desde el POS no se anulan cobranzas.
- No lleva stock: el POS nunca advierte faltantes con esta conexión.
- El fiado (cuenta corriente) se aprueba siempre, sin reserva de crédito.
- La planilla nunca se reinicia desde el POS.

Archivos: [`bridge.gs`](../../src/connectors/google-sheets/bridge.gs) (la lógica) y
[`columnas.gs`](../../src/connectors/google-sheets/columnas.gs) (los nombres visibles de pestañas,
columnas y valores).

## Instalarlo en una planilla

1. Creá una planilla nueva en Google Sheets (puede estar vacía).
2. **Extensiones > Apps Script**. En el proyecto que se abre, reemplazá el contenido de `Código.gs`
   por el de `bridge.gs`, y agregá un segundo archivo de secuencia de comandos (**+ > Secuencia de
   comandos**) llamado `columnas` con el contenido de `columnas.gs`. Los dos archivos van en el
   mismo proyecto: sin `columnas.gs` el puente responde `Falta el archivo columnas.gs…`. Guardá.
3. **Implementar > Nueva implementación**, tipo **Aplicación web**:
   - "Ejecutar como": **Yo**.
   - "Quién tiene acceso": **Cualquier persona**.
4. Autorizá el script (ver "Permisos" abajo) y copiá la **URL de la aplicación web**
   (`https://script.google.com/macros/s/…/exec`).
5. Opcional, recomendado: protegé el puente con un secreto compartido. En **Configuración del
   proyecto > Propiedades de la secuencia de comandos**, agregá `SHARED_SECRET` con el valor que
   quieras.
6. En el POS, `/CONFIG`: tipo de conexión **Google Sheets**, la URL del Web App y, si lo pusiste,
   el secreto compartido. El POS prueba la conexión antes de guardarla.

En el primer pedido el puente crea las pestañas que necesita, con productos y clientes de prueba
para empezar. Para probar el despliegue sin el POS, abrí la URL en el navegador: tiene que
responder `{"ok":true,"data":{"service":"pos-sheets-bridge"}}`.

"Cualquier persona" **no** significa que cualquiera pueda editar la planilla: el script corre con
los permisos de quien lo implementó y solo expone las acciones del puente. Es la única forma de
que el POS escriba sin que nadie tenga que iniciar sesión en Google. Con `SHARED_SECRET`, además,
hace falta conocer el secreto.

## Permisos

El puente pide acceso **solo a esta planilla** ("See, edit, create, and delete **this**
spreadsheet"): `bridge.gs` empieza con la anotación `@OnlyCurrentDoc` justamente para eso. Si la
pantalla de autorización pide acceso a **todas** tus planillas, cancelá, revisá que la anotación
esté al principio del archivo y volvé a autorizar. El aviso de "app no verificada" es normal en un
script propio.

## Actualizar el puente

Cada versión publicada del POS trae el puente que le corresponde, en esta misma carpeta.

1. Bajá `bridge.gs` y `columnas.gs` de la carpeta de la versión del POS que usan tus terminales.
2. En la planilla, **Extensiones > Apps Script**: reemplazá el contenido de los dos archivos y
   guardá.
3. **Implementar > Administrar implementaciones**, el lápiz sobre la implementación existente,
   **Versión: Nueva versión**, **Implementar**. La URL no cambia, así que no hay que tocar
   `/CONFIG`. No crees una implementación nueva: daría otra URL, y cambiar la URL en `/CONFIG`
   cuenta como otro backend.
4. En el POS, `/SINCRONIZAR`.

Las columnas nuevas que traiga una versión aparecen solas al final de cada pestaña, sin tocar los
datos. Si el POS y el puente no comparten la versión mayor del contrato, la terminal deja de
sincronizar y lo avisa en la barra de estado; se sigue vendiendo y nada se pierde: lo pendiente
viaja cuando se actualiza el puente.

## Cómo se ve y cómo se edita la planilla

Todo está en español: las pestañas (`Productos`, `Clientes`, `Ventas`, `Pagos`, `CuentaCorriente`,
`MovimientosCaja`, `Cobranzas`), los encabezados ("Precio unitario", "Medio de pago") y los valores
("Efectivo", "Cerrada", "Producto"). Los nombres visibles están en `columnas.gs`: es el único archivo
que hay que tocar para cambiarlos. Las pestañas `_PushLots` y `_Snapshot` son del puente: no las
edites.

El puente encuentra cada columna por su **encabezado**, no por su posición. Podés:

- reordenar columnas y agregar las tuyas ("Notas", cálculos): se ignoran;
- convertir un rango en tabla desde el menú (**Formato > Convertir en tabla**);
- borrar las columnas opcionales `Documento`, `Teléfono` y `Códigos de barras`;
- **bloquear** un producto o un cliente: "Sí" en `Bloqueado` y, si querés, el motivo en `Motivo del
  bloqueo`. Es informativo: el POS lo muestra pero nunca impide vender ni cobrar;
- dejar vacía la columna `Alta` de un producto o cliente: el puente la completa con la primera vez
  que lee la fila.

Las demás columnas no se pueden borrar ni renombrar: el puente responde con un error que dice cuál
falta (`Falta la columna 'Precio' en la pestaña Productos`) y el POS lo muestra en la barra de
estado. Reconocer un encabezado no distingue mayúsculas, acentos ni espacios.

Cada pestaña nueva nace con formato por columna: texto para ids y códigos (un código de barras no
pierde los ceros de la izquierda), importes con miles y decimales, IVA en porcentaje, fechas
(`dd/mm/aaaa hh:mm`), cantidades con hasta 3 decimales (se vende por peso) y listas desplegables en
las columnas de valores fijos. Las filas nuevas copian el formato de la fila 2.

## Qué guarda la planilla

Cuando el POS **envía** lo que vendió (un lote de eventos, de una sola vez):

| Evento | Filas |
| --- | --- |
| Venta | Una por línea en `Ventas` y una por pago en `Pagos`, con la fecha y el número del ticket. |
| Anulación | Es otra venta, con líneas y pagos en negativo y la columna `Anula a`; las filas de la venta original pasan a Estado = Anulada (no se borran). |
| Cliente nuevo | Una en `Clientes`. |
| Venta a cuenta corriente | Una en `CuentaCorriente` (el libro del cliente), con su signo. |
| Cobranza | Una por medio de pago en `Cobranzas`, con la fecha y el número del recibo, y el total en negativo en `CuentaCorriente`. |
| Ingreso, egreso o arqueo de caja | Una en `MovimientosCaja`. |

Cada fila lleva el dispositivo, la sucursal y el punto de venta que la originaron. Un evento que no
se puede aplicar queda informado en el lote, sin frenar el resto. Reenviar un lote no duplica
filas.

Cuando el POS **pide** el catálogo, recibe `Productos` y `Clientes`: completos o solo lo que cambió
desde la última vez, incluidas las ediciones a mano en la planilla. Cada cliente viaja con su
**saldo**, la suma de sus filas en `CuentaCorriente` (0 si no tiene movimientos).

## El contrato del puente

Apps Script no maneja preflight de CORS ni expone los headers del pedido, así que el puente no habla
el Connector API REST tal cual: el POS le manda un `POST` a la URL del Web App con
`Content-Type: text/plain;charset=utf-8` y un cuerpo JSON:

```json
{
  "action": "pushBatch",
  "payload": { "deviceId": "3f0c…", "events": [] },
  "idempotencyKey": "01J…",
  "sharedSecret": "…",
  "contractVersion": "4.2.0"
}
```

La respuesta es siempre HTTP 200, con el resultado en el cuerpo:

```json
{ "ok": true, "data": {} }
{ "ok": false, "error": "mensaje" }
{ "ok": false, "error": "mensaje", "code": "incompatible-contract", "contractVersion": "4.2.0" }
```

Acciones:

- `info`: sin `payload`. Devuelve la versión del contrato y el estado
  (`{ contractVersion, status: 'ok', backend: { name: 'pos-sheets-bridge', version } }`).
- `pushBatch`: `payload: { deviceId, events }`, con los mismos eventos que `POST /sync/push` del
  [OpenAPI](../connector-api.openapi.yaml). Es idempotente por `idempotencyKey`: el lote completo,
  no cada evento.
- `pullBatch`: `payload: { deviceId, cursors: { products?, customers? }, pendingLotIds }`. Devuelve
  `{ products: { items, nextCursor? }, customers: { items, nextCursor? }, lots }`, con el estado
  (`ok` o `issues`) de cada lote pedido.

Un pedido con otra versión mayor del contrato se responde `incompatible-contract` sin procesar
nada. `pushBatch` y `pullBatch` corren con el lock del script: dos terminales escribiendo a la vez
no mezclan filas.

## Limitaciones

- Una fila borrada de `Productos` o `Clientes` no se informa como baja en los cambios: llega recién
  con la próxima foto completa del catálogo, que el POS pide periódicamente.
- Anular una venta a cuenta corriente acredita con una fila negativa en `CuentaCorriente`; una venta
  con reserva de crédito confirmada no genera ese contra-asiento.
- La zona horaria del proyecto de Apps Script (**Configuración del proyecto**) tiene que coincidir
  con la de la planilla: si no, la hora de las ventas se ve corrida.
````

  Antes de guardar, comparar contra el puente real: la versión (`var CONTRACT_VERSION` en
  `bridge.gs`), los nombres de pestañas en `columnas.gs`, la respuesta de `doGet` y de
  `infoAction`, y el mensaje de columna faltante (`grep -n "Falta la columna" src/connectors/google-sheets/*.gs`).
  Si algo no coincide, corregir la guía, nunca el puente.

- [ ] **Paso 4: formatear y correr los tests.**
  Run: `pnpm exec prettier --write docs/integradores/google-sheets.md site/docs.test.ts`, después
  `pnpm exec vitest run site/docs.test.ts`
  Esperado: PASS. Si Prettier cambia el texto de la línea con `contrato **4.2.0**`, verificar que
  el test de versión siga pasando.

- [ ] **Paso 5: verificar y commitear.**
  Run: `pnpm lint; if ($?) { pnpm typecheck }; if ($?) { pnpm test }; if ($?) { pnpm build }`

```bash
git add docs/integradores/google-sheets.md site/docs.test.ts
git commit -F - <<'EOF'
docs: guía pública del puente de Google Sheets (#166)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Tarea 3: publicar `docs/google-sheets/` en cada carpeta de versión

**Archivos:**
- Modificar: `site/guide-page.ts`, `site/templates/guide.html:60-64`, `site/build-version.ts`
- Test: `site/build-version.test.ts`

**Interfaces:**
- Consume: `docs/integradores/google-sheets.md` (Tarea 2).
- Produce: `renderGuidePage(markdown: string, version: string, docsRoot?: string): string` (por
  omisión `''`); `DocsSources` con `sheetsGuide`, `sheetsBridge` y `sheetsColumns`; la constante
  `SHEETS_SOURCE = '../../src/connectors/google-sheets/'` en `build-version.ts`, que usa la Tarea 4.

- [ ] **Paso 1: tests que fallan.** En `site/build-version.test.ts`, dentro del
  `describe('buildVersionFolder (#148)')`, agregar:

```ts
  it('publica el puente de Sheets en docs/google-sheets/ con los links localizados (#166)', () => {
    const { distDir, siteDir } = fixture();
    const sheets = join(buildVersionFolder({ distDir, siteDir, info: INFO }), 'docs', 'google-sheets');

    for (const name of ['bridge.gs', 'columnas.gs']) {
      expect(readFileSync(join(sheets, name), 'utf8')).toBe(
        readFileSync(new URL(`../src/connectors/google-sheets/${name}`, import.meta.url), 'utf8'),
      );
    }
    const guide = readFileSync(join(sheets, 'guia.md'), 'utf8');
    expect(guide).toContain('](bridge.gs)');
    expect(guide).toContain('](columnas.gs)');
    expect(guide).toContain('](../guia.md)');
    expect(guide).toContain('](../connector-api.openapi.yaml)');
    expect(guide).not.toContain('src/');
    const html = readFileSync(join(sheets, 'index.html'), 'utf8');
    expect(html).toContain('<h1>Google Sheets: el puente de Apps Script</h1>');
    expect(html).toContain('href="../connector-api.openapi.yaml"');
    expect(html).toContain('href="guia.md"');
  });
```

  y en el `describe('renderGuidePage')`:

```ts
  it('con docsRoot, el encabezado apunta a las docs de la versión desde una subcarpeta', () => {
    const html = renderGuidePage('# Puente', '0.1.0', '../');
    expect(html).toContain('href="../connector-api.openapi.yaml"');
    expect(html).toContain('href="../llms.txt"');
    expect(html).toContain('href="../../../versions/"');
    expect(html).toContain('href="guia.md"');
  });
```

- [ ] **Paso 2: correrlos y ver que fallan.**
  Run: `pnpm exec vitest run site/build-version.test.ts`
  Esperado: FAIL (no existe `docs/google-sheets/`; el encabezado no tiene `../`).

- [ ] **Paso 3: `docsRoot` en la plantilla.** En `site/templates/guide.html`, el `<header>` queda:

```html
      <header>
        offline-pos {{version}} · <a href="guia.md">Markdown</a> ·
        <a href="{{docsRoot}}connector-api.openapi.yaml">OpenAPI</a> ·
        <a href="{{docsRoot}}llms.txt">llms.txt</a> ·
        <a href="{{docsRoot}}../../versions/">Todas las versiones</a>
      </header>
```

  y `site/guide-page.ts`:

```ts
/**
 * Una guía en HTML para leer en el navegador (#148). El título sale del primer `# `. `docsRoot` es
 * la ruta desde la página hasta `docs/` de la versión (`'../'` para `docs/google-sheets/`, #166);
 * el link "Markdown" es siempre el `guia.md` de al lado.
 */
export function renderGuidePage(markdown: string, version: string, docsRoot = ''): string {
  const title = /^# (.+)$/m.exec(markdown)?.[1] ?? 'Guía para integradores';
  const content = marked.parse(markdown, { async: false });
  return TEMPLATE.replaceAll('{{title}}', title)
    .replaceAll('{{version}}', version)
    .replaceAll('{{docsRoot}}', docsRoot)
    .replace('{{content}}', content);
}
```

- [ ] **Paso 4: publicar la subcarpeta.** En `site/build-version.ts`:

```ts
export type DocsSources = {
  guide: string;
  llms: string;
  openapi: string;
  /** La guía del puente de Google Sheets y sus dos archivos de Apps Script (#166). */
  sheetsGuide: string;
  sheetsBridge: string;
  sheetsColumns: string;
};

const DEFAULT_DOCS: DocsSources = {
  guide: repo('docs/integradores/guia.md'),
  llms: repo('docs/integradores/llms.txt'),
  openapi: repo('docs/connector-api.openapi.yaml'),
  sheetsGuide: repo('docs/integradores/google-sheets.md'),
  sheetsBridge: repo('src/connectors/google-sheets/bridge.gs'),
  sheetsColumns: repo('src/connectors/google-sheets/columnas.gs'),
};

/** Donde están los `.gs` vistos desde `docs/integradores/`. */
export const SHEETS_SOURCE = '../../src/connectors/google-sheets/';

/**
 * La guía del puente, publicada en `docs/google-sheets/` al lado de los `.gs`: la guía para
 * integradores queda un nivel arriba y el OpenAPI, igual que en el repo, en `../`.
 */
const localizeSheetsLinks = (text: string): string =>
  text.replaceAll(SHEETS_SOURCE, '').replaceAll('](guia.md)', '](../guia.md)');
```

  y al final de `buildVersionFolder`, antes del `return folder;`:

```ts
  const sheetsDir = join(docsDir, 'google-sheets');
  mkdirSync(sheetsDir);
  const sheetsGuide = localizeSheetsLinks(readFileSync(docs.sheetsGuide, 'utf8'));
  writeFileSync(join(sheetsDir, 'guia.md'), sheetsGuide);
  cpSync(docs.sheetsBridge, join(sheetsDir, 'bridge.gs'));
  cpSync(docs.sheetsColumns, join(sheetsDir, 'columnas.gs'));
  writeFileSync(join(sheetsDir, 'index.html'), renderGuidePage(sheetsGuide, info.version, '../'));
```

  Actualizar el JSDoc de `buildVersionFolder`: "…`version.json` (hechos del POS) y `docs/`, con el
  puente de Google Sheets en `docs/google-sheets/` (#166)."

- [ ] **Paso 5: formatear y correr los tests.**
  Run: `pnpm exec prettier --write site/guide-page.ts site/templates/guide.html site/build-version.ts site/build-version.test.ts`,
  después `pnpm exec vitest run site`
  Esperado: PASS (incluidos los tests viejos de la guía: `docsRoot` por omisión es `''`).

- [ ] **Paso 6: verificar y commitear.**
  Run: `pnpm lint; if ($?) { pnpm typecheck }; if ($?) { pnpm test }; if ($?) { pnpm build }`

```bash
git add site/guide-page.ts site/templates/guide.html site/build-version.ts site/build-version.test.ts
git commit -F - <<'EOF'
feat(site): el puente de Sheets en docs/google-sheets/ de cada versión (#166)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Tarea 4: enlaces desde la guía y `llms.txt`, y el e2e del sitio

**Archivos:**
- Modificar: `docs/integradores/guia.md` (sección nueva antes de "Servir el POS desde tu propio
  servidor"), `docs/integradores/llms.txt`, `site/build-version.ts`
- Test: `site/docs.test.ts`, `site/build-version.test.ts`, `e2e/published-site.spec.ts`

**Interfaces:**
- Consume: `SHEETS_SOURCE`, `DocsSources`, la subcarpeta `docs/google-sheets/` (Tarea 3).
- Produce: `localizeGuideLinks` y `localizeLlmsLinks` en `build-version.ts` (reemplazan a
  `localizeLinks`).

- [ ] **Paso 1: tests que fallan.** En `site/docs.test.ts`, dentro del `describe` del puente:

```ts
  it('la guía para integradores y llms.txt enlazan al puente', () => {
    expect(read('../docs/integradores/guia.md')).toContain('](google-sheets.md)');
    const llms = read('../docs/integradores/llms.txt');
    expect(llms).toContain('](google-sheets.md)');
    expect(llms).toContain(`](${SHEETS_SOURCE}bridge.gs)`);
    expect(llms).toContain(`](${SHEETS_SOURCE}columnas.gs)`);
  });
```

  En `site/build-version.test.ts`, en el primer test (`copia el build, escribe version.json…`),
  reemplazar la línea `expect(readFileSync(join(folder, 'docs', 'llms.txt'), 'utf8')).not.toContain('../');`
  por:

```ts
    expect(guide).toContain('](google-sheets/)');
    const llms = readFileSync(join(folder, 'docs', 'llms.txt'), 'utf8');
    expect(llms).not.toContain('../');
    expect(llms).toContain('](google-sheets/guia.md)');
    expect(llms).toContain('](google-sheets/bridge.gs)');
```

  En `e2e/published-site.spec.ts`, después del test de `/<versión>/docs/`:

```ts
test('/<versión>/docs/ enlaza la guía del puente de Google Sheets y sus .gs (#166)', async ({
  page,
}) => {
  await page.goto(`${SITE}/${VERSION}/docs/`);
  await page.getByRole('link', { name: 'Google Sheets: el puente de Apps Script' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Google Sheets: el puente de Apps Script' }),
  ).toBeVisible();
  for (const href of ['bridge.gs', 'columnas.gs', '../connector-api.openapi.yaml']) {
    expect((await page.request.get(new URL(href, page.url()).href)).ok()).toBe(true);
  }
});
```

- [ ] **Paso 2: correrlos y ver que fallan.**
  Run: `pnpm exec vitest run site`
  Esperado: FAIL en "enlazan al puente" y en el primer test de `buildVersionFolder`.

- [ ] **Paso 3: la sección en la guía.** En `docs/integradores/guia.md`, antes de
  `## Servir el POS desde tu propio servidor`:

```markdown
## Google Sheets: un backend sin servidor

Para un comercio sin ERP, el POS trae un backend ya hecho: una planilla de Google Sheets con un
puente de Apps Script que se pega en la planilla y se despliega como Web App, sin servidor propio.
El POS lo usa con su tipo de conexión **Google Sheets**. Cada versión publicada trae su puente:
instalación, actualización y qué guarda la planilla en
[Google Sheets: el puente de Apps Script](google-sheets.md).
```

- [ ] **Paso 4: las entradas en `llms.txt`.** En `docs/integradores/llms.txt`, al final de
  `## Docs`:

```markdown
- [Google Sheets: el puente de Apps Script](google-sheets.md): un backend sin servidor, una planilla con un puente de Apps Script; instalarlo, actualizarlo y qué guarda.
- [bridge.gs](../../src/connectors/google-sheets/bridge.gs): el puente (Apps Script), para pegar en la planilla.
- [columnas.gs](../../src/connectors/google-sheets/columnas.gs): los nombres visibles de pestañas, columnas y valores; va en el mismo proyecto que bridge.gs.
```

- [ ] **Paso 5: reescribir los links al publicar.** En `site/build-version.ts`, reemplazar
  `localizeLinks` por:

```ts
/** En el repo el OpenAPI está un nivel arriba; publicado, al lado. */
const localizeOpenApi = (text: string): string =>
  text.replaceAll('../connector-api.openapi.yaml', 'connector-api.openapi.yaml');

/** `guia.md` también se lee como página: la guía del puente, por su `index.html` (#166). */
const localizeGuideLinks = (text: string): string =>
  localizeOpenApi(text).replaceAll('](google-sheets.md)', '](google-sheets/)');

/** `llms.txt` es para un agente: todo en Markdown o como archivo (#166). */
const localizeLlmsLinks = (text: string): string =>
  localizeOpenApi(text)
    .replaceAll('](google-sheets.md)', '](google-sheets/guia.md)')
    .replaceAll(SHEETS_SOURCE, 'google-sheets/');
```

  (`SHEETS_SOURCE` tiene que estar declarada antes de `localizeLlmsLinks`: moverla arriba si hace
  falta.) En `buildVersionFolder`, `localizeLinks(readFileSync(docs.guide…))` pasa a
  `localizeGuideLinks(…)` y el de `docs.llms` a `localizeLlmsLinks(…)`.

- [ ] **Paso 6: formatear y correr los tests.**
  Run: `pnpm exec prettier --write docs/integradores/guia.md docs/integradores/llms.txt site/build-version.ts site/build-version.test.ts site/docs.test.ts e2e/published-site.spec.ts`,
  después `pnpm exec vitest run site`
  Esperado: PASS.

- [ ] **Paso 7: verificar, incluido el e2e, y commitear.**
  Run: `pnpm lint; if ($?) { pnpm typecheck }; if ($?) { pnpm test }; if ($?) { pnpm build }`, y
  después `pnpm test:e2e` (arma el sitio con `site:build` y lo sirve en 4174).
  Esperado: todo en verde, incluido el test nuevo de `published-site.spec.ts`.

```bash
git add docs/integradores/guia.md docs/integradores/llms.txt site/build-version.ts site/build-version.test.ts site/docs.test.ts e2e/published-site.spec.ts
git commit -F - <<'EOF'
feat(site): la guía y llms.txt enlazan al puente de Sheets (#166)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Tarea 5: el README del conector, para desarrollo

**Archivos:**
- Modificar: `src/connectors/google-sheets/README.md`

- [ ] **Paso 1: reemplazar lo que cubre la guía pública.** Borrar las secciones
  `## Setup (comerciante)`, `## Cómo se ve y cómo se edita la planilla`,
  `## Qué hace cada operación` (con su tabla y "Limitaciones conocidas"), `## Cursor de pull
  (Etapa 2, #87)` y `## Contrato del puente`, y en el lugar de `## Setup (comerciante)` (justo
  después del bloque `> Estado: …`) poner:

```markdown
## Instalación, uso y contrato del puente

Están en la guía pública, [`docs/integradores/google-sheets.md`](../../../docs/integradores/google-sheets.md),
que se publica en cada carpeta de versión (`/<versión>/docs/google-sheets/`) junto con `bridge.gs` y
`columnas.gs`: instalar el puente en una planilla, permisos, actualizarlo, cómo se edita la
planilla, qué guarda cada evento, el contrato del puente y sus limitaciones. Lo que se publica no
cita issues ni archivos del repo (lo vigila `site/docs.test.ts`), tampoco en los comentarios de los
`.gs`.

El cursor de pull usa fingerprints en la pestaña oculta `_Snapshot`: ver el comentario de
`trackChanges` en `bridge.gs`.

Este README queda para desarrollo: las notas de actualización de cada versión del contrato, cómo se
testea y el checklist contra una planilla real.
```

  Quedan, sin tocar: el título y la intro, `## Actualizar el puente a la v3 del contrato (#96)`,
  `## Contrato 4.0.0 (#99)`, `## Contrato 4.1.0 (#120)`, `## Contrato 4.2.0 (#101)`,
  `## Desarrollo` y el checklist. Verificar que `trackChanges` exista:
  `grep -n "function trackChanges" src/connectors/google-sheets/bridge.gs`; si tiene otro nombre,
  usar el real.

- [ ] **Paso 2: links rotos.** `grep -n 'Cursor de pull\|Qué hace cada operación\|Contrato del puente\|Setup' src/connectors/google-sheets/README.md`:
  toda mención a una sección borrada pasa a apuntar a la guía pública. Formatear:
  `pnpm exec prettier --write src/connectors/google-sheets/README.md`.

- [ ] **Paso 3: commitear.**

```bash
git add src/connectors/google-sheets/README.md
git commit -F - <<'EOF'
docs: el README del conector remite a la guía pública del puente (#166)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Tarea 6: documentación del repo y verificación final

**Archivos:**
- Modificar: `AGENTS.md` (sección "Publicación"), `docs/publicacion.md` (sección 1),
  `src/connectors/AGENTS.md` (primer párrafo de "Implementaciones y registro")

- [ ] **Paso 1: `AGENTS.md`, "Publicación".** El ítem "Docs para integradores" queda:

```markdown
- **Docs para integradores** en `docs/integradores/` (guía, `llms.txt` y la guía del puente de
  Google Sheets, `google-sheets.md`), publicadas con el OpenAPI en cada `/<versión>/docs/`; el
  puente (`bridge.gs` y `columnas.gs`, tal cual) va en `/<versión>/docs/google-sheets/` con su guía
  (#166). Lo publicado no lleva referencias internas (issues, specs, `AGENTS.md`), tampoco los
  comentarios de los `.gs`: lo vigila `site/docs.test.ts`.
```

- [ ] **Paso 2: `docs/publicacion.md`.** En la sección 1, el primer sub-ítem queda: "una carpeta
  **inmutable** por versión (`/0.1.0/`), con el POS, su `version.json` y sus docs (desde la versión
  siguiente a `0.1.0`, también el puente de Google Sheets en `docs/google-sheets/`);".

- [ ] **Paso 3: `src/connectors/AGENTS.md`.** Después de "…se prueban en Vitest con una planilla
  falsa (`src/test/fake-spreadsheet.ts`).", agregar: "Se publican tal cual en cada carpeta de
  versión (`docs/google-sheets/`), con la guía pública `docs/integradores/google-sheets.md`: sus
  comentarios no citan issues ni archivos del repo (lo vigila `site/docs.test.ts`), y lo que la
  guía dice del puente se corrige en la guía, nunca al revés."

- [ ] **Paso 4: formatear y commitear.**
  Run: `pnpm exec prettier --write AGENTS.md docs/publicacion.md src/connectors/AGENTS.md` (mirar el
  diff: si Prettier reformatea tablas o párrafos que no se tocaron, revertir esos cambios y dejar
  solo los propios).

```bash
git add AGENTS.md docs/publicacion.md src/connectors/AGENTS.md
git commit -F - <<'EOF'
docs: AGENTS.md y publicacion.md con el puente publicado (#166)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

- [ ] **Paso 5: verificación completa.**
  Run: `pnpm lint; if ($?) { pnpm typecheck }; if ($?) { pnpm test }; if ($?) { pnpm build }`,
  `pnpm test:e2e` y `pnpm site:build`. Después, en segundo plano, `pnpm site:preview` y revisar en
  el navegador `http://localhost:4174/versions/` → Docs → Google Sheets: la guía se ve, los links
  del encabezado (OpenAPI, llms.txt, Todas las versiones) andan, `bridge.gs` y `columnas.gs` se
  abren, y `docs/llms.txt` lista el puente.

- [ ] **Paso 6: informe final** con la prueba manual paso a paso (el usuario la hace en el
  navegador) y esperar la revisión antes del PR.

---

### Después de la revisión (fuera de las tareas)

1. PR a `main` sin "Closes" (el punto 2 es un ítem del epic, no tiene issue propio): cuerpo con resumen,
   prueba manual y `Refs #166`. Merge commit.
2. `AGENTS.md`, "Estado del proyecto": una fila "#166, punto 2" (el puente publicado por versión,
   PR #N) y, en "Siguiente", el punto 2 como hecho. Commit en la misma rama antes del merge.
3. Tildar en #166 el ítem del punto 2 ("— PR #N").
