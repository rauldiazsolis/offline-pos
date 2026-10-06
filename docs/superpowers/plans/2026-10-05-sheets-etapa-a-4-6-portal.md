# Sheets, etapa A: el puente en 4.6.0 con portal a la planilla — plan de implementación

> **Para agentes:** se ejecuta inline con superpowers:executing-plans, tarea por tarea y con
> checkpoints (convención del repo: nunca un subagente por tarea). Los pasos usan checkboxes
> (`- [ ]`).

**Objetivo:** que el puente de Google Sheets hable el contrato 4.6.0: anula cobranzas (4.3), informa
la empresa (4.5) y ofrece el portal (4.6), que desde el POS abre la planilla de origen con
`/PLANILLA`.

**Arquitectura:** `bridge.gs` declara capacidades, empresa y `portal` en `info`, suma la acción
liviana `portalLink` (la URL de la planilla) y marca las cobranzas anuladas como las ventas. En el
POS, `requestPortalLink` llama a esa acción con el cliente del puente cuando el conector es Sheets;
lo demás del portal ya es genérico.

**Stack:** Apps Script (JS plano, V8) probado con `node:vm` y la planilla falsa; TypeScript, Zod,
Vitest.

**Spec:** `docs/superpowers/specs/2026-10-05-sheets-4-6-portal-onboarding-design.md` (etapa A).

## Restricciones globales

- Todo en español: textos, comentarios, commits.
- Los comentarios nuevos de `bridge.gs` y `columnas.gs` **no citan issues** ni archivos del repo (se
  publican tal cual; la etapa C limpia los viejos y agrega el test que lo vigila).
- Permisos mínimos: nada que pida más que `@OnlyCurrentDoc` (`getName()` y `getUrl()` de la planilla
  activa no lo hacen).
- Verificación por commit: `pnpm lint; if ($?) { pnpm typecheck }; if ($?) { pnpm test }; if ($?) { pnpm build }`
  desde PowerShell (en este Windows pnpm no anda desde Bash). Formatear con Prettier solo lo que se
  toca (`pnpm exec prettier --write <archivos>`; los `.gs` no pasan por Prettier).
- Commits con heredoc desde Bash (`git commit -F - <<'EOF'`), terminando con
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Flakes conocidos: #142 (`pnpm test`), #155 y #169 (e2e): volver a correr antes de investigar.

## Archivos

| Archivo | Qué cambia |
|---|---|
| `src/connectors/google-sheets/bridge.gs` | 4.6.0: capacidades, empresa, portal, `portalLink`, cobranzas anuladas |
| `src/connectors/google-sheets/columnas.gs` | Etiquetas de Estado y Anula a en Cobranzas |
| `src/test/fake-spreadsheet.ts` | `getName()` y `getUrl()` |
| `src/connectors/google-sheets/bridge.test.ts` | Tests de lo anterior; el arnés acepta un secreto |
| `src/sync/portal-link.ts`, `src/sync/portal-link.test.ts` | El portal con el conector de Sheets |
| `src/sync/connector-registry.ts` | La descripción de Sheets sin "Sin mantenimiento" |
| `src/connectors/google-sheets/README.md`, `src/connectors/AGENTS.md`, `src/sync/AGENTS.md`, `AGENTS.md` | Docs al día |

---

### Tarea 0: rama y línea base

- [ ] **Paso 1:** desde Bash, `git switch -c claude/sheets-4-6-portal` (parte de la rama actual, que
  ya tiene `main` mergeado y la spec).
- [ ] **Paso 2:** línea base con el merge de `main`: `pnpm install` (el lockfile pudo cambiar) y
  `pnpm lint; if ($?) { pnpm typecheck }; if ($?) { pnpm test }; if ($?) { pnpm build }`.
  Esperado: verde. Si algo falla antes de tocar nada, frenar y avisar (no es de esta etapa).

---

### Tarea 1: cobranzas anuladas en la planilla (4.3.0)

**Archivos:**
- Modificar: `src/connectors/google-sheets/bridge.gs` (SCHEMA `Cobranzas`, `pushCustomerPayment`,
  `markSaleRows` → `markRows`), `src/connectors/google-sheets/columnas.gs` (`COLUMN_LABELS.Cobranzas`)
- Test: `src/connectors/google-sheets/bridge.test.ts`

