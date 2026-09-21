# Conector Google Sheets — Etapa 1 (aislado) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar el puerto `Connector` completo contra un puente HTTP de Google Apps Script, en una carpeta nueva y autocontenida (`src/connectors/google-sheets/`), sin modificar ningún archivo existente del repo.

**Architecture:** Un cliente HTTP chico (`bridge-client.ts`) envía un envelope JSON `{ action, payload, idempotencyKey?, sharedSecret? }` por `POST` con `Content-Type: text/plain` (evita el preflight CORS) y traduce la respuesta `{ ok, data } | { ok: false, error }` a `Result<T>`. `createGoogleSheetsConnector(config)` mapea cada método del puerto a una acción del puente, o lo resuelve localmente sin red (hold/release de cuenta corriente, stock). `bridge.gs` es el lado servidor (fuente versionada, no pasa por TS/Vitest).

**Tech Stack:** TypeScript estricto, Zod 4, Vitest (`vi.stubGlobal('fetch', …)`), Google Apps Script (V8) para `bridge.gs`.

**Spec:** `docs/superpowers/specs/2026-09-17-conector-sheets-y-registro-de-conectores-design.md` — vive en la rama `claude/sheets-connectors-plugins-27612e` (todavía no mergeada; leerla con `git show claude/sheets-connectors-plugins-27612e:docs/superpowers/specs/2026-09-17-conector-sheets-y-registro-de-conectores-design.md`). Issue: #67 (parte del epic #66).

## Decisiones que ajustan el spec (acordadas con el usuario el 2026-09-21)

El spec tiene tres divergencias con el código actual de `main`; este plan sigue las resoluciones de abajo, **no** el texto original del spec en estos puntos:

1. **`pushSaleVoid` faltaba en el spec.** El puerto `Connector` tiene 11 métodos, el spec listaba 10. Se agrega la acción `pushSaleVoid` al puente: marca las filas de esa venta en `Ventas` y `Pagos` con `estado = anulada` (nunca borra, RNF-07). El total por medio de `Turnos` suma solo filas `estado = cerrada`, igual que `domain/cash-session.ts::calculateCashSessionSummary` excluye ventas anuladas.
2. **`pushAccountHoldConfirm` solo recibe `{ holdId, saleId }` del puerto** (el spec asumía `customerId`/`amount`/`confirmedAt`). El payload al puente es `{ holdId, saleId }`; `bridge.gs` deriva `customerId` de la fila de `Ventas` y el monto de la fila de `Pagos` (`medio = account`) de ese `saleId`, y pone el timestamp él mismo. Si la venta todavía no llegó, responde error y el motor de sync reintenta con backoff. Limitación conocida: un fiado vendido sin red no emite `account-hold-confirm` (no hubo hold) — ese caso queda solo en `Pagos`.
3. **`unrestricted: true` NO se puebla en la Etapa 1.** `ConnectorCustomer` recién suma ese campo en la Etapa 3 (#69) y la Etapa 1 no puede tocar `sync/connector.ts`. `pullCustomers` devuelve clientes sin `unrestricted`; la Etapa 3 agrega el campo al schema y la línea `unrestricted: true` al conector, con su test.

## Global Constraints

- **No se modifica ningún archivo existente** del repo. Solo se crean archivos en `src/connectors/google-sheets/` (y este plan). Importar módulos existentes está permitido.
- `any` prohibido; `unknown` solo en la firma de algo externo validado con Zod en la línea siguiente. Nada de `unknown` propagado al dominio.
- Toda función de negocio devuelve `Result<T>`, **nunca lanza**. `try/catch` solo en el borde (`fetch`, `response.json()`).
- Códigos de error: reusar los existentes `'sync/request-failed'` (`{ status?: number; message: string }`) y `'sync/invalid-payload'` (`{ issues: { path: string; message: string }[] }`). No se agrega ningún `ErrorCode` (eso tocaría `domain/result.ts`).
- Imports con extensión `.ts`; `verbatimModuleSyntax` (usar `import type` para tipos); `exactOptionalPropertyTypes` (nunca pasar `undefined` explícito a una prop opcional — armar con spread condicional).
- Request al puente: `POST`, `Content-Type: text/plain;charset=utf-8` **exacto**, **sin headers extra** (cualquier header custom dispara preflight `OPTIONS`, que Apps Script no maneja). La `Idempotency-Key` viaja en el envelope, no como header.
- IDs nuevos generados en el cliente: `newId()` de `src/storage/ids.ts` (único punto de la app que llama `ulid()`).
- `tracksStock: false` fijo en cada producto que devuelve `pullProducts` (lo pone el conector TS, no depende de lo que mande el puente).
- Comentarios y mensajes de usuario en español, mismo estilo del repo.
- Verificación antes de cada commit: `pnpm test`, `pnpm typecheck`, `pnpm lint`.
- Commits terminan con: `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.

## File Structure

| Archivo | Responsabilidad |
|---|---|
| `src/connectors/google-sheets/config.ts` | `googleSheetsConfigSchema` (Zod) + tipo `GoogleSheetsConfig`. Local a la carpeta, no conectado a `SyncConfig` (Etapa 2). |
| `src/connectors/google-sheets/config.test.ts` | Tests del schema. |
| `src/connectors/google-sheets/bridge-client.ts` | `callBridge(config, request, dataSchema)`: arma el envelope, hace `fetch`, valida la respuesta, devuelve `Result`. Único lugar que conoce el formato del envelope. |
| `src/connectors/google-sheets/bridge-client.test.ts` | Tests del envelope y del mapeo de errores. |
| `src/connectors/google-sheets/google-sheets-connector.ts` | `createGoogleSheetsConnector(config): Connector` — mapea los 11 métodos del puerto. |
| `src/connectors/google-sheets/google-sheets-connector.test.ts` | Tests por método. |
| `src/connectors/google-sheets/bridge.gs` | Fuente del Apps Script (servidor). No corre en Vitest. |
| `src/connectors/google-sheets/README.md` | Setup del comerciante + contrato del puente + checklist de validación manual. |

`bridge.gs` no molesta a las herramientas del repo: `tsc` incluye solo `.ts/.tsx`, ESLint solo lintea `.js/.ts` y Vitest solo corre `*.test.*`/`*.spec.*` — la extensión `.gs` queda fuera de las tres. (Se confirma en el Task 4, Step 3.)

---

### Task 1: Config del conector

**Files:**
- Create: `src/connectors/google-sheets/config.ts`
- Test: `src/connectors/google-sheets/config.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `googleSheetsConfigSchema` — `z.object({ type: z.literal('google-sheets'), webAppUrl: z.url(), sharedSecret: z.string().min(1).optional() })`
  - `type GoogleSheetsConfig = z.infer<typeof googleSheetsConfigSchema>`

- [ ] **Step 1: Escribir el test que falla**

`src/connectors/google-sheets/config.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { googleSheetsConfigSchema } from './config.ts';

describe('googleSheetsConfigSchema', () => {
  it('acepta una config mínima sin secreto', () => {
    const parsed = googleSheetsConfigSchema.safeParse({
      type: 'google-sheets',
      webAppUrl: 'https://script.google.com/macros/s/abc/exec',
    });

    expect(parsed.success).toBe(true);
  });

  it('acepta un secreto compartido opcional', () => {
    const parsed = googleSheetsConfigSchema.safeParse({
      type: 'google-sheets',
      webAppUrl: 'https://script.google.com/macros/s/abc/exec',
      sharedSecret: 's3cr3t',
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.sharedSecret).toBe('s3cr3t');
    }
  });

  it('rechaza una webAppUrl que no es una URL', () => {
    const parsed = googleSheetsConfigSchema.safeParse({
      type: 'google-sheets',
      webAppUrl: 'no-es-una-url',
    });

    expect(parsed.success).toBe(false);
  });

  it('rechaza un type distinto de google-sheets', () => {
    const parsed = googleSheetsConfigSchema.safeParse({
      type: 'rest',
      webAppUrl: 'https://script.google.com/macros/s/abc/exec',
    });

    expect(parsed.success).toBe(false);
  });

  it('rechaza un secreto vacío', () => {
    const parsed = googleSheetsConfigSchema.safeParse({
      type: 'google-sheets',
      webAppUrl: 'https://script.google.com/macros/s/abc/exec',
      sharedSecret: '',
    });

    expect(parsed.success).toBe(false);
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `pnpm vitest run src/connectors/google-sheets/config.test.ts`
Expected: FAIL — no se puede resolver `./config.ts`.

- [ ] **Step 3: Implementación mínima**

`src/connectors/google-sheets/config.ts`:

```ts
import { z } from 'zod';

/**
 * Config del conector de Google Sheets. `type` es el discriminador que va a
 * usar el registro de conectores (Etapa 2, `sync/connector-registry.ts`);
 * hoy este schema es local a la carpeta y no está conectado a `SyncConfig`.
 *
 * `webAppUrl` es la URL del Apps Script desplegado como Web App ("Execute
 * as: Me", "Who has access: Anyone") — no requiere login de Google.
 * `sharedSecret` es defensa en profundidad opcional, simétrica con el
 * `apiKey` del conector REST: se manda en el envelope y `bridge.gs` lo
 * compara contra la propiedad de script `SHARED_SECRET`.
 */
export const googleSheetsConfigSchema = z.object({
  type: z.literal('google-sheets'),
  webAppUrl: z.url(),
  sharedSecret: z.string().min(1).optional(),
});

export type GoogleSheetsConfig = z.infer<typeof googleSheetsConfigSchema>;
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `pnpm vitest run src/connectors/google-sheets/config.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/connectors/google-sheets/config.ts src/connectors/google-sheets/config.test.ts
git commit -m "feat: config del conector de Google Sheets (#67)"
```

---

### Task 2: Cliente del puente (envelope + mapeo a Result)

**Files:**
- Create: `src/connectors/google-sheets/bridge-client.ts`
- Test: `src/connectors/google-sheets/bridge-client.test.ts`

**Interfaces:**
- Consumes: `GoogleSheetsConfig` (Task 1); `err`, `ok`, `Result` de `src/domain/result.ts`; `toZodIssues` de `src/domain/zod-issues.ts`.
- Produces:
  - `type BridgeRequest = { action: string; payload?: object; idempotencyKey?: string }`
  - `callBridge<S extends z.ZodType>(config: GoogleSheetsConfig, request: BridgeRequest, dataSchema: S): Promise<Result<z.infer<S>>>`
  - Contrato de respuesta esperado del puente: `{ "ok": true, "data": … } | { "ok": false, "error": "<mensaje>" }`. Las acciones de escritura responden `data: {}`.

- [ ] **Step 1: Escribir el test que falla**

`src/connectors/google-sheets/bridge-client.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { GoogleSheetsConfig } from './config.ts';
import { callBridge } from './bridge-client.ts';

const config: GoogleSheetsConfig = {
  type: 'google-sheets',
  webAppUrl: 'https://script.google.com/macros/s/abc/exec',
  sharedSecret: 's3cr3t',
};

const configWithoutSecret: GoogleSheetsConfig = {
  type: 'google-sheets',
  webAppUrl: 'https://script.google.com/macros/s/abc/exec',
};

function jsonResponse(body: unknown, init?: { status?: number; ok?: boolean }): Response {
  return {
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    statusText: 'status text',
    json: () => Promise.resolve(body),
  } as Response;
}

const dataSchema = z.object({ value: z.number() });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('callBridge — request', () => {
  it('hace POST a webAppUrl con Content-Type text/plain y el envelope completo', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true, data: { value: 1 } }));
    vi.stubGlobal('fetch', fetchMock);

    await callBridge(
      config,
      { action: 'pushSale', payload: { sale: { id: 's1' } }, idempotencyKey: 's1' },
      dataSchema,
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://script.google.com/macros/s/abc/exec');
    expect(init.method).toBe('POST');
    // Exactamente este header y ningún otro: cualquier header custom dispara preflight OPTIONS.
    expect(init.headers).toEqual({ 'Content-Type': 'text/plain;charset=utf-8' });
    expect(JSON.parse(init.body as string)).toEqual({
      action: 'pushSale',
      payload: { sale: { id: 's1' } },
      idempotencyKey: 's1',
      sharedSecret: 's3cr3t',
    });
  });

  it('omite idempotencyKey y sharedSecret si no hay, y payload default es {}', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true, data: { value: 1 } }));
    vi.stubGlobal('fetch', fetchMock);

    await callBridge(configWithoutSecret, { action: 'pullProducts' }, dataSchema);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ action: 'pullProducts', payload: {} });
  });
});

describe('callBridge — response', () => {
  it('devuelve data validada cuando el puente responde ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ ok: true, data: { value: 7 } })));

    const result = await callBridge(config, { action: 'x' }, dataSchema);

    expect(result).toEqual({ ok: true, value: { value: 7 } });
  });

  it('mapea { ok: false, error } del puente a sync/request-failed con el mensaje', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ ok: false, error: 'Venta no encontrada' })),
    );

    const result = await callBridge(config, { action: 'x' }, dataSchema);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('sync/request-failed');
      expect(result.meta).toEqual({ message: 'Venta no encontrada' });
    }
  });

  it('devuelve sync/request-failed con el status si el HTTP no es ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, { ok: false, status: 500 })));

    const result = await callBridge(config, { action: 'x' }, dataSchema);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('sync/request-failed');
      expect(result.meta).toMatchObject({ status: 500 });
    }
  });

  it('devuelve sync/request-failed si fetch rechaza (sin red)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

    const result = await callBridge(config, { action: 'x' }, dataSchema);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('sync/request-failed');
      expect(result.meta).toMatchObject({ message: 'network down' });
    }
  });

  it('devuelve sync/invalid-payload si el body no es JSON', async () => {
    const badJson = {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: () => Promise.reject(new SyntaxError('Unexpected token <')),
    } as Response;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(badJson));

    const result = await callBridge(config, { action: 'x' }, dataSchema);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('sync/invalid-payload');
    }
  });

  it('devuelve sync/invalid-payload si el envelope no tiene la forma esperada', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ hola: 'mundo' })));

    const result = await callBridge(config, { action: 'x' }, dataSchema);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('sync/invalid-payload');
    }
  });

  it('devuelve sync/invalid-payload si data no cumple el schema pedido', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ ok: true, data: { value: 'no-es-numero' } })),
    );

    const result = await callBridge(config, { action: 'x' }, dataSchema);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('sync/invalid-payload');
      expect(result.meta).toMatchObject({ issues: [{ path: 'value' }] });
    }
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `pnpm vitest run src/connectors/google-sheets/bridge-client.test.ts`
Expected: FAIL — no se puede resolver `./bridge-client.ts`.

- [ ] **Step 3: Implementación mínima**

`src/connectors/google-sheets/bridge-client.ts`:

```ts
import { z } from 'zod';
import { err, ok, type Result } from '../../domain/result.ts';
import { toZodIssues } from '../../domain/zod-issues.ts';
import type { GoogleSheetsConfig } from './config.ts';

export type BridgeRequest = {
  action: string;
  payload?: object;
  idempotencyKey?: string;
};

/**
 * Envelope de respuesta del puente. Apps Script no permite controlar el
 * código HTTP de un `doPost`, así que éxito/error viajan en el body, nunca
 * en el status — mapea directo al `Result<T>` del resto del código.
 */
const bridgeEnvelopeSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), data: z.unknown() }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);

