# Onboarding de demo y contrato 4.4.0 — plan de implementación

> **Para agentes:** este plan se ejecuta **inline** con `superpowers:executing-plans`, tarea por
> tarea y con checkpoints (convención del repo, `AGENTS.md` → "Cómo trabajamos"). Los pasos usan
> casillas (`- [ ]`).

**Objetivo:** un POS genérico que arranca una demo contra cualquier backend del contrato
(`?demo=true&backend=…`), lleva al usuario al alta del backend y vuelve configurado; y el contrato
4.4.0 como última versión antes del MVP (piso de versión, capacidades, `notices`, reglas de
evolución), más el arreglo de #115.

**Arquitectura:** la lectura de los links es pura y vive en `sync/` (`demo-link.ts`, validado con
Zod); los bordes (HTTP de `/demo-sessions`, `localStorage` del `wipe_key`, capacidades y avisos)
son adaptadores chicos en `sync/`; la orquestación pasa a `ui/onboarding.ts`, llamada desde
`bootstrap`. La compatibilidad deja de exigir el minor del POS y usa un piso fijo (4.0.0) más
capacidades declaradas en `GET /info`.

**Stack:** Preact + `@preact/signals`, Zod 4, Dexie, Vitest + Testing Library, Playwright; el
demo-backend es Node + `node:sqlite`, sin dependencias.

**Spec:** `docs/superpowers/specs/2026-09-28-onboarding-demo-contrato-4-4-design.md` (leerlo
antes de arrancar).

## Restricciones globales

- `POS_CONTRACT_VERSION = '4.4.0'`; `MIN_BACKEND_CONTRACT = '4.0.0'`.
- Capacidades: `'demo-sessions'` y `'customer-payment-void'`, exactamente esos strings.
- Claves de `localStorage` nuevas: `offline-pos:backend-capabilities`,
  `offline-pos:backend-notices`, `offline-pos:pending-wipe-key` (esta reemplaza a
  `pending-wipe-key`/`pending-wipe-time` sueltas; misma clave, otro formato).
- El `wipe_key` vence a las 2 h y es de un solo uso.
- `backend` del link: `https:`, o `http:` solo a `localhost`, `127.0.0.1` o `[::1]`. Misma regla para
  `onboarding.url` y para `baseUrl` de la vuelta.
- Textos (exactos): marca `DEMO`; botón `<onboarding.label> (/ALTA)`; "Esta terminal ya está
  conectada: se ignoró el link de demo."; "Esta terminal tiene datos locales: se ignoró el link de
  demo."; "La plantilla X no existe; se usó Y."; "No se pudo iniciar la demo: <motivo>";
  "El backend no permite anular cobranzas."; "Todavía no se sabe si el backend permite anular
  cobranzas: probá /SINCRONIZAR."; "Avisos (N)".
- TypeScript estricto: sin `any`; `unknown` solo en la firma de algo externo validado con Zod en la
  línea siguiente; funciones de negocio devuelven `Result<T>`; `try/catch` solo en bordes.
- `sync/` no importa de `ui/` salvo `ui/state/*` (signals), como ya hace el resto de `sync/`.
- El mini-erp y `connectors/google-sheets/bridge.gs` no se tocan. El conector TS de Sheets, solo lo
  mínimo mecánico para compilar.
- Verificación local de cada commit: `pnpm lint && pnpm typecheck && pnpm test` (y
  `pnpm --filter demo-backend test` / `typecheck` cuando se toca el demo-backend); `pnpm build` y
  `pnpm test:e2e` en las tareas que lo dicen.
- Commits en español, terminando con `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Mapa de archivos

| Archivo | Qué hace | Tarea |
|---|---|---|
| `src/domain/contract-version.ts` | Piso de compatibilidad | 1 |
| `src/sync/connector.ts` | Tolerancias, `capabilities`, `BackendNotice`, `notices` | 2 |
| `src/sync/backend-capabilities.ts` (nuevo) | Persistir y consultar capacidades | 3 |
| `src/sync/backend-notices.ts` (nuevo) | Persistir avisos, severidad máxima | 4 |
| `src/sync/pull-snapshot.ts`, `connection.ts`, `apply-connection.ts`, `engine.ts`, `backend-status.ts`, `diagnostics.ts` | Enganchar capacidades y avisos | 3, 4 |
| `src/ui/keyboard/void-controller.ts` | `/ANULAR` sin capacidad | 3 |
| `src/ui/components/StatusBar.tsx`, `src/ui/screens/diagnostico-screen.tsx` | Avisos, capacidades, DEMO | 3, 4, 8 |
| `demo-backend/src/**` | 4.4.0, templates, `/demo-sessions`, onboarding falso, avisos | 5 |
| `src/sync/demo-link.ts` (nuevo) | Leer/armar links (puro) | 6 |
| `src/sync/demo-session.ts`, `src/sync/wipe-key.ts` (nuevos) | Bordes HTTP y `localStorage` | 7 |
| `src/sync/config.ts` | `SyncConfig.demo` | 8 |
| `src/ui/keyboard/onboarding-controller.ts` (nuevo), `commands.ts`, `command-bar-controller.ts` | `/ALTA` | 8 |
| `src/ui/onboarding.ts` (nuevo), `bootstrap.ts`, `config-controller.ts`, `config-screen.tsx`, `main.tsx` | Orquestación | 9 |
| `src/sync/url-auto-config.ts`, `src/ui/state/demo-mode.ts`, `docs/url-autoconfig-handshake.md` | Se borran | 9 |
| `e2e/demo-onboarding.spec.ts` (nuevo), `playwright.config.ts`, `e2e/fixtures.ts` | e2e | 3, 10 |
| `src/storage/apply-pull.ts`, `src/sync/pull-adjust.ts`, `src/storage/reconcile.ts` | #115 | 11 |
| `docs/connector-api.openapi.yaml`, `AGENTS.md` (raíz, `src/sync`, `src/ui`, `e2e`), `docs/historia.md` | Docs | 12 |

---

### Tarea 1: compatibilidad por piso (4.0.0)

**Archivos:**
- Modificar: `src/domain/contract-version.ts`
- Modificar: `src/ui/components/StatusBar.tsx:68`, `src/ui/errors.ts:78`
- Test: `src/domain/contract-version.test.ts` (y los tests que esperen "4.3 o posterior")

**Interfaces:**
- Produce: `POS_CONTRACT_VERSION = '4.4.0'`, `MIN_BACKEND_CONTRACT = '4.0.0'`,
  `isCompatibleContract(backendVersion: string, floor?: string): boolean`,
  `contractRequirement(version: string): string` (sin cambios).

- [ ] **Paso 1: test que falla** — en `contract-version.test.ts`, reemplazar los casos de "minor
  igual o mayor que el del POS" por:

```ts
describe('isCompatibleContract (piso 4.0.0, #128)', () => {
  it.each(['4.0.0', '4.2.0', '4.3.1', '4.4.0', '4.9.0'])('%s es compatible', (version) => {
    expect(isCompatibleContract(version)).toBe(true);
  });
  it.each(['3.9.0', '5.0.0', 'x', '4.0'])('%s es incompatible', (version) => {
    expect(isCompatibleContract(version)).toBe(false);
  });
  it('el piso es 4.0.0 y el POS habla 4.4.0', () => {
    expect(MIN_BACKEND_CONTRACT).toBe('4.0.0');
    expect(POS_CONTRACT_VERSION).toBe('4.4.0');
    expect(contractRequirement(MIN_BACKEND_CONTRACT)).toBe('4.0 o posterior');
  });
});
```

- [ ] **Paso 2:** `pnpm vitest run src/domain/contract-version.test.ts` → FALLA (`4.2.0` incompatible, no existe `MIN_BACKEND_CONTRACT`).

- [ ] **Paso 3: implementación**

```ts
/**
 * Versión del Connector API que habla este POS: … 4.3.0 desde #125, 4.4.0 desde #128
 * (`POST /demo-sessions`, capacidades en `GET /info`, `notices` en el pull, reglas de evolución).
 */
export const POS_CONTRACT_VERSION = '4.4.0';

/**
 * Piso de compatibilidad (4.4.0, #128): desde acá un agregado nuevo entra como capacidad
 * (`GET /info.capabilities`), así que el POS ya no exige que el backend esté en su mismo minor.
 */
export const MIN_BACKEND_CONTRACT = '4.0.0';