**Interfaces:**
- Produce: `markRows(sheetName, key, id, values)` en `bridge.gs` (reemplaza a
  `markSaleRows(sheetName, saleId, values)`); columnas `estado` y `anulaA` (opcionales) al final de
  Cobranzas.

- [ ] **Paso 1: tests que fallan.** En `bridge.test.ts`, al final del archivo:

```ts
describe('anulación de cobranzas (4.3.0)', () => {
  const COBRANZAS_4_2_LABELS = [
    'Id de cobranza',
    'Fecha',
    'Id de cliente',
    'Medio de pago',
    'Monto',
    'Total de la cobranza',
    'Dispositivo',
    'Sucursal',
    'Punto de venta',
    'Fecha del recibo',
    'N° de recibo',
  ];

  function paymentEvent(id: string, total: number, voidsPaymentId?: string) {
    return {
      type: 'customer-payment',
      id,
      createdAt: NOW,
      origin: {},
      payment: {
        id,
        customerId: 'c-1',
        payments: [{ method: 'cash', amount: total }],
        total,
        createdAt: NOW,
        ...(voidsPaymentId !== undefined ? { voidsPaymentId } : {}),
      },
    };
  }

  function column(spreadsheet: FakeSpreadsheet, label: string): number {
    return (spreadsheet.getSheetByName('Cobranzas')?.values()[0] ?? []).indexOf(label);
  }

  it('la anulación escribe "Anula a", marca la original como anulada y el saldo vuelve a subir', () => {
    const { spreadsheet, call } = loadBridge();
    call('pushBatch', { deviceId: 'dev-1', events: [paymentEvent('cp1', 500)] }, 'lot-1');

    const response = call(
      'pushBatch',
      { deviceId: 'dev-1', events: [paymentEvent('cp2', -500, 'cp1')] },
      'lot-2',
    );

    expect(response.ok).toBe(true);
    const estado = column(spreadsheet, 'Estado');
    const anulaA = column(spreadsheet, 'Anula a');
    expect(
      table(spreadsheet, 'Cobranzas').map((row) => [row[0], row[4], row[estado], row[anulaA]]),
    ).toEqual([
      ['cp1', 500, 'Anulada', ''],
      ['cp2', -500, 'Cerrada', 'cp1'],
    ]);
    // Monto en el libro: la cobranza baja el saldo, su anulación lo sube.
    expect(table(spreadsheet, 'CuentaCorriente').map((row) => row[4])).toEqual([-500, 500]);
  });

  it('la anulación de una cobranza que la planilla no tiene no falla', () => {
    const { call } = loadBridge();

    call('pushBatch', { deviceId: 'dev-1', events: [paymentEvent('cp2', -500, 'nope')] }, 'lot-1');
    const pull = pullBatch(call, {}, ['lot-1']);

    expect((pull.data as { lots: unknown }).lots).toEqual({ 'lot-1': { status: 'ok' } });
  });

  it('una pestaña Cobranzas de 4.2.0 gana Estado y Anula a al final sin tocar lo que había', () => {
    const { spreadsheet, call } = loadBridge();
    const old = spreadsheet.addSheet('Cobranzas', [COBRANZAS_4_2_LABELS]);

    call('pushBatch', { deviceId: 'dev-1', events: [paymentEvent('cp1', 300)] }, 'lot-1');

    expect(old.values()[0]?.slice(0, 13)).toEqual([...COBRANZAS_4_2_LABELS, 'Estado', 'Anula a']);
  });
});
```

  Y ajustar los dos tests que miran el final de las filas de Cobranzas (ahora terminan en Estado y
  Anula a):
  - en `customer-payment escribe una fila por medio en Cobranzas…` (~línea 842), cada fila esperada
    suma `'Cerrada', ''` al final:

```ts
    expect(table(spreadsheet, 'Cobranzas')).toEqual([
      ['cp1', NOW, 'c-1', 'Efectivo', 300, 500, 'dev-1', '', '', '', '', 'Cerrada', ''],
      ['cp1', NOW, 'c-1', 'Código QR', 200, 500, 'dev-1', '', '', '', '', 'Cerrada', ''],
    ]);
```

  - en `escribe la fecha y el número del recibo en cada fila de la cobranza` (~línea 1142),
    `row.slice(-2)` pasa a `row.slice(9, 11)`.