/**
 * Único lugar que conoce el formato del envelope del puente. El *request*
 * (dato nuestro, ya tipado) no se valida; la *respuesta* sí — es externa.
 *
 * `Content-Type: text/plain;charset=utf-8` y **ningún otro header**: Apps
 * Script Web Apps no responden bien al preflight `OPTIONS` que un navegador
 * dispara para `application/json` (o cualquier header custom) cross-origin.
 * Con `text/plain` es un "simple request" sin preflight; el script parsea
 * el body con `JSON.parse(e.postData.contents)` igual. Por eso la
 * idempotency key y el secreto viajan dentro del envelope, no como headers.
 */
export async function callBridge<S extends z.ZodType>(
  config: GoogleSheetsConfig,
  request: BridgeRequest,
  dataSchema: S,
): Promise<Result<z.infer<S>>> {
  const body = {
    action: request.action,
    payload: request.payload ?? {},
    ...(request.idempotencyKey !== undefined ? { idempotencyKey: request.idempotencyKey } : {}),
    ...(config.sharedSecret !== undefined ? { sharedSecret: config.sharedSecret } : {}),
  };

  let response: Response;
  try {
    response = await fetch(config.webAppUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body),
    });
  } catch (error) {
    return err('sync/request-failed', {
      message: error instanceof Error ? error.message : String(error),
    });
  }
  if (!response.ok) {
    return err('sync/request-failed', { status: response.status, message: response.statusText });
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    return err('sync/invalid-payload', {
      issues: [{ path: '', message: 'La respuesta del puente no es JSON válido' }],
    });
  }

  const envelope = bridgeEnvelopeSchema.safeParse(json);
  if (!envelope.success) {
    return err('sync/invalid-payload', { issues: toZodIssues(envelope.error) });
  }
  if (!envelope.data.ok) {
    return err('sync/request-failed', { message: envelope.data.error });
  }

  const data = dataSchema.safeParse(envelope.data.data);
  if (!data.success) {
    return err('sync/invalid-payload', { issues: toZodIssues(data.error) });
  }
  return ok(data.data);
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `pnpm vitest run src/connectors/google-sheets/bridge-client.test.ts`
Expected: PASS (8 tests). Si `pnpm typecheck` se queja de `let json: unknown`, es el mismo patrón que `fetchJson` de `rest-fetch-connector.ts` (valor externo validado con Zod en la línea siguiente) — dejarlo así.

- [ ] **Step 5: Commit**

```bash
git add src/connectors/google-sheets/bridge-client.ts src/connectors/google-sheets/bridge-client.test.ts
git commit -m "feat: cliente del puente Apps Script con envelope y mapeo a Result (#67)"
```

---

### Task 3: Conector `createGoogleSheetsConnector`

Un solo task para los 11 métodos: el objeto tiene que satisfacer `Connector` completo para compilar, así que no se puede entregar a mitades.

**Files:**
- Create: `src/connectors/google-sheets/google-sheets-connector.ts`
- Test: `src/connectors/google-sheets/google-sheets-connector.test.ts`

**Interfaces:**
- Consumes: `callBridge` (Task 2); `GoogleSheetsConfig` (Task 1); `Connector`, `ConnectorCustomer`, `ConnectorPullResult`, `AccountHoldResult`, `connectorCustomerSchema` de `src/sync/connector.ts`; `productSchema`/`Product` de `src/domain/product.ts`; `newId` de `src/storage/ids.ts`.
- Produces: `createGoogleSheetsConnector(config: GoogleSheetsConfig): Connector`.
- Acciones del puente que este task fija (las implementa `bridge.gs` en el Task 4 — **los nombres y payloads son contrato**):

| Método del puerto | `action` | `payload` | `idempotencyKey` | `data` esperado |
|---|---|---|---|---|
| `pullProducts` | `pullProducts` | `params` (`{ since?: string }`) | — | `{ items: Product sin tracksStock[] }` |
| `pullCustomers` | `pullCustomers` | `params` | — | `{ items: ConnectorCustomer[] }` |
| `pushSale` | `pushSale` | `{ sale }` | la del motor (`sale.id`) | `{}` |
| `pushSaleVoid` | `pushSaleVoid` | `{ saleId, voidedAt, voidReason? }` | la del motor | `{}` |
| `pushCustomer` | `pushCustomer` | `{ customer }` | la del motor | `{}` |
| `pushAccountHoldConfirm` | `pushAccountHoldConfirm` | `{ holdId, saleId }` | la del motor | `{}` |
| `pushCashSession` | `pushCashSession` | `{ session }` | la del motor | `{}` |
| `requestAccountHold` | — (local) | — | — | `ok({ approved: true, holdId: newId() })` |
| `releaseAccountHold` | — (local) | — | — | `ok(undefined)` |
| `pullStock` | — (local) | — | — | `ok([])` |
| `pushStockMovement` | — (local) | — | — | `ok(undefined)` |

- [ ] **Step 1: Escribir los tests que fallan — pulls y operaciones locales**