/** Compatible: mismo major que el piso y minor igual o mayor. Un formato inválido es incompatible. */
export function isCompatibleContract(
  backendVersion: string,
  floor: string = MIN_BACKEND_CONTRACT,
): boolean {
  const backend = parseVersion(backendVersion);
  const min = parseVersion(floor);
  if (backend === undefined || min === undefined) {
    return false;
  }
  return backend[0] === min[0] && backend[1] >= min[1];
}
```

En `StatusBar.tsx` y `errors.ts`, `contractRequirement(POS_CONTRACT_VERSION)` /
`contractRequirement(failure.meta.pos)` pasan a `contractRequirement(MIN_BACKEND_CONTRACT)`.

- [ ] **Paso 4:** `pnpm test` → arreglar los tests que esperaban "4.3 o posterior" o
  incompatibilidad de un 4.2 (`grep -rn "o posterior\|4.2.0" src --include=*.test.*`): pasan a
  "4.0 o posterior" y a usar `3.0.0` como versión incompatible. Correr también
  `pnpm vitest run src/connectors/google-sheets` (el puente recibe `4.4.0`: mismo major).
- [ ] **Paso 5:** `pnpm lint && pnpm typecheck && pnpm test` y commit
  `feat(contrato): compatibilidad por piso 4.0.0 y POS en 4.4.0 (#128)`.

---

### Tarea 2: tolerancias, capacidades y `notices` en los schemas de red

**Archivos:**
- Modificar: `src/sync/connector.ts`
- Test: `src/sync/connector.test.ts`, `src/connectors/rest/rest-fetch-connector.test.ts`

**Interfaces:**
- Produce:
  - `BackendInfo.capabilities?: string[]`.
  - `NOTICE_SEVERITIES = ['info', 'warning', 'critical'] as const`, `NoticeSeverity`.
  - `BackendNotice = { id: string; severity: NoticeSeverity; message: string; ref?: { type: string; id: string } }`.
  - `PullBatchResult.notices?: BackendNotice[]` (ausente = el backend no mandó; se trata como `[]`).

- [ ] **Paso 1: tests que fallan** (en `connector.test.ts`):

```ts
describe('reglas de evolución (4.4.0, #128)', () => {
  const baseProduct = {
    id: 'p1', sku: 'S', barcodes: [], name: 'X', price: 1, taxRate: 0, category: 'c',
    tracksStock: true, createdAt: '2026-01-01T00:00:00Z',
  };
  const basePull = {
    products: { items: [baseProduct] },
    customers: { items: [] },
    stock: [],
    lots: {},
  };

  it('ningún schema de red es estricto: campos desconocidos en todos los niveles', () => {
    const parsed = pullBatchResponseSchema.safeParse({
      ...basePull,
      extra: 1,
      products: { items: [{ ...baseProduct, nuevo: true }], otro: 'x' },
      lots: { l1: { status: 'ok', extra: 1 } },
    });
    expect(parsed.success).toBe(true);
    expect(backendInfoSchema.safeParse({ contractVersion: '4.4.0', status: 'ok', x: 1 }).success).toBe(true);
  });

  it('status desconocido de /info → ok; capacidades opcionales', () => {
    const parsed = backendInfoSchema.parse({ contractVersion: '4.5.0', status: 'degraded', message: 'm' });
    expect(toBackendInfo(parsed)).toEqual({ contractVersion: '4.5.0', status: 'ok', message: 'm' });
    const withCaps = backendInfoSchema.parse({ contractVersion: '4.4.0', status: 'ok', capabilities: ['demo-sessions'] });
    expect(toBackendInfo(withCaps).capabilities).toEqual(['demo-sessions']);
  });

  it('estado de lote desconocido → processing', () => {
    const parsed = pullBatchResponseSchema.parse({ ...basePull, lots: { l1: { status: 'archived' } } });
    expect(toPullBatchResult(parsed).lots).toEqual({ l1: { status: 'processing' } });
  });

  it('notices: severidad desconocida → info; uno mal formado se descarta sin tirar el pull', () => {
    const parsed = pullBatchResponseSchema.parse({
      ...basePull,
      notices: [
        { id: 'n1', severity: 'fatal', message: 'a' },
        { id: 'n2', message: 42 },
        { id: 'n3', severity: 'warning', message: 'b', ref: { type: 'sale', id: 's1' } },
      ],
    });
    expect(toPullBatchResult(parsed).notices).toEqual([
      { id: 'n1', severity: 'info', message: 'a' },
      { id: 'n3', severity: 'warning', message: 'b', ref: { type: 'sale', id: 's1' } },
    ]);
  });

  it('sin notices, el resultado no trae la clave', () => {
    expect('notices' in toPullBatchResult(pullBatchResponseSchema.parse(basePull))).toBe(false);
  });
});
```

- [ ] **Paso 2:** `pnpm vitest run src/sync/connector.test.ts` → FALLA.
- [ ] **Paso 3: implementación** en `sync/connector.ts`:

```ts
// batchLotStatusSchema queda igual; en la respuesta del pull se tolera un estado desconocido:
/** 4.4.0 (#128): un estado de lote desconocido se trata como `processing` (reglas de evolución). */
const tolerantLotStatusSchema = batchLotStatusSchema.catch({ status: 'processing' as const });

export const NOTICE_SEVERITIES = ['info', 'warning', 'critical'] as const;
export type NoticeSeverity = (typeof NOTICE_SEVERITIES)[number];

/** Aviso del backend (4.4.0, #128): la lista vigente llega completa en cada pull. */
export type BackendNotice = {
  id: string;
  severity: NoticeSeverity;
  message: string;
  ref?: { type: string; id: string };
};

export const backendNoticeSchema = z.object({
  id: z.string(),
  severity: z.enum(NOTICE_SEVERITIES).catch('info'),
  message: z.string(),
  ref: z.object({ type: z.string(), id: z.string() }).optional(),
});

export const pullBatchResponseSchema = z.object({
  products: pullResultSchema(connectorProductSchema),
  customers: pullResultSchema(connectorCustomerSchema),
  stock: z.array(stockItemSchema),
  lots: z.record(z.string(), tolerantLotStatusSchema),
  // Uno mal formado se descarta solo (`null`), sin tirar el pull.
  notices: z.array(backendNoticeSchema.nullable().catch(null)).optional(),
});

function toNotices(
  notices: (z.infer<typeof backendNoticeSchema> | null)[],
): BackendNotice[] {
  return notices.flatMap((notice) =>
    notice === null
      ? []
      : [
          {
            id: notice.id,
            severity: notice.severity,
            message: notice.message,
            ...(notice.ref !== undefined ? { ref: notice.ref } : {}),
          },
        ],
  );
}
```

`toPullBatchResult` suma `...(data.notices !== undefined ? { notices: toNotices(data.notices) } : {})`;
`PullBatchResult` suma `notices?: BackendNotice[]`. `backendInfoSchema`:
`status: z.enum(['ok', 'maintenance']).catch('ok')` y `capabilities: z.array(z.string()).optional()`;
`BackendInfo` suma `capabilities?: string[]` y `toBackendInfo` la copia si viene.

- [ ] **Paso 4:** en `rest-fetch-connector.test.ts`, un caso: `/sync/pull` con `notices` los
  devuelve en el resultado (el conector ya usa `toPullBatchResult`, solo se fija). `pnpm test` → PASA.
- [ ] **Paso 5:** verificación local y commit
  `feat(contrato): tolerancias, capacidades y notices en los schemas de red (#128)`.

---

### Tarea 3: capacidades en el POS y `/ANULAR` sin `customer-payment-void`

**Archivos:**
- Crear: `src/sync/backend-capabilities.ts` + test
- Modificar: `src/ui/state/sync.ts` (signal), `src/sync/backend-status.ts`, `src/sync/pull-snapshot.ts`,
  `src/sync/connection.ts`, `src/sync/apply-connection.ts`, `src/sync/diagnostics.ts`,
  `src/ui/screens/diagnostico-screen.tsx`, `src/ui/keyboard/void-controller.ts`, `src/ui/bootstrap.ts`,
  `e2e/fixtures.ts`
- Test: `src/ui/keyboard/void-controller.test.ts`, `src/sync/backend-status.test.ts`,
  `src/sync/apply-connection.test.ts`

**Interfaces:**
- Consume: `BackendInfo.capabilities` (Tarea 2).
- Produce:
  - `CAPABILITY_DEMO_SESSIONS`, `CAPABILITY_CUSTOMER_PAYMENT_VOID`.
  - `restoreBackendCapabilities(): void` (lee `localStorage` al signal).
  - `saveBackendCapabilities(capabilities: readonly string[] | undefined): void` (`undefined` borra).
  - `supportsCapability(capabilities: readonly string[] | undefined, name: string): boolean | undefined`.
  - `backendCapabilitiesSignal: Signal<readonly string[] | undefined>` en `ui/state/sync.ts`.
  - `ProbeSnapshot.capabilities?: string[]`.

- [ ] **Paso 1: tests de `backend-capabilities.test.ts`**

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { backendCapabilitiesSignal } from '../ui/state/sync.ts';
import {
  CAPABILITY_CUSTOMER_PAYMENT_VOID,
  restoreBackendCapabilities,
  saveBackendCapabilities,
  supportsCapability,
} from './backend-capabilities.ts';

beforeEach(() => {
  localStorage.clear();
  backendCapabilitiesSignal.value = undefined;
});

describe('capacidades del backend (#128)', () => {
  it('se guardan, se restauran al arrancar y se borran con undefined', () => {
    saveBackendCapabilities(['customer-payment-void']);
    backendCapabilitiesSignal.value = undefined;
    restoreBackendCapabilities();
    expect(backendCapabilitiesSignal.value).toEqual(['customer-payment-void']);
    saveBackendCapabilities(undefined);
    expect(localStorage.getItem('offline-pos:backend-capabilities')).toBeNull();
    expect(backendCapabilitiesSignal.value).toBeUndefined();
  });
  it('un valor guardado inválido es "nunca se supo"', () => {
    localStorage.setItem('offline-pos:backend-capabilities', '{"no":"lista"}');
    restoreBackendCapabilities();
    expect(backendCapabilitiesSignal.value).toBeUndefined();
  });
  it('supportsCapability: true, false o undefined (nunca se supo)', () => {
    expect(supportsCapability(['customer-payment-void'], CAPABILITY_CUSTOMER_PAYMENT_VOID)).toBe(true);
    expect(supportsCapability([], CAPABILITY_CUSTOMER_PAYMENT_VOID)).toBe(false);
    expect(supportsCapability(undefined, CAPABILITY_CUSTOMER_PAYMENT_VOID)).toBeUndefined();
  });
});
```

- [ ] **Paso 2:** correr → FALLA (no existe el módulo).
- [ ] **Paso 3: implementación**

```ts
// src/sync/backend-capabilities.ts
import { z } from 'zod';
import { backendCapabilitiesSignal } from '../ui/state/sync.ts';

/** Capacidades del contrato 4.4.0 (#128): un backend las declara en `GET /info`. */
export const CAPABILITY_DEMO_SESSIONS = 'demo-sessions';
export const CAPABILITY_CUSTOMER_PAYMENT_VOID = 'customer-payment-void';

/**
 * Las del último `getInfo` exitoso, en `localStorage`: una terminal que arranca sin red las sabe
 * igual. Estado operativo best-effort, como los cursores: perderlo solo vuelve a "nunca se supo".
 */
const STORAGE_KEY = 'offline-pos:backend-capabilities';
const capabilitiesSchema = z.array(z.string());

export function restoreBackendCapabilities(): void {
  let raw: string | null;
  let parsedJson: unknown;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
    parsedJson = raw === null ? null : (JSON.parse(raw) as unknown);
  } catch {
    parsedJson = null;
  }
  const parsed = capabilitiesSchema.safeParse(parsedJson);
  backendCapabilitiesSignal.value = parsed.success ? parsed.data : undefined;
}

export function saveBackendCapabilities(capabilities: readonly string[] | undefined): void {
  backendCapabilitiesSignal.value = capabilities === undefined ? undefined : [...capabilities];
  try {
    if (capabilities === undefined) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(capabilities));
    }
  } catch {
    // Best-effort: el signal ya tiene el valor de esta sesión.
  }
}

/** `undefined` = nunca se supo (terminal previa a 4.4.0 que arrancó sin red). Pura. */
export function supportsCapability(
  capabilities: readonly string[] | undefined,
  name: string,
): boolean | undefined {
  return capabilities === undefined ? undefined : capabilities.includes(name);
}
```

En `ui/state/sync.ts`:
`export const backendCapabilitiesSignal = signal<readonly string[] | undefined>(undefined);`

- [ ] **Paso 4: enganches**
  - `backend-status.ts::refreshBackendStatus`, rama `result.ok`:
    `saveBackendCapabilities(result.value.capabilities ?? []);` (también con incompatible o
    mantenimiento: es lo que el backend declara).
  - `pull-snapshot.ts::ProbeSnapshot` suma `capabilities?: string[]`; `connection.ts::checkThenPull`:

```ts
  const snapshot = await pullEverything(connector);
  return snapshot.ok
    ? ok({ ...snapshot.value, capabilities: info.value.capabilities ?? [] })
    : snapshot;
```

  - `apply-connection.ts::applyConnection`, después de guardar la config:
    `saveBackendCapabilities(params.snapshot.capabilities);` (una foto sin capacidades las borra).
  - `bootstrap.ts`, antes de `startSyncEngine()`: `restoreBackendCapabilities();`.
  - `diagnostics.ts::SyncDiagnostics` suma `capabilities: readonly string[] | undefined`
    (`backendCapabilitiesSignal.value`); `diagnostico-screen.tsx`, debajo de "Backend:", una línea
    `Capacidades: {capabilities === undefined ? 'sin consultar' : capabilities.length === 0 ? 'ninguna' : capabilities.join(', ')}`.
  - Tests: `backend-status.test.ts` (un `getInfo` con `capabilities` las guarda),
    `apply-connection.test.ts` (aplicar con `snapshot.capabilities` las guarda; sin ellas, las borra).

- [ ] **Paso 5: `/ANULAR`** — en `void-controller.ts::selectForVoid`, después del chequeo de
  `candidate.state !== 'voidable'`:

```ts
  // 4.4.0 (#128): anular una cobranza necesita que el backend lo declare.
  if (candidate.kind === 'collection') {
    const supported = supportsCapability(
      backendCapabilitiesSignal.value,
      CAPABILITY_CUSTOMER_PAYMENT_VOID,
    );
    if (supported !== true) {
      voidMessageSignal.value =
        supported === false
          ? 'El backend no permite anular cobranzas.'
          : 'Todavía no se sabe si el backend permite anular cobranzas: probá /SINCRONIZAR.';
      return;
    }
  }
