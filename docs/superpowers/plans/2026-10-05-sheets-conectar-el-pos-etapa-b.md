# "Conectar el POS" desde la planilla (etapa B de #180, #133) — plan

> **Para quien lo ejecute:** se ejecuta **inline** con `superpowers:executing-plans`, tarea por
> tarea con checkpoints (nunca un subagente por tarea, ver "Cómo trabajamos" en `AGENTS.md`). Los
> pasos usan checkboxes (`- [ ]`).

**Objetivo:** que la página del Web App del puente tenga un botón "Conectar el POS" que abre el POS
con la planilla precargada en el wizard de `/CONFIG`, y que la planilla tenga una pestaña
Configuración con la URL del POS y los pasos para conectar.

**Arquitectura:** el puente arma el link con su propia URL (`ScriptApp.getService().getUrl()`) y la
URL del POS que lee de la pestaña Configuración; el POS reconoce una segunda forma en `#connect=`
(unión discriminada) y con ella siempre precarga el wizard, que ya resuelve el resto (pide sucursal
y punto de venta, prueba, Mantener o Borrar).

**Stack:** Apps Script (V8, JS plano) para el puente; TypeScript + Zod + Vitest (`node:vm` con la
planilla falsa) + Playwright para el POS.

**Spec:** `docs/superpowers/specs/2026-10-05-sheets-4-6-portal-onboarding-design.md`, sección
"Etapa B". Ver ahí las decisiones (el link sale de la copia implementada y nunca de una celda, nunca
lleva el secreto, siempre precarga el wizard, la pestaña al final).

**Riesgo de la spec, ya verificado (2026-10-05):** en una planilla real con `@OnlyCurrentDoc`, un
script con `ScriptApp.getService().getUrl()`, `HtmlService` y `SpreadsheetApp...getName()` lista
solo `spreadsheets.currentonly`; la autorización no pidió nada más, y la página del Web App mostró
la misma URL `/exec` de la implementación. Sin plan B.

## Restricciones globales

- Todo en español: textos, comentarios, commits.
- Los comentarios **nuevos** de los `.gs` no citan issues ni archivos del repo (se publican tal cual).
- El puente sigue con `@OnlyCurrentDoc` y no usa ningún servicio nuevo además de `ScriptApp`
  (`getService().getUrl()`), `HtmlService` y `Utilities` (verificados o sin permiso propio).
- El link nunca lleva el secreto compartido; la pestaña Configuración tampoco.
- URL del POS por omisión: `https://pos.contax.ar/v4/`.
- Cada commit verificado con `pnpm lint && pnpm typecheck && pnpm test && pnpm build` (desde
  PowerShell); `pnpm test:e2e` en la tarea que toca e2e y al final. Formatear con Prettier solo los
  `.ts`/`.md` que se toquen (`pnpm exec prettier --write <archivos>`); los `.gs` no pasan por Prettier.