`src/connectors/google-sheets/google-sheets-connector.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CashSession } from '../../domain/cash-session.ts';
import type { Customer } from '../../domain/customer.ts';
import type { Sale } from '../../domain/sale.ts';
import type { StockMovement } from '../../domain/stock.ts';
import type { GoogleSheetsConfig } from './config.ts';
import { createGoogleSheetsConnector } from './google-sheets-connector.ts';

const config: GoogleSheetsConfig = {
  type: 'google-sheets',
  webAppUrl: 'https://script.google.com/macros/s/abc/exec',
};

function bridgeOk(data: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: () => Promise.resolve({ ok: true, data }),
  } as Response;
}

function bridgeError(error: string): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: () => Promise.resolve({ ok: false, error }),
  } as Response;
}

/** Devuelve el envelope enviado en la llamada `index` del mock de fetch. */
function sentEnvelope(fetchMock: ReturnType<typeof vi.fn>, index = 0): Record<string, unknown> {
  const [, init] = fetchMock.mock.calls[index] as [string, RequestInit];
  return JSON.parse(init.body as string) as Record<string, unknown>;
}

const sale: Sale = {
  id: 'sale-1',
  lines: [{ kind: 'product', productId: 'p1', qty: 1, unitPrice: 100 }],
  payments: [{ method: 'cash', amount: 100 }],
  total: 100,
  status: 'closed',
  createdAt: '2026-01-01T00:00:00.000Z',
};

const customer: Customer = { id: 'c1', name: 'Ana', createdAt: '2026-01-01T00:00:00.000Z' };

const cashSession: CashSession = {
  id: 'cs-1',
  openedAt: '2026-01-01T08:00:00.000Z',
  closedAt: '2026-01-01T20:00:00.000Z',
  openingAmount: 1000,
  closingAmount: 1100,
  sales: ['sale-1'],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('pullProducts', () => {
  it('llama a la acción pullProducts con since y fuerza tracksStock: false', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      bridgeOk({
        items: [
          {
            id: 'p1',
            sku: 'SKU-1',
            barcodes: ['111'],
            name: 'Arroz 1kg',
            price: 100,
            taxRate: 0.21,
            category: 'almacen',
            tracksStock: true, // aunque el puente mande true, el conector lo pisa
          },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const connector = createGoogleSheetsConnector(config);

    const result = await connector.pullProducts({ since: 'cursor-1' });

    expect(sentEnvelope(fetchMock)).toEqual({ action: 'pullProducts', payload: { since: 'cursor-1' } });
    expect(result).toEqual({
      ok: true,
      value: {
        items: [
          {
            id: 'p1',
            sku: 'SKU-1',
            barcodes: ['111'],
            name: 'Arroz 1kg',
            price: 100,
            taxRate: 0.21,
            category: 'almacen',
            tracksStock: false,
          },
        ],
      },
    });
  });

  it('no manda since si no hay, y nunca devuelve nextCursor (pull completo)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(bridgeOk({ items: [] }));
    vi.stubGlobal('fetch', fetchMock);
    const connector = createGoogleSheetsConnector(config);

    const result = await connector.pullProducts({});

    expect(sentEnvelope(fetchMock)).toEqual({ action: 'pullProducts', payload: {} });
    expect(result).toEqual({ ok: true, value: { items: [] } });
  });

  it('devuelve sync/invalid-payload si un producto no cumple el schema', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(bridgeOk({ items: [{ id: 'p1' }] })));
    const connector = createGoogleSheetsConnector(config);

    const result = await connector.pullProducts({});

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('sync/invalid-payload');
    }
  });

  it('propaga el error del puente', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(bridgeError('Planilla ocupada')));
    const connector = createGoogleSheetsConnector(config);

    const result = await connector.pullProducts({});

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('sync/request-failed');
      expect(result.meta).toEqual({ message: 'Planilla ocupada' });
    }
  });
});

describe('pullCustomers', () => {
  it('llama a la acción pullCustomers y devuelve los clientes tal cual (sin unrestricted, eso es Etapa 3)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(bridgeOk({ items: [{ id: 'c1', name: 'Ana', phone: '1155' }] }));
    vi.stubGlobal('fetch', fetchMock);
    const connector = createGoogleSheetsConnector(config);

    const result = await connector.pullCustomers({});

    expect(sentEnvelope(fetchMock)).toEqual({ action: 'pullCustomers', payload: {} });
    expect(result).toEqual({
      ok: true,
      value: { items: [{ id: 'c1', name: 'Ana', phone: '1155' }] },
    });
  });

  it('devuelve sync/invalid-payload si un cliente no tiene name', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(bridgeOk({ items: [{ id: 'c1' }] })));
    const connector = createGoogleSheetsConnector(config);

    const result = await connector.pullCustomers({});

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('sync/invalid-payload');
    }
  });
});

describe('operaciones locales (sin red)', () => {
  it('requestAccountHold aprueba siempre con un holdId nuevo y no llama a fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const connector = createGoogleSheetsConnector(config);

    const first = await connector.requestAccountHold({ customerId: 'c1', amount: 500 }, 'k1');
    const second = await connector.requestAccountHold({ customerId: 'c1', amount: 500 }, 'k2');

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(first.value.approved).toBe(true);
      expect(second.value.approved).toBe(true);
      if (first.value.approved && second.value.approved) {
        expect(first.value.holdId.length).toBeGreaterThan(0);
        expect(first.value.holdId).not.toBe(second.value.holdId);
      }
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('releaseAccountHold, pullStock y pushStockMovement son no-ops sin red', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const connector = createGoogleSheetsConnector(config);
    const movement: StockMovement = {
      id: 'm1',
      productId: 'p1',
      delta: -1,
      reason: 'sale',
      createdAt: '2026-01-01T00:00:00.000Z',
    };

    expect(await connector.releaseAccountHold({ holdId: 'h1' }, 'k')).toEqual({
      ok: true,
      value: undefined,
    });
    expect(await connector.pullStock()).toEqual({ ok: true, value: [] });
    expect(await connector.pushStockMovement(movement, 'k')).toEqual({ ok: true, value: undefined });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Agregar los tests que fallan — pushes**

Agregar al final del mismo archivo:

```ts
describe('pushes', () => {
  it('pushSale manda { sale } con la idempotencyKey del motor', async () => {
    const fetchMock = vi.fn().mockResolvedValue(bridgeOk({}));
    vi.stubGlobal('fetch', fetchMock);
    const connector = createGoogleSheetsConnector(config);

    const result = await connector.pushSale(sale, 'sale-1');

    expect(result).toEqual({ ok: true, value: undefined });
    expect(sentEnvelope(fetchMock)).toEqual({
      action: 'pushSale',
      payload: { sale },
      idempotencyKey: 'sale-1',
    });
  });

  it('pushSaleVoid manda { saleId, voidedAt, voidReason } con su propia key', async () => {
    const fetchMock = vi.fn().mockResolvedValue(bridgeOk({}));
    vi.stubGlobal('fetch', fetchMock);
    const connector = createGoogleSheetsConnector(config);
    const params = { saleId: 'sale-1', voidedAt: '2026-01-02T00:00:00.000Z', voidReason: 'error de precio' };

    const result = await connector.pushSaleVoid(params, 'void-key-1');

    expect(result).toEqual({ ok: true, value: undefined });
    expect(sentEnvelope(fetchMock)).toEqual({
      action: 'pushSaleVoid',
      payload: params,
      idempotencyKey: 'void-key-1',
    });
  });

  it('pushCustomer manda { customer }', async () => {
    const fetchMock = vi.fn().mockResolvedValue(bridgeOk({}));
    vi.stubGlobal('fetch', fetchMock);
    const connector = createGoogleSheetsConnector(config);

    const result = await connector.pushCustomer(customer, 'c1');

    expect(result).toEqual({ ok: true, value: undefined });
    expect(sentEnvelope(fetchMock)).toEqual({
      action: 'pushCustomer',
      payload: { customer },
      idempotencyKey: 'c1',
    });
  });

  it('pushAccountHoldConfirm manda solo { holdId, saleId } (el puente deriva cliente y monto)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(bridgeOk({}));
    vi.stubGlobal('fetch', fetchMock);
    const connector = createGoogleSheetsConnector(config);

    const result = await connector.pushAccountHoldConfirm(
      { holdId: 'hold-1', saleId: 'sale-1' },
      'confirm-key-1',
    );

    expect(result).toEqual({ ok: true, value: undefined });
    expect(sentEnvelope(fetchMock)).toEqual({
      action: 'pushAccountHoldConfirm',
      payload: { holdId: 'hold-1', saleId: 'sale-1' },
      idempotencyKey: 'confirm-key-1',
    });
  });

  it('pushCashSession manda { session }', async () => {
    const fetchMock = vi.fn().mockResolvedValue(bridgeOk({}));
    vi.stubGlobal('fetch', fetchMock);
    const connector = createGoogleSheetsConnector(config);

    const result = await connector.pushCashSession(cashSession, 'cs-1');

    expect(result).toEqual({ ok: true, value: undefined });
    expect(sentEnvelope(fetchMock)).toEqual({
      action: 'pushCashSession',
      payload: { session: cashSession },
      idempotencyKey: 'cs-1',
    });
  });

  it('un push propaga el error del puente como sync/request-failed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(bridgeError('Venta no encontrada: sale-1')));
    const connector = createGoogleSheetsConnector(config);

    const result = await connector.pushAccountHoldConfirm({ holdId: 'h', saleId: 'sale-1' }, 'k');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('sync/request-failed');
      expect(result.meta).toEqual({ message: 'Venta no encontrada: sale-1' });
    }
  });

  it('un push devuelve sync/request-failed si no hay red', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    const connector = createGoogleSheetsConnector(config);

    const result = await connector.pushSale(sale, 'sale-1');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('sync/request-failed');
      expect(result.meta).toMatchObject({ message: 'network down' });
    }
  });
});
```

- [ ] **Step 3: Correr los tests y verificar que fallan**

Run: `pnpm vitest run src/connectors/google-sheets/google-sheets-connector.test.ts`
Expected: FAIL — no se puede resolver `./google-sheets-connector.ts`.

- [ ] **Step 4: Implementación**

`src/connectors/google-sheets/google-sheets-connector.ts`:

```ts
import { z } from 'zod';
import { productSchema, type Product } from '../../domain/product.ts';
import { ok, type Result } from '../../domain/result.ts';
import { newId } from '../../storage/ids.ts';
import {
  connectorCustomerSchema,
  type AccountHoldResult,
  type Connector,
  type ConnectorCustomer,
  type ConnectorPullResult,
} from '../../sync/connector.ts';
import { callBridge } from './bridge-client.ts';
import type { GoogleSheetsConfig } from './config.ts';

/** Producto tal como lo manda el puente: sin `tracksStock`, que fija este conector. */
const bridgeProductSchema = productSchema.omit({ tracksStock: true });

const productsDataSchema = z.object({ items: z.array(bridgeProductSchema) });
const customersDataSchema = z.object({ items: z.array(connectorCustomerSchema) });