```

  Tests en `void-controller.test.ts`: los casos existentes que anulan cobranzas ponen
  `backendCapabilitiesSignal.value = ['customer-payment-void']` en su `beforeEach`; dos casos nuevos
  (`[]` → "El backend no permite anular cobranzas."; `undefined` → "Todavía no se sabe…"), y uno
  que muestra que una **venta** se anula igual con `[]`.
- [ ] **Paso 6:** `e2e/fixtures.ts`: el fixture `test` siembra también
  `localStorage.setItem('offline-pos:backend-capabilities', JSON.stringify(['customer-payment-void']))`
  (el backend del fixture es inalcanzable, nunca las va a informar), con un comentario del porqué.
- [ ] **Paso 7:** verificación local y commit
  `feat(anular): anular cobranzas solo con la capacidad customer-payment-void (#128)`.

---

### Tarea 4: `notices` en el POS

**Archivos:**
- Crear: `src/sync/backend-notices.ts` + test
- Modificar: `src/ui/state/sync.ts`, `src/sync/pull-snapshot.ts`, `src/sync/engine.ts`,
  `src/sync/apply-connection.ts`, `src/sync/diagnostics.ts`, `src/ui/bootstrap.ts`,
  `src/ui/components/StatusBar.tsx`, `src/ui/screens/diagnostico-screen.tsx`
- Test: `src/sync/engine.test.ts`, `src/ui/components/StatusBar.test.tsx`

**Interfaces:**
- Consume: `BackendNotice`, `NoticeSeverity`, `PullBatchResult.notices` (Tarea 2).
- Produce:
  - `backendNoticesSignal: Signal<readonly BackendNotice[]>` en `ui/state/sync.ts` (inicial `[]`).
  - `restoreBackendNotices(): void`, `saveBackendNotices(notices: readonly BackendNotice[]): void`.
  - `mostSevere(notices: readonly BackendNotice[]): NoticeSeverity | undefined`.
  - `ProbeSnapshot.notices?: BackendNotice[]`.

- [ ] **Paso 1: tests de `backend-notices.test.ts`**

```ts
describe('avisos del backend (#128)', () => {
  beforeEach(() => {
    localStorage.clear();
    backendNoticesSignal.value = [];
  });
  it('se reemplazan enteros, se persisten y se restauran', () => {
    saveBackendNotices([{ id: 'a', severity: 'info', message: 'uno' }]);
    saveBackendNotices([{ id: 'b', severity: 'warning', message: 'dos' }]);
    backendNoticesSignal.value = [];
    restoreBackendNotices();
    expect(backendNoticesSignal.value).toEqual([{ id: 'b', severity: 'warning', message: 'dos' }]);
  });
  it('lo guardado inválido se lee como sin avisos', () => {
    localStorage.setItem('offline-pos:backend-notices', 'no-json');
    restoreBackendNotices();
    expect(backendNoticesSignal.value).toEqual([]);
  });
  it('mostSevere: critical > warning > info; sin avisos, undefined', () => {
    expect(mostSevere([])).toBeUndefined();
    expect(
      mostSevere([
        { id: 'a', severity: 'info', message: '' },
        { id: 'b', severity: 'critical', message: '' },
        { id: 'c', severity: 'warning', message: '' },
      ]),
    ).toBe('critical');
  });
});
```

- [ ] **Paso 2:** correr → FALLA.
- [ ] **Paso 3: implementación** (`sync/backend-notices.ts`): mismo patrón que
  `backend-capabilities.ts` — clave `offline-pos:backend-notices`, schema
  `z.array(backendNoticeSchema)` (de `sync/connector.ts`), `restoreBackendNotices` deja `[]` si no
  hay o es inválido, `saveBackendNotices` actualiza signal y `localStorage` (best-effort), y:

```ts
const SEVERITY_RANK: Record<NoticeSeverity, number> = { info: 0, warning: 1, critical: 2 };

/** La severidad más grave de la lista, para el color de "Avisos (N)". Pura. */
export function mostSevere(notices: readonly BackendNotice[]): NoticeSeverity | undefined {
  let worst: NoticeSeverity | undefined;
  for (const notice of notices) {
    if (worst === undefined || SEVERITY_RANK[notice.severity] > SEVERITY_RANK[worst]) {
      worst = notice.severity;
    }
  }
  return worst;
}
```

- [ ] **Paso 4: enganches**
  - `pull-snapshot.ts::toProbeSnapshot` suma `...(result.notices !== undefined ? { notices: result.notices } : {})`.
  - `engine.ts::pullAndApply`, después del chequeo de `skipped` (pull aplicado):
    `saveBackendNotices(pullResult.value.notices ?? []);` — test en `engine.test.ts`: un pull con
    `notices` los deja en `backendNoticesSignal`; el siguiente sin `notices` los vacía; un pull
    fallido no los toca.
  - `apply-connection.ts::applyConnection`: `saveBackendNotices(params.snapshot.notices ?? []);`
  - `bootstrap.ts`: `restoreBackendNotices();` junto a `restoreBackendCapabilities()`.
  - `diagnostics.ts::SyncDiagnostics` suma `notices: readonly BackendNotice[]`.
- [ ] **Paso 5: barra de estado** — en `StatusBar.tsx`, primer botón del grupo de la derecha:

```tsx
const NOTICE_COLOR: Record<NoticeSeverity, string> = {
  critical: 'var(--color-danger)',
  warning: 'var(--color-chrome-warning)',
  info: 'var(--color-chrome-text-muted)',
};
// …
{backendNoticesSignal.value.length > 0 && (
  <button
    type="button"
    tabIndex={-1}
    onMouseDown={keepFocusOnMouseDown}
    onClick={(event) => {
      event.stopPropagation();
      enterDiagnosticoScreen();
    }}
    title="Ver los avisos del backend (/DIAGNOSTICO)"
    style={{ /* mismo estilo que "Sin arqueo en 24 h", con color y borde = NOTICE_COLOR[mostSevere(...)] */ }}
  >
    Avisos ({String(backendNoticesSignal.value.length)})
  </button>
)}
```

  Tests en `StatusBar.test.tsx`: sin avisos no aparece; con dos aparece "Avisos (2)" y el click
  abre `/DIAGNOSTICO` (`activeScreenSignal.value === 'diagnostico'`, como el test existente del click
  en la barra).
- [ ] **Paso 6: `/DIAGNOSTICO`** — una tarjeta nueva, después de la de lotes, siempre visible:

```tsx
<div style={cardStyle}>
  <p style={labelStyle}>Avisos del backend</p>
  {diagnostics.notices.length === 0 ? (
    <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>Sin avisos</p>
  ) : (
    diagnostics.notices.map((notice) => (
      <p key={notice.id} style={{ margin: 0 }}>
        <strong>{NOTICE_LABEL[notice.severity]}</strong> · {notice.message}
        {notice.ref !== undefined && (
          <span style={monoStyle}> ({notice.ref.type} {notice.ref.id})</span>
        )}
      </p>
    ))
  )}
</div>
```

  con `NOTICE_LABEL = { info: 'Info', warning: 'Advertencia', critical: 'Crítico' }`. Test de
  pantalla (`diagnostico-screen.test.tsx` si existe; si no, en `StatusBar.test.tsx` no) que muestre
  mensaje y `ref`.
  Además, en la misma pantalla, un `BackendInfo.message` con estado `ok` (un estado desconocido
  tratado como `ok`, Tarea 2) se muestra en `backendStatusText`: `contrato X · ok (mensaje)`.
- [ ] **Paso 7:** verificación local y commit
  `feat(sync): avisos del backend en la barra de estado y en /DIAGNOSTICO (#128)`.

---

### Tarea 5: demo-backend en 4.4.0

**Archivos:**
- Modificar: `demo-backend/src/settings.ts`, `routes/info.ts`, `routes/sync.ts`, `routes/panel.ts`,
  `panel.html`, `seed.ts`, `server.ts`
- Crear: `demo-backend/src/fixtures/almacen-products.json`, `almacen-customers.json`,
  `demo-backend/src/routes/demo-sessions.ts`, `demo-backend/src/onboarding.html`
- Test: `demo-backend/test/routes/demo-sessions.test.ts` (nuevo), `info.test.ts`, `sync.test.ts`,
  `seed.test.ts`

**Interfaces:**
- Produce (HTTP): `POST /demo-sessions`, `GET /_demo/onboarding`, `GET /info` con
  `capabilities`, `POST /sync/pull` con `notices` si el panel lo prende.
- `TEMPLATES`, `DEFAULT_TEMPLATE = 'kiosco'`, `resetToSeed(db, now, template?)`.
- Ajuste nuevo `DemoSettings.notice: { enabled: boolean; severity: 'info' | 'warning' | 'critical'; message: string }`.
- `server.ts` lee `DEMO_BACKEND_PORT` (default 4000) y `DEMO_BACKEND_DB` (default
  `data/demo.sqlite`; `:memory:` válido).

- [ ] **Paso 1: tests que fallan** — `demo-sessions.test.ts` (mismo andamiaje que `info.test.ts`,
  registrando `demoSessionRoutes`):

```ts
it('crea una demo con el template por defecto y re-siembra la base', async () => {
  const response = await fetch(`${baseUrl}/demo-sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-POS-Contract-Version': '4.4.0' },
    body: JSON.stringify({}),
  });
  expect(response.status).toBe(201);
  const body = (await response.json()) as Record<string, unknown>;
  expect(body).toMatchObject({
    apiKey: 'demo-api-key',
    branch: 'CENTRAL',
    pointOfSale: 'Caja 1',
    template: 'kiosco',
    onboarding: { url: `${baseUrl}/_demo/onboarding`, label: 'Crear mi comercio' },
  });
});

it('otro template siembra otro catálogo', async () => {
  await post('/demo-sessions', { template: 'almacen' });
  const names = listProductNames(db); // SELECT payload FROM products
  expect(names).toContain(/* un producto de almacen-products.json */);
  expect(names).not.toContain('Arroz 1kg'); // si Arroz no está en almacén; si no, otro de kiosco
});

it('template desconocido → 422 con la lista', async () => {
  const response = await post('/demo-sessions', { template: 'nope' });
  expect(response.status).toBe(422);
  expect(await response.json()).toEqual({ code: 'unknown-template', templates: ['kiosco', 'almacen'] });
});

it('no pide Authorization', async () => { /* sin header Authorization → 201 */ });