- [ ] **Paso 2: correrlos y ver que fallan.**
  Run (PowerShell): `pnpm exec vitest run src/connectors/google-sheets/bridge.test.ts`
  Esperado: FAIL en los tres tests nuevos y en el de `customer-payment escribe…` (no existen las
  columnas Estado y Anula a).

- [ ] **Paso 3: las columnas.** En `bridge.gs`, `SCHEMA.Cobranzas`, después de
  `['numeroRecibo', 'integer', true],`:

```js
    // 4.3.0: la anulación de una cobranza es otra cobranza que apunta a la que anula; la original
    // queda marcada, como una venta anulada.
    ['estado', 'text', true],
    ['anulaA', 'text', true],
```

  En `columnas.gs`, `COLUMN_LABELS.Cobranzas`, después de `numeroRecibo: 'N° de recibo',`:

```js
    estado: 'Estado',
    anulaA: 'Anula a',
```

  (`VALUE_LABELS.estado` ya traduce `cerrada`/`anulada` y da el desplegable por clave de columna.)

- [ ] **Paso 4: escribir y marcar.** En `bridge.gs`, `pushCustomerPayment`: en el objeto de cada
  fila de Cobranzas, después de `numeroRecibo: …,`, agregar

```js
          estado: 'cerrada',
          anulaA: payment.voidsPaymentId,
```

  y al final de la función, después del `appendObjects('CuentaCorriente', …)`:

```js
  // 4.3.0: la original se marca, nunca se borra. Si la planilla no la tiene, no es un error: la
  // anulación ya quedó registrada.
  if (payment.voidsPaymentId) {
    markRows('Cobranzas', 'customerPaymentId', payment.voidsPaymentId, { estado: 'anulada' });
  }
```

  Reemplazar `markSaleRows` por una versión genérica:

```js
/** Marca (no borra: un evento nunca se modifica) las filas cuyo `key` es `id`; devuelve cuántas encontró. */
function markRows(sheetName, key, id, values) {
  var count = 0;
  readRows(sheetName).forEach(function (row) {
    if (String(row[key]) === id) {
      setCells(sheetName, row._row, values);
      count++;
    }
  });
  return count;
}
```

  y en `pushSale` las dos llamadas pasan a
  `markRows('Ventas', 'saleId', sale.voidsSaleId, { estado: 'anulada' });` y
  `markRows('Pagos', 'saleId', sale.voidsSaleId, { estado: 'anulada' });`.
  Verificar que no quede ninguna: `grep -n markSaleRows src/connectors/google-sheets/bridge.gs` no
  imprime nada.

- [ ] **Paso 5: correr los tests.**
  Run: `pnpm exec vitest run src/connectors/google-sheets`
  Esperado: PASS (también los de anulación de ventas, que usan `markRows`).

- [ ] **Paso 6: verificar y commitear.**
  Run: `pnpm exec prettier --write src/connectors/google-sheets/bridge.test.ts`, después
  `pnpm lint; if ($?) { pnpm typecheck }; if ($?) { pnpm test }; if ($?) { pnpm build }`

```bash
git add src/connectors/google-sheets/bridge.gs src/connectors/google-sheets/columnas.gs src/connectors/google-sheets/bridge.test.ts
git commit -F - <<'EOF'
feat(sheets): el puente marca las cobranzas anuladas, con Estado y Anula a (#180)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Tarea 2: `info` en 4.6.0 y la acción `portalLink`

**Archivos:**
- Modificar: `src/test/fake-spreadsheet.ts` (`FakeOptions`, `FakeSpreadsheet`),
  `src/connectors/google-sheets/bridge.gs` (cabecera, `infoAction`, `doPost`)
- Test: `src/connectors/google-sheets/bridge.test.ts`

**Interfaces:**
- Consume: nada de la Tarea 1.
- Produce: `info` devuelve `{ contractVersion: '4.6.0', status: 'ok', backend: { name:
  'pos-sheets-bridge', version: '4.6.0' }, capabilities: ['customer-payment-void', 'portal'],
  portal: { command: 'PLANILLA', label: 'Abrir planilla' }, company?: { name } }`; la acción
  `portalLink` devuelve `{ url }` (la Tarea 3 la llama desde el POS). `FakeOptions` gana `name?` y
  `url?`; `loadBridge(options: BridgeOptions = {}, files?)` con
  `BridgeOptions = FakeOptions & { sharedSecret?: string }`.

- [ ] **Paso 1: la planilla falsa.** En `src/test/fake-spreadsheet.ts`, en `FakeOptions`:

```ts
  /** Nombre y URL de la planilla (`getName()`, `getUrl()`). */
  name?: string;
  url?: string;