- Flakes conocidos (#142, #155, #169, #205, `terminal-identity.spec.ts`): volver a correr antes de
  investigar.

## Archivos

| Archivo | Qué cambia |
|---|---|
| `src/sync/demo-link.ts` (+ test) | `ConnectReturn` pasa a unión discriminada (`rest` / `google-sheets`); `readConnectReturn` acepta las dos formas |
| `src/ui/onboarding.ts` (+ test) | `handleReturn`: con Sheets, siempre `review` con el candidato y un aviso |
| `e2e/config-connector.spec.ts` | El link de Sheets abre el wizard precargado y se aplica |
| `src/connectors/google-sheets/columnas.gs` | Textos de la pestaña Configuración: nombre, claves, pasos |
| `src/connectors/google-sheets/bridge.gs` | `DEFAULT_POS_URL`, `ensureConfigSheet`, `readConfigValue`, `posUrl`, `connectLink`, `escapeHtml`, `doGet` con la página |
| `src/test/fake-spreadsheet.ts` | `insertSheet(name, index?)` y `getNumSheets()` |
| `src/connectors/google-sheets/bridge.test.ts` | Mocks de `ScriptApp`, `HtmlService` y `Utilities`; tests de la pestaña y de la página |
| `src/connectors/google-sheets/README.md` | Setup con "Conectar el POS", la pestaña Configuración, checklist |
| `src/connectors/AGENTS.md`, `src/sync/AGENTS.md`, `src/ui/AGENTS.md`, `AGENTS.md` | Lo nuevo, cada cosa en su archivo |

---

### Tarea 1: `readConnectReturn` acepta la forma de Sheets

**Archivos:**
- Modificar: `src/sync/demo-link.ts` (schema y tipo de la vuelta, `readConnectReturn`)
- Test: `src/sync/demo-link.test.ts` (`describe('readConnectReturn')`)

**Interfaces:**
- Produce:
  ```ts
  export type ConnectReturn =
    | { type: 'rest'; baseUrl: string; apiKey: string; branch: string; pointOfSale: string; wipeKey?: string }
    | { type: 'google-sheets'; webAppUrl: string };
  export function readConnectReturn(href: string): Result<ConnectReturn> | undefined; // firma igual
  ```
  La forma REST sin `type` (la que manda el alta hoy) se devuelve con `type: 'rest'`.

- [ ] **Paso 1: tests que fallan.** En `describe('readConnectReturn')`, el test existente pasa a
  esperar `ok({ type: 'rest', ...payload })`, y se agregan:

```ts
  it('acepta type: rest explícito', () => {
    expect(readConnectReturn(`https://pos.x/#connect=${encode({ type: 'rest', ...payload })}`)).toEqual(
      ok({ type: 'rest', ...payload }),
    );
  });
  it('la forma de Google Sheets: type y webAppUrl, nada más', () => {
    const sheets = {
      type: 'google-sheets',
      webAppUrl: 'https://script.google.com/macros/s/abc/exec',
      sharedSecret: 'no-viaja',
    };
    expect(readConnectReturn(`https://pos.x/#connect=${encode(sheets)}`)).toEqual(
      ok({ type: 'google-sheets', webAppUrl: 'https://script.google.com/macros/s/abc/exec' }),
    );
  });
  it('Google Sheets sin webAppUrl https → demo/invalid-return', () => {
    for (const webAppUrl of [undefined, 'no-es-url', 'http://script.google.com/macros/s/abc/exec']) {
      const link = `https://pos.x/#connect=${encode({ type: 'google-sheets', webAppUrl })}`;
      expect(readConnectReturn(link)?.ok).toBe(false);
    }
  });
  it('un type desconocido → demo/invalid-return', () => {
    expect(readConnectReturn(`https://pos.x/#connect=${encode({ type: 'otro', ...payload })}`)?.ok).toBe(
      false,
    );
  });
```

- [ ] **Paso 2: correrlos y verlos fallar.**
  `pnpm exec vitest run src/sync/demo-link.test.ts` → fallan "decodifica el fragmento" (falta
  `type`), "acepta type: rest" y "la forma de Google Sheets".

- [ ] **Paso 3: implementar.** En `demo-link.ts`, reemplazar `connectReturnSchema`, `ConnectReturn`
  y el final de `readConnectReturn`:

```ts
// La vuelta del alta (REST, #128): sin `type` o con `type: 'rest'`.
const restReturnSchema = z.object({
  type: z.literal('rest').optional(),
  baseUrl: allowedUrl,
  apiKey: z.string().min(1),
  branch: z.string().min(1),
  pointOfSale: z.string().min(1),
  wipeKey: z.string().min(1).optional(),
});

// "Conectar el POS" desde la planilla (#133): solo la URL del Web App. Nunca trae el secreto ni la
// identidad de la terminal, así que siempre termina en el wizard.
const sheetsReturnSchema = z.object({
  type: z.literal('google-sheets'),
  webAppUrl: z
    .string()
    .refine((raw) => URL.canParse(raw) && new URL(raw).protocol === 'https:', 'Tiene que ser https'),
});

const connectReturnSchema = z.union([sheetsReturnSchema, restReturnSchema]);

export type ConnectReturn =
  | {
      type: 'rest';
      baseUrl: string;
      apiKey: string;
      branch: string;
      pointOfSale: string;
      wipeKey?: string;
    }
  | { type: 'google-sheets'; webAppUrl: string };
```

```ts
  const data = parsed.data;
  if (data.type === 'google-sheets') {
    return ok({ type: 'google-sheets', webAppUrl: data.webAppUrl });
  }
  const { baseUrl, apiKey, branch, pointOfSale, wipeKey } = data;
  return ok({
    type: 'rest',
    baseUrl,
    apiKey,
    branch,
    pointOfSale,
    ...(wipeKey !== undefined ? { wipeKey } : {}),
  });