/** Las acciones de escritura del puente responden `data: {}` — no hay nada que leer. */
const emptyDataSchema = z.object({});

/**
 * Implementación del puerto `Connector` contra un Apps Script Web App (ver
 * `README.md` de esta carpeta y el spec de la Etapa 1, #67). Caso de uso:
 * backend completo para un micro-comercio sin ERP — catálogo y ventas viven
 * en una planilla.
 *
 * Lo que **no** llama al puente, a propósito:
 * - `requestAccountHold`/`releaseAccountHold`: el fiado es sin bloqueo, la
 *   decisión siempre es "sí" — no vale un round-trip. Nunca hubo una
 *   reserva real que liberar.
 * - `pullStock`/`pushStockMovement`: no aplican. `pullProducts` fija
 *   `tracksStock: false`, y `storage/sale-repository.ts` solo genera
 *   movimientos para productos que trackean stock, así que
 *   `pushStockMovement` en la práctica nunca se invoca.
 *
 * `unrestricted: true` en `pullCustomers` lo agrega la Etapa 3 (#69) junto
 * con el campo en `ConnectorCustomer` — la Etapa 1 no toca `sync/`.
 */
export function createGoogleSheetsConnector(config: GoogleSheetsConfig): Connector {
  async function push(
    action: string,
    payload: object,
    idempotencyKey: string,
  ): Promise<Result<void>> {
    const result = await callBridge(config, { action, payload, idempotencyKey }, emptyDataSchema);
    if (!result.ok) {
      return result;
    }
    return ok(undefined);
  }

  return {
    async pullProducts(params): Promise<Result<ConnectorPullResult<Product>>> {
      const result = await callBridge(
        config,
        { action: 'pullProducts', payload: params },
        productsDataSchema,
      );
      if (!result.ok) {
        return result;
      }
      // Pull completo, sin delta ni cursor: la planilla de un micro-comercio es chica.
      return ok({ items: result.value.items.map((item) => ({ ...item, tracksStock: false })) });
    },

    async pullCustomers(params): Promise<Result<ConnectorPullResult<ConnectorCustomer>>> {
      const result = await callBridge(
        config,
        { action: 'pullCustomers', payload: params },
        customersDataSchema,
      );
      if (!result.ok) {
        return result;
      }
      return ok({ items: result.value.items });
    },

    pushSale(sale, idempotencyKey) {
      return push('pushSale', { sale }, idempotencyKey);
    },

    pushSaleVoid(params, idempotencyKey) {
      return push('pushSaleVoid', params, idempotencyKey);
    },

    pushCustomer(customer, idempotencyKey) {
      return push('pushCustomer', { customer }, idempotencyKey);
    },

    pushAccountHoldConfirm(params, idempotencyKey) {
      return push('pushAccountHoldConfirm', params, idempotencyKey);
    },

    pushCashSession(session, idempotencyKey) {
      return push('pushCashSession', { session }, idempotencyKey);
    },

    requestAccountHold(): Promise<Result<AccountHoldResult>> {
      return Promise.resolve(ok({ approved: true, holdId: newId() }));
    },

    releaseAccountHold(): Promise<Result<void>> {
      return Promise.resolve(ok(undefined));
    },

    pullStock() {
      return Promise.resolve(ok([]));
    },

    pushStockMovement(): Promise<Result<void>> {
      return Promise.resolve(ok(undefined));
    },
  };
}
```

- [ ] **Step 5: Correr los tests, typecheck y lint**

Run: `pnpm vitest run src/connectors/google-sheets/`
Expected: PASS (todos los tests de la carpeta).

Run: `pnpm typecheck` y `pnpm lint`
Expected: sin errores. Si TypeScript se queja de que `pushSaleVoid(params, …)` no acepta `params` como `object`, es un problema de tipado del literal de `params` (un `{ saleId; voidedAt; voidReason? }` ES asignable a `object`) — revisar el mensaje exacto antes de castear; no usar `as`.

- [ ] **Step 6: Commit**

```bash
git add src/connectors/google-sheets/google-sheets-connector.ts src/connectors/google-sheets/google-sheets-connector.test.ts
git commit -m "feat: conector de Google Sheets que implementa el puerto Connector (#67)"
```

---

### Task 4: `bridge.gs` (Apps Script)

No corre en Vitest: se valida manualmente (Task 6). Es JS plano para el motor V8 de Google — `var`/funciones, sin imports.

**Files:**
- Create: `src/connectors/google-sheets/bridge.gs`

**Interfaces:**
- Consumes: el contrato de acciones/payloads de la tabla del Task 3.
- Produces: `doPost(e)` / `doGet()` — endpoint único. Request: `{ action, payload, idempotencyKey?, sharedSecret? }`. Response: `{ ok: true, data } | { ok: false, error }` (JSON). Las acciones de escritura devuelven `data: {}`; las de pull devuelven `data: { items: [...] }`.

- [ ] **Step 1: Escribir `bridge.gs`**

`src/connectors/google-sheets/bridge.gs`:

```javascript
/**
 * Puente HTTP entre el POS y esta planilla (conector de Google Sheets, #67).
 *
 * Un solo endpoint: doPost(e). Request (Content-Type text/plain, para evitar
 * el preflight CORS que Apps Script no maneja):
 *   { action, payload, idempotencyKey?, sharedSecret? }
 * Response (siempre HTTP 200 — Apps Script no deja controlar el status):
 *   { ok: true, data } | { ok: false, error }
 *
 * Desplegar como Web App: "Execute as: Me", "Who has access: Anyone".
 * Secreto compartido opcional: propiedad de script SHARED_SECRET
 * (Project Settings > Script properties). Si existe, todo request debe
 * traer el mismo `sharedSecret`.
 *
 * Diseño: cada request toma el lock del script de punta a punta (varias
 * terminales pueden sincronizar a la vez contra la misma planilla). Las
 * lecturas también lo toman — simple y seguro para el volumen de un
 * micro-comercio.
 */

var HEADERS = {
  Productos: ['id', 'sku', 'barcodes', 'name', 'price', 'taxRate', 'category'],
  Clientes: ['id', 'name', 'document', 'phone', 'createdAt'],
  Ventas: [
    'saleId', 'fecha', 'customerId', 'linea', 'tipo', 'productId', 'descripcion', 'cantidad',
    'precioUnitario', 'descuentoTipo', 'descuentoValor', 'totalVenta', 'ajusteGlobalPct',
    'estado', 'anuladaEn', 'motivoAnulacion',
  ],
  Pagos: ['saleId', 'fecha', 'medio', 'monto', 'referencia', 'estado'],
  CuentaCorriente: ['fecha', 'holdId', 'saleId', 'customerId', 'monto'],
  Turnos: [
    'sessionId', 'abiertoEn', 'cerradoEn', 'aperturaEfectivo', 'contadoEfectivo', 'ventas',
    'cash', 'debit', 'credit', 'transfer', 'qr', 'account', 'efectivoEsperado', 'diferencia',
  ],
  _Idempotency: ['key', 'at'],
};

// Columnas que se fuerzan a texto plano: que Sheets no convierta un código de barras
// o un ISO 8601 en número/fecha.
var TEXT_COLUMNS = {
  Productos: ['id', 'sku', 'barcodes'],
  Clientes: ['id', 'document', 'phone', 'createdAt'],
  Ventas: ['saleId', 'fecha', 'customerId', 'productId', 'anuladaEn'],
  Pagos: ['saleId', 'fecha', 'referencia'],
  CuentaCorriente: ['fecha', 'holdId', 'saleId', 'customerId'],
  Turnos: ['sessionId', 'abiertoEn', 'cerradoEn'],
  _Idempotency: ['key', 'at'],
};