```

  y en `FakeSpreadsheet`, antes de `app()`:

```ts
  getName(): string {
    return this.options.name ?? 'Kiosco de prueba';
  }
  getUrl(): string {
    return this.options.url ?? 'https://docs.google.com/spreadsheets/d/fake/edit';
  }
```

- [ ] **Paso 2: el arnés acepta un secreto.** En `bridge.test.ts`:

```ts
type BridgeOptions = FakeOptions & { sharedSecret?: string };

function loadBridge(options: BridgeOptions = {}, files: string[] = SOURCE_FILES) {
  const { sharedSecret, ...spreadsheetOptions } = options;
  const spreadsheet = new FakeSpreadsheet(spreadsheetOptions);
```

  y el `PropertiesService` del contexto:

```ts
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (key: string) => (key === 'SHARED_SECRET' ? (sharedSecret ?? null) : null),
      }),
    },
```

- [ ] **Paso 3: tests que fallan.** En `describe('contrato 4.x (#99, #120)')`:
  - el test `la acción info devuelve la versión y el estado, sin tocar la planilla` pasa a:

```ts
  it('la acción info declara 4.6.0, sus capacidades, el portal y la planilla como empresa', () => {
    const bridge = loadBridge();

    const response = rawCall(bridge, { action: 'info', contractVersion: '4.6.0' });

    expect(response).toEqual({
      ok: true,
      data: {
        contractVersion: '4.6.0',
        status: 'ok',
        backend: { name: 'pos-sheets-bridge', version: '4.6.0' },
        capabilities: ['customer-payment-void', 'portal'],
        portal: { command: 'PLANILLA', label: 'Abrir planilla' },
        company: { name: 'Kiosco de prueba' },
      },
    });
    expect(bridge.spreadsheet.getSheetByName('Ventas')).toBeNull();
  });

  it('sin nombre de planilla, info no manda empresa', () => {
    const bridge = loadBridge({ name: '' });

    const response = rawCall(bridge, { action: 'info', contractVersion: '4.6.0' });

    expect(response.data).not.toHaveProperty('company');
  });
```

  - en `un request con otro major responde incompatible-contract…`, `contractVersion: '4.2.0'` del
    `toMatchObject` pasa a `'4.6.0'`.

  Y un `describe` nuevo al final del archivo:

```ts
describe('portal (4.6.0)', () => {
  it('portalLink devuelve la URL de la planilla, sin crear pestañas', () => {
    const bridge = loadBridge({ url: 'https://docs.google.com/spreadsheets/d/abc/edit' });

    const response = bridge.raw({ action: 'portalLink', contractVersion: '4.6.0' });

    expect(response).toEqual({
      ok: true,
      data: { url: 'https://docs.google.com/spreadsheets/d/abc/edit' },
    });
    expect(bridge.spreadsheet.sheetNames()).toEqual([]);
  });

  it('portalLink exige el secreto compartido, como las demás acciones', () => {
    const bridge = loadBridge({ sharedSecret: 's1' });

    expect(bridge.raw({ action: 'portalLink' })).toEqual({
      ok: false,
      error: 'Secreto compartido inválido',
    });
    expect(bridge.raw({ action: 'portalLink', sharedSecret: 's1' }).ok).toBe(true);
  });
});
```

- [ ] **Paso 4: correrlos y ver que fallan.**
  Run: `pnpm exec vitest run src/connectors/google-sheets/bridge.test.ts`
  Esperado: FAIL en los de `info`, incompatible y portal (versión 4.2.0, sin capacidades, acción
  desconocida).

- [ ] **Paso 5: el puente.** En `bridge.gs`, el bloque de `CONTRACT_VERSION` queda:

```js
/**
 * Versión del Connector API que habla este puente. Un request con otra versión mayor se responde
 * `incompatible-contract` sin procesar nada: el POS no recibe ack y el lote queda en su outbox hasta
 * que se redespliegue el puente.
 */
var CONTRACT_VERSION = '4.6.0';

/** Lo que el puente hace más allá del piso 4.0.0 del contrato (4.4.0). */
var CAPABILITIES = ['customer-payment-void', 'portal'];