it('la página de onboarding arma la vuelta con #connect y el wipe_key', async () => {
  const html = await (
    await fetch(`${baseUrl}/_demo/onboarding?return_url=${encodeURIComponent('http://localhost:4173/')}&wipe_key=k1`)
  ).text();
  const match = /href="http:\/\/localhost:4173\/#connect=([^"]+)"/.exec(html);
  expect(match).not.toBeNull();
  const payload = JSON.parse(Buffer.from(match![1]!, 'base64url').toString('utf-8'));
  expect(payload).toEqual({
    baseUrl, apiKey: 'demo-api-key', branch: 'CENTRAL', pointOfSale: 'Caja 1', wipeKey: 'k1',
  });
  expect(html).toContain('Volver sin wipe_key');
});
```

  (sin `!` en el código real: `expect(match?.[1]).toBeDefined()` y un guard.) En `info.test.ts`:
  `capabilities` es `['demo-sessions', 'customer-payment-void']` y `contractVersion` `4.4.0`. En
  `sync.test.ts`: con `setDemoSettings(db, { notice: { enabled: true, severity: 'warning', message: 'Aviso' } })`
  el pull trae `notices: [{ id: 'demo-notice', severity: 'warning', message: 'Aviso' }]`; apagado no
  trae la clave; un push de una venta con `payments: [{ method: 'cripto', amount: 10 }]` responde
  200 y queda guardada con ese `method` (`SELECT payload FROM sales`).

- [ ] **Paso 2:** `pnpm --filter demo-backend test` → FALLA.
- [ ] **Paso 3: implementación**
  - `settings.ts`: `CONTRACT_VERSION = '4.4.0'`,
    `export const CAPABILITIES = ['demo-sessions', 'customer-payment-void'];`, `notice` en
    `DemoSettings` (default `{ enabled: false, severity: 'warning', message: '' }`) con lectura y
    escritura como `maintenance`.
  - `info.ts`: suma `capabilities: CAPABILITIES`.
  - `sync.ts` (pull): `...(notice.enabled ? { notices: [{ id: 'demo-notice', severity: notice.severity, message: notice.message }] } : {})`.
  - `seed.ts`:

```ts
import almacenCustomers from './fixtures/almacen-customers.json' with { type: 'json' };
import almacenProducts from './fixtures/almacen-products.json' with { type: 'json' };

/** Templates de `POST /demo-sessions` (4.4.0, #128): cada uno es un juego de fixtures. */
export const TEMPLATES = {
  kiosco: { products: productsFixture, customers: customersFixture },
  almacen: { products: almacenProducts, customers: almacenCustomers },
} as const;
export type TemplateName = keyof typeof TEMPLATES;
export const DEFAULT_TEMPLATE: TemplateName = 'kiosco';

export function isTemplateName(value: string): value is TemplateName {
  return Object.hasOwn(TEMPLATES, value);
}
```

    `insertSeedRows(db, now, template = DEFAULT_TEMPLATE)` usa `TEMPLATES[template]`;
    `resetToSeed(db, now, template = DEFAULT_TEMPLATE)`; `seedIfEmpty` sin cambios (default).
  - Fixtures `almacen-*`: 6 productos (ej. "Yerba 1kg", "Fideos 500g", "Aceite 900ml", "Harina
    1kg", "Leche 1L", "Galletitas") con los mismos campos que `products.json` (`initialStock`
    incluido, ids `alm-p1`…) y 2 clientes (`alm-c1` con `creditLimit`, `alm-c2` sin cuenta).
  - `routes/demo-sessions.ts`:

```ts
function requestOrigin(req: IncomingMessage): string {
  return `http://${req.headers.host ?? 'localhost:4000'}`;
}

export const demoSessionRoutes: RouteDef[] = [
  {
    method: 'POST',
    pattern: /^\/demo-sessions$/,
    requiresAuth: false,
    checksContract: true,
    handler: async (req, res, ctx) => {
      const body = (await readJsonBody(req)) as { template?: string } | undefined;
      const requested = body?.template ?? DEFAULT_TEMPLATE;
      if (!isTemplateName(requested)) {
        sendJson(res, 422, { code: 'unknown-template', templates: Object.keys(TEMPLATES) });
        return;
      }
      // Base única, de un solo comercio: cada demo pisa la anterior.
      resetToSeed(ctx.db, new Date().toISOString(), requested);
      sendJson(res, 201, {
        ...DEMO_CONNECTION,
        template: requested,
        onboarding: { url: `${requestOrigin(req)}/_demo/onboarding`, label: 'Crear mi comercio' },
      });
    },
  },
  {
    method: 'GET',
    pattern: /^\/_demo\/onboarding$/,
    requiresAuth: false,
    handler: (req, res, ctx) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderOnboardingPage(ctx.url, requestOrigin(req)));
    },
  },
];
```

    con `DEMO_CONNECTION = { apiKey: 'demo-api-key', branch: 'CENTRAL', pointOfSale: 'Caja 1' }` y
    `renderOnboardingPage(url, origin)`: lee `return_url` y `wipe_key`, arma
    `connect(withKey) = Buffer.from(JSON.stringify({ baseUrl: origin, ...DEMO_CONNECTION, ...(withKey && wipeKey ? { wipeKey } : {}) })).toString('base64url')`
    y devuelve el HTML de `onboarding.html` con los valores escapados (`&`, `<`, `>`, `"`): un
    título "Alta de comercio (demo)", la lista de lo recibido y dos links
    `<a href="{return_url}#connect=…">Crear comercio y volver al POS</a>` y
    `<a href="{return_url}#connect=…">Volver sin wipe_key</a>`. Sin `return_url`: un párrafo
    "Falta return_url." y sin links.
  - `server.ts`: `const PORT = Number(process.env.DEMO_BACKEND_PORT ?? 4000);`,
    `const dbPath = process.env.DEMO_BACKEND_DB ?? fileURLToPath(…)`, `registerRoutes(demoSessionRoutes)`.
  - `panel.ts`/`panel.html`: el `PUT /_demo/api/settings` acepta `notice`; en el panel, junto a
    mantenimiento, un checkbox "Aviso de prueba en el pull", un `<select>` de severidad y un campo de
    mensaje (mismo patrón que `maintenance`).
- [ ] **Paso 4:** `pnpm --filter demo-backend test && pnpm --filter demo-backend typecheck` → PASA.
- [ ] **Paso 5:** commit `feat(demo-backend): contrato 4.4.0, /demo-sessions con templates y onboarding falso (#128)`.

---

### Tarea 6: `sync/demo-link.ts` (lectura pura de los links)

**Archivos:**
- Crear: `src/sync/demo-link.ts`, `src/sync/demo-link.test.ts`
- Modificar: `src/domain/result.ts` (códigos), `src/ui/errors.ts` (traducciones)

**Interfaces:**
- Produce:
  - `DemoEntry = { backend: string; template?: string }`.
  - `readDemoEntry(href: string): Result<DemoEntry> | undefined` (`undefined` = no hay `demo=true`).
  - `ConnectReturn = { baseUrl: string; apiKey: string; branch: string; pointOfSale: string; wipeKey?: string }`.
  - `readConnectReturn(href: string): Result<ConnectReturn> | undefined` (`undefined` = no hay `#connect=`).
  - `isAllowedBackendUrl(raw: string): boolean`.
  - `buildOnboardingUrl(onboardingUrl: string, returnUrl: string, wipeKey: string): string`.
  - `returnUrlFor(href: string): string` (`origin + pathname`).
  - `stripOnboardingParams(href: string): string` (ruta relativa sin `demo`, `backend`, `template` ni `#connect`).
  - `ErrorMeta`: `'demo/invalid-link': { reason: 'backend-missing' | 'backend-invalid' | 'backend-insecure' }`,
    `'demo/invalid-return': { issues: { path: string; message: string }[] }`.

- [ ] **Paso 1: tests que fallan**

```ts
const encode = (value: object) => btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

describe('readDemoEntry', () => {
  it('sin demo=true no hay entrada', () => {
    expect(readDemoEntry('https://pos.x/?backend=https://b.x')).toBeUndefined();
  });
  it('https, con template y sin barra final', () => {
    expect(readDemoEntry('https://pos.x/?demo=true&backend=https://b.x/api/&template=almacen')).toEqual(
      ok({ backend: 'https://b.x/api', template: 'almacen' }),
    );
  });
  it.each(['http://localhost:4000', 'http://127.0.0.1:4000'])('http solo a localhost: %s', (backend) => {
    expect(readDemoEntry(`https://pos.x/?demo=true&backend=${backend}`)?.ok).toBe(true);
  });
  it('http a otro host es inseguro', () => {
    expect(readDemoEntry('https://pos.x/?demo=true&backend=http://b.x')).toEqual(
      err('demo/invalid-link', { reason: 'backend-insecure' }),
    );
  });
  it('sin backend o inválido', () => {
    expect(readDemoEntry('https://pos.x/?demo=true')).toEqual(err('demo/invalid-link', { reason: 'backend-missing' }));
    expect(readDemoEntry('https://pos.x/?demo=true&backend=nope')).toEqual(err('demo/invalid-link', { reason: 'backend-invalid' }));
  });
});

describe('readConnectReturn', () => {
  const payload = { baseUrl: 'https://b.x', apiKey: 'k', branch: 'CENTRAL', pointOfSale: 'Caja 1', wipeKey: 'w' };
  it('decodifica el fragmento', () => {
    expect(readConnectReturn(`https://pos.x/#connect=${encode(payload)}`)).toEqual(ok(payload));
  });
  it('sin fragmento no hay vuelta', () => {
    expect(readConnectReturn('https://pos.x/')).toBeUndefined();
  });
  it('basura o forma inválida → demo/invalid-return', () => {
    expect(readConnectReturn('https://pos.x/#connect=%%%')?.ok).toBe(false);
    expect(readConnectReturn(`https://pos.x/#connect=${encode({ apiKey: 'k' })}`)?.ok).toBe(false);
    expect(readConnectReturn(`https://pos.x/#connect=${encode({ ...payload, baseUrl: 'http://b.x' })}`)?.ok).toBe(false);
  });
  it('ignora la query string: la config nunca viaja ahí', () => {
    expect(readConnectReturn('https://pos.x/?connect=abc')).toBeUndefined();
  });
});

describe('links de ida y limpieza', () => {
  it('buildOnboardingUrl conserva la query del backend', () => {
    expect(buildOnboardingUrl('https://b.x/alta?x=1', 'https://pos.x/app/', 'w1')).toBe(
      'https://b.x/alta?x=1&return_url=https%3A%2F%2Fpos.x%2Fapp%2F&wipe_key=w1',
    );
  });
  it('returnUrlFor usa origin + pathname (anda en una subruta)', () => {
    expect(returnUrlFor('https://pos.x/app/?demo=true#connect=a')).toBe('https://pos.x/app/');
  });
  it('stripOnboardingParams saca solo lo del onboarding', () => {
    expect(stripOnboardingParams('https://pos.x/app/?demo=true&backend=b&template=t&otro=1#connect=a')).toBe('/app/?otro=1');
  });
});
```

- [ ] **Paso 2:** correr → FALLA.
- [ ] **Paso 3: implementación**

```ts
import { z } from 'zod';
import { err, ok, type Result } from '../domain/result.ts';
import { toZodIssues } from '../domain/zod-issues.ts';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** `https:`, o `http:` solo a la máquina local (desarrollo y e2e). */
export function isAllowedBackendUrl(raw: string): boolean {
  if (!URL.canParse(raw)) return false;
  const url = new URL(raw);
  return url.protocol === 'https:' || (url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname));
}