// Datos de prueba: solo se siembran cuando esta llamada CREA la pestaña.
var SEED = {
  Productos: [
    ['p-001', 'SKU-001', '7790001000011', 'Gaseosa cola 500ml', 1200, 0.21, 'bebidas'],
    ['p-002', 'SKU-002', '7790001000028,7790001000035', 'Alfajor triple', 900, 0.21, 'golosinas'],
    ['p-003', 'SKU-003', '7790001000042', 'Yerba 1kg', 4500, 0.21, 'almacen'],
    ['p-004', 'SKU-004', '', 'Pan (kg)', 2200, 0.105, 'panaderia'],
    ['p-005', 'SKU-005', '7790001000059', 'Agua mineral 1.5L', 1100, 0.21, 'bebidas'],
  ],
  Clientes: [
    ['c-001', 'Ana Gómez', '30111222', '1155501234', '2026-01-01T00:00:00.000Z'],
    ['c-002', 'Carlos Ruiz', '', '', '2026-01-01T00:00:00.000Z'],
    ['c-003', 'Lucía Fernández', '27333444', '1155505678', '2026-01-01T00:00:00.000Z'],
  ],
};

var ACTIONS = {
  pullProducts: pullProducts,
  pullCustomers: pullCustomers,
  pushSale: idempotent(pushSale),
  pushSaleVoid: idempotent(pushSaleVoid),
  pushCustomer: idempotent(pushCustomer),
  pushAccountHoldConfirm: idempotent(pushAccountHoldConfirm),
  pushCashSession: idempotent(pushCashSession),
};

// ---------------------------------------------------------------- entrada

function doGet() {
  // Health check para probar el despliegue desde el navegador.
  return respond({ ok: true, data: { service: 'pos-sheets-bridge' } });
}

function doPost(e) {
  var request;
  try {
    request = JSON.parse(e.postData.contents);
  } catch (error) {
    return respond({ ok: false, error: 'El body no es JSON válido' });
  }
  if (!request || typeof request.action !== 'string') {
    return respond({ ok: false, error: 'Falta action' });
  }

  var expectedSecret = PropertiesService.getScriptProperties().getProperty('SHARED_SECRET');
  if (expectedSecret && request.sharedSecret !== expectedSecret) {
    return respond({ ok: false, error: 'Secreto compartido inválido' });
  }

  var handler = ACTIONS[request.action];
  if (!handler) {
    return respond({ ok: false, error: 'Acción desconocida: ' + request.action });
  }

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
  } catch (error) {
    return respond({ ok: false, error: 'Planilla ocupada, reintentar' });
  }
  try {
    ensureSheetsExist();
    return respond({ ok: true, data: handler(request.payload || {}, request.idempotencyKey) });
  } catch (error) {
    return respond({ ok: false, error: String(error && error.message ? error.message : error) });
  } finally {
    lock.releaseLock();
  }
}

function respond(body) {
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(
    ContentService.MimeType.JSON
  );
}

// ------------------------------------------------------- auto-provisión

function ensureSheetsExist() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(HEADERS).forEach(function (name) {
    if (spreadsheet.getSheetByName(name)) {
      return;
    }
    var headers = HEADERS[name];
    var sheet = spreadsheet.insertSheet(name);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sheet.setFrozenRows(1);
    (TEXT_COLUMNS[name] || []).forEach(function (header) {
      sheet.getRange(1, headers.indexOf(header) + 1, sheet.getMaxRows(), 1).setNumberFormat('@');
    });
    if (SEED[name]) {
      appendRows(name, SEED[name]);
    }
    if (name === '_Idempotency') {
      sheet.hideSheet();
    }
  });
}

// --------------------------------------------------------------- helpers

function getSheet(name) {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
}

function appendRows(name, rows) {
  if (rows.length === 0) {
    return;
  }
  var sheet = getSheet(name);
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
}

/** Filas de datos como objetos { header: valor, _row: nº de fila en la hoja }. */
function readRows(name) {
  var sheet = getSheet(name);
  var last = sheet.getLastRow();
  if (last < 2) {
    return [];
  }
  var headers = HEADERS[name];
  return sheet
    .getRange(2, 1, last - 1, headers.length)
    .getValues()
    .map(function (values, index) {
      var row = { _row: index + 2 };
      headers.forEach(function (header, column) {
        row[header] = values[column];
      });
      return row;
    });
}

function setCells(name, rowNumber, values) {
  var sheet = getSheet(name);
  var headers = HEADERS[name];
  Object.keys(values).forEach(function (header) {
    sheet.getRange(rowNumber, headers.indexOf(header) + 1).setValue(values[header]);
  });
}

/** Devuelve un objeto sin las claves vacías — así el JSON no manda '' donde el POS espera "ausente". */
function compact(object) {
  var result = {};
  Object.keys(object).forEach(function (key) {
    var value = object[key];
    if (value !== '' && value !== null && value !== undefined) {
      result[key] = value;
    }
  });
  return result;
}

function orEmpty(value) {
  return value === undefined || value === null ? '' : value;
}

/**
 * Envuelve una acción de escritura: si la key ya está en _Idempotency responde
 * éxito sin reescribir; si no, escribe y recién ahí registra la key.
 */
function idempotent(write) {
  return function (payload, key) {
    if (!key) {
      throw new Error('Falta idempotencyKey');
    }
    if (hasKey(key)) {
      return {};
    }
    write(payload);
    appendRows('_Idempotency', [[key, new Date().toISOString()]]);
    return {};
  };
}

function hasKey(key) {
  return readRows('_Idempotency').some(function (row) {
    return String(row.key) === key;
  });
}

// ----------------------------------------------------------------- pulls

function pullProducts() {
  var items = readRows('Productos')
    .filter(function (row) {
      return row.id !== '' && row.name !== '' && !isNaN(Number(row.price));
    })
    .map(function (row) {
      return {
        id: String(row.id),
        sku: String(row.sku),
        barcodes: String(row.barcodes)
          .split(',')
          .map(function (code) {
            return code.trim();
          })
          .filter(function (code) {
            return code !== '';
          }),
        name: String(row.name),
        price: Number(row.price),
        taxRate: Number(row.taxRate),
        category: String(row.category),
      };
    });
  return { items: items };
}

function pullCustomers() {
  var items = readRows('Clientes')
    .filter(function (row) {
      return row.id !== '' && row.name !== '';
    })
    .map(function (row) {
      return compact({
        id: String(row.id),
        name: String(row.name),
        document: String(row.document),
        phone: String(row.phone),
      });
    });
  return { items: items };
}

// ---------------------------------------------------------------- pushes

function pushSale(payload) {
  var sale = payload.sale;
  if (!sale || !sale.id) {
    throw new Error('Falta sale');
  }
  var lineRows = sale.lines.map(function (line, index) {
    var discount = line.discount || {};
    return [
      sale.id, sale.createdAt, orEmpty(sale.customerId), index + 1, line.kind,
      orEmpty(line.productId), orEmpty(line.description), line.qty, line.unitPrice,
      orEmpty(discount.type), orEmpty(discount.value), sale.total,
      orEmpty(sale.globalAdjustmentPercentage), 'cerrada', '', '',
    ];
  });
  var paymentRows = sale.payments.map(function (payment) {
    return [sale.id, sale.createdAt, payment.method, payment.amount, orEmpty(payment.reference), 'cerrada'];
  });
  appendRows('Ventas', lineRows);
  appendRows('Pagos', paymentRows);
}

/** Marca (no borra, RNF-07) las filas de una venta; devuelve cuántas encontró. */
function markSaleRows(sheetName, saleId, values) {
  var count = 0;
  readRows(sheetName).forEach(function (row) {
    if (String(row.saleId) === saleId) {
      setCells(sheetName, row._row, values);
      count++;
    }
  });
  return count;
}

function pushSaleVoid(payload) {
  var found = markSaleRows('Ventas', payload.saleId, {
    estado: 'anulada',
    anuladaEn: payload.voidedAt,
    motivoAnulacion: orEmpty(payload.voidReason),
  });
  if (found === 0) {
    // La venta todavía no llegó: el motor de sync reintenta con backoff.
    throw new Error('Venta no encontrada: ' + payload.saleId);
  }
  markSaleRows('Pagos', payload.saleId, { estado: 'anulada' });
}