/** El portal (4.6.0) abre esta planilla: el POS muestra el comando y el botón con esta etiqueta. */
var PORTAL = { command: 'PLANILLA', label: 'Abrir planilla' };
```

  `infoAction` (con su comentario):

```js
/**
 * Versión, estado, capacidades y portal; la empresa (4.5.0) es la planilla. La planilla nunca está
 * en mantenimiento: siempre `ok`.
 */
function infoAction() {
  var info = {
    contractVersion: CONTRACT_VERSION,
    status: 'ok',
    backend: { name: 'pos-sheets-bridge', version: CONTRACT_VERSION },
    capabilities: CAPABILITIES,
    portal: PORTAL,
  };
  var name = SpreadsheetApp.getActiveSpreadsheet().getName();
  if (name) {
    info.company = { name: name };
  }
  return info;
}
```

  En `doPost`, después del bloque de `info`:

```js
  // `portalLink` (4.6.0) también es liviano: la URL de esta planilla. No hay token que emitir:
  // abrirla ya exige una cuenta de Google con acceso.
  if (request.action === 'portalLink') {
    return respond({ ok: true, data: { url: SpreadsheetApp.getActiveSpreadsheet().getUrl() } });
  }
```

- [ ] **Paso 6: correr los tests.**
  Run: `pnpm exec vitest run src/connectors/google-sheets src/test`
  Esperado: PASS.

- [ ] **Paso 7: verificar y commitear.**
  Run: `pnpm exec prettier --write src/test/fake-spreadsheet.ts src/connectors/google-sheets/bridge.test.ts`,
  después `pnpm lint; if ($?) { pnpm typecheck }; if ($?) { pnpm test }; if ($?) { pnpm build }`

```bash
git add src/test/fake-spreadsheet.ts src/connectors/google-sheets/bridge.gs src/connectors/google-sheets/bridge.test.ts
git commit -F - <<'EOF'
feat(sheets): el puente habla 4.6.0, con capacidades, empresa y portal a la planilla (#180)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Tarea 3: el portal con el conector de Sheets, del lado del POS

**Archivos:**
- Modificar: `src/sync/portal-link.ts`, `src/sync/connector-registry.ts:95-97`
- Test: `src/sync/portal-link.test.ts`

**Interfaces:**
- Consume: la acción `portalLink` del puente (Tarea 2);
  `callBridge(config: GoogleSheetsConfig, request: BridgeRequest, dataSchema)` de
  `connectors/google-sheets/bridge-client.ts`.
- Produce: `requestPortalLink(config)` con el mismo tipo, que con `google-sheets` llama al puente.

- [ ] **Paso 1: tests que fallan.** En `src/sync/portal-link.test.ts`, borrar el test
  `un conector que no es REST no ofrece el portal y no pide nada` y agregar al final:

```ts
describe('requestPortalLink con el puente de Google Sheets (4.6.0)', () => {
  const sheets = {
    type: 'google-sheets' as const,
    webAppUrl: 'https://script.google.com/macros/s/x/exec',
    sharedSecret: 's1',
  };

  it('pide la acción portalLink al puente, con el secreto, y devuelve la URL de la planilla', async () => {
    fetchMock.mockResolvedValue(
      json(200, { ok: true, data: { url: 'https://docs.google.com/spreadsheets/d/abc/edit' } }),
    );

    const result = await requestPortalLink(sheets);

    expect(result).toEqual({
      ok: true,
      value: { url: 'https://docs.google.com/spreadsheets/d/abc/edit' },
    });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(sheets.webAppUrl);
    expect(JSON.parse(String(init?.body))).toMatchObject({
      action: 'portalLink',
      sharedSecret: 's1',
    });
  });

  it('un error del puente llega con su mensaje', async () => {
    fetchMock.mockResolvedValue(json(200, { ok: false, error: 'Secreto compartido inválido' }));

    expect(await requestPortalLink(sheets)).toEqual({
      ok: false,
      error: 'sync/remote-error',
      meta: { message: 'Secreto compartido inválido' },
    });
  });

  it('una URL que no es https es inválida', async () => {
    fetchMock.mockResolvedValue(json(200, { ok: true, data: { url: 'http://otro.x/planilla' } }));

    expect(await requestPortalLink(sheets)).toMatchObject({ error: 'sync/invalid-payload' });
  });
});
```

- [ ] **Paso 2: correrlos y ver que fallan.**
  Run: `pnpm exec vitest run src/sync/portal-link.test.ts`
  Esperado: FAIL (hoy Sheets devuelve `portal/not-offered` sin pedir nada).

- [ ] **Paso 3: implementar.** En `src/sync/portal-link.ts`:
  - importar `callBridge` de `'../connectors/google-sheets/bridge-client.ts'`;
  - después de `portalLinkSchema`, una función que normaliza el `expiresAt` opcional:

```ts
const toPortalLink = ({ url, expiresAt }: z.infer<typeof portalLinkSchema>): PortalLink => ({
  url,
  ...(expiresAt !== undefined ? { expiresAt } : {}),
});
```

  - el JSDoc de `requestPortalLink` pasa a decir: "`POST /portal-links` (4.6.0, #179): el link que el
    backend decide para la key de esta terminal; con el puente de Google Sheets, su acción
    `portalLink` (la URL de la planilla). No pasa por el puerto `Connector`. …" (el resto igual);
  - el guard del principio se reemplaza por:

```ts
  if (config.type === 'google-sheets') {
    const link = await callBridge(config, { action: 'portalLink' }, portalLinkSchema);
    return link.ok ? ok(toPortalLink(link.value)) : link;
  }
```

  - y el final del camino REST pasa a `return ok(toPortalLink(parsed.data));` (en vez de
    desestructurar a mano).

  Con los tres tipos del registro, después del `if` el tipo queda `rest | rest-demo`: un conector
  nuevo sin `baseUrl` no compila acá, que es lo buscado (obliga a decidir su portal).

- [ ] **Paso 4: la descripción en `/CONFIG`.** En `src/sync/connector-registry.ts`, sacar el
  comentario `// Congelado en el contrato 4.2 (#127)…` y dejar
  `description: 'Una planilla de Google Sheets, a través de un puente de Apps Script.',`.
  Verificar que ningún test la espere: `grep -rn "Sin mantenimiento" src e2e` no imprime nada.

- [ ] **Paso 5: correr los tests.**
  Run: `pnpm exec vitest run src/sync`
  Esperado: PASS.

- [ ] **Paso 6: verificar y commitear.**
  Run: `pnpm exec prettier --write src/sync/portal-link.ts src/sync/portal-link.test.ts src/sync/connector-registry.ts`,
  después `pnpm lint; if ($?) { pnpm typecheck }; if ($?) { pnpm test }; if ($?) { pnpm build }`

```bash
git add src/sync/portal-link.ts src/sync/portal-link.test.ts src/sync/connector-registry.ts
git commit -F - <<'EOF'
feat(sync): el portal abre la planilla con el conector de Google Sheets (#180)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Tarea 4: documentación y verificación final

**Archivos:**
- Modificar: `src/connectors/google-sheets/README.md`, `src/connectors/AGENTS.md`,
  `src/sync/AGENTS.md` (párrafo "El portal en el POS"), `AGENTS.md` (sección "Connector API")

- [ ] **Paso 1: README del conector.** Después de la sección `## Contrato 4.2.0 (#101)`, agregar:

```markdown
## Contrato 4.6.0 (#180)

- **`info` declara 4.6.0** con `capabilities: ['customer-payment-void', 'portal']`,
  `portal: { command: 'PLANILLA', label: 'Abrir planilla' }` y `company: { name }`, el nombre de la
  planilla (sin nombre, no se manda). El POS muestra la empresa en `/DIAGNOSTICO` y ofrece
  `/PLANILLA` y su botón en la barra de estado.
- **Acción `portalLink`**: sin payload, liviana como `info` (sin lock ni pestañas nuevas), pide el
  secreto como las demás. Devuelve `{ url }`, la URL de la planilla: abrirla ya exige una cuenta de
  Google con acceso, así que no hay token que emitir.
- **Anular cobranzas (4.3.0)**: la anulación llega como otra cobranza con medios y total en negativo
  y `voidsPaymentId`. Se escribe como cualquier cobranza (en `CuentaCorriente`, `-total`: el saldo
  sube), con las columnas nuevas **Estado** (`Cerrada`) y **Anula a**; las filas de la original pasan
  a Estado = Anulada. Si la planilla no la tiene, no es un error.
- **Hay que redesplegar el puente** (`bridge.gs` y `columnas.gs`) para tener el portal y anular
  cobranzas; un puente 4.2.0 sigue sincronizando (piso 4.0.0), sin esas dos cosas. Estado y Anula a
  aparecen solas al final de Cobranzas (`ensureColumns`); las filas viejas quedan con Estado vacío.
```

  Al checklist de validación manual, después del paso 21:

```markdown
22. Contrato 4.6.0: `info` responde `4.6.0` con las capacidades, el portal y el nombre de la
    planilla; en el POS, `/DIAGNOSTICO` muestra "Empresa: <nombre de la planilla>", y `/PLANILLA` (o
    el botón "Abrir planilla") abre la planilla en una pestaña nueva. Anular una cobranza desde
    `/ANULAR` escribe la fila negativa con Anula a, deja la original en Anulada y en el siguiente pull
    el saldo del cliente vuelve a subir.
```

  y la última línea del archivo suma "para el 22, en #180".

- [ ] **Paso 2: `src/connectors/AGENTS.md`.** En "Implementaciones y registro", después de
  "…Sheets procesa cada lote dentro del request: nunca informa `queued`/`processing`.", agregar:
  "Desde 4.6.0 (#180) el puente declara `customer-payment-void` y `portal` (comando `PLANILLA`) y la
  planilla como empresa; su acción liviana `portalLink` devuelve la URL de la planilla, y una
  cobranza anulada marca la original con Estado = Anulada, como una venta."

- [ ] **Paso 3: `src/sync/AGENTS.md`.** En el párrafo "El portal en el POS", el paréntesis
  "(solo `rest` y `rest-demo`; otro conector es `portal/not-offered` sin pedir nada)" pasa a
  "(`rest` y `rest-demo`; con `google-sheets`, la acción `portalLink` del puente vía `callBridge`,
  que devuelve la URL de la planilla, #180)".

- [ ] **Paso 4: `AGENTS.md`.** En "Connector API", "Un backend 4.2 (Sheets, o uno externo que todavía
  no se actualizó) vuelve a ser compatible sin tocarlo" pasa a "Un backend 4.2 (uno externo que
  todavía no se actualizó) sigue siendo compatible sin tocarlo", y después de "El puente informa su
  versión (`bridge.gs::CONTRACT_VERSION`)" agregar "(4.6.0 desde #180, con el portal a la planilla)".
  Mirar `git diff`: solo esas frases.

- [ ] **Paso 5: formatear y commitear.**
  Run: `pnpm exec prettier --write src/connectors/google-sheets/README.md src/connectors/AGENTS.md src/sync/AGENTS.md AGENTS.md`
  y revisar el diff (si reformatea tablas o párrafos ajenos, revertir esos cambios).

```bash
git add src/connectors/google-sheets/README.md src/connectors/AGENTS.md src/sync/AGENTS.md AGENTS.md
git commit -F - <<'EOF'
docs: el puente de Sheets en 4.6.0 con el portal (#180)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

- [ ] **Paso 6: verificación completa.**
  Run: `pnpm lint; if ($?) { pnpm typecheck }; if ($?) { pnpm test }; if ($?) { pnpm build }` y
  `pnpm test:e2e`. Sin e2e nuevo: la UI del portal es genérica y ya la cubre
  `e2e/demo-onboarding.spec.ts` contra el demo-backend; lo propio de Sheets es el
  puente real, que se prueba a mano.

- [ ] **Paso 7: informe final** con la prueba manual contra una planilla real (redesplegar el
  puente; `/DIAGNOSTICO` con la empresa; `/PLANILLA` y el botón; anular una cobranza y ver la
  planilla y el saldo) y esperar la revisión del usuario antes del PR.

---

### Después de la revisión (fuera de las tareas)

1. Push y PR a `main` con `Refs #180` (la etapa no cierra un issue propio), resumen y prueba manual.
   Merge commit.
2. `AGENTS.md`, "Estado del proyecto": una fila para la etapa A de #180 (PR #N) y "Siguiente" al día;
   commit en la misma rama antes del merge. Borrar este plan al cerrar la etapa (queda en el
   historial), como las etapas anteriores.
3. Tildar en #180 el ítem "Llevarlo a 4.4.0…" del punto 2, con una nota de que quedó en 4.6.0
   ("— PR #N"). El ítem "Verificar contra una planilla real" se tilda con la prueba manual del
   usuario.