export type DemoEntry = { backend: string; template?: string };

export function readDemoEntry(href: string): Result<DemoEntry> | undefined {
  const params = new URL(href).searchParams;
  if (params.get('demo') !== 'true') return undefined;
  const raw = params.get('backend')?.trim() ?? '';
  if (raw === '') return err('demo/invalid-link', { reason: 'backend-missing' });
  if (!URL.canParse(raw) || !/^https?:$/.test(new URL(raw).protocol)) {
    return err('demo/invalid-link', { reason: 'backend-invalid' });
  }
  if (!isAllowedBackendUrl(raw)) return err('demo/invalid-link', { reason: 'backend-insecure' });
  const template = params.get('template')?.trim();
  return ok({
    backend: raw.replace(/\/+$/, ''),
    ...(template !== undefined && template !== '' ? { template } : {}),
  });
}

const allowedUrl = z.url().refine(isAllowedBackendUrl, 'Tiene que ser https (o http a localhost)');

const connectReturnSchema = z.object({
  baseUrl: allowedUrl,
  apiKey: z.string().min(1),
  branch: z.string().min(1),
  pointOfSale: z.string().min(1),
  wipeKey: z.string().min(1).optional(),
});

export type ConnectReturn = { baseUrl: string; apiKey: string; branch: string; pointOfSale: string; wipeKey?: string };

/** base64url → JSON: el único borde que lanza (`atob`, `JSON.parse`). */
function decodeBase64UrlJson(value: string): unknown {
  try {
    const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const bytes = Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    return undefined;
  }
}

export function readConnectReturn(href: string): Result<ConnectReturn> | undefined {
  const hash = new URL(href).hash.replace(/^#/, '');
  const encoded = new URLSearchParams(hash).get('connect');
  if (encoded === null) return undefined;
  const parsed = connectReturnSchema.safeParse(decodeBase64UrlJson(encoded));
  if (!parsed.success) return err('demo/invalid-return', { issues: toZodIssues(parsed.error) });
  const { wipeKey, ...connection } = parsed.data;
  return ok({ ...connection, ...(wipeKey !== undefined ? { wipeKey } : {}) });
}

export function buildOnboardingUrl(onboardingUrl: string, returnUrl: string, wipeKey: string): string {
  const url = new URL(onboardingUrl);
  url.searchParams.set('return_url', returnUrl);
  url.searchParams.set('wipe_key', wipeKey);
  return url.toString();
}

export function returnUrlFor(href: string): string {
  const url = new URL(href);
  return `${url.origin}${url.pathname}`;
}

const ONBOARDING_PARAMS = ['demo', 'backend', 'template'];

export function stripOnboardingParams(href: string): string {
  const url = new URL(href);
  for (const name of ONBOARDING_PARAMS) url.searchParams.delete(name);
  const search = url.searchParams.toString();
  const hashParams = new URLSearchParams(url.hash.replace(/^#/, ''));
  hashParams.delete('connect');
  const hash = hashParams.toString();
  return `${url.pathname}${search !== '' ? `?${search}` : ''}${hash !== '' ? `#${hash}` : ''}`;
}
```

  (`decodeBase64UrlJson` devuelve `unknown` y se valida con Zod en la línea siguiente de quien lo
  llama: cumple la regla de `unknown`.) `errors.ts`:
  `'demo/invalid-link'` → "el link no trae la dirección del backend" / "la dirección del backend no es
  válida" / "el backend tiene que ser https (o http a localhost)"; `'demo/invalid-return'` → "los
  datos de conexión que devolvió el alta no son válidos".
- [ ] **Paso 4:** correr → PASA; verificación local; commit
  `feat(onboarding): lectura pura de los links de demo y de vuelta (#128)`.

---

### Tarea 7: `POST /demo-sessions` y el `wipe_key` (bordes)

**Archivos:**
- Crear: `src/sync/demo-session.ts` + test, `src/sync/wipe-key.ts` + test
- Modificar: `src/domain/result.ts`, `src/ui/errors.ts`

**Interfaces:**
- Consume: `isAllowedBackendUrl` (Tarea 6), `CONTRACT_VERSION_HEADER`, `POS_CONTRACT_VERSION`.
- Produce:
  - `DemoSession = { apiKey: string; branch: string; pointOfSale: string; template: string; onboarding: { url: string; label: string }; baseUrl?: string }`.
  - `requestDemoSession(backend: string, template?: string): Promise<Result<DemoSession>>`.
  - `ErrorMeta`: `'demo/unknown-template': { template: string; templates: string[] }`, `'demo/not-offered': undefined`.
  - `issueWipeKey(now: Date, generate?: () => string): string`, `consumeWipeKey(candidate: string | undefined, now: Date): boolean`, `WIPE_KEY_TTL_MS = 2 * 60 * 60 * 1000`.

- [ ] **Paso 1: tests que fallan** — `demo-session.test.ts` con `vi.stubGlobal('fetch', vi.fn())`
  (patrón de `rest-fetch-connector.test.ts`):
  - 201 válido → `ok(session)`; verifica `POST https://b.x/demo-sessions`, header
    `X-POS-Contract-Version: 4.4.0`, sin `Authorization`, body `{"template":"almacen"}` (sin template:
    `{}`).
  - 422 `{ code: 'unknown-template', templates: ['kiosco'] }` → `err('demo/unknown-template', { template: 'nope', templates: ['kiosco'] })`.
  - 404 → `err('demo/not-offered', undefined)`.
  - 500 → `sync/request-failed` con `status: 500`; `fetch` que rechaza → `sync/request-failed` sin status.
  - 201 con `onboarding.url: 'http://b.x/alta'` → `sync/invalid-payload` (inseguro).

  `wipe-key.test.ts`:

```ts
const now = new Date('2026-09-28T12:00:00Z');
it('se emite, se consume una vez y no vuelve a valer', () => {
  const key = issueWipeKey(now, () => 'k1');
  expect(key).toBe('k1');
  expect(consumeWipeKey('k1', now)).toBe(true);
  expect(consumeWipeKey('k1', now)).toBe(false);
});
it('otra clave no vale y no consume la emitida', () => {
  issueWipeKey(now, () => 'k1');
  expect(consumeWipeKey('k2', now)).toBe(false);
  expect(consumeWipeKey('k1', now)).toBe(true);
});
it('vence a las 2 h', () => {
  issueWipeKey(now, () => 'k1');
  expect(consumeWipeKey('k1', new Date(now.getTime() + WIPE_KEY_TTL_MS + 1))).toBe(false);
});
it('sin clave o con lo guardado inválido, false', () => {
  expect(consumeWipeKey(undefined, now)).toBe(false);
  localStorage.setItem('offline-pos:pending-wipe-key', 'basura');
  expect(consumeWipeKey('k1', now)).toBe(false);
});
```

- [ ] **Paso 2:** correr → FALLA.
- [ ] **Paso 3: implementación**

```ts
// src/sync/demo-session.ts
const demoSessionSchema = z.object({
  apiKey: z.string().min(1),
  branch: z.string().min(1),
  pointOfSale: z.string().min(1),
  template: z.string(),
  onboarding: z.object({
    url: z.url().refine(isAllowedBackendUrl, 'Tiene que ser https (o http a localhost)'),
    label: z.string().min(1),
  }),
  baseUrl: z.url().refine(isAllowedBackendUrl).optional(),
});
const unknownTemplateSchema = z.object({ code: z.literal('unknown-template'), templates: z.array(z.string()) });

/**
 * `POST /demo-sessions` (4.4.0, #128). No pasa por el puerto `Connector`: no es sync y solo existe
 * en backends REST. Sin API key (todavía no hay). Adaptador HTTP: único try/catch, `fetch`/`json()`.
 */
export async function requestDemoSession(backend: string, template?: string): Promise<Result<DemoSession>> {
  let response: Response;
  try {
    response = await fetch(`${backend}/demo-sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', [CONTRACT_VERSION_HEADER]: POS_CONTRACT_VERSION },
      body: JSON.stringify(template !== undefined ? { template } : {}),
    });
  } catch (error) {
    return err('sync/request-failed', { message: error instanceof Error ? error.message : String(error) });
  }
  if (response.status === 404) return err('demo/not-offered', undefined);
  const body = await readJson(response); // try/catch → undefined
  if (response.status === 422) {
    const parsed = unknownTemplateSchema.safeParse(body);
    if (parsed.success) {
      return err('demo/unknown-template', { template: template ?? '', templates: parsed.data.templates });
    }
  }
  if (!response.ok) return err('sync/request-failed', { status: response.status, message: response.statusText });
  const parsed = demoSessionSchema.safeParse(body);
  if (!parsed.success) return err('sync/invalid-payload', { issues: toZodIssues(parsed.error) });
  const { baseUrl, ...session } = parsed.data;
  return ok({ ...session, ...(baseUrl !== undefined ? { baseUrl } : {}) });
}
```

```ts
// src/sync/wipe-key.ts
/**
 * `wipe_key` del onboarding (#128): lo emite esta terminal al ir al alta y, si vuelve igual, la
 * autoriza a borrar lo local (la excepción a "cambiar la conexión nunca borra solo"). Un solo uso,
 * vence a las 2 h. `localStorage` es el borde: único try/catch.
 */
const STORAGE_KEY = 'offline-pos:pending-wipe-key';
export const WIPE_KEY_TTL_MS = 2 * 60 * 60 * 1000;
const storedSchema = z.object({ key: z.string(), issuedAt: z.string() });

export function issueWipeKey(now: Date, generate: () => string = () => crypto.randomUUID()): string {
  const key = generate();
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ key, issuedAt: now.toISOString() }));
  } catch {
    // Sin localStorage no hay wipe_key: la vuelta precarga el wizard en vez de borrar.
  }
  return key;
}