function pushCustomer(payload) {
  var customer = payload.customer;
  if (!customer || !customer.id) {
    throw new Error('Falta customer');
  }
  appendRows('Clientes', [
    [customer.id, customer.name, orEmpty(customer.document), orEmpty(customer.phone), customer.createdAt],
  ]);
}

/**
 * Ledger de fiado. El POS solo manda { holdId, saleId }: el cliente sale de la
 * fila de Ventas y el monto de la fila de Pagos (medio "account") de esa venta.
 */
function pushAccountHoldConfirm(payload) {
  var saleId = payload.saleId;
  var saleRow = readRows('Ventas').filter(function (row) {
    return String(row.saleId) === saleId;
  })[0];
  var paymentRow = readRows('Pagos').filter(function (row) {
    return String(row.saleId) === saleId && row.medio === 'account';
  })[0];
  if (!saleRow || !paymentRow) {
    throw new Error('Venta a cuenta no encontrada: ' + saleId);
  }
  appendRows('CuentaCorriente', [
    [new Date().toISOString(), payload.holdId, saleId, String(saleRow.customerId), Number(paymentRow.monto)],
  ]);
}

/**
 * Resumen de un turno cerrado. Suma Pagos de las ventas del turno con estado
 * "cerrada" (las anuladas no cuentan), igual que
 * domain/cash-session.ts::calculateCashSessionSummary en el POS.
 */
function pushCashSession(payload) {
  var session = payload.session;
  if (!session || !session.id) {
    throw new Error('Falta session');
  }
  var inSession = {};
  session.sales.forEach(function (id) {
    inSession[id] = true;
  });
  var totals = { cash: 0, debit: 0, credit: 0, transfer: 0, qr: 0, account: 0 };
  var countedSales = {};
  readRows('Pagos').forEach(function (row) {
    var saleId = String(row.saleId);
    if (inSession[saleId] && row.estado === 'cerrada' && totals[row.medio] !== undefined) {
      totals[row.medio] += Number(row.monto);
      countedSales[saleId] = true;
    }
  });
  var expectedCash = session.openingAmount + totals.cash;
  var counted = session.closingAmount;
  appendRows('Turnos', [
    [
      session.id, session.openedAt, orEmpty(session.closedAt), session.openingAmount, orEmpty(counted),
      Object.keys(countedSales).length,
      totals.cash, totals.debit, totals.credit, totals.transfer, totals.qr, totals.account,
      expectedCash, counted === undefined ? '' : counted - expectedCash,
    ],
  ]);
}
```

- [ ] **Step 2: Revisión manual del contrato contra el Task 3**

Verificar a ojo, punto por punto contra la tabla del Task 3: los 7 nombres de acción de `ACTIONS` coinciden exactamente con los del conector (`pullProducts`, `pullCustomers`, `pushSale`, `pushSaleVoid`, `pushCustomer`, `pushAccountHoldConfirm`, `pushCashSession`); las acciones de escritura devuelven `{}`; los pulls devuelven `{ items }`; `pushSaleVoid` lee `saleId`/`voidedAt`/`voidReason`; `pushAccountHoldConfirm` lee `holdId`/`saleId`.

- [ ] **Step 3: Confirmar que `.gs` no molesta a las herramientas del repo**

Run: `pnpm typecheck; pnpm lint; pnpm test`
Expected: los tres pasan igual que antes de agregar el archivo (`.gs` no lo levanta tsc, ESLint ni Vitest). Si alguno lo procesa y falla, agregarlo a los `ignores` correspondientes **en un commit aparte** y avisar (eso ya toca un archivo existente).

- [ ] **Step 4: Commit**

```bash
git add src/connectors/google-sheets/bridge.gs
git commit -m "feat: bridge.gs, puente Apps Script del conector de Google Sheets (#67)"
```

---

### Task 5: README del conector

**Files:**
- Create: `src/connectors/google-sheets/README.md`

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: documentación de setup (comerciante), contrato del puente (integrador/contribuidor) y el checklist de validación manual que usa el Task 6.

- [ ] **Step 1: Escribir el README**

`src/connectors/google-sheets/README.md`:

````markdown
# Conector de Google Sheets

Backend completo para un micro-comercio sin ERP: el catálogo y las ventas viven en una planilla de
Google Sheets. Implementa el puerto `Connector` (`src/sync/connector.ts`) contra un **puente Apps
Script** (`bridge.gs`) desplegado como Web App.

> Estado: Etapa 1 (#67) — el conector existe y está testeado, pero todavía **no está conectado** a
> `/CONFIG` ni al motor de sync (Etapa 2, #68).

## Setup (comerciante)

1. Hacer "Archivo > Hacer una copia" de la plantilla de planilla (viene con `bridge.gs` ya
   incrustado y datos de prueba).
2. En la copia: Extensiones > Apps Script > Implementar > Nueva implementación > **Aplicación web**:
   - "Ejecutar como": **Yo**
   - "Quién tiene acceso": **Cualquier persona**
3. Copiar la URL de la aplicación web (`https://script.google.com/macros/s/.../exec`).
4. (Opcional, recomendado) Proteger el puente con un secreto compartido: Configuración del proyecto >
   Propiedades de la secuencia de comandos > agregar `SHARED_SECRET` con el valor que quieras.
5. Pegar la URL (y el secreto, si lo pusiste) en `/CONFIG` — disponible desde la Etapa 2.

"Cualquier persona" **no** significa que cualquiera pueda editar tu planilla: el script corre con tus
permisos y solo expone las acciones de `bridge.gs`. Es la única forma de que el POS escriba sin que
nadie tenga que iniciar sesión en Google. Con `SHARED_SECRET`, además, hace falta conocer el secreto.

Si la planilla no tiene las pestañas que el puente necesita, las crea sola en el primer request (y
siembra datos de prueba en `Productos` y `Clientes`).

## Qué hace cada operación

| Operación del POS | Comportamiento |
|---|---|
| `pullProducts` | Lee `Productos` completo (sin delta). `tracksStock: false` fijo: el POS nunca bloquea una venta por falta de stock. |
| `pullCustomers` | Lee `Clientes` completo. |
| `pushSale` | Una fila por línea en `Ventas` + una fila por medio de pago en `Pagos`. |
| `pushSaleVoid` | Marca las filas de esa venta en `Ventas` y `Pagos` con `estado = anulada` (no borra). |
| `pushCustomer` | Una fila en `Clientes`. |
| `pushAccountHoldConfirm` | Una fila en `CuentaCorriente` (ledger de fiado). Cliente y monto se derivan de `Ventas`/`Pagos`. |
| `pushCashSession` | Una fila en `Turnos` con el total por medio de pago (solo ventas `cerrada` del turno) y el arqueo de efectivo. |
| `requestAccountHold` / `releaseAccountHold` | Locales, sin red: el fiado es sin bloqueo (siempre aprobado). |
| `pullStock` / `pushStockMovement` | No-ops: no aplican a este caso de uso. |

Limitaciones conocidas:
- Un fiado vendido **sin red** no genera fila en `CuentaCorriente` (no hubo hold, no hay evento de
  confirmación); sí queda en `Pagos` con `medio = account`.
- Anular una venta después de cerrado el turno no reescribe la fila ya escrita en `Turnos`.
- El balance de cada cliente no vuelve al POS: sumar `CuentaCorriente` queda del lado de la planilla.

## Contrato del puente

`POST <webAppUrl>` con `Content-Type: text/plain;charset=utf-8` (a propósito, no `application/json`:
evita el preflight `OPTIONS` que Apps Script no maneja) y body JSON:

```json
{ "action": "pushSale", "payload": { "sale": {} }, "idempotencyKey": "01J...", "sharedSecret": "..." }
```