```

  Actualizar el comentario del módulo: la vuelta puede ser la del alta (REST) o "Conectar el POS"
  desde una planilla. `ui/onboarding.ts` no compila todavía (desestructura `type` dentro de
  `connection`): en este mismo paso, en `handleReturn`, cambiar
  `const { wipeKey, ...connection } = back.value;` por un guardado provisorio
  `if (back.value.type !== 'rest') { return { kind: 'none' }; }` antes de desestructurar
  `const { wipeKey, type, ...connection } = back.value;` y armar `{ type, ...connection, ... }`. La
  tarea 2 reemplaza el guardado.

- [ ] **Paso 4: correr y verlos pasar.** `pnpm exec vitest run src/sync/demo-link.test.ts src/ui/onboarding.test.ts` → PASS.

- [ ] **Paso 5: verificar y commitear.** `pnpm lint && pnpm typecheck && pnpm test && pnpm build`;
  Prettier sobre los dos `.ts` tocados y su test. Commit (incluye este plan):
  `feat: la vuelta #connect acepta la forma de Google Sheets (#133)`.

### Tarea 2: con el link de Sheets, el wizard siempre precargado

**Archivos:**
- Modificar: `src/ui/onboarding.ts` (`handleReturn`, comentario del módulo)
- Test: `src/ui/onboarding.test.ts`, `e2e/config-connector.spec.ts`

**Interfaces:**
- Consume: `ConnectReturn` de la tarea 1.
- Produce: `OnboardingOutcome` sin cambios; con Sheets, `{ kind: 'review', candidate:
  { type: 'google-sheets', webAppUrl, locale? }, notice: SHEETS_CONNECT_NOTICE }`.
  `bootstrap.ts` ya llama a `openWizardWithCandidate`, que va a Probar y, sin sucursal, rebota solo
  al paso Terminal (`runProbe` → `firstIncomplete`).

- [ ] **Paso 1: tests que fallan** en `src/ui/onboarding.test.ts`, un `describe` nuevo:

```ts
describe('runOnboardingFromUrl — Conectar el POS desde una planilla (#133)', () => {
  const sheetsLink = `https://pos.x/#connect=${encode({
    type: 'google-sheets',
    webAppUrl: 'https://script.google.com/macros/s/abc/exec',
  })}`;
  const notice =
    'Conexión con la planilla precargada: completá la sucursal y el punto de venta (y el secreto compartido, si lo configuraste en Apps Script) y probá la conexión.';

  it.each([
    ['sin config', NO_CONFIG, false],
    ['en demo y sin datos', DEMO_CONFIG, false],
    ['con una conexión real y datos', REAL_CONFIG, true],
  ])('%s: siempre review, sin probar, aplicar ni consumir un wipe_key', async (_, config, hasUserData) => {
    const outcome = await runOnboardingFromUrl(sheetsLink, { config, hasUserData }, deps);

    expect(outcome).toEqual({
      kind: 'review',
      candidate: { type: 'google-sheets', webAppUrl: 'https://script.google.com/macros/s/abc/exec' },
      notice,
    });
    expect(deps.probeConnection).not.toHaveBeenCalled();
    expect(deps.applyConnection).not.toHaveBeenCalled();
    expect(deps.consumeWipeKey).not.toHaveBeenCalled();
  });

  it('conserva el locale de la config actual', async () => {
    const config: Result<SyncConfig> = ok({ type: 'rest', baseUrl: 'https://erp.x', locale: 'es-AR' });
    const outcome = await runOnboardingFromUrl(sheetsLink, { config, hasUserData: false }, deps);
    expect(outcome).toMatchObject({ candidate: { locale: 'es-AR' } });
  });
});
```

- [ ] **Paso 2: verlos fallar** (`pnpm exec vitest run src/ui/onboarding.test.ts`): devuelven
  `{ kind: 'none' }` por el guardado provisorio.

- [ ] **Paso 3: implementar** en `handleReturn`, en lugar del guardado provisorio:

```ts
  if (back.value.type === 'google-sheets') {
    // Al link de la planilla le faltan la sucursal, el punto de venta y el secreto: nunca se prueba
    // ni se borra solo, el operador termina en el wizard (que ofrece Mantener o Borrar si hace falta).
    return {
      kind: 'review',
      candidate: {
        type: 'google-sheets',
        webAppUrl: back.value.webAppUrl,
        ...keptLocale(context.config),
      },
      notice: SHEETS_CONNECT_NOTICE,
    };
  }
```

  con `const SHEETS_CONNECT_NOTICE = 'Conexión con la planilla precargada: completá la sucursal y el
  punto de venta (y el secreto compartido, si lo configuraste en Apps Script) y probá la conexión.';`
  arriba de `handleReturn`. El comentario del módulo suma: "La vuelta de una planilla de Google
  Sheets ('Conectar el POS', #133) nunca borra: siempre precarga el wizard."

- [ ] **Paso 4: verlos pasar** → PASS.

- [ ] **Paso 5: e2e** en `e2e/config-connector.spec.ts` (usa el `route` de `script.google.com` del
  `beforeEach` y el fixture con la conexión REST activa, sin datos del usuario):

```ts
test('Conectar el POS desde una planilla: el wizard precargado, sucursal y caja a mano, y se aplica (#133)', async ({
  page,
}) => {
  const encoded = Buffer.from(JSON.stringify({ type: 'google-sheets', webAppUrl: WEB_APP_URL }))
    .toString('base64url');
  await page.goto(`/#connect=${encoded}`);

  await expect(page.getByRole('heading', { name: 'Configurar conexión' })).toBeVisible();
  await expect(page.getByText(/Conexión con la planilla precargada/)).toBeVisible();
  expect(page.url()).not.toContain('connect=');
  // Sin sucursal ni caja, la prueba no arranca: el wizard queda en el paso Terminal.
  await expect(page.getByRole('button', { name: /^Paso 1:/ })).toHaveAttribute('aria-current', 'step');

  await page.getByLabel('Sucursal').fill('Planilla');
  await page.getByLabel('Punto de venta').fill('Caja 2');
  await page.keyboard.press('Control+Enter');
  await expect(page.getByText(/Conexión OK/)).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Aplicar (Enter)' })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Barra de comandos')).toBeFocused();

  const stored = await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY);
  expect(JSON.parse(stored ?? 'null')).toMatchObject({
    type: 'google-sheets',
    webAppUrl: WEB_APP_URL,
    branch: 'Planilla',
    pointOfSale: 'Caja 2',
  });
});
```

  Ojo: el fixture vuelve a sembrar la config REST en cada navegación (`addInitScript`); el test no
  recarga después de aplicar, así que no afecta. Si "Datos locales" no se saltea (el fixture no tiene
  datos del usuario, debería saltearse), ajustar el test a lo que muestre el wizard, no el código.

- [ ] **Paso 6: verificar y commitear.** `pnpm lint && pnpm typecheck && pnpm test && pnpm build`
  y `pnpm test:e2e`. Commit: `feat: el link de una planilla precarga el wizard de /CONFIG (#133)`.

### Tarea 3: la pestaña Configuración en el seed

**Archivos:**
- Modificar: `src/connectors/google-sheets/columnas.gs` (al final), `src/connectors/google-sheets/bridge.gs`
  (`DEFAULT_POS_URL` junto a `PORTAL`; `ensureConfigSheet` después de `createSheet`; la llamada al
  final de `ensureSheetsExist`), `src/test/fake-spreadsheet.ts`
- Test: `src/connectors/google-sheets/bridge.test.ts` (`describe('pestaña Configuración')`)

**Interfaces:**
- Produce (en el ámbito global del proyecto de Apps Script):
  - `columnas.gs`: `CONFIG_SHEET = 'Configuración'`, `CONFIG_LABELS = { posUrl: 'URL del POS' }`,
    `CONFIG_STEPS` (array de strings, el primero es el título).
  - `bridge.gs`: `DEFAULT_POS_URL = 'https://pos.contax.ar/v4/'`, `ensureConfigSheet(spreadsheet)`.
  - `FakeSpreadsheet.insertSheet(name: string, index?: number)`, `FakeSpreadsheet.getNumSheets(): number`.

- [ ] **Paso 1: la planilla falsa.** En `FakeSpreadsheet`, `insertSheet(name: string, _index?: number)`
  (el índice se ignora: las pestañas se agregan siempre al final, el orden es el del `Map`) y
  `getNumSheets(): number { return this.sheets.size; }`.

- [ ] **Paso 2: tests que fallan.** Importar `vi` de vitest. Nuevo `describe`:

```ts
describe('pestaña Configuración', () => {
  it('el primer request la crea al final, con la URL del POS y los pasos', () => {
    const { spreadsheet, call } = loadBridge();
    const insert = vi.spyOn(spreadsheet, 'insertSheet');

    pullBatch(call);

    const names = spreadsheet.sheetNames();
    expect(names.at(-1)).toBe('Configuración');
    // Se inserta con el índice explícito del final: sin índice, Sheets la pone al lado de la activa.
    expect(insert).toHaveBeenLastCalledWith('Configuración', names.length - 1);
    const rows = table(spreadsheet, 'Configuración');
    expect(rows[0]).toEqual(['URL del POS', 'https://pos.contax.ar/v4/']);
    expect(rows.some((row) => String(row[0]).includes('Conectar el POS'))).toBe(true);
  });

  it('nunca guarda el secreto compartido', () => {
    const bridge = loadBridge({ sharedSecret: 'secreto-1' });

    bridge.raw({
      action: 'pullBatch',
      payload: { cursors: {}, pendingLotIds: [] },
      sharedSecret: 'secreto-1',
    });

    const config = bridge.spreadsheet.getSheetByName('Configuración');
    expect(config).not.toBeNull();
    expect(JSON.stringify(config?.values())).not.toContain('secreto-1');
  });

  it('si ya existe no la toca', () => {
    const { spreadsheet, call } = loadBridge();
    const own = spreadsheet.addSheet('Configuración', [
      ['Notas mías', ''],
      ['URL del POS', 'https://otro.pos/v4/'],
    ]);

    pullBatch(call);

    expect(own.values()).toEqual([
      ['Notas mías', ''],
      ['URL del POS', 'https://otro.pos/v4/'],
    ]);
  });
});
```

- [ ] **Paso 3: verlos fallar** (`pnpm exec vitest run src/connectors/google-sheets/bridge.test.ts`).

- [ ] **Paso 4: implementar.** Al final de `columnas.gs`:

```js
// La pestaña Configuración: la crea el puente al final de la planilla la primera vez y después solo
// la lee. Las claves (columna A) se buscan por su texto, no por la fila: se pueden mover, y se puede
// escribir abajo o al costado. Nunca va acá el secreto compartido (viajaría con cada copia).
var CONFIG_SHEET = 'Configuración';

var CONFIG_LABELS = {
  posUrl: 'URL del POS',
};

// Lo que se escribe debajo de las claves al crear la pestaña. El primero es el título.
var CONFIG_STEPS = [
  'Cómo conectar una terminal',
  '1. Si esta planilla es una plantilla compartida, hacé tu copia (Archivo > Hacer una copia) y seguí en la copia.',
  '2. Extensiones > Apps Script > Implementar > Nueva implementación > Aplicación web. Ejecutar como: Yo. Quién tiene acceso: Cualquier persona. Autorizá el acceso a esta planilla.',
  '3. Desde la terminal, abrí la URL de la aplicación web y tocá Conectar el POS.',
  '4. En el POS, completá la sucursal y el punto de venta (y el secreto compartido, si lo configuraste) y probá la conexión.',
  'Cada terminal se conecta igual: abriendo la URL de la aplicación web desde esa terminal.',
  'URL del POS: adónde lleva el botón Conectar el POS. Vacía, se usa https://pos.contax.ar/v4/.',
  'El secreto compartido no va en esta pestaña: se configura en Apps Script (Configuración del proyecto > Propiedades de la secuencia de comandos > SHARED_SECRET).',
];
```

  En `bridge.gs`, junto a `PORTAL`:

```js
/** Adónde lleva "Conectar el POS" si la pestaña Configuración no dice otra cosa. */
var DEFAULT_POS_URL = 'https://pos.contax.ar/v4/';
```

  Al final de `ensureSheetsExist`: `ensureConfigSheet(spreadsheet);`. Después de `createSheet`:

```js
/**
 * La pestaña Configuración, al final de la planilla: solo se crea si no existe (el dueño la puede
 * mover o darle formato, y la portada de la planilla es suya). Lleva los pares clave/valor que el
 * puente lee y, abajo, los pasos para conectar una terminal.
 */
function ensureConfigSheet(spreadsheet) {
  if (spreadsheet.getSheetByName(CONFIG_SHEET)) {
    return;
  }
  var rows = [[CONFIG_LABELS.posUrl, DEFAULT_POS_URL], ['', '']].concat(
    CONFIG_STEPS.map(function (step) {
      return [step, ''];
    }),
  );
  // Con el índice explícito: sin él, Sheets la inserta al lado de la pestaña activa.
  var sheet = spreadsheet.insertSheet(CONFIG_SHEET, spreadsheet.getNumSheets());
  sheet.getRange(1, 1, rows.length, 2).setValues(rows);
  sheet.getRange(1, 1).setFontWeight('bold');
  sheet.getRange(3, 1).setFontWeight('bold');
}
```

- [ ] **Paso 5: verlos pasar**, y toda la suite del puente (el test de "crea MovimientosCaja y
  Cobranzas" usa `arrayContaining`, no se rompe). Si `FakeRange` no acepta un rango que pasa de
  `getMaxRows()` (20 por omisión; acá son 10 filas), revisar antes de agrandarlo.

- [ ] **Paso 6: verificar y commitear.** Suite completa + build. Commit:
  `feat: el puente de Sheets crea la pestaña Configuración al final (#133)`.

### Tarea 4: `doGet` muestra la página con "Conectar el POS"

**Archivos:**
- Modificar: `src/connectors/google-sheets/bridge.gs` (`doGet`; funciones nuevas `readConfigValue`,
  `posUrl`, `connectLink`, `escapeHtml`, `htmlPage` en una sección "página del Web App", después de
  `respond`)
- Test: `src/connectors/google-sheets/bridge.test.ts` (mocks en `loadBridge`; `describe('Conectar el POS')`)

**Interfaces:**
- Consume: `CONFIG_SHEET`, `CONFIG_LABELS`, `DEFAULT_POS_URL` (tarea 3); `readConnectReturn` de
  `src/sync/demo-link.ts` (tarea 1), que el test usa para decodificar el link: así el test cubre el
  contrato entre el puente y el POS de punta a punta.
- Produce: `doGet()` → `HtmlOutput`. Harness: `loadBridge` suma la opción `webAppUrl` y devuelve
  `page(): { html: string; title: string }`.

- [ ] **Paso 1: harness.** En `loadBridge`, `BridgeOptions` suma `webAppUrl?: string` (por omisión
  `'https://script.google.com/macros/s/fake/exec'`) y el contexto suma:

```ts
    ScriptApp: { getService: () => ({ getUrl: () => webAppUrl }) },
    HtmlService: {
      createHtmlOutput: (html: string) => {
        const output = {
          html,
          title: '',
          setTitle: (title: string) => {
            output.title = title;
            return output;
          },
          addMetaTag: () => output,
        };
        return output;
      },
    },
    Utilities: {
      Charset: { UTF_8: 'UTF-8' },
      // Como el real: base64 "web safe" CON el relleno `=`.
      base64EncodeWebSafe: (text: string) =>
        Buffer.from(text, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
    },
```

  y `function page() { return pageSchema.parse(vm.runInContext('doGet()', context)); }` con
  `const pageSchema = z.object({ html: z.string(), title: z.string() });`.

- [ ] **Paso 2: tests que fallan:**

```ts
describe('Conectar el POS (doGet)', () => {
  const hrefOf = (html: string) =>
    (/href="([^"]+)"/.exec(html)?.[1] ?? '').replace(/&amp;/g, '&');

  it('muestra la planilla, el contrato y el botón con el link del POS', () => {
    const bridge = loadBridge({ name: 'Kiosco <Ana>', webAppUrl: 'https://script.google.com/macros/s/abc/exec' });

    const { html, title } = bridge.page();

    expect(title).toBe('Conectar el POS');
    expect(html).toContain('Kiosco &lt;Ana&gt;');
    expect(html).toContain('4.6.0');
    expect(html).toContain('target="_blank"');
    const href = hrefOf(html);
    expect(href.startsWith('https://pos.contax.ar/v4/#connect=')).toBe(true);
    expect(href).not.toContain('=='); // sin el relleno
    expect(readConnectReturn(href)).toEqual(
      ok({ type: 'google-sheets', webAppUrl: 'https://script.google.com/macros/s/abc/exec' }),
    );
  });

  it('nunca lleva el secreto compartido', () => {
    const bridge = loadBridge({ sharedSecret: 'secreto-1' });
    const { html } = bridge.page();
    expect(html).not.toContain('secreto-1');
    expect(Buffer.from(hrefOf(html).split('#connect=')[1] ?? '', 'base64url').toString()).not.toContain(
      'secreto',
    );
  });

  it('usa la URL del POS de la pestaña Configuración, encontrada por la clave', () => {
    const bridge = loadBridge();
    bridge.spreadsheet.addSheet('Configuración', [
      ['Mis notas', ''],
      ['  url del pos ', ' https://otro.pos/v4/#viejo '],
    ]);
    expect(hrefOf(bridge.page().html).startsWith('https://otro.pos/v4/#connect=')).toBe(true);
  });

  it.each([
    ['vacía', ''],
    ['que no es http(s)', 'javascript:alert(1)'],
  ])('con la URL del POS %s usa la de por omisión', (_, value) => {
    const bridge = loadBridge();
    bridge.spreadsheet.addSheet('Configuración', [['URL del POS', value]]);
    expect(hrefOf(bridge.page().html).startsWith('https://pos.contax.ar/v4/#connect=')).toBe(true);
  });

  it('no crea pestañas', () => {
    const bridge = loadBridge();
    bridge.page();
    expect(bridge.spreadsheet.sheetNames()).toEqual([]);
  });

  it('sin columnas.gs lo dice en la página', () => {
    const bridge = loadBridge({}, ['bridge.gs']);
    expect(bridge.page().html).toContain('Falta el archivo columnas.gs');
  });
});
```

  (Imports nuevos en el test: `ok` de `../../domain/result.ts` y `readConnectReturn` de
  `../../sync/demo-link.ts`.)

- [ ] **Paso 3: verlos fallar** (`doGet` devuelve el JSON de `ContentService`).

- [ ] **Paso 4: implementar** en `bridge.gs`. `doGet` (reemplaza el health check):

```js
/**
 * La página del Web App: el nombre de la planilla, la versión del contrato y "Conectar el POS", que
 * abre el POS con esta planilla precargada en su configuración. El link lleva la URL de ESTA
 * implementación (nunca sale de una celda: viajaría en cada copia de la planilla) y nunca el secreto
 * compartido, porque la página es pública. No toma el lock ni crea pestañas.
 */
function doGet() {
  if (typeof CONFIG_LABELS === 'undefined') {
    return htmlPage('<p>Falta el archivo columnas.gs en el proyecto de Apps Script.</p>');
  }
  var pos = posUrl();
  var link = connectLink(pos, ScriptApp.getService().getUrl());
  var name = SpreadsheetApp.getActiveSpreadsheet().getName() || 'Esta planilla';
  return htmlPage(
    '<h1>' + escapeHtml(name) + '</h1>' +
      '<p class="sub">Puente del POS · contrato ' + escapeHtml(CONTRACT_VERSION) + '</p>' +
      '<p><a class="boton" href="' + escapeHtml(link) + '" target="_blank" rel="noopener">Conectar el POS</a></p>' +
      '<p>Abre el POS (' + escapeHtml(pos) + ') con esta planilla en su configuración. Ahí completás ' +
      'la sucursal, el punto de venta y el secreto compartido, si lo configuraste. Cada terminal se ' +
      'conecta igual: abriendo esta página desde esa terminal.</p>',
  );
}
```

  Sección nueva después de `respond`:

```js
// ------------------------------------------------------ página del Web App

/** El valor de una clave de la pestaña Configuración (por etiqueta o clave interna); '' si no está. */
function readConfigValue(key) {
  var sheet = getSheet(CONFIG_SHEET);
  if (!sheet || sheet.getLastRow() === 0) {
    return '';
  }
  var wanted = [normalize(CONFIG_LABELS[key]), normalize(key)];
  var width = Math.min(2, sheet.getMaxColumns());
  var rows = sheet.getRange(1, 1, sheet.getLastRow(), width).getValues();
  for (var i = 0; i < rows.length; i++) {
    if (wanted.indexOf(normalize(rows[i][0])) !== -1) {
      return rows[i][1] === undefined ? '' : String(rows[i][1]).trim();
    }
  }
  return '';
}

/** La URL del POS de la pestaña Configuración, sin fragmento; si no es http(s), la de por omisión. */
function posUrl() {
  var value = readConfigValue('posUrl');
  return /^https?:\/\//i.test(value) ? value.split('#')[0] : DEFAULT_POS_URL;
}

/** `<POS>#connect=<base64url sin relleno>` con lo único que el POS necesita de esta planilla. */
function connectLink(pos, webAppUrl) {
  var json = JSON.stringify({ type: 'google-sheets', webAppUrl: webAppUrl });
  var encoded = Utilities.base64EncodeWebSafe(json, Utilities.Charset.UTF_8).replace(/=+$/, '');
  return pos + '#connect=' + encoded;
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function htmlPage(body) {
  var style =
    '<style>body{font-family:system-ui,sans-serif;max-width:36rem;margin:2rem auto;padding:0 1rem;color:#1f2937}' +
    '.sub{color:#6b7280}.boton{display:inline-block;padding:.75rem 1.25rem;border-radius:.5rem;' +
    'background:#2563eb;color:#fff;text-decoration:none;font-weight:600}</style>';
  return HtmlService.createHtmlOutput(style + body)
    .setTitle('Conectar el POS')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}
```

  Actualizar el comentario de la cabecera de `bridge.gs` ("Un solo endpoint: doPost(e)") para
  decir que `doGet` es la página para conectar el POS, sin citar issues. Ojo: `normalize` de un
  `undefined` (columna A vacía) tiene que dar algo que no coincida; `String(undefined)` da
  `'undefined'`, que no coincide con ninguna clave: alcanza.

- [ ] **Paso 5: verlos pasar**, y toda la suite.

- [ ] **Paso 6: README del conector.** En `src/connectors/google-sheets/README.md`:
  - **Setup**: los pasos 3 y 5 pasan a ser "abrir la URL de la aplicación web desde la terminal y
    tocar **Conectar el POS**: abre el POS con la planilla precargada en `/CONFIG`; completar
    sucursal, punto de venta y, si lo pusiste, el secreto, y probar". Pegar la URL a mano en
    `/CONFIG` queda como alternativa. Mencionar la pestaña **Configuración** (al final; "URL del POS",
    por omisión `https://pos.contax.ar/v4/`, para quien usa otro canal o un POS propio; nunca el
    secreto) y que se crea en el primer request.
  - **Permisos**: suma que la página usa la URL de la propia implementación (`ScriptApp`) sin pedir
    otro permiso (verificado el 2026-10-05).
  - **Checklist manual**, paso 1: abrir `$URL` → la página con el nombre de la planilla, "contrato
    4.6.0" y "Conectar el POS"; el botón abre el POS en una pestaña nueva con el wizard precargado.
    Paso nuevo: en una planilla nueva, el primer request crea la pestaña Configuración al final;
    cambiar "URL del POS" y recargar la página cambia adónde lleva el botón.

- [ ] **Paso 7: verificar y commitear.** Suite completa + build, Prettier sobre el test y el README.
  Commit: `feat: la página del puente de Sheets con "Conectar el POS" (#133)`.

### Tarea 5: documentación del repo

**Archivos:** `src/connectors/AGENTS.md`, `src/sync/AGENTS.md`, `src/ui/AGENTS.md`, `AGENTS.md`.

- [ ] **Paso 1:** `src/sync/AGENTS.md`, fila de `sync/demo-link.ts` (línea ~375): `readConnectReturn`
  acepta dos formas (la vuelta del alta, REST con `wipeKey` opcional, y la de una planilla,
  `type: 'google-sheets'` + `webAppUrl` https, #133), unión discriminada.
- [ ] **Paso 2:** `src/ui/AGENTS.md`, el párrafo de `openWizardWithCandidate` (línea ~516): el link
  de una planilla siempre termina ahí (nunca prueba ni borra solo); sin sucursal, el wizard rebota
  al paso Terminal.
- [ ] **Paso 3:** `src/connectors/AGENTS.md`, la parte del puente: `doGet` es la página "Conectar el
  POS" (link con `ScriptApp.getService().getUrl()`, sin secreto) y la pestaña Configuración
  (`ensureConfigSheet`, al final, solo se crea; claves por texto; `DEFAULT_POS_URL`).
- [ ] **Paso 4:** `AGENTS.md`, sección "Onboarding de demo", una línea al final: "Sheets tiene su
  propia vuelta (#133): la página del Web App del puente abre `#connect=` con
  `{ type: 'google-sheets', webAppUrl }`, sin secreto, y el POS siempre precarga el wizard." (Estado
  del proyecto, recién después del merge.)
- [ ] **Paso 5:** Prettier sobre los cuatro `.md`, verificación completa (`pnpm lint && pnpm
  typecheck && pnpm test && pnpm build` y `pnpm test:e2e`). Commit:
  `docs: "Conectar el POS" desde la planilla (#133)`.

### Al terminar (fuera de las tareas)

- Informe final con prueba manual contra una planilla real: copia de la planilla con los `.gs`
  nuevos, nueva versión de la implementación, primer request → pestaña Configuración al final; abrir
  la URL del Web App → página; Conectar el POS → POS en pestaña nueva con el wizard en Terminal y el
  aviso; completar y aplicar; cambiar "URL del POS" (por ejemplo a `http://localhost:4173/` con
  `pnpm build && pnpm preview`) y ver que el botón la sigue; "Hacer una copia" de la planilla, implementar
  la copia y ver que su botón lleva la URL de la copia.
- Después de la revisión y sus cambios: "Estado del proyecto" en `AGENTS.md` y borrar este plan,
  en la misma rama (como en la etapa A); PR con merge commit, "Refs #180" (no lo cierra) y
  "Closes #133". Después del merge: verificar que #133 se cerró y tildar en #180 el punto 3 ("— PR #N").