export function consumeWipeKey(candidate: string | undefined, now: Date): boolean {
  if (candidate === undefined) return false;
  let stored: unknown;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    stored = raw === null ? undefined : (JSON.parse(raw) as unknown);
  } catch {
    stored = undefined;
  }
  const parsed = storedSchema.safeParse(stored);
  if (!parsed.success || parsed.data.key !== candidate) return false;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Best-effort.
  }
  return now.getTime() - Date.parse(parsed.data.issuedAt) <= WIPE_KEY_TTL_MS;
}
```

  `errors.ts`: `'demo/unknown-template'` → "La plantilla ${template} no existe (hay: ${templates.join(', ')})."; `'demo/not-offered'` → "este backend no ofrece demos".
- [ ] **Paso 4:** correr → PASA; verificación local; commit
  `feat(onboarding): POST /demo-sessions y wipe_key de un solo uso (#128)`.

---

### Tarea 8: `SyncConfig.demo`, marca DEMO y `/ALTA`

**Archivos:**
- Modificar: `src/sync/config.ts`, `src/ui/state/sync.ts`, `src/sync/apply-connection.ts`,
  `src/ui/keyboard/commands.ts`, `src/ui/keyboard/command-bar-controller.ts`,
  `src/ui/components/StatusBar.tsx`, `src/ui/bootstrap.ts`
- Crear: `src/ui/keyboard/onboarding-controller.ts` + test
- Test: `src/sync/config.test.ts`, `src/ui/keyboard/commands.test.ts` (o el que cubra `availableCommands`), `src/ui/components/StatusBar.test.tsx`

**Interfaces:**
- Consume: `issueWipeKey` (T7), `buildOnboardingUrl`, `returnUrlFor` (T6).
- Produce:
  - `DemoSessionInfo = { template: string; onboarding: { url: string; label: string }; startedAt: string }` y `SyncConfig.demo?: DemoSessionInfo`.
  - `demoSessionSignal: Signal<DemoSessionInfo | null>` y `setDemoSession(demo: DemoSessionInfo | null)` en `ui/state/sync.ts`.
  - `startOnboarding(navigate?: (url: string) => void): void`.
  - Comando `ALTA`.

- [ ] **Paso 1: tests que fallan**
  - `config.test.ts`: una config con `demo` válido se lee y se guarda igual; con `demo.onboarding.url`
    no-URL es `sync/config-invalid`.
  - `onboarding-controller.test.ts`:

```ts
it('navega al alta con return_url y un wipe_key recién emitido', () => {
  setDemoSession({ template: 'kiosco', onboarding: { url: 'https://b.x/alta', label: 'Crear' }, startedAt: 'x' });
  const navigate = vi.fn();
  startOnboarding(navigate);
  const target = new URL(navigate.mock.calls[0]?.[0] as string);
  expect(target.origin + target.pathname).toBe('https://b.x/alta');
  expect(target.searchParams.get('return_url')).toBe(returnUrlFor(window.location.href));
  expect(consumeWipeKey(target.searchParams.get('wipe_key') ?? undefined, new Date())).toBe(true);
});
it('sin demo no hace nada', () => {
  setDemoSession(null);
  const navigate = vi.fn();
  startOnboarding(navigate);
  expect(navigate).not.toHaveBeenCalled();
});
```

  - Comandos: con `demoSessionSignal` `null`, `availableCommands()` no trae `ALTA` y `/ALTA` da
    "Comando desconocido: /ALTA"; con demo, lo trae con descripción `Darse de alta: Crear mi comercio`.
  - `StatusBar.test.tsx`: reemplazar "convive con el botón de modo demo" por: con demo se ven `DEMO` y
    el botón "Crear mi comercio (/ALTA)"; el click llama a `startOnboarding` (espiar el módulo con
    `vi.mock('../keyboard/onboarding-controller.ts')`) y no abre `/DIAGNOSTICO`.
- [ ] **Paso 2:** correr → FALLA.
- [ ] **Paso 3: implementación**
  - `sync/config.ts`:

```ts
/** Terminal en demo (#128): lo que devolvió `POST /demo-sessions`, para la marca y `/ALTA`. */
export const demoSessionInfoSchema = z.object({
  template: z.string(),
  onboarding: z.object({ url: z.url(), label: z.string() }),
  startedAt: z.string(),
});
export type DemoSessionInfo = z.infer<typeof demoSessionInfoSchema>;
```

    y `demo: demoSessionInfoSchema.optional()` en el objeto de terminal de `syncConfigSchema`.
  - `ui/state/sync.ts`: `demoSessionSignal` + `setDemoSession`.
  - `apply-connection.ts::applyConnection`: `setDemoSession(params.candidate.demo ?? null);` junto a
    `setActiveConnectorType` (aplicar otra conexión desde `/CONFIG` sale de la demo: el wizard arma
    el candidato sin `demo`). `applyTerminalSettings` ya conserva `demo` (`...current.value`).
  - `bootstrap.ts`: `setDemoSession(state === 'active' && configResult.ok ? configResult.value.demo ?? null : null);`.
  - `onboarding-controller.ts`:

```ts
/**
 * `/ALTA` y el botón de la barra de estado (#128): emite el `wipe_key` y lleva al alta del backend,
 * que vuelve al POS con `#connect=…`. `return_url` sale de la URL actual: nada fijo en el código.
 */
export function startOnboarding(
  navigate: (url: string) => void = (url) => {
    window.location.assign(url);
  },
): void {
  const demo = demoSessionSignal.value;
  if (demo === null) return;
  const wipeKey = issueWipeKey(new Date());
  navigate(buildOnboardingUrl(demo.onboarding.url, returnUrlFor(window.location.href), wipeKey));
}
```

  - `commands.ts::availableCommands()`: `const demo = demoSessionSignal.value;` y, si no es `null`,
    agrega `{ name: 'ALTA', description: `Darse de alta: ${demo.onboarding.label}` }` después de
    `CORE_COMMANDS`.
  - `command-bar-controller.ts::runCommand`: `case 'ALTA':` → si `demoSessionSignal.value === null`,
    `commandBarErrorSignal.value = 'Comando desconocido: /ALTA'`; si no, `clearBuffer(); startOnboarding();`.
  - `StatusBar.tsx`: se borra el botón viejo (🚀, "Conectar Mini-ERP", `isDemoModeSignal`). Con demo:

```tsx
{demo !== null && (
  <>
    <span style={{ fontWeight: 'bold', color: 'var(--color-chrome-warning)', letterSpacing: '0.05em' }}>DEMO</span>
    <button
      type="button"
      tabIndex={-1}
      class="btn-primary"
      onMouseDown={keepFocusOnMouseDown}
      onClick={(event) => {
        event.stopPropagation();
        startOnboarding();
      }}
      title={`${demo.onboarding.label} (/ALTA)`}
      style={{ padding: '2px 8px', fontSize: 'var(--font-size-xs, 12px)' }}
    >
      {demo.onboarding.label} (/ALTA)
    </button>
  </>
)}
```

    (la marca DEMO va a la izquierda del grupo de la derecha; revisar en el navegador que el botón se
    lea bien con `.btn-primary` sobre el fondo de la barra y ajustar a los tokens si no).
- [ ] **Paso 4:** correr → PASA; verificación local; commit
  `feat(onboarding): terminal en demo con marca DEMO y /ALTA (#128)`.

---

### Tarea 9: orquestación en `ui/onboarding.ts`, `bootstrap` y borrado de lo viejo

**Archivos:**
- Crear: `src/ui/onboarding.ts`, `src/ui/onboarding.test.ts`
- Modificar: `src/ui/bootstrap.ts`, `src/main.tsx`, `index.html`,
  `src/ui/state/sync-config.ts` (`configNoticeSignal`), `src/ui/keyboard/config-controller.ts`
  (`openWizardWithCandidate`), `src/ui/screens/config-screen.tsx`
- Borrar: `src/sync/url-auto-config.ts`, `src/sync/url-auto-config.test.ts`,
  `src/ui/state/demo-mode.ts`, `docs/url-autoconfig-handshake.md`

**Interfaces:**
- Consume: `readDemoEntry`, `readConnectReturn`, `stripOnboardingParams` (T6), `requestDemoSession`,
  `consumeWipeKey` (T7), `DemoSessionInfo` (T8), `probeConnection`, `applyConnection`.
- Produce:

```ts
export type OnboardingOutcome =
  | { kind: 'none' }
  | { kind: 'applied'; notice?: string }
  | { kind: 'ignored'; notice: string }
  | { kind: 'failed'; notice: string }
  | { kind: 'review'; candidate: SyncConfig; notice: string };

export type OnboardingDeps = {
  requestDemoSession: (backend: string, template?: string) => Promise<Result<DemoSession>>;
  probeConnection: (config: SyncConfig) => Promise<Result<ProbeSnapshot>>;
  applyConnection: (params: ApplyConnectionParams) => Promise<Result<void>>;
  consumeWipeKey: (key: string | undefined, now: Date) => boolean;
  now: () => Date;
};

export type OnboardingContext = { config: Result<SyncConfig>; hasUserData: boolean };

export function runOnboardingFromUrl(
  href: string,
  context: OnboardingContext,
  deps?: OnboardingDeps,
): Promise<OnboardingOutcome>;
```

  - `configNoticeSignal: Signal<string | null>` (se limpia en `resetConfigForm`).
  - `openWizardWithCandidate(candidate: SyncConfig, notice: string): Promise<void>`.

- [ ] **Paso 1: tests que fallan** (`onboarding.test.ts`, con `deps` falsos; `probeConnection`
  devuelve `ok(snapshot)` y `applyConnection` `ok(undefined)` salvo que el caso diga otra cosa):

```ts
const session: DemoSession = {
  apiKey: 'k', branch: 'CENTRAL', pointOfSale: 'Caja 1', template: 'kiosco',
  onboarding: { url: 'https://b.x/alta', label: 'Crear mi comercio' },
};
const NO_CONFIG = err('sync/config-missing', undefined);
const DEMO_CONFIG = ok({ type: 'rest', baseUrl: 'https://b.x', apiKey: 'k', branch: 'CENTRAL', pointOfSale: 'Caja 1', verifiedAt: 'x', demo: { template: 'kiosco', onboarding: session.onboarding, startedAt: 'x' } });
const REAL_CONFIG = ok({ type: 'rest', baseUrl: 'https://erp.x', branch: 'A', pointOfSale: 'B', verifiedAt: 'x' });
const entry = 'https://pos.x/?demo=true&backend=https://b.x';

it('sin link no hace nada', …); // kind 'none', ninguna dep llamada

it('entrada sin config: pide la demo, prueba y aplica con wipe', async () => {
  const outcome = await runOnboardingFromUrl(entry, { config: NO_CONFIG, hasUserData: false }, deps);
  expect(outcome).toEqual({ kind: 'applied' });
  const applied = deps.applyConnection.mock.calls[0]?.[0];
  expect(applied?.local).toBe('wipe');
  expect(applied?.candidate).toMatchObject({
    type: 'rest', baseUrl: 'https://b.x', apiKey: 'k', branch: 'CENTRAL', pointOfSale: 'Caja 1',
    demo: { template: 'kiosco', onboarding: session.onboarding, startedAt: NOW.toISOString() },
  });
});

it('ya en demo: reinicia la demo aunque haya datos', …); // DEMO_CONFIG + hasUserData true → applied
it('con conexión real se ignora sin llamar al backend', …);
// REAL_CONFIG → { kind: 'ignored', notice: 'Esta terminal ya está conectada: se ignoró el link de demo.' }
it('sin config pero con datos locales se ignora', …);
// → 'Esta terminal tiene datos locales: se ignoró el link de demo.'
it('template desconocido: reintenta sin template y avisa', …);
// primer requestDemoSession → err unknown-template; segundo → ok(session)
// → { kind: 'applied', notice: 'La plantilla nope no existe; se usó kiosco.' }
it('backend sin demos (404) → failed con el motivo', …);
// → { kind: 'failed', notice: 'No se pudo iniciar la demo: este backend no ofrece demos.' }
it('link inválido → failed', …); // backend http://b.x → notice con "tiene que ser https"
it('usa baseUrl de la sesión si viene', …);

const back = (payload: object) => `https://pos.x/#connect=${encode(payload)}`;
const ret = { baseUrl: 'https://b.x', apiKey: 'real', branch: 'CENTRAL', pointOfSale: 'Caja 1', wipeKey: 'w' };

it('vuelta con wipe_key válido: aplica con wipe y sin demo', async () => {
  deps.consumeWipeKey.mockReturnValue(true);
  const outcome = await runOnboardingFromUrl(back(ret), { config: DEMO_CONFIG, hasUserData: true }, deps);
  expect(outcome.kind).toBe('applied');
  const applied = deps.applyConnection.mock.calls[0]?.[0];
  expect(applied?.local).toBe('wipe');
  expect(applied?.candidate).not.toHaveProperty('demo');
  expect(applied?.candidate).toMatchObject({ apiKey: 'real' });
});
it('vuelta sin wipe_key válido y sin datos: aplica igual', …);
it('vuelta sin wipe_key válido y con datos: review sin borrar', …);
// → { kind: 'review', candidate: {…sin demo, sin verifiedAt}, notice: 'Volviste del alta. Esta terminal tiene datos locales: revisá la conexión y elegí qué hacer con ellos.' }
it('vuelta con prueba fallida: review con el motivo', …);
// → notice 'No se pudo probar la conexión del alta: <describeError>'
it('vuelta inválida → failed', …);
// → 'No se pudo completar el alta: los datos de conexión que devolvió el alta no son válidos.'
```

- [ ] **Paso 2:** correr → FALLA.
- [ ] **Paso 3: implementación** (`ui/onboarding.ts`):

```ts
/**
 * Onboarding de demo (#128): lo llama `bootstrap` una vez, antes del primer render. La lectura de
 * los links es pura (`sync/demo-link.ts`); acá se decide qué hacer y se orquesta. Excepción a
 * "cambiar la conexión nunca borra solo" (AGENTS.md): se borra lo local en (a) un link de demo con
 * la terminal sin config y sin datos, o ya en demo; (b) la vuelta del alta con un `wipe_key`
 * emitido por esta terminal, o sin datos del usuario.
 */
const defaultDeps: OnboardingDeps = {
  requestDemoSession: (backend, template) =>
    withTimeout(requestDemoSession(backend, template), PROBE_TIMEOUT_MS),
  probeConnection: (config) => probeConnection(config),
  applyConnection,
  consumeWipeKey,
  now: () => new Date(),
};

export async function runOnboardingFromUrl(href, context, deps = defaultDeps): Promise<OnboardingOutcome> {
  const back = readConnectReturn(href);
  if (back !== undefined) return handleReturn(back, context, deps);
  const entry = readDemoEntry(href);
  if (entry !== undefined) return handleEntry(entry, context, deps);
  return { kind: 'none' };
}

function keptLocale(config: Result<SyncConfig>): { locale?: string } {
  return config.ok && config.value.locale !== undefined ? { locale: config.value.locale } : {};
}

async function handleEntry(entry: Result<DemoEntry>, context: OnboardingContext, deps: OnboardingDeps): Promise<OnboardingOutcome> {
  if (!entry.ok) return { kind: 'failed', notice: `No se pudo iniciar la demo: ${describeError(entry)}` };
  const inDemo = context.config.ok && context.config.value.demo !== undefined;
  const hasConfig = context.config.ok || context.config.error !== 'sync/config-missing';
  if (!inDemo && hasConfig) return { kind: 'ignored', notice: 'Esta terminal ya está conectada: se ignoró el link de demo.' };
  if (!inDemo && context.hasUserData) return { kind: 'ignored', notice: 'Esta terminal tiene datos locales: se ignoró el link de demo.' };

  let notice: string | undefined;
  let session = await deps.requestDemoSession(entry.value.backend, entry.value.template);
  if (!session.ok && session.error === 'demo/unknown-template' && entry.value.template !== undefined) {
    session = await deps.requestDemoSession(entry.value.backend);
    if (session.ok) notice = `La plantilla ${entry.value.template} no existe; se usó ${session.value.template}.`;
  }
  if (!session.ok) return { kind: 'failed', notice: `No se pudo iniciar la demo: ${describeError(session)}` };

  const now = deps.now().toISOString();
  const candidate: SyncConfig = {
    type: 'rest',
    baseUrl: session.value.baseUrl ?? entry.value.backend,
    apiKey: session.value.apiKey,
    branch: session.value.branch,
    pointOfSale: session.value.pointOfSale,
    ...keptLocale(context.config),
    demo: { template: session.value.template, onboarding: session.value.onboarding, startedAt: now },
  };
  const applied = await probeAndWipe(candidate, deps, now);
  if (!applied.ok) return { kind: 'failed', notice: `No se pudo iniciar la demo: ${describeError(applied)}` };
  return notice !== undefined ? { kind: 'applied', notice } : { kind: 'applied' };
}

async function handleReturn(back: Result<ConnectReturn>, context: OnboardingContext, deps: OnboardingDeps): Promise<OnboardingOutcome> {
  if (!back.ok) return { kind: 'failed', notice: `No se pudo completar el alta: ${describeError(back)}.` };
  const { wipeKey, ...connection } = back.value;
  const candidate: SyncConfig = { type: 'rest', ...connection, ...keptLocale(context.config) };
  const authorized = deps.consumeWipeKey(wipeKey, deps.now()) || !context.hasUserData;
  if (!authorized) {
    return { kind: 'review', candidate, notice: 'Volviste del alta. Esta terminal tiene datos locales: revisá la conexión y elegí qué hacer con ellos.' };
  }
  const applied = await probeAndWipe(candidate, deps, deps.now().toISOString());
  if (!applied.ok) return { kind: 'review', candidate, notice: `No se pudo probar la conexión del alta: ${describeError(applied)}` };
  return { kind: 'applied' };
}

async function probeAndWipe(candidate: SyncConfig, deps: OnboardingDeps, now: string): Promise<Result<void>> {
  const probe = await deps.probeConnection(candidate);
  if (!probe.ok) return probe;
  return deps.applyConnection({ candidate, snapshot: probe.value, local: 'wipe', originChanged: true, now });
}
```

  Todas las frases armadas con `describeError` pasan por `sentence(text)`, que agrega el punto final
  si falta (los textos de `errors.ts` a veces lo traen y a veces no):
  `const sentence = (text: string) => (/[.!?]$/.test(text) ? text : `${text}.`);` →
  `notice: sentence(`No se pudo iniciar la demo: ${describeError(x)}`)`, y lo mismo en "No se pudo
  completar el alta" y "No se pudo probar la conexión del alta" (sin el `.` literal del ejemplo).
- [ ] **Paso 4: wizard** — `sync-config.ts`: `export const configNoticeSignal = signal<string | null>(null);`
  y `configNoticeSignal.value = null;` en `resetConfigForm`. `config-controller.ts`:

```ts
/**
 * Vuelta del alta sin autorización para borrar, o con la prueba fallida (#128): el wizard abre con
 * la conexión precargada y lanza la prueba; el operador elige Mantener o Borrar como en cualquier
 * cambio de conexión. Activa o en modo requerido.
 */
export async function openWizardWithCandidate(candidate: SyncConfig, notice: string): Promise<void> {
  openWizard();
  await refreshLocalData();
  configTypeSignal.value = candidate.type;
  configFieldValuesSignal.value = { ...configFieldValuesSignal.value, [candidate.type]: toFieldValues(candidate) };
  configTerminalSignal.value = {
    locale: candidate.locale ?? '',
    branch: candidate.branch ?? '',
    pointOfSale: candidate.pointOfSale ?? '',
  };
  configNoticeSignal.value = notice;
  activeScreenSignal.value = 'config';
  goToStep('probe');
}
```

  `config-screen.tsx`: debajo del `<h1>`, `{configNoticeSignal.value !== null && <p role="status" style={…noticeStyle de advertencia…}>{configNoticeSignal.value}</p>}`.
  Test en `config-controller.test.ts`: después de `openWizardWithCandidate`, el tipo, los campos y la
  terminal son los del candidato, el aviso está puesto y el paso es `probe` (la prueba corre con el
  conector del candidato; usar el conector falso de `src/test/fake-connector.ts` como en los tests
  existentes del controller).
- [ ] **Paso 5: `bootstrap`** — reemplazar el bloque "Gestión de modo Demo…" y lo que sigue por:

```ts
  // Onboarding de demo (#128): un link de demo o la vuelta del alta. Antes de leer la config: puede
  // haberla cambiado. La URL se limpia siempre, así un F5 no lo repite.
  const onboarding = await runOnboardingFromUrl(window.location.href, {
    config: loadSyncConfig(),
    hasUserData: hasUserData(await summarizeLocalData()),
  });
  if (onboarding.kind !== 'none') {
    window.history.replaceState(null, '', stripOnboardingParams(window.location.href));
  }
  if (onboarding.kind === 'applied') {
    // Lo local se borró: la venta en curso restaurada más arriba ya no existe.
    cartSignal.value = { lines: [] };
    cartSelectionIndexSignal.value = null;
    resetAttachedCustomer();
    identityResetSignal.value = false;
  }

  const configResult = loadSyncConfig();
  const state = connectionState(configResult);
  setConnectionState(state);
  setActiveConnectorType(state === 'active' && configResult.ok ? configResult.value.type : null);
  setDemoSession(state === 'active' && configResult.ok ? (configResult.value.demo ?? null) : null);
  restoreBackendCapabilities();
  restoreBackendNotices();

  if (onboarding.kind === 'review') {
    await openWizardWithCandidate(onboarding.candidate, onboarding.notice);
  } else if (state !== 'active') {
    await openRequiredWizard();
    if (onboarding.kind === 'failed' || onboarding.kind === 'ignored') {
      configNoticeSignal.value = onboarding.notice;
    }
  } else if (onboarding.kind === 'failed' || onboarding.kind === 'ignored') {
    commandBarWarningSignal.value = onboarding.notice;
  } else if (onboarding.kind === 'applied' && onboarding.notice !== undefined) {
    commandBarNoticeSignal.value = onboarding.notice;
  }

  startSyncEngine();
```

  y, si `applyConnection` no lo hizo ya, disparar el primer sync como hoy (`startSyncEngine` corre
  `runPushThenPull` al arrancar).
- [ ] **Paso 6: "Preparando…"** — `index.html`: `<div id="app"><p style="font-family: system-ui, sans-serif; padding: 16px">Preparando…</p></div>`;
  `main.tsx`: `container.replaceChildren();` justo antes de `render(...)`.
- [ ] **Paso 7: borrar lo viejo** — `git rm src/sync/url-auto-config.ts src/sync/url-auto-config.test.ts src/ui/state/demo-mode.ts docs/url-autoconfig-handshake.md`;
  `grep -rn "demo-mode\|url-auto-config\|localhost:4100\|preset\|Mini-ERP\|isDemoModeSignal" src docs/*.md`
  → sin resultados en `src/` (los docs se tratan en la Tarea 12).
- [ ] **Paso 8:** `pnpm lint && pnpm typecheck && pnpm test && pnpm build` → PASA; commit
  `feat(onboarding): orquestación del link de demo y de la vuelta del alta; sale el flujo viejo (#128)`.

---

### Tarea 10: e2e del onboarding contra el demo-backend

**Archivos:**
- Modificar: `playwright.config.ts` (tercer `webServer`)
- Crear: `e2e/demo-onboarding.spec.ts`

**Interfaces:**
- Consume: `/demo-sessions`, `/_demo/onboarding`, `/_demo/api/settings` (T5); todo el flujo del POS.

- [ ] **Paso 1: backend propio para este spec** — un segundo demo-backend en `4001`, en memoria,
  así re-sembrar la base no le pisa los datos a los specs que usan el de `4000` en paralelo:

```ts
    {
      // Onboarding de demo (#128): `POST /demo-sessions` re-siembra la base, así que
      // `e2e/demo-onboarding.spec.ts` usa su propio backend, en memoria.
      command: 'pnpm --filter demo-backend run start',
      env: { DEMO_BACKEND_PORT: '4001', DEMO_BACKEND_DB: ':memory:' },
      url: 'http://localhost:4001/_demo',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
```

- [ ] **Paso 2: el spec** (`test.describe.configure({ mode: 'serial' })`, `import { test, expect } from '@playwright/test'` salvo el caso de conexión real, que usa `./fixtures.ts`):

```ts
const BACKEND = 'http://localhost:4001';
const DEMO_LINK = `/?demo=true&backend=${encodeURIComponent(BACKEND)}`;

test('link de demo → venta en demo → /ALTA → alta falsa → vuelve configurado y sin lo local', async ({ page }) => {
  await page.goto(DEMO_LINK);
  const commandBar = page.getByLabel('Barra de comandos');
  await expect(commandBar).toBeVisible();
  await expect(page.getByText('DEMO', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Crear mi comercio (/ALTA)' })).toBeVisible();
  expect(page.url()).not.toContain('demo=');

  await commandBar.fill('arroz');
  await expect(page.getByText('Arroz 1kg')).toBeVisible();
  await commandBar.press('Enter'); // línea en la venta en curso (se persiste en draftCart)

  await commandBar.fill('/ALTA');
  await commandBar.press('Enter');
  await expect(page).toHaveURL(/localhost:4001\/_demo\/onboarding\?return_url=/);
  await page.getByRole('link', { name: 'Crear comercio y volver al POS' }).click();

  await expect(page.getByLabel('Barra de comandos')).toBeVisible();
  await expect(page.getByText('DEMO', { exact: true })).toHaveCount(0);
  expect(page.url()).not.toContain('connect=');
  const config = await page.evaluate(() => JSON.parse(localStorage.getItem('offline-pos:sync-config') ?? '{}'));
  expect(config).toMatchObject({ type: 'rest', baseUrl: BACKEND, apiKey: 'demo-api-key' });
  expect(config).not.toHaveProperty('demo');
  await expect(page.getByText('Arroz 1kg')).toHaveCount(0); // la venta en curso se borró
});

test('template desconocido: arranca con el default y avisa', async ({ page }) => {
  await page.goto(`${DEMO_LINK}&template=nope`);
  await expect(page.getByText('La plantilla nope no existe; se usó kiosco.')).toBeVisible();
});

test('vuelta sin wipe_key con datos: wizard precargado, nada borrado', async ({ page }) => {
  await page.goto(DEMO_LINK);
  // una venta cerrada = datos del usuario (usar fillPayment/confirmCheckout de ./helpers.ts)
  // … vender "Arroz 1kg" en efectivo …
  await commandBar.fill('/ALTA'); await commandBar.press('Enter');
  await page.getByRole('link', { name: 'Volver sin wipe_key' }).click();
  await expect(page.getByRole('heading', { name: 'Configurar conexión' })).toBeVisible();
  await expect(page.getByText(/Volviste del alta/)).toBeVisible();
  // la venta sigue en IndexedDB (getAllFromStore(page, 'sales') con 1 fila)
});

test('avisos del backend: "Avisos (1)" y el detalle en /DIAGNOSTICO', async ({ page }) => {
  await page.goto(DEMO_LINK);
  await expect(page.getByLabel('Barra de comandos')).toBeVisible();
  // Después de crear la demo: /demo-sessions borra los ajustes del panel.
  await page.request.put(`${BACKEND}/_demo/api/settings`, {
    data: { notice: { enabled: true, severity: 'warning', message: 'Aviso de prueba' } },
  });
  const commandBar = page.getByLabel('Barra de comandos');
  await commandBar.fill('/SINCRONIZAR');
  await commandBar.press('Enter');
  await page.getByRole('button', { name: 'Avisos (1)' }).click();
  await expect(page.getByText('Aviso de prueba')).toBeVisible();
  await page.request.put(`${BACKEND}/_demo/api/settings`, { data: { notice: { enabled: false, severity: 'warning', message: '' } } });
});
```

  y, con el `test` de `./fixtures.ts` (conexión real sembrada):

```ts
fixtureTest('con una conexión real el link se ignora y avisa', async ({ page }) => {
  await page.goto(DEMO_LINK);
  await expect(page.getByText('Esta terminal ya está conectada: se ignoró el link de demo.')).toBeVisible();
  const config = await page.evaluate(() => JSON.parse(localStorage.getItem('offline-pos:sync-config') ?? '{}'));
  expect(config.baseUrl).toBe('http://127.0.0.1:9');
});
```

- [ ] **Paso 3:** `pnpm test:e2e` → PASA la suite completa (incluidos `collection.spec.ts` y
  `void-sale.spec.ts` con las capacidades sembradas en la Tarea 3).
- [ ] **Paso 4:** commit `test(e2e): onboarding de demo contra el demo-backend (#128)`.

---

### Tarea 11: #115 — foto completa con stock vacío

**Archivos:**
- Modificar: `src/sync/pull-adjust.ts`, `src/storage/apply-pull.ts`, `src/storage/reconcile.ts`
- Test: `src/sync/pull-adjust.test.ts`, `src/storage/apply-pull.test.ts`

**Interfaces:**
- Produce: `applySnapshotReconciled(snapshot, { now, allowEmptyTables?, keepStock? })`.

- [ ] **Paso 1: tests que fallan**
  - `pull-adjust.test.ts`: con `stock: []`, sin retener y con efectos de stock pendientes, el stock
    ajustado es `[]` (no crea filas desde 0).
  - `apply-pull.test.ts` (reusar el armado de ese archivo: filas de stock sembradas, un evento
    `stock-movement` pendiente en el outbox): stock local `p1 = 8`, `p2 = 5`, pendiente de `p1`
    `-2`; `applyPull({ full: true, result: { …, stock: [] }, retain: false, queuedEventIds: [], now })`
    → `ok({ skipped: [], … })` y las filas de stock quedan `p1 = 8`, `p2 = 5`. Mismo caso con
    `full: false` → stock intacto. Un caso de control: con `stock` no vacío se sigue reconciliando
    como hoy.
- [ ] **Paso 2:** correr → FALLA (se borra `p2` y `p1` queda en `-2`).
- [ ] **Paso 3: implementación**
  - `pull-adjust.ts::adjustPull`, rama sin retener: si `params.stock.length === 0`, `stock: []`
    (comentario: 4.4.0, `stock: []` es "el backend no mandó stock", #115).
  - `reconcile.ts::applySnapshotReconciled`: `params.keepStock === true` saltea el `bulkPut` y el
    `bulkDelete` de `stock` (y no la agrega a `skipped`).
  - `apply-pull.ts::applyPull`: `const stockSent = input.result.stock.length > 0;` → en la foto
    completa, `applySnapshotReconciled(…, { now: input.now, keepStock: !stockSent })`; en el delta,
    el `bulkPut` de stock ya no corre con `adjusted.stock` vacío.
- [ ] **Paso 4:** correr → PASA; verificación local; commit
  `fix(sync): una foto con stock vacío no toca el stock local (#115)` con `Closes`/referencia en el PR.

---

### Tarea 12: documentación

**Archivos:**
- Modificar: `docs/connector-api.openapi.yaml`, `AGENTS.md`, `src/sync/AGENTS.md`,
  `src/ui/AGENTS.md`, `e2e/AGENTS.md`, `docs/historia.md`, la spec (estado: implementado + desvíos)

- [ ] **Paso 1: OpenAPI 4.4.0** — `info.version: 4.4.0`; en la descripción, una sección
  **"Reglas de evolución"** con las reglas de la spec (§1: campos y enums desconocidos, tipos de
  evento y medios de pago desconocidos del lado del backend, foto completa nunca truncada, números
  sin contigüidad) y **"Compatibilidad"** (piso 4.0.0, capacidades). Schemas: `BackendInfo`
  suma `capabilities`; `PullBatchResponse` suma `notices` (`BackendNotice`); path
  `POST /demo-sessions` con `security: []`, `DemoSessionRequest`, `DemoSessionResponse`, 201/404/422
  (`UnknownTemplate`); sección "Vuelta del onboarding" con `#connect=` y el JSON; aclaraciones de
  `customer` (alta o actualización por `id` con `updatedAt`) y de stock (`tracksStock: false`,
  `stock: []`). Validar que el YAML parsea (`pnpm dlx @redocly/cli lint docs/connector-api.openapi.yaml`
  si ya se usa en el repo; si no, `node -e` con el parser YAML que haya instalado, o revisión manual).
- [ ] **Paso 2: `AGENTS.md` raíz** — índice (onboarding → `src/sync` y `src/ui`); "Connector API":
  4.4.0, compatibilidad por piso y capacidades (reemplaza "Compatible = mismo major y minor igual o
  mayor"); qué backends acompañan (Sheets vuelve a ser compatible con el piso 4.0, sin tocarlo);
  "Ciclo de vida de la conexión": la **excepción de borrado automático** escrita; reemplazar
  "Onboarding y modo demo (primera versión…)" por el diseño nuevo (link, `/ALTA`, vuelta con
  `#connect`, spec); tabla de comandos con `/ALTA`; "Estado del proyecto" e "Issues abiertas"
  (#128 y #115 cerradas al mergear).
- [ ] **Paso 3: `src/sync/AGENTS.md`** — "Contrato 4.4.0" arriba de 4.3.0 (qué trajo, piso,
  capacidades, `notices`, tolerancias, #115); sección "Onboarding de demo" (módulos, `wipe_key`,
  excepción de borrado); capacidades y avisos en "Log de intentos y `/DIAGNOSTICO`".
- [ ] **Paso 4: `src/ui/AGENTS.md`** — barra de estado (DEMO, `/ALTA`, "Avisos (N)"), `/ANULAR` sin
  capacidad, `/DIAGNOSTICO` (capacidades, avisos), wizard con `configNoticeSignal`; `e2e/AGENTS.md`
  (segundo demo-backend en 4001, capacidades sembradas en el fixture).
- [ ] **Paso 5:** `docs/historia.md` con la etapa; la spec con "Estado: implementado" y los desvíos
  del plan, si hubo. Comentario en #127 (con el piso 4.0 Sheets vuelve a ser compatible) y el issue
  `feature:mini-erp` con lo que tendría que implementar — **preguntar antes de crearlos** (son
  acciones en GitHub).
- [ ] **Paso 6:** `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm test:e2e`;
  commit `docs: onboarding de demo y contrato 4.4.0 (#128)`.

---

## Cierre

Informe final con la prueba manual paso a paso (link de demo contra el demo-backend local, `/ALTA`,
las dos vueltas, template desconocido, conexión real, avisos, `/ANULAR` con y sin la capacidad,
#115). El PR se abre recién con la aprobación del usuario, con `Closes #128` y `Closes #115`, y se
mergea con merge commit.