Respuesta (siempre HTTP 200; el resultado viaja en el body):

```json
{ "ok": true, "data": {} }
{ "ok": false, "error": "mensaje" }
```

Acciones: `pullProducts`, `pullCustomers` (responden `data: { items: [...] }`); `pushSale`,
`pushSaleVoid`, `pushCustomer`, `pushAccountHoldConfirm`, `pushCashSession` (responden `data: {}`).
Las de escritura son idempotentes por `idempotencyKey` (pestaña oculta `_Idempotency`) y toman
`LockService.getScriptLock()`.

## Desarrollo

`bridge.gs` es JS plano para el motor V8 de Google — no pasa por TypeScript/Vitest/ESLint. Lo que sí
está testeado en CI es el lado TS (`bridge-client.ts`, `google-sheets-connector.ts`) con `fetch`
mockeado. **El `.gs` solo se valida contra un despliegue real:**

### Checklist de validación manual (antes de dar la Etapa 1 por cerrada)

Reemplazar `$URL` por la URL del Web App de una copia de prueba.

1. Health check: abrir `$URL` en el navegador → `{"ok":true,"data":{"service":"pos-sheets-bridge"}}`.
2. **CORS desde un navegador** (la asunción crítica del diseño). Abrir cualquier página `http(s)` (por
   ejemplo el POS con `pnpm build && pnpm preview`), DevTools > Console:
   ```js
   await (await fetch('$URL', { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
     body: JSON.stringify({ action: 'pullProducts', payload: {} }) })).json()
   ```
   Esperado: `{ ok: true, data: { items: [...] } }` **sin error de CORS ni request `OPTIONS`** en la
   pestaña Network. Si falla, el diseño de `text/plain` no alcanza: parar y revisar.
3. `pullCustomers` con la misma forma → 3 clientes de prueba, sin campos vacíos.
4. `pushSale` (una venta con 2 líneas y 2 pagos, una de `medio: "account"` con `customerId`) →
   aparecen 2 filas en `Ventas` y 2 en `Pagos`, con `estado = cerrada`.
5. Idempotencia: repetir exactamente el mismo `pushSale` (misma `idempotencyKey`) → `ok: true` y **no**
   se agregan filas.
6. `pushAccountHoldConfirm` con `{ holdId, saleId }` de esa venta → una fila en `CuentaCorriente` con
   el cliente y el monto correctos. Con un `saleId` inexistente → `ok: false`.
7. `pushSaleVoid` de esa venta → sus filas de `Ventas` y `Pagos` pasan a `estado = anulada`, con fecha
   y motivo. Con un `saleId` inexistente → `ok: false`.
8. `pushCashSession` con `sales: [<saleId>]` → una fila en `Turnos`; con la venta ya anulada, los
   totales por medio son 0 (no cuenta).
9. Secreto: setear `SHARED_SECRET`, repetir el paso 2 sin `sharedSecret` → `ok: false` "Secreto
   compartido inválido"; con el secreto correcto → `ok: true`.
10. Auto-provisión: borrar la pestaña `Turnos` y llamar cualquier acción → se recrea con headers.
11. Concurrencia (opcional): dos `pushSale` distintos disparados a la vez → ambos escritos, sin
    filas mezcladas.

Registrar el resultado de esta lista en el issue #67 antes de cerrarlo.
````

- [ ] **Step 2: Verificar formato**

Run: `pnpm format:check`
Expected: sin diferencias en los archivos nuevos. Si Prettier marca algo, correr `pnpm prettier --write src/connectors/google-sheets/` y revisar que **no** reformatee `bridge.gs` (Prettier no procesa extensiones que no conoce; si lo hiciera, agregar `*.gs` a `.prettierignore` en commit aparte y avisar, porque toca un archivo existente).

- [ ] **Step 3: Commit**

```bash
git add src/connectors/google-sheets/README.md
git commit -m "docs: README del conector de Google Sheets con contrato y checklist de validación (#67)"
```

---

### Task 6: Verificación final y validación manual contra un despliegue real

**Files:** ninguno (verificación).

- [ ] **Step 1: Verificación completa del repo**

Run: `pnpm test; pnpm typecheck; pnpm lint; pnpm format:check`
Expected: todo verde. Confirmar además que `git status` no muestra archivos existentes modificados: `git diff --stat main...HEAD` debe listar **solo** archivos nuevos bajo `src/connectors/google-sheets/` y `docs/superpowers/plans/`.

- [ ] **Step 2: Validación manual contra un despliegue real (la hace el usuario)**

Requiere una cuenta de Google — no la puede hacer un agente. Pasos: crear una planilla nueva, pegar `bridge.gs` en Extensiones > Apps Script, implementar como Web App (ver README), correr el "Checklist de validación manual" del README (11 puntos). El punto 2 (CORS desde el navegador con `text/plain`) es el que valida la asunción crítica del diseño.

Si algún punto falla: corregir `bridge.gs` (y, si el problema es de CORS/parsing, revisar `bridge-client.ts`) y volver a correr el checklist completo.

- [ ] **Step 3: Cerrar el ciclo con los issues (confirmar con el usuario antes de postear)**

Comentarios propuestos — son acciones visibles en GitHub, **no publicar sin OK explícito**:

- En #67: las dos correcciones al alcance (`pushSaleVoid` agregado; `pushAccountHoldConfirm` manda solo `{ holdId, saleId }` y el puente deriva cliente/monto) + el resultado del checklist.
- En #69: que el conector de Sheets **no** puebla `unrestricted` en la Etapa 1; la línea `unrestricted: true` en `pullCustomers` (y su test) se agrega en la Etapa 3 junto con el campo en `ConnectorCustomer`.

- [ ] **Step 4: PR**

Abrir el PR de la Etapa 1 contra `main` solo cuando el checklist manual esté completo (mismo criterio del proyecto: PR al final del alcance, merge commit normal, no squash). Cuerpo: `Closes #67`.

---

## Self-Review

**Spec coverage** (spec, sección "Etapa 1" y "Caso de uso"):
- `google-sheets-connector.ts` implementando `Connector` completo → Task 3 (11 métodos, incluido `pushSaleVoid` que el spec omitía).
- `config.ts` con `googleSheetsConfigSchema` local → Task 1.
- Tests con `fetch` mockeado, mismo patrón que `rest-fetch-connector.test.ts` → Tasks 1–3.
- `bridge.gs` (doPost, envelope, `ensureSheetsExist`, `_Idempotency`, `LockService`, secreto compartido, pestañas `Productos/Clientes/Ventas/Pagos/CuentaCorriente/Turnos/_Idempotency`, seed) → Task 4.
- `README.md` con setup del comerciante → Task 5.
- `Content-Type: text/plain` + validación de la asunción de CORS contra despliegue real → Task 2 (código y test del header exacto) y Task 6 / checklist punto 2.
- `tracksStock: false` fijo → Task 3. `requestAccountHold`/`release` locales; `pullStock`/`pushStockMovement` no-ops → Task 3.
- `pushCashSession` con total por medio calculado en el puente → Task 4.
- Sin delta real en `pullProducts` → Task 3 (nunca devuelve `nextCursor`).
- **Divergencias con el spec** (no son gaps del plan, son decisiones acordadas): `pushSaleVoid`, payload de `pushAccountHoldConfirm`, y `unrestricted` diferido a Etapa 3 — documentadas arriba.
- "No toca ningún archivo existente" → restricción global + verificación en Task 6 Step 1.

**Placeholder scan:** sin TBD/TODO ni puntos abiertos.

**Type consistency:** `callBridge(config, { action, payload?, idempotencyKey? }, dataSchema)` igual en Task 2 (definición), Task 3 (uso) y en los tests. `GoogleSheetsConfig` idéntico en Tasks 1–3. Nombres de acción idénticos entre la tabla del Task 3, `ACTIONS` del Task 4 y el contrato del README. `createGoogleSheetsConnector` idéntico en Task 3 y sus tests.
