# Registro de conectores + `/CONFIG` como modal — Etapa 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el POS pueda elegir por configuración entre el conector REST y el de Google Sheets (registro cerrado de conectores), y rediseñar `/CONFIG` como un diálogo modal con selector de tipo — absorbiendo y cerrando el issue #56.

**Architecture:** Cada conector es dueño de su schema de config y de su lista ordenada de campos (`connectors/<tipo>/config.ts`). `sync/connector-registry.ts` arma la unión discriminada por `type` y expone `createConnector(config)`, único punto que elige implementación. `sync/config.ts` guarda `{ type, …campos, locale? }` y lee una config vieja sin `type` como REST. `/CONFIG` pasa de un wizard de 3 pasos a un formulario con todos los campos visibles, con el mismo chrome de modal que Cobro (#55).

**Tech Stack:** TypeScript estricto, Zod 4, Preact + `@preact/signals`, Vitest + Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-17-conector-sheets-y-registro-de-conectores-design.md` — secciones "Etapa 2" y "UI de `/CONFIG`: absorbe y cierra el issue #56". Vive en la rama `claude/sheets-connectors-plugins-27612e` (leer con `git show claude/sheets-connectors-plugins-27612e:docs/superpowers/specs/2026-09-17-conector-sheets-y-registro-de-conectores-design.md`). Issue: #68 (cierra #56), parte del epic #66.

## Decisiones que ajustan el spec (acordadas con el usuario el 2026-09-21)

Contrastado el spec con el código de `main`, aparecieron puntos que el spec no cubría. Este plan sigue estas resoluciones, **no** el texto original en estos puntos:

1. **Config guardada sin `type` = REST.** Hoy `localStorage` guarda `{ baseUrl, apiKey?, locale? }` sin `type`. Con una unión discriminada, toda terminal ya configurada fallaría la validación y el sync se cortaría en silencio. `syncConfigSchema` usa `z.preprocess` para leer una config sin `type` como `type: 'rest'`; la próxima vez que se guarde, queda con `type`.
2. **`/DEMO_RESET` se bloquea con un conector distinto de REST**, mostrando "no está disponible con Google Sheets". `POST /_demo/reset` solo existe en el minibackend REST de demo y una config de Sheets no tiene `baseUrl`. Nuevo `ErrorCode` `'demo/unavailable-for-connector'`. El aviso se ve apenas se abre la pantalla y `demoReset()` lo repite como verificación de fondo (mismo criterio que el gate de turno de caja).
3. **`/CONFIG` precarga la config guardada** (y solo si no hay ninguna, los defaults del demo `http://localhost:4000` / `demo-token`). Hoy siempre arranca con los defaults, aunque la terminal ya esté configurada.
4. **`createConnector(config: ConnectorConfig)`, no `SyncConfig`** (el spec decía `SyncConfig`). `SyncConfig` es `ConnectorConfig & { locale? }`, así que sigue siendo asignable, y evita un ciclo de imports entre `sync/config.ts` y el registro.
5. **El conector REST recibe `RestConnectionConfig = Omit<RestConfig, 'type'>`**: el discriminador es del registro, el conector no lo necesita. Permite mover el archivo sin romper la compilación entre commits.
6. **Interacción del modal = la de Cobro (#55):** Tab/Shift+Tab nativo entre campos, Ctrl+Enter valida y guarda todo junto, Esc cancela. **Enter solo no hace nada** (antes avanzaba el wizard). El selector de tipo es un `<select>` nativo, primer campo y el que recibe el foco al abrir.

## Global Constraints

- `any` prohibido; `unknown` solo en la firma de algo externo validado con Zod en la línea siguiente. Nada de `unknown` propagado al dominio.
- Toda función de negocio devuelve `Result<T>`, **nunca lanza**. `try/catch` solo en adaptadores (`localStorage`, `fetch`).
- Un solo registro central de errores: todo `ErrorCode` nuevo entra en `ErrorMeta` (`src/domain/result.ts`) **y** en el `switch` exhaustivo de `src/ui/errors.ts`, o no compila.
- Imports con extensión `.ts`/`.tsx`; `verbatimModuleSyntax` (`import type` para tipos); `exactOptionalPropertyTypes` (nunca `undefined` explícito en una prop opcional — armar con spread condicional).
- El foco imperativo pasa siempre por `useFocusOnMount` / hooks de `ui/hooks/`, **nunca** por el atributo `autoFocus`.
- La validación del formulario ocurre solo al confirmar (Ctrl+Enter), nunca mientras se tipea.
- Cada pantalla mantiene `height: 'var(--app-height)'` en su raíz (no `100svh`, no `minHeight`).
- Textos de usuario y comentarios en español, mismo estilo del repo.
- **Cada commit deja `pnpm test`, `pnpm typecheck` y `pnpm lint` en verde.** Por eso el Task 3 es atómico (ver ahí).
- `pnpm format:check` falla en todo el repo por CRLF (`core.autocrlf` en Windows), es previo a este trabajo: verificar los archivos tocados con `pnpm prettier --check --end-of-line auto <archivos>`.
- Commits terminan con: `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.
- Rama de trabajo: `claude/sheets-connector-stage-2` (ya creada sobre `origin/main`). PR recién al final (Task 8), con `Closes #68` y `Closes #56`.

## File Structure

| Archivo | Acción | Responsabilidad |
|---|---|---|
| `src/connectors/config-field.ts` | crear | Tipo `ConfigField<K>` = `{ key, label, optional }`. |
| `src/connectors/rest/config.ts` | crear | `restConfigSchema`, `RestConfig`, `RestConnectionConfig`, `restConfigFields`. |
| `src/connectors/rest/rest-fetch-connector.ts` (+ `.test.ts`) | mover (`git mv`) desde `src/connectors/` | Conector REST; ahora recibe `RestConnectionConfig`. |
| `src/connectors/google-sheets/config.ts` | modificar | Suma `googleSheetsConfigFields`. |
| `src/sync/connector-registry.ts` (+ `.test.ts`) | crear | `connectorConfigSchema`, `ConnectorConfig`, `ConnectorType`, `CONNECTOR_TYPES`, `connectorLabel`, `connectorFields`, `createConnector`, `toFieldValues`. |
| `src/sync/config.ts` (+ `.test.ts`) | modificar | `SyncConfig` = `ConnectorConfig & { locale? }` con lectura de la config vieja como REST. |
| `src/sync/engine.ts`, `src/sync/account-hold.ts` | modificar | Usan `createConnector`. |
| `src/storage/demo-reset.ts` | modificar | Bloquea con conector ≠ REST; `checkDemoResetAvailable`. |
| `src/domain/result.ts`, `src/ui/errors.ts` (+ `errors.test.ts`) | modificar | Nuevo `'demo/unavailable-for-connector'`. |
| `src/ui/keyboard/demo-reset-controller.ts` | modificar | Muestra el aviso al abrir la pantalla. |
| `src/ui/state/sync-config.ts` | reescribir | Estado del formulario (tipo activo, valores por conector, locale, error). |
| `src/ui/keyboard/config-controller.ts` (+ test) | reescribir | Abrir (con precarga), cambiar tipo, editar campos, confirmar, cancelar. |
| `src/ui/screens/config-screen.tsx` (+ test) | reescribir | Modal con selector de tipo y todos los campos visibles. |
| `e2e/config-connector.spec.ts` | crear | Teclado-only: elegir Sheets, guardar, precarga, migración de config vieja. |
| `e2e/minibackend-sync.spec.ts` | modificar | Recorre el formulario nuevo en vez del wizard. |
| `CLAUDE.md`, `src/connectors/google-sheets/README.md` | modificar | Documentación. |

---

### Task 1: Descripción de campos de cada conector (aditivo)

Solo agrega archivos y exports nuevos: nada existente cambia de comportamiento.

**Files:**
- Create: `src/connectors/config-field.ts`
- Create: `src/connectors/rest/config.ts`
- Test: `src/connectors/rest/config.test.ts`
- Modify: `src/connectors/google-sheets/config.ts`
- Modify: `src/connectors/google-sheets/config.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `type ConfigField<K extends string = string> = { key: K; label: string; optional: boolean }`
  - `restConfigSchema` = `z.object({ type: z.literal('rest'), baseUrl: z.url(), apiKey: z.string().optional() })`; `type RestConfig`; `type RestConnectionConfig = Omit<RestConfig, 'type'>`
  - `restConfigFields: ConfigField<keyof RestConnectionConfig>[]` = `[baseUrl (obligatorio), apiKey (opcional)]`
  - `googleSheetsConfigFields: ConfigField<Exclude<keyof GoogleSheetsConfig, 'type'>>[]` = `[webAppUrl (obligatorio), sharedSecret (opcional)]`

- [ ] **Step 1: Escribir los tests que fallan**

`src/connectors/rest/config.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { restConfigFields, restConfigSchema } from './config.ts';

describe('restConfigSchema', () => {
  it('acepta una config mínima sin apiKey', () => {
    const parsed = restConfigSchema.safeParse({ type: 'rest', baseUrl: 'https://api.example.com' });

    expect(parsed.success).toBe(true);
  });

  it('acepta apiKey opcional', () => {
    const parsed = restConfigSchema.safeParse({
      type: 'rest',
      baseUrl: 'https://api.example.com',
      apiKey: 'secret',
    });

    expect(parsed.success).toBe(true);
  });

  it('rechaza una baseUrl que no es una URL', () => {
    const parsed = restConfigSchema.safeParse({ type: 'rest', baseUrl: 'no-es-una-url' });

    expect(parsed.success).toBe(false);
  });

  it('rechaza un type distinto de rest', () => {
    const parsed = restConfigSchema.safeParse({
      type: 'google-sheets',
      baseUrl: 'https://api.example.com',
    });

    expect(parsed.success).toBe(false);
  });
});

describe('restConfigFields', () => {
  it('lista baseUrl (obligatorio) y apiKey (opcional), en ese orden', () => {
    expect(restConfigFields).toEqual([
      { key: 'baseUrl', label: 'URL del sistema externo', optional: false },
      { key: 'apiKey', label: 'API key', optional: true },
    ]);
  });
});
```

Agregar al final de `src/connectors/google-sheets/config.test.ts` (y sumar `googleSheetsConfigFields` al import existente de `./config.ts`):

```ts
describe('googleSheetsConfigFields', () => {
  it('lista webAppUrl (obligatorio) y sharedSecret (opcional), en ese orden', () => {
    expect(googleSheetsConfigFields).toEqual([
      { key: 'webAppUrl', label: 'URL del Web App de Google Apps Script', optional: false },
      { key: 'sharedSecret', label: 'Secreto compartido', optional: true },
    ]);
  });
});
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `pnpm vitest run src/connectors/rest/config.test.ts src/connectors/google-sheets/config.test.ts`
Expected: FAIL — `./config.ts` de `rest/` no existe y `googleSheetsConfigFields` no está exportado.

- [ ] **Step 3: Implementación**

`src/connectors/config-field.ts`:

```ts
/**
 * Un campo de configuración de un conector, en el orden en que `/CONFIG` lo
 * muestra (Etapa 2, #68). Cada conector exporta su propia lista
 * (`connectors/<tipo>/config.ts`); la pantalla no sabe qué campos existen,
 * solo renderiza los del tipo elegido. `optional` lo lee la UI para marcar el
 * campo y tiene que coincidir con el schema Zod del conector (lo verifica un
 * test en `sync/connector-registry.test.ts`).
 */
export type ConfigField<K extends string = string> = {
  key: K;
  label: string;
  optional: boolean;
};
```

`src/connectors/rest/config.ts`:

```ts
import { z } from 'zod';
import type { ConfigField } from '../config-field.ts';

/**
 * Config del conector REST genérico (`docs/connector-api.openapi.yaml`).
 * `type` es el discriminador del registro de conectores
 * (`sync/connector-registry.ts`).
 */
export const restConfigSchema = z.object({
  type: z.literal('rest'),
  baseUrl: z.url(),
  apiKey: z.string().optional(),
});

export type RestConfig = z.infer<typeof restConfigSchema>;

/**
 * Lo que `createRestFetchConnector` necesita para hablar con el backend — el
 * discriminador `type` es del registro, el conector no lo usa.
 */
export type RestConnectionConfig = Omit<RestConfig, 'type'>;

export const restConfigFields: ConfigField<keyof RestConnectionConfig>[] = [
  { key: 'baseUrl', label: 'URL del sistema externo', optional: false },
  { key: 'apiKey', label: 'API key', optional: true },
];
```

En `src/connectors/google-sheets/config.ts`, agregar el import y el export (al final del archivo):

```ts
import type { ConfigField } from '../config-field.ts';

export const googleSheetsConfigFields: ConfigField<Exclude<keyof GoogleSheetsConfig, 'type'>>[] = [
  { key: 'webAppUrl', label: 'URL del Web App de Google Apps Script', optional: false },
  { key: 'sharedSecret', label: 'Secreto compartido', optional: true },
];
```

(El `import type` va junto a los otros imports, arriba del archivo.)

- [ ] **Step 4: Correr y verificar que pasan**

Run: `pnpm vitest run src/connectors/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/connectors/config-field.ts src/connectors/rest/config.ts src/connectors/rest/config.test.ts src/connectors/google-sheets/config.ts src/connectors/google-sheets/config.test.ts
git commit -m "feat: descripción de campos de config por conector (#68)"
```

---

### Task 2: Mover el conector REST a `connectors/rest/`

Refactor puro, por simetría con `connectors/google-sheets/`. No agrega comportamiento: los tests existentes del conector son la red de seguridad.

**Files:**
- Move: `src/connectors/rest-fetch-connector.ts` → `src/connectors/rest/rest-fetch-connector.ts`
- Move: `src/connectors/rest-fetch-connector.test.ts` → `src/connectors/rest/rest-fetch-connector.test.ts`
- Modify: `src/sync/engine.ts`, `src/sync/account-hold.ts` (solo la ruta del import)
- Modify (comentarios con la ruta vieja): `src/domain/result.ts`, `demo-backend/src/router.ts`, `demo-backend/src/routes/events.ts`

**Interfaces:**
- Consumes: `RestConnectionConfig` (Task 1).
- Produces: `createRestFetchConnector(config: RestConnectionConfig): Connector` en `src/connectors/rest/rest-fetch-connector.ts`. `SyncConfig` (todavía sin `type`) sigue siendo asignable a `RestConnectionConfig`, así que `engine.ts`/`account-hold.ts` compilan sin más cambio que la ruta.

- [ ] **Step 1: Mover con `git mv` (conserva el historial)**

```bash
git mv src/connectors/rest-fetch-connector.ts src/connectors/rest/rest-fetch-connector.ts
git mv src/connectors/rest-fetch-connector.test.ts src/connectors/rest/rest-fetch-connector.test.ts
```

- [ ] **Step 2: Corregir imports relativos y el tipo de config**

```bash
sed -i "s#'\.\./domain/#'../../domain/#; s#'\.\./sync/connector\.ts'#'../../sync/connector.ts'#; s#import type { SyncConfig } from '\.\./sync/config\.ts';#import type { RestConnectionConfig } from './config.ts';#; s#\bSyncConfig\b#RestConnectionConfig#g" src/connectors/rest/rest-fetch-connector.ts
sed -i "s#'\.\./domain/#'../../domain/#" src/connectors/rest/rest-fetch-connector.test.ts
```

Verificar a mano que en `rest-fetch-connector.ts` quedó `buildHeaders(config: RestConnectionConfig, …)` y `createRestFetchConnector(config: RestConnectionConfig)`, y **ninguna** referencia a `SyncConfig` ni a `'../sync/config.ts'`:

Run: `grep -n "SyncConfig\|sync/config" src/connectors/rest/rest-fetch-connector.ts`
Expected: sin resultados.

- [ ] **Step 3: Actualizar los dos importadores**

En `src/sync/engine.ts` y `src/sync/account-hold.ts`, reemplazar `'../connectors/rest-fetch-connector.ts'` por `'../connectors/rest/rest-fetch-connector.ts'`.

- [ ] **Step 4: Actualizar los comentarios que citan la ruta vieja**

Reemplazar `connectors/rest-fetch-connector.ts` por `connectors/rest/rest-fetch-connector.ts` en el texto de comentario de `src/domain/result.ts` (línea del bloque `// sync/config.ts, sync/engine.ts, …`), `demo-backend/src/router.ts` y `demo-backend/src/routes/events.ts`.

Run: `grep -rn "connectors/rest-fetch-connector" src demo-backend/src e2e`
Expected: sin resultados.

- [ ] **Step 5: Verificar que nada cambió de comportamiento**

Run: `pnpm test; pnpm typecheck; pnpm lint`
Expected: todo verde, con la misma cantidad de tests que antes (el conector REST sigue teniendo sus tests, ahora en `rest/`).

- [ ] **Step 6: Commit**

```bash
git add -A src demo-backend
git commit -m "refactor: mover el conector REST a connectors/rest/ (#68)"
```

---

### Task 3: Registro de conectores + `SyncConfig` como unión (atómico)

Este task es grande a propósito: en cuanto `SyncConfig` pasa a ser una unión, dejan de compilar el motor, el hold, `/DEMO_RESET`, `/CONFIG` y ~15 tests que siembran config. Partirlo dejaría commits en rojo. Adentro sigue el orden TDD: primero las pruebas del registro y de la config, después el resto.

**Files:**
- Create: `src/sync/connector-registry.ts`, `src/sync/connector-registry.test.ts`
- Modify: `src/sync/config.ts`, `src/sync/config.test.ts`
- Modify: `src/sync/engine.ts`, `src/sync/account-hold.ts`, `src/sync/engine.test.ts`, `src/sync/account-hold.test.ts`
- Modify: `src/storage/demo-reset.ts`, `src/storage/demo-reset.test.ts`
- Modify: `src/domain/result.ts`, `src/ui/errors.ts`, `src/ui/errors.test.ts`
- Modify (adaptación transitoria del wizard, se reescribe en el Task 5): `src/ui/keyboard/config-controller.ts`, `src/ui/keyboard/config-controller.test.ts`, `src/ui/screens/config-screen.test.tsx`
- Modify (solo agregar `type: 'rest'` a la config sembrada): `src/ui/format.test.ts`, `src/ui/keyboard/checkout-controller.test.ts`, `src/ui/keyboard/parse-command-bar.test.ts`, `src/ui/parse-amount.test.ts`, `src/ui/screens/cash-summary-screen.test.tsx`, `src/ui/screens/checkout-screen.test.tsx`

**Interfaces:**
- Consumes: `restConfigSchema`, `restConfigFields`, `createRestFetchConnector` (Tasks 1–2); `googleSheetsConfigSchema`, `googleSheetsConfigFields`, `createGoogleSheetsConnector` (Etapa 1).
- Produces (los usan los Tasks 4 y 5):
  - `connectorConfigSchema` (`z.discriminatedUnion('type', [restConfigSchema, googleSheetsConfigSchema])`), `type ConnectorConfig`, `type ConnectorType = 'rest' | 'google-sheets'`
  - `CONNECTOR_TYPES: { type: ConnectorType; label: string; fields: ConfigField[] }[]` = REST (`'REST genérico'`), Google Sheets (`'Google Sheets'`)
  - `connectorLabel(type: ConnectorType): string`, `connectorFields(type: ConnectorType): ConfigField[]`
  - `createConnector(config: ConnectorConfig): Connector`
  - `toFieldValues(config: ConnectorConfig): Record<string, string>` — los valores de sus campos como strings (opcional ausente → `''`), para precargar el formulario
  - `syncConfigSchema` y `type SyncConfig = ConnectorConfig & { locale?: string }`; `loadSyncConfig(): Result<SyncConfig>`, `saveSyncConfig(config: SyncConfig): Result<void>` (mismas firmas que hoy)
  - `ErrorCode` `'demo/unavailable-for-connector'` con meta `{ connectorLabel: string }`

- [ ] **Step 1: Escribir el test del registro (falla)**

`src/sync/connector-registry.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { z } from 'zod';
import { googleSheetsConfigSchema } from '../connectors/google-sheets/config.ts';
import { restConfigSchema } from '../connectors/rest/config.ts';
import {
  CONNECTOR_TYPES,
  connectorConfigSchema,
  connectorFields,
  connectorLabel,
  createConnector,
  toFieldValues,
} from './connector-registry.ts';

afterEach(() => {
  vi.unstubAllGlobals();
});

function okResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: () => Promise.resolve(body),
  } as Response;
}

describe('connectorConfigSchema', () => {
  it('discrimina por type: rest', () => {
    const parsed = connectorConfigSchema.safeParse({ type: 'rest', baseUrl: 'https://api.example.com' });

    expect(parsed.success).toBe(true);
  });

  it('discrimina por type: google-sheets', () => {
    const parsed = connectorConfigSchema.safeParse({
      type: 'google-sheets',
      webAppUrl: 'https://script.google.com/macros/s/abc/exec',
    });

    expect(parsed.success).toBe(true);
  });

  it('rechaza un type desconocido', () => {
    expect(connectorConfigSchema.safeParse({ type: 'csv', path: 'x' }).success).toBe(false);
  });

  it('rechaza una config rest sin baseUrl', () => {
    expect(connectorConfigSchema.safeParse({ type: 'rest' }).success).toBe(false);
  });

  it('rechaza una config google-sheets con webAppUrl inválida', () => {
    expect(
      connectorConfigSchema.safeParse({ type: 'google-sheets', webAppUrl: 'no-es-una-url' }).success,
    ).toBe(false);
  });
});

describe('createConnector', () => {
  it('type rest: arma el conector REST (GET a {baseUrl}/products)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ items: [] }));
    vi.stubGlobal('fetch', fetchMock);

    const connector = createConnector({ type: 'rest', baseUrl: 'https://api.example.com' });
    await connector.pullProducts({});

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe('https://api.example.com/products');
  });

  it('type google-sheets: arma el conector de Sheets (POST al Web App con la acción)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ ok: true, data: { items: [] } }));
    vi.stubGlobal('fetch', fetchMock);

    const connector = createConnector({
      type: 'google-sheets',
      webAppUrl: 'https://script.google.com/macros/s/abc/exec',
    });
    await connector.pullProducts({});

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://script.google.com/macros/s/abc/exec');
    expect(JSON.parse(init.body as string)).toMatchObject({ action: 'pullProducts' });
  });
});

describe('CONNECTOR_TYPES', () => {
  it('lista REST y Google Sheets con su etiqueta', () => {
    expect(CONNECTOR_TYPES.map((info) => [info.type, info.label])).toEqual([
      ['rest', 'REST genérico'],
      ['google-sheets', 'Google Sheets'],
    ]);
  });

  const schemas = { rest: restConfigSchema, 'google-sheets': googleSheetsConfigSchema };

  it.each(CONNECTOR_TYPES)('los campos de $type coinciden con las claves y la opcionalidad de su schema', (info) => {
    const shape: Record<string, z.ZodType> = schemas[info.type].shape;
    const schemaKeys = Object.keys(shape).filter((key) => key !== 'type');

    expect(info.fields.map((field) => field.key)).toEqual(schemaKeys);
    for (const field of info.fields) {
      const acceptsUndefined = shape[field.key]?.safeParse(undefined).success;
      expect(field.optional).toBe(acceptsUndefined);
    }
  });
});

describe('connectorLabel / connectorFields', () => {
  it('devuelven la etiqueta y los campos del tipo pedido', () => {
    expect(connectorLabel('google-sheets')).toBe('Google Sheets');
    expect(connectorFields('rest').map((field) => field.key)).toEqual(['baseUrl', 'apiKey']);
  });
});

describe('toFieldValues', () => {
  it('rest: baseUrl y apiKey (ausente → cadena vacía)', () => {
    expect(toFieldValues({ type: 'rest', baseUrl: 'https://api.example.com' })).toEqual({
      baseUrl: 'https://api.example.com',
      apiKey: '',
    });
  });

  it('google-sheets: webAppUrl y sharedSecret', () => {
    expect(
      toFieldValues({
        type: 'google-sheets',
        webAppUrl: 'https://script.google.com/macros/s/abc/exec',
        sharedSecret: 's3cr3t',
      }),
    ).toEqual({ webAppUrl: 'https://script.google.com/macros/s/abc/exec', sharedSecret: 's3cr3t' });
  });

  it('devuelve exactamente las claves que declara connectorFields', () => {
    expect(Object.keys(toFieldValues({ type: 'rest', baseUrl: 'https://a.com' }))).toEqual(
      connectorFields('rest').map((field) => field.key),
    );
    expect(
      Object.keys(toFieldValues({ type: 'google-sheets', webAppUrl: 'https://a.com' })),
    ).toEqual(connectorFields('google-sheets').map((field) => field.key));
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `pnpm vitest run src/sync/connector-registry.test.ts`
Expected: FAIL — no se puede resolver `./connector-registry.ts`.

- [ ] **Step 3: Implementar el registro**

`src/sync/connector-registry.ts`:

```ts
import { z } from 'zod';
import type { ConfigField } from '../connectors/config-field.ts';
import {
  googleSheetsConfigFields,
  googleSheetsConfigSchema,
} from '../connectors/google-sheets/config.ts';
import { createGoogleSheetsConnector } from '../connectors/google-sheets/google-sheets-connector.ts';
import { restConfigFields, restConfigSchema } from '../connectors/rest/config.ts';
import { createRestFetchConnector } from '../connectors/rest/rest-fetch-connector.ts';
import type { Connector } from './connector.ts';

/**
 * Registro cerrado de conectores integrados (#66, Etapa 2). "Plugin" acá
 * significa un conjunto fijo de implementaciones que el POS trae compiladas,
 * seleccionable por `/CONFIG` — no carga de código de terceros en runtime
 * (descartada: ejecución de código arbitrario dentro de una app que maneja
 * ventas y pagos). Un conector nuevo es un PR al repo: su carpeta en
 * `connectors/<tipo>/` con su schema de config, su lista de campos y su
 * factory, más una entrada en cada lista de este archivo.
 *
 * Único punto de la app que decide qué implementación de `Connector` usar:
 * `sync/engine.ts::runSyncCycle` y `sync/account-hold.ts::requestAccountHoldNow`
 * llaman a `createConnector`, nunca instancian un conector directo.
 */
export const connectorConfigSchema = z.discriminatedUnion('type', [
  restConfigSchema,
  googleSheetsConfigSchema,
]);

export type ConnectorConfig = z.infer<typeof connectorConfigSchema>;
export type ConnectorType = ConnectorConfig['type'];

export type ConnectorTypeInfo = {
  type: ConnectorType;
  label: string;
  fields: ConfigField[];
};

/** Orden = orden del selector de `/CONFIG`. */
export const CONNECTOR_TYPES: ConnectorTypeInfo[] = [
  { type: 'rest', label: 'REST genérico', fields: restConfigFields },
  { type: 'google-sheets', label: 'Google Sheets', fields: googleSheetsConfigFields },
];

export function connectorLabel(type: ConnectorType): string {
  return CONNECTOR_TYPES.find((info) => info.type === type)?.label ?? type;
}

export function connectorFields(type: ConnectorType): ConfigField[] {
  return CONNECTOR_TYPES.find((info) => info.type === type)?.fields ?? [];
}

/**
 * `config` es `ConnectorConfig`, no `SyncConfig`: `SyncConfig` (con `locale`)
 * le es asignable, y así este módulo no importa de `sync/config.ts` (que sí
 * importa de acá) — evita un ciclo de imports.
 */
export function createConnector(config: ConnectorConfig): Connector {
  switch (config.type) {
    case 'rest':
      return createRestFetchConnector(config);
    case 'google-sheets':
      return createGoogleSheetsConnector(config);
    default: {
      const exhaustiveCheck: never = config;
      return exhaustiveCheck;
    }
  }
}

/**
 * Los valores de los campos de una config, como strings — lo que el
 * formulario de `/CONFIG` necesita para precargarse (un opcional ausente es
 * `''`). Las claves tienen que coincidir con `connectorFields(type)`; un test
 * lo verifica.
 */
export function toFieldValues(config: ConnectorConfig): Record<string, string> {
  switch (config.type) {
    case 'rest':
      return { baseUrl: config.baseUrl, apiKey: config.apiKey ?? '' };
    case 'google-sheets':
      return { webAppUrl: config.webAppUrl, sharedSecret: config.sharedSecret ?? '' };
    default: {
      const exhaustiveCheck: never = config;
      return exhaustiveCheck;
    }
  }
}
```

- [ ] **Step 4: Correr el test del registro**

Run: `pnpm vitest run src/sync/connector-registry.test.ts`
Expected: PASS.

- [ ] **Step 5: Reescribir los tests de `sync/config.ts` (fallan)**

Reemplazar todo `src/sync/config.test.ts` por:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { loadSyncConfig, saveSyncConfig } from './config.ts';

const STORAGE_KEY = 'offline-pos:sync-config';

afterEach(() => {
  localStorage.clear();
});

describe('saveSyncConfig / loadSyncConfig', () => {
  it('guarda y relee una config REST (round-trip)', () => {
    const saveResult = saveSyncConfig({
      type: 'rest',
      baseUrl: 'https://api.example.com',
      apiKey: 'secret',
    });
    expect(saveResult.ok).toBe(true);

    expect(loadSyncConfig()).toEqual({
      ok: true,
      value: { type: 'rest', baseUrl: 'https://api.example.com', apiKey: 'secret' },
    });
  });

  it('guarda y relee locale', () => {
    saveSyncConfig({ type: 'rest', baseUrl: 'https://api.example.com', locale: 'en-US' });

    expect(loadSyncConfig()).toEqual({
      ok: true,
      value: { type: 'rest', baseUrl: 'https://api.example.com', locale: 'en-US' },
    });
  });

  it('apiKey es opcional', () => {
    saveSyncConfig({ type: 'rest', baseUrl: 'https://api.example.com' });

    expect(loadSyncConfig()).toEqual({
      ok: true,
      value: { type: 'rest', baseUrl: 'https://api.example.com' },
    });
  });

  it('guarda y relee una config de Google Sheets con locale', () => {
    saveSyncConfig({
      type: 'google-sheets',
      webAppUrl: 'https://script.google.com/macros/s/abc/exec',
      sharedSecret: 's3cr3t',
      locale: 'es-AR',
    });

    expect(loadSyncConfig()).toEqual({
      ok: true,
      value: {
        type: 'google-sheets',
        webAppUrl: 'https://script.google.com/macros/s/abc/exec',
        sharedSecret: 's3cr3t',
        locale: 'es-AR',
      },
    });
  });

  it('descarta claves de otro conector (una config de Sheets no arrastra baseUrl)', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        type: 'google-sheets',
        webAppUrl: 'https://script.google.com/macros/s/abc/exec',
        baseUrl: 'https://api.example.com',
      }),
    );

    expect(loadSyncConfig()).toEqual({
      ok: true,
      value: { type: 'google-sheets', webAppUrl: 'https://script.google.com/macros/s/abc/exec' },
    });
  });

  it('devuelve sync/config-missing si no hay nada guardado', () => {
    const result = loadSyncConfig();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('sync/config-missing');
    }
  });

  it('devuelve sync/config-invalid si el JSON guardado no matchea el schema', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ type: 'rest', baseUrl: 'no-es-una-url' }));

    const result = loadSyncConfig();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('sync/config-invalid');
    }
  });

  it('devuelve sync/config-invalid si el type es desconocido', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ type: 'csv', path: 'x' }));

    const result = loadSyncConfig();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('sync/config-invalid');
    }
  });

  it('devuelve sync/config-invalid si lo guardado no es JSON válido', () => {
    localStorage.setItem(STORAGE_KEY, 'esto no es json{');

    const result = loadSyncConfig();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('sync/config-invalid');
    }
  });
});

// Antes de la Etapa 2 (#68) la config guardada no tenía `type`: solo existía
// el conector REST. Sin esta lectura, toda terminal ya configurada quedaría
// "sin configurar" al actualizar y el sync se cortaría en silencio.
describe('loadSyncConfig — config guardada por una versión anterior (sin type)', () => {
  it('se lee como REST, con todos sus campos', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ baseUrl: 'https://api.example.com', apiKey: 'vieja', locale: 'es-AR' }),
    );

    expect(loadSyncConfig()).toEqual({
      ok: true,
      value: {
        type: 'rest',
        baseUrl: 'https://api.example.com',
        apiKey: 'vieja',
        locale: 'es-AR',
      },
    });
  });

  it('una config vieja inválida sigue siendo sync/config-invalid', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ baseUrl: 'no-es-una-url' }));

    const result = loadSyncConfig();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('sync/config-invalid');
    }
  });
});
```

Run: `pnpm vitest run src/sync/config.test.ts`
Expected: FAIL (el schema actual no tiene `type`).

- [ ] **Step 6: Reescribir `src/sync/config.ts`**

Reemplazar el bloque del schema y el tipo (todo lo que está arriba de `const STORAGE_KEY`), y dejar `loadSyncConfig`/`saveSyncConfig` como están:

```ts
import { z } from 'zod';
import { err, ok, type Result } from '../domain/result.ts';
import { toZodIssues } from '../domain/zod-issues.ts';
import { connectorConfigSchema } from './connector-registry.ts';

/**
 * Antes del registro de conectores (Etapa 2, #68) la config guardada no tenía
 * `type` — solo existía el conector REST. Un objeto sin `type` se lee como
 * `type: 'rest'`; la próxima vez que se guarde, queda con `type`. Recibe
 * `unknown` porque es lo que Zod le pasa a un `preprocess`: el resultado se
 * valida de inmediato contra `connectorConfigSchema`.
 */
function withLegacyType(value: unknown): unknown {
  if (typeof value === 'object' && value !== null && !('type' in value)) {
    return { ...value, type: 'rest' };
  }
  return value;
}

/**
 * Configuración de la terminal, editada por el humano vía `/CONFIG` (ver
 * `ui/screens/config-screen.tsx`): los campos del conector elegido
 * (`connectorConfigSchema`, discriminado por `type`) más `locale`, que queda
 * afuera de la unión porque es config de terminal transversal (Fase 4,
 * usado por `ui/format.ts` para `Intl.NumberFormat`), no de un backend.
 * Separada de `cursor.ts` a propósito: esto es lo único que la pantalla de
 * config toca.
 */
export const syncConfigSchema = z.preprocess(
  withLegacyType,
  connectorConfigSchema.and(z.object({ locale: z.string().optional() })),
);

export type SyncConfig = z.infer<typeof syncConfigSchema>;
```

Run: `pnpm vitest run src/sync/config.test.ts src/sync/connector-registry.test.ts`
Expected: PASS. (Si `pnpm typecheck` se queja de `SyncConfig`, es normal en este punto: faltan los pasos siguientes.)

- [ ] **Step 7: Usar el registro en el motor y en el hold**

`src/sync/engine.ts`: quitar el import de `createRestFetchConnector`, agregar `import { createConnector } from './connector-registry.ts';` junto a los otros imports de `./`, y en `runSyncCycle` reemplazar

```ts
    const connector = createRestFetchConnector(configResult.value);
```
por
```ts
    const connector = createConnector(configResult.value);
```

`src/sync/account-hold.ts`: mismo cambio (import de `createConnector` desde `./connector-registry.ts`, y `const connector = createConnector(configResult.value);`). Actualizar también el comentario de cabecera que dice "arma el conector real" si nombra al REST.

- [ ] **Step 8: Agregar los tests de que el motor y el hold eligen el conector por `type`**

En `src/sync/engine.test.ts`, dentro de `describe('runSyncCycle', …)`, justo después del test `'con config guardada, arma el conector real y corre un ciclo'`:

```ts
  it('con config de Google Sheets guardada, sincroniza contra el Web App (Etapa 2, #68)', async () => {
    const webAppUrl = 'https://script.google.com/macros/s/abc/exec';
    saveSyncConfig({ type: 'google-sheets', webAppUrl });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: () => Promise.resolve({ ok: true, data: { items: [] } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await runSyncCycle();

    expect(syncConfiguredSignal.value).toBe(true);
    expect(syncStatusSignal.value).toBe('online-idle');
    expect(fetchMock).toHaveBeenCalled();
    for (const [url] of fetchMock.mock.calls) {
      expect(url).toBe(webAppUrl);
    }
  });
```

En `src/sync/account-hold.test.ts`, dentro de `describe('requestAccountHoldNow', …)`, al final:

```ts
  it('con config de Google Sheets, aprueba el hold localmente sin llamar a fetch', async () => {
    saveSyncConfig({
      type: 'google-sheets',
      webAppUrl: 'https://script.google.com/macros/s/abc/exec',
    });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await requestAccountHoldNow({
      customerId: 'c1',
      amount: 100,
      idempotencyKey: 'req-1',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.approved).toBe(true);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
```

- [ ] **Step 9: Agregar `type: 'rest'` a toda config sembrada en tests**

```bash
sed -i "s/saveSyncConfig({ baseUrl/saveSyncConfig({ type: 'rest', baseUrl/" \
  src/storage/demo-reset.test.ts src/sync/account-hold.test.ts src/sync/engine.test.ts \
  src/ui/format.test.ts src/ui/keyboard/checkout-controller.test.ts \
  src/ui/keyboard/parse-command-bar.test.ts src/ui/parse-amount.test.ts \
  src/ui/screens/cash-summary-screen.test.tsx src/ui/screens/checkout-screen.test.tsx
```

Y en `src/storage/demo-reset.test.ts`, el test `'no toca la configuración de /CONFIG (URL, API key, locale)'`: agregar `type: 'rest'` al `value` esperado:

```ts
      value: { type: 'rest', baseUrl: 'http://localhost:4000', apiKey: 'clave-1', locale: 'es-AR' },
```

Run: `grep -rn "saveSyncConfig({ baseUrl" src`
Expected: sin resultados.

- [ ] **Step 10: Nuevo `ErrorCode` y su traducción**

`src/domain/result.ts`, en `ErrorMeta`, debajo de `'demo/backend-reset-failed'`:

```ts
  'demo/unavailable-for-connector': { connectorLabel: string };
```

`src/ui/errors.ts`, antes del `default:` del `switch`:

```ts
    case 'demo/unavailable-for-connector':
      return `/DEMO_RESET no está disponible con ${failure.meta.connectorLabel}: solo funciona con el backend REST de demo.`;
```

Agregar a `src/ui/errors.test.ts`, dentro del `describe('describeError', …)`:

```ts
  it('demo/unavailable-for-connector', () => {
    const message = describeError({
      ok: false,
      error: 'demo/unavailable-for-connector',
      meta: { connectorLabel: 'Google Sheets' },
    });

    expect(message).toBe(
      '/DEMO_RESET no está disponible con Google Sheets: solo funciona con el backend REST de demo.',
    );
  });
```

- [ ] **Step 11: Bloquear `/DEMO_RESET` con un conector distinto de REST (test primero)**

Agregar a `src/storage/demo-reset.test.ts`, dentro del `describe('demoReset', …)`:

```ts
  it('con un conector que no es REST: devuelve demo/unavailable-for-connector sin tocar nada ni llamar al backend', async () => {
    saveSyncConfig({
      type: 'google-sheets',
      webAppUrl: 'https://script.google.com/macros/s/abc/exec',
    });
    const created = await createCustomerLocally('Cliente de prueba');
    if (!created.ok) throw new Error('setup falló');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await demoReset();

    expect(result).toEqual({
      ok: false,
      error: 'demo/unavailable-for-connector',
      meta: { connectorLabel: 'Google Sheets' },
    });
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(db.customers.get(created.value.id)).resolves.not.toBeUndefined();
  });
```

Run: `pnpm vitest run src/storage/demo-reset.test.ts`
Expected: el test nuevo FALLA.

En `src/storage/demo-reset.ts`, agregar los imports y las dos funciones, y el guard dentro de `demoReset`:

```ts
import type { SyncConfig } from '../sync/config.ts';
import { connectorLabel, type ConnectorType } from '../sync/connector-registry.ts';

function unavailableFor(type: ConnectorType): Result<never> {
  return err('demo/unavailable-for-connector', { connectorLabel: connectorLabel(type) });
}

/**
 * `/DEMO_RESET` solo tiene sentido contra el minibackend REST de demo: el
 * `POST /_demo/reset` no es parte del contrato del `Connector` y una config
 * de otro tipo (Google Sheets) ni siquiera tiene `baseUrl`. Decisión del
 * usuario (Etapa 2, #68): bloquearlo con un aviso claro, no resetear a medias.
 * Lo consulta también `ui/keyboard/demo-reset-controller.ts` para avisar al
 * abrir la pantalla.
 */
export function checkDemoResetAvailable(config: SyncConfig): Result<void> {
  return config.type === 'rest' ? ok(undefined) : unavailableFor(config.type);
}
```

y en `demoReset()`, reemplazar el bloque `if (configResult.ok) { const backendReset = … }` por:

```ts
  if (configResult.ok) {
    if (configResult.value.type !== 'rest') {
      return unavailableFor(configResult.value.type);
    }
    const backendReset = await resetDemoBackend(configResult.value.baseUrl);
    if (!backendReset.ok) {
      return backendReset;
    }
  }
```

Actualizar además el bloque de comentario de `demoReset` con una línea: "Con un conector que no sea REST se bloquea antes de tocar nada (`checkDemoResetAvailable`)."

Run: `pnpm vitest run src/storage/demo-reset.test.ts`
Expected: PASS.

- [ ] **Step 12: Adaptación transitoria del wizard viejo (se reescribe en el Task 5)**

Es lo mínimo para que el wizard actual siga compilando y guardando una config válida; el Task 5 lo reemplaza entero.

En `src/ui/keyboard/config-controller.ts`:
- `import { saveSyncConfig, syncConfigSchema } from '../../sync/config.ts';` → `import { restConfigSchema } from '../../connectors/rest/config.ts';` + `import { saveSyncConfig } from '../../sync/config.ts';`
- `syncConfigSchema.shape.baseUrl.safeParse(buffer)` → `restConfigSchema.shape.baseUrl.safeParse(buffer)`
- en `submitLocale`, agregar `type: 'rest' as const,` como primera propiedad del objeto `config`.

En `src/ui/keyboard/config-controller.test.ts`, los dos `loadSyncConfig()` esperados ganan `type: 'rest'`:

```ts
      value: { type: 'rest', baseUrl: 'https://api.example.com', apiKey: 'secret-key', locale: 'en-US' },
```
```ts
    expect(loadSyncConfig()).toEqual({ ok: true, value: { type: 'rest', baseUrl: 'https://api.example.com' } });
```

En `src/ui/screens/config-screen.test.tsx`, el `loadSyncConfig()` esperado:

```ts
      value: { type: 'rest', baseUrl: 'https://api.example.com', apiKey: 'secret', locale: 'en-US' },
```

- [ ] **Step 13: Verificar todo y commitear**

Run: `pnpm test; pnpm typecheck; pnpm lint`
Expected: todo verde.

Run: `pnpm prettier --check --end-of-line auto src/sync src/storage/demo-reset.ts src/storage/demo-reset.test.ts src/ui/errors.ts src/ui/errors.test.ts src/domain/result.ts`
Expected: sin diferencias (si marca algo, `pnpm prettier --write --end-of-line auto <archivo>`).

```bash
git add -A src
git commit -m "feat: registro de conectores y SyncConfig como unión por type (#68)

Config guardada sin type se lee como REST (terminales ya configuradas no pierden su conexión). /DEMO_RESET se bloquea con un conector que no es REST."
```

---

### Task 4: `/DEMO_RESET` avisa al abrir la pantalla

**Files:**
- Modify: `src/ui/keyboard/demo-reset-controller.ts`
- Test: `src/ui/keyboard/demo-reset-controller.test.ts`

**Interfaces:**
- Consumes: `checkDemoResetAvailable(config: SyncConfig): Result<void>` (`storage/demo-reset.ts`, Task 3); `loadSyncConfig`; `describeError`; `demoResetErrorSignal`.
- Produces: `enterDemoResetScreen()` deja el aviso en `demoResetErrorSignal` si el conector configurado no es REST (la pantalla ya renderiza ese signal).

- [ ] **Step 1: Escribir los tests que fallan**

En `src/ui/keyboard/demo-reset-controller.test.ts`, agregar `import { saveSyncConfig } from '../../sync/config.ts';` y, dentro de `describe('enterDemoResetScreen / exitDemoResetScreen', …)`:

```ts
  it('con un conector de Google Sheets, muestra el aviso de no disponible apenas se abre', () => {
    saveSyncConfig({
      type: 'google-sheets',
      webAppUrl: 'https://script.google.com/macros/s/abc/exec',
    });

    enterDemoResetScreen();

    expect(activeScreenSignal.value).toBe('demo-reset');
    expect(demoResetErrorSignal.value).toBe(
      '/DEMO_RESET no está disponible con Google Sheets: solo funciona con el backend REST de demo.',
    );
  });

  it('con un conector REST o sin config, no muestra ningún aviso', () => {
    enterDemoResetScreen();
    expect(demoResetErrorSignal.value).toBeNull();

    exitDemoResetScreen();
    saveSyncConfig({ type: 'rest', baseUrl: 'http://localhost:4000' });
    enterDemoResetScreen();
    expect(demoResetErrorSignal.value).toBeNull();
  });
```

y dentro de `describe('confirmDemoReset', …)`:

```ts
  it('con un conector de Google Sheets, Enter no borra nada y mantiene el aviso', async () => {
    await seedCatalogIfEmpty({ now: '2026-01-01T00:00:00.000Z' });
    saveSyncConfig({
      type: 'google-sheets',
      webAppUrl: 'https://script.google.com/macros/s/abc/exec',
    });
    enterDemoResetScreen();

    await confirmDemoReset();

    expect(activeScreenSignal.value).toBe('demo-reset');
    expect(demoResetErrorSignal.value).toContain('no está disponible con Google Sheets');
    await expect(db.products.count()).resolves.toBeGreaterThan(0);
  });
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `pnpm vitest run src/ui/keyboard/demo-reset-controller.test.ts`
Expected: FAIL en los dos tests de Sheets (`demoResetErrorSignal` queda `null` al abrir).

- [ ] **Step 3: Implementación**

En `src/ui/keyboard/demo-reset-controller.ts`, agregar los imports:

```ts
import { checkDemoResetAvailable } from '../../storage/demo-reset.ts';
import { loadSyncConfig } from '../../sync/config.ts';
```
(`demoReset` ya se importa desde `../../storage/demo-reset.ts`: combinar en un solo import.) Y reemplazar `enterDemoResetScreen`:

```ts
/**
 * `/DEMO_RESET`: entra a la pantalla de confirmación dedicada (mismo patrón
 * que `/ANULAR`). Con un conector que no es REST muestra el aviso de "no
 * disponible" apenas se abre, en vez de dejar que el usuario llegue a
 * confirmar para enterarse — `demoReset()` lo vuelve a verificar de fondo.
 */
export function enterDemoResetScreen(): void {
  const configResult = loadSyncConfig();
  const availability = configResult.ok ? checkDemoResetAvailable(configResult.value) : undefined;
  demoResetErrorSignal.value =
    availability !== undefined && !availability.ok ? describeError(availability) : null;
  demoResetInProgressSignal.value = false;
  activeScreenSignal.value = 'demo-reset';
}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `pnpm vitest run src/ui/keyboard/demo-reset-controller.test.ts; pnpm typecheck; pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/keyboard/demo-reset-controller.ts src/ui/keyboard/demo-reset-controller.test.ts
git commit -m "feat: /DEMO_RESET avisa al abrir que no está disponible con Google Sheets (#68)"
```

---

### Task 5: `/CONFIG` como diálogo modal (estado, controlador y pantalla)

Un solo task: el estado y el controlador se usan solo desde la pantalla, y separarlos dejaría un commit con la pantalla vieja apuntando a signals que ya no existen. Adentro: primero controlador (TDD), después pantalla (TDD). **Cierra #56.**

**Files:**
- Rewrite: `src/ui/state/sync-config.ts`
- Rewrite: `src/ui/keyboard/config-controller.ts`, `src/ui/keyboard/config-controller.test.ts`
- Rewrite: `src/ui/screens/config-screen.tsx`, `src/ui/screens/config-screen.test.tsx`

**Interfaces:**
- Consumes: `CONNECTOR_TYPES`, `connectorFields`, `toFieldValues`, `type ConnectorType` (registro); `syncConfigSchema`, `loadSyncConfig`, `saveSyncConfig`, `type SyncConfig` (`sync/config.ts`); `activeScreenSignal`; `setSyncConfigured`.
- Produces:
  - Estado (`ui/state/sync-config.ts`): `DEFAULT_BASE_URL = 'http://localhost:4000'`, `DEFAULT_API_KEY = 'demo-token'`; `configTypeSignal: Signal<ConnectorType>`; `configFieldValuesSignal: Signal<Record<ConnectorType, Record<string, string>>>`; `configLocaleSignal: Signal<string>`; `configErrorSignal: Signal<string | null>`; `configErrorFieldSignal: Signal<string | null>` (clave del campo a enfocar); `resetConfigForm(saved?: SyncConfig): void`
  - Controlador: `enterConfigScreen()`, `cancelConfigScreen()`, `setConfigType(type: ConnectorType)`, `setConfigField(key: string, value: string)`, `setConfigLocale(value: string)`, `submitConfig()`
  - Pantalla: `ConfigScreen` (heading `Configurar conexión`; selector `aria-label="Tipo de conexión"`; cada campo con `data-config-field="<key>"`)

- [ ] **Step 1: Escribir los tests del controlador (fallan)**

Reemplazar todo `src/ui/keyboard/config-controller.test.ts` por:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadSyncConfig, saveSyncConfig } from '../../sync/config.ts';
import { activeScreenSignal } from '../state/screen.ts';
import { syncConfiguredSignal } from '../state/sync.ts';
import {
  configErrorFieldSignal,
  configErrorSignal,
  configFieldValuesSignal,
  configLocaleSignal,
  configTypeSignal,
} from '../state/sync-config.ts';
import {
  cancelConfigScreen,
  enterConfigScreen,
  setConfigField,
  setConfigLocale,
  setConfigType,
  submitConfig,
} from './config-controller.ts';

const WEB_APP_URL = 'https://script.google.com/macros/s/abc/exec';

beforeEach(() => {
  activeScreenSignal.value = 'sale';
  syncConfiguredSignal.value = false;
  enterConfigScreen();
});

afterEach(() => {
  localStorage.clear();
});

describe('enterConfigScreen', () => {
  it('cambia a la pantalla config, en REST y sin error', () => {
    expect(activeScreenSignal.value).toBe('config');
    expect(configTypeSignal.value).toBe('rest');
    expect(configErrorSignal.value).toBeNull();
  });

  it('sin config guardada, precarga los defaults del minibackend de demo (URL y API key)', () => {
    expect(configFieldValuesSignal.value.rest).toEqual({
      baseUrl: 'http://localhost:4000',
      apiKey: 'demo-token',
    });
    expect(configLocaleSignal.value).toBe('');
  });

  it('con una config REST guardada, precarga esos valores en vez de los defaults', () => {
    saveSyncConfig({ type: 'rest', baseUrl: 'https://api.example.com', locale: 'es-AR' });

    enterConfigScreen();

    expect(configTypeSignal.value).toBe('rest');
    // apiKey guardada como ausente: se muestra vacía, no el default del demo.
    expect(configFieldValuesSignal.value.rest).toEqual({
      baseUrl: 'https://api.example.com',
      apiKey: '',
    });
    expect(configLocaleSignal.value).toBe('es-AR');
  });

  it('con una config de Google Sheets guardada, abre en ese tipo con sus valores', () => {
    saveSyncConfig({ type: 'google-sheets', webAppUrl: WEB_APP_URL, sharedSecret: 's3cr3t' });

    enterConfigScreen();

    expect(configTypeSignal.value).toBe('google-sheets');
    expect(configFieldValuesSignal.value['google-sheets']).toEqual({
      webAppUrl: WEB_APP_URL,
      sharedSecret: 's3cr3t',
    });
  });

  it('con una config guardada sin type (formato anterior a la Etapa 2), la precarga como REST', () => {
    localStorage.setItem(
      'offline-pos:sync-config',
      JSON.stringify({ baseUrl: 'https://api.example.com', apiKey: 'vieja' }),
    );

    enterConfigScreen();

    expect(configTypeSignal.value).toBe('rest');
    expect(configFieldValuesSignal.value.rest).toEqual({
      baseUrl: 'https://api.example.com',
      apiKey: 'vieja',
    });
  });
});

describe('setConfigType', () => {
  it('cambia el tipo activo sin perder lo tipeado en el otro', () => {
    setConfigField('baseUrl', 'https://api.example.com');
    setConfigType('google-sheets');
    setConfigField('webAppUrl', WEB_APP_URL);
    setConfigType('rest');

    expect(configTypeSignal.value).toBe('rest');
    expect(configFieldValuesSignal.value.rest.baseUrl).toBe('https://api.example.com');
    expect(configFieldValuesSignal.value['google-sheets'].webAppUrl).toBe(WEB_APP_URL);
  });

  it('limpia el error visible', () => {
    setConfigField('baseUrl', '');
    submitConfig();
    expect(configErrorSignal.value).not.toBeNull();

    setConfigType('google-sheets');

    expect(configErrorSignal.value).toBeNull();
    expect(configErrorFieldSignal.value).toBeNull();
  });
});

describe('submitConfig — REST', () => {
  it('guarda la config completa (con apiKey y locale) y vuelve a la venta', () => {
    setConfigField('baseUrl', 'https://api.example.com');
    setConfigField('apiKey', 'secret-key');
    setConfigLocale('en-US');

    submitConfig();

    expect(activeScreenSignal.value).toBe('sale');
    expect(syncConfiguredSignal.value).toBe(true);
    expect(loadSyncConfig()).toEqual({
      ok: true,
      value: {
        type: 'rest',
        baseUrl: 'https://api.example.com',
        apiKey: 'secret-key',
        locale: 'en-US',
      },
    });
  });

  it('apiKey y locale vacíos son válidos y quedan sin guardar', () => {
    setConfigField('baseUrl', 'https://api.example.com');
    setConfigField('apiKey', '');
    setConfigLocale('');

    submitConfig();

    expect(loadSyncConfig()).toEqual({
      ok: true,
      value: { type: 'rest', baseUrl: 'https://api.example.com' },
    });
  });

  it('recorta los espacios de los valores', () => {
    setConfigField('baseUrl', '  https://api.example.com  ');
    setConfigField('apiKey', '');

    submitConfig();

    expect(loadSyncConfig()).toEqual({
      ok: true,
      value: { type: 'rest', baseUrl: 'https://api.example.com' },
    });
  });

  it('rechaza una URL vacía: error sobre ese campo, se queda en la pantalla y no guarda', () => {
    setConfigField('baseUrl', '');

    submitConfig();

    expect(configErrorSignal.value).toBe('Completá «URL del sistema externo».');
    expect(configErrorFieldSignal.value).toBe('baseUrl');
    expect(activeScreenSignal.value).toBe('config');
    expect(loadSyncConfig().ok).toBe(false);
  });

  it('rechaza una URL inválida con un mensaje sobre ese campo', () => {
    setConfigField('baseUrl', 'no-es-una-url');

    submitConfig();

    expect(configErrorSignal.value).toBe('«URL del sistema externo» no es válido.');
    expect(configErrorFieldSignal.value).toBe('baseUrl');
    expect(activeScreenSignal.value).toBe('config');
  });
});

describe('submitConfig — Google Sheets', () => {
  beforeEach(() => {
    setConfigType('google-sheets');
  });

  it('guarda solo los campos de Sheets (sin restos de REST) más locale', () => {
    // Se tipea una URL en REST y se vuelve a Sheets: esos valores no deben viajar.
    setConfigType('rest');
    setConfigField('baseUrl', 'https://api.example.com');
    setConfigType('google-sheets');
    setConfigField('webAppUrl', WEB_APP_URL);
    setConfigField('sharedSecret', 's3cr3t');
    setConfigLocale('es-AR');

    submitConfig();

    expect(activeScreenSignal.value).toBe('sale');
    expect(loadSyncConfig()).toEqual({
      ok: true,
      value: {
        type: 'google-sheets',
        webAppUrl: WEB_APP_URL,
        sharedSecret: 's3cr3t',
        locale: 'es-AR',
      },
    });
  });

  it('el secreto compartido es opcional', () => {
    setConfigField('webAppUrl', WEB_APP_URL);

    submitConfig();

    expect(loadSyncConfig()).toEqual({
      ok: true,
      value: { type: 'google-sheets', webAppUrl: WEB_APP_URL },
    });
  });

  it('rechaza una Web App URL inválida, señalando ese campo', () => {
    setConfigField('webAppUrl', 'no-es-una-url');

    submitConfig();

    expect(configErrorSignal.value).toBe('«URL del Web App de Google Apps Script» no es válido.');
    expect(configErrorFieldSignal.value).toBe('webAppUrl');
    expect(activeScreenSignal.value).toBe('config');
  });

  it('rechaza una Web App URL vacía', () => {
    submitConfig();

    expect(configErrorSignal.value).toBe('Completá «URL del Web App de Google Apps Script».');
    expect(configErrorFieldSignal.value).toBe('webAppUrl');
  });
});

describe('cancelConfigScreen', () => {
  it('vuelve a la venta sin guardar nada', () => {
    setConfigField('baseUrl', 'https://api.example.com');

    cancelConfigScreen();

    expect(activeScreenSignal.value).toBe('sale');
    expect(loadSyncConfig().ok).toBe(false);
  });
});
```

Run: `pnpm vitest run src/ui/keyboard/config-controller.test.ts`
Expected: FAIL (el controlador viejo no exporta nada de esto).

- [ ] **Step 2: Reescribir el estado**

`src/ui/state/sync-config.ts`:

```ts
import { signal } from '@preact/signals';
import type { SyncConfig } from '../../sync/config.ts';
import { toFieldValues, type ConnectorType } from '../../sync/connector-registry.ts';

/** URL default del minibackend de demo (Fase 7) — precargada en REST cuando no hay config guardada, sigue siendo editable. */
export const DEFAULT_BASE_URL = 'http://localhost:4000';
/**
 * API key default de REST, precargada igual que `DEFAULT_BASE_URL` — el
 * minibackend de demo solo exige que el header `Authorization: Bearer <token>`
 * no esté vacío (`router.ts::hasValidBearerToken`), cualquier string no vacío
 * sirve. Sin esto, seguir el camino "obvio" del demo (aceptar la URL
 * precargada, dejar el campo "opcional" en blanco) deja el catálogo vacío por
 * un 401 silencioso (`sync/engine.ts` traga errores de pull) — ver hallazgo
 * de la revisión final de Fase 7.
 */
export const DEFAULT_API_KEY = 'demo-token';

/** Valores de los campos de cada conector, como strings (lo que se tipea). */
export type ConfigFormValues = Record<ConnectorType, Record<string, string>>;

function defaultFormValues(): ConfigFormValues {
  return {
    rest: { baseUrl: DEFAULT_BASE_URL, apiKey: DEFAULT_API_KEY },
    'google-sheets': { webAppUrl: '', sharedSecret: '' },
  };
}

/** Conector elegido en el selector. */
export const configTypeSignal = signal<ConnectorType>('rest');
/**
 * Valores tipeados **por conector**: cambiar el tipo no pierde lo que ya se
 * cargó en el otro, y solo los campos del tipo activo llegan a guardarse.
 */
export const configFieldValuesSignal = signal<ConfigFormValues>(defaultFormValues());
/** `locale` es config de terminal (no de conector): un solo valor, siempre visible. */
export const configLocaleSignal = signal('');
export const configErrorSignal = signal<string | null>(null);
/** Clave del campo al que apunta el error, para enfocarlo y seleccionarlo (`data-config-field`). */
export const configErrorFieldSignal = signal<string | null>(null);

/**
 * Deja el formulario en su estado inicial. Con `saved`, precarga esa config
 * (tipo, campos y locale) — así reconfigurar un solo dato no obliga a
 * retipear los demás; sin ella (terminal nueva), arranca en REST con los
 * defaults del demo.
 */
export function resetConfigForm(saved?: SyncConfig): void {
  const values = defaultFormValues();
  if (saved !== undefined) {
    values[saved.type] = toFieldValues(saved);
  }
  configTypeSignal.value = saved?.type ?? 'rest';
  configFieldValuesSignal.value = values;
  configLocaleSignal.value = saved?.locale ?? '';
  configErrorSignal.value = null;
  configErrorFieldSignal.value = null;
}
```

- [ ] **Step 3: Reescribir el controlador**

`src/ui/keyboard/config-controller.ts`:

```ts
import { loadSyncConfig, saveSyncConfig, syncConfigSchema } from '../../sync/config.ts';
import { connectorFields, type ConnectorType } from '../../sync/connector-registry.ts';
import { activeScreenSignal } from '../state/screen.ts';
import { setSyncConfigured } from '../state/sync.ts';
import {
  configErrorFieldSignal,
  configErrorSignal,
  configFieldValuesSignal,
  configLocaleSignal,
  configTypeSignal,
  resetConfigForm,
} from '../state/sync-config.ts';

/** `/CONFIG`: abre el formulario, precargado con la config guardada (o los defaults del demo si no hay). */
export function enterConfigScreen(): void {
  const saved = loadSyncConfig();
  resetConfigForm(saved.ok ? saved.value : undefined);
  activeScreenSignal.value = 'config';
}

/** Esc: sale sin guardar nada. */
export function cancelConfigScreen(): void {
  resetConfigForm();
  activeScreenSignal.value = 'sale';
}

function clearConfigError(): void {
  configErrorSignal.value = null;
  configErrorFieldSignal.value = null;
}

/** Cambia el conector elegido — los campos que se muestran cambian en el acto, sin perder lo tipeado en el otro. */
export function setConfigType(type: ConnectorType): void {
  configTypeSignal.value = type;
  clearConfigError();
}

/** Edita un campo del conector activo. */
export function setConfigField(key: string, value: string): void {
  const type = configTypeSignal.value;
  const all = configFieldValuesSignal.value;
  configFieldValuesSignal.value = { ...all, [type]: { ...all[type], [key]: value } };
  clearConfigError();
}

export function setConfigLocale(value: string): void {
  configLocaleSignal.value = value;
  clearConfigError();
}

/**
 * Ctrl+Enter: valida todo junto y guarda. La validación ocurre solo acá,
 * nunca mientras se tipea (mismo criterio que Cobro, #55). Un valor vacío se
 * omite de la config guardada (un opcional en blanco no se guarda).
 */
export function submitConfig(): void {
  const type = configTypeSignal.value;
  const fields = connectorFields(type);
  const raw = configFieldValuesSignal.value[type];

  const candidate: Record<string, string> = { type };
  for (const field of fields) {
    const value = (raw[field.key] ?? '').trim();
    if (value !== '') {
      candidate[field.key] = value;
    }
  }
  const locale = configLocaleSignal.value.trim();
  if (locale !== '') {
    candidate.locale = locale;
  }

  const parsed = syncConfigSchema.safeParse(candidate);
  if (!parsed.success) {
    const offendingKey = parsed.error.issues[0]?.path[0];
    const field = fields.find((candidateField) => candidateField.key === offendingKey);
    if (field === undefined) {
      configErrorSignal.value = 'La configuración no es válida.';
      return;
    }
    const isEmpty = (raw[field.key] ?? '').trim() === '';
    configErrorFieldSignal.value = field.key;
    configErrorSignal.value = isEmpty
      ? `Completá «${field.label}».`
      : `«${field.label}» no es válido.`;
    return;
  }

  const saveResult = saveSyncConfig(parsed.data);
  if (!saveResult.ok) {
    configErrorSignal.value = 'No se pudo guardar la configuración.';
    return;
  }

  setSyncConfigured(true);
  resetConfigForm();
  activeScreenSignal.value = 'sale';
}
```

- [ ] **Step 4: Correr los tests del controlador**

Run: `pnpm vitest run src/ui/keyboard/config-controller.test.ts`
Expected: PASS. (`pnpm typecheck` todavía falla: `config-screen.tsx` usa los signals viejos. Se arregla en los pasos siguientes; no commitear todavía.)

- [ ] **Step 5: Escribir los tests de la pantalla (fallan)**

Reemplazar todo `src/ui/screens/config-screen.test.tsx` por:

```tsx
import { fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadSyncConfig, saveSyncConfig } from '../../sync/config.ts';
import { enterConfigScreen } from '../keyboard/config-controller.ts';
import { activeScreenSignal } from '../state/screen.ts';
import { syncConfiguredSignal } from '../state/sync.ts';
import { ConfigScreen } from './config-screen.tsx';

const WEB_APP_URL = 'https://script.google.com/macros/s/abc/exec';
const CTRL_ENTER = { key: 'Enter', ctrlKey: true };

beforeEach(() => {
  syncConfiguredSignal.value = false;
  enterConfigScreen();
});

afterEach(() => {
  localStorage.clear();
});

function typeSelect(): HTMLSelectElement {
  return screen.getByLabelText('Tipo de conexión') as HTMLSelectElement;
}

describe('ConfigScreen', () => {
  it('muestra el selector de tipo con REST elegido y los campos de REST más el locale', () => {
    render(<ConfigScreen />);

    expect(typeSelect().value).toBe('rest');
    expect(screen.getByLabelText(/URL del sistema externo/)).not.toBeNull();
    expect(screen.getByLabelText(/API key/)).not.toBeNull();
    expect(screen.getByLabelText(/Locale/)).not.toBeNull();
  });

  it('el foco arranca en el selector de tipo', () => {
    render(<ConfigScreen />);

    expect(document.activeElement).toBe(typeSelect());
  });

  it('cambiar el tipo a Google Sheets intercambia los campos sin ocultar el selector', () => {
    render(<ConfigScreen />);

    fireEvent.change(typeSelect(), { target: { value: 'google-sheets' } });

    expect(screen.queryByLabelText(/URL del sistema externo/)).toBeNull();
    expect(screen.queryByLabelText(/API key/)).toBeNull();
    expect(screen.getByLabelText(/URL del Web App/)).not.toBeNull();
    expect(screen.getByLabelText(/Secreto compartido/)).not.toBeNull();
    expect(screen.getByLabelText(/Locale/)).not.toBeNull();
    expect(typeSelect().value).toBe('google-sheets');
  });

  it('marca como opcionales los campos opcionales', () => {
    render(<ConfigScreen />);

    expect(screen.getByLabelText(/API key.*opcional/)).not.toBeNull();
    expect(screen.queryByLabelText(/URL del sistema externo.*opcional/)).toBeNull();
  });

  it('Ctrl+Enter guarda todos los campos de REST juntos y vuelve a la venta', () => {
    render(<ConfigScreen />);
    const url = screen.getByLabelText(/URL del sistema externo/);
    const apiKey = screen.getByLabelText(/API key/);
    const locale = screen.getByLabelText(/Locale/);

    fireEvent.input(url, { target: { value: 'https://api.example.com' } });
    fireEvent.input(apiKey, { target: { value: 'secret' } });
    fireEvent.input(locale, { target: { value: 'en-US' } });
    fireEvent.keyDown(locale, CTRL_ENTER);

    expect(activeScreenSignal.value).toBe('sale');
    expect(loadSyncConfig()).toEqual({
      ok: true,
      value: { type: 'rest', baseUrl: 'https://api.example.com', apiKey: 'secret', locale: 'en-US' },
    });
  });

  it('Ctrl+Enter guarda una config de Google Sheets', () => {
    render(<ConfigScreen />);
    fireEvent.change(typeSelect(), { target: { value: 'google-sheets' } });
    const webApp = screen.getByLabelText(/URL del Web App/);

    fireEvent.input(webApp, { target: { value: WEB_APP_URL } });
    fireEvent.keyDown(webApp, CTRL_ENTER);

    expect(activeScreenSignal.value).toBe('sale');
    expect(loadSyncConfig()).toEqual({
      ok: true,
      value: { type: 'google-sheets', webAppUrl: WEB_APP_URL },
    });
  });

  it('Enter solo no guarda ni avanza (a diferencia del wizard anterior)', () => {
    render(<ConfigScreen />);
    const url = screen.getByLabelText(/URL del sistema externo/);

    fireEvent.input(url, { target: { value: 'https://api.example.com' } });
    fireEvent.keyDown(url, { key: 'Enter' });

    expect(activeScreenSignal.value).toBe('config');
    expect(loadSyncConfig().ok).toBe(false);
  });

  it('valida solo al confirmar: sin error mientras se tipea, alerta al Ctrl+Enter', () => {
    render(<ConfigScreen />);
    const url = screen.getByLabelText(/URL del sistema externo/);

    fireEvent.input(url, { target: { value: 'no-es-una-url' } });
    expect(screen.queryByRole('alert')).toBeNull();

    fireEvent.keyDown(url, CTRL_ENTER);

    expect(screen.getByRole('alert').textContent).toContain('URL del sistema externo');
    expect(activeScreenSignal.value).toBe('config');
  });

  it('Escape cancela sin guardar y vuelve a la venta', () => {
    render(<ConfigScreen />);
    const url = screen.getByLabelText(/URL del sistema externo/);
    fireEvent.input(url, { target: { value: 'https://api.example.com' } });

    fireEvent.keyDown(url, { key: 'Escape' });

    expect(activeScreenSignal.value).toBe('sale');
    expect(loadSyncConfig().ok).toBe(false);
  });

  it('Escape también cancela con el foco en el selector de tipo', () => {
    render(<ConfigScreen />);

    fireEvent.keyDown(typeSelect(), { key: 'Escape' });

    expect(activeScreenSignal.value).toBe('sale');
  });

  it('precarga la config guardada al abrirse', () => {
    saveSyncConfig({ type: 'google-sheets', webAppUrl: WEB_APP_URL, locale: 'es-AR' });
    enterConfigScreen();

    render(<ConfigScreen />);

    expect(typeSelect().value).toBe('google-sheets');
    expect((screen.getByLabelText(/URL del Web App/) as HTMLInputElement).value).toBe(WEB_APP_URL);
    expect((screen.getByLabelText(/Locale/) as HTMLInputElement).value).toBe('es-AR');
  });
});
```

Run: `pnpm vitest run src/ui/screens/config-screen.test.tsx`
Expected: FAIL.

- [ ] **Step 6: Reescribir la pantalla**

`src/ui/screens/config-screen.tsx`:

```tsx
import { useSignalEffect } from '@preact/signals';
import type { TargetedEvent, TargetedKeyboardEvent } from 'preact';
import { useRef } from 'preact/hooks';
import type { ConfigField } from '../../connectors/config-field.ts';
import { CONNECTOR_TYPES, connectorFields } from '../../sync/connector-registry.ts';
import { useFocusOnMount } from '../hooks/use-focus-on-mount.ts';
import {
  cancelConfigScreen,
  setConfigField,
  setConfigLocale,
  setConfigType,
  submitConfig,
} from '../keyboard/config-controller.ts';
import {
  configErrorFieldSignal,
  configErrorSignal,
  configFieldValuesSignal,
  configLocaleSignal,
  configTypeSignal,
} from '../state/sync-config.ts';

const overlayStyle = {
  height: 'var(--app-height)',
  overflowY: 'auto' as const,
  display: 'flex',
  flexDirection: 'column' as const,
  alignItems: 'center',
  justifyContent: 'center',
  padding: 'var(--space-4)',
  background: 'var(--color-surface)',
};

const dialogStyle = {
  width: '100%',
  maxWidth: '560px',
  background: 'var(--color-bg)',
  borderRadius: 'var(--radius-md)',
  boxShadow: 'var(--shadow-card)',
  padding: 'var(--space-4)',
  display: 'flex',
  flexDirection: 'column' as const,
  gap: 'var(--space-3)',
  color: 'var(--color-text)',
  fontFamily: 'var(--font-sans)',
};

const fieldStyle = {
  display: 'flex',
  flexDirection: 'column' as const,
  gap: 'var(--space-2)',
};

const controlStyle = {
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--font-size-base)',
  padding: 'var(--space-2)',
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--color-border)',
  background: 'var(--color-bg)',
  color: 'var(--color-text)',
};

const buttonStyle = {
  padding: 'var(--space-2) var(--space-3)',
  borderRadius: 'var(--radius-md)',
  whiteSpace: 'nowrap' as const,
};

/** `locale` es config de terminal, no de un conector: vive aparte y va siempre al final. */
const LOCALE_FIELD: ConfigField = {
  key: 'locale',
  label: 'Locale (ej. es-AR — en blanco usa el del navegador)',
  optional: true,
};

function fieldLabel(field: ConfigField): string {
  return field.optional ? `${field.label} (opcional)` : field.label;
}

/**
 * `/CONFIG` como diálogo modal (#68, cierra #56): mismo chrome que Cobro
 * (#55) — tarjeta centrada sobre un overlay, todos los campos visibles a la
 * vez. Tab/Shift+Tab (nativo) navega entre ellos, Ctrl+Enter valida y guarda
 * todo junto, Esc cancela; Enter solo no hace nada. El selector de tipo de
 * conector es el primer campo y nunca se oculta: cambiarlo intercambia en el
 * acto los campos específicos de abajo (cada conector declara los suyos en
 * `connectors/<tipo>/config.ts`), y `locale` queda siempre al final.
 */
export function ConfigScreen() {
  const typeRef = useFocusOnMount<HTMLSelectElement>();
  const dialogRef = useRef<HTMLDivElement>(null);

  // Un error apunta a un campo concreto: enfocarlo y seleccionarlo permite
  // retipear de una (mismo criterio que Cobro con `select()`).
  useSignalEffect(() => {
    const key = configErrorFieldSignal.value;
    if (key === null || configErrorSignal.value === null) {
      return;
    }
    const input = dialogRef.current?.querySelector<HTMLInputElement>(
      `[data-config-field="${key}"]`,
    );
    input?.focus();
    input?.select();
  });

  const handleKeyDown = (event: TargetedKeyboardEvent<HTMLInputElement | HTMLSelectElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      cancelConfigScreen();
      return;
    }
    if (event.key === 'Enter' && event.ctrlKey) {
      event.preventDefault();
      submitConfig();
    }
  };

  const handleTypeChange = (event: TargetedEvent<HTMLSelectElement>) => {
    const chosen = CONNECTOR_TYPES.find((info) => info.type === event.currentTarget.value);
    if (chosen !== undefined) {
      setConfigType(chosen.type);
    }
  };

  const type = configTypeSignal.value;
  const values = configFieldValuesSignal.value[type];
  const visibleFields = [...connectorFields(type), LOCALE_FIELD];

  return (
    <div style={overlayStyle}>
      <div ref={dialogRef} style={dialogStyle}>
        <h1 style={{ margin: 0, fontSize: 'var(--font-size-xl)' }}>Configurar conexión</h1>

        <label style={fieldStyle}>
          <span>Tipo de conexión</span>
          <select
            ref={typeRef}
            value={type}
            onChange={handleTypeChange}
            onKeyDown={handleKeyDown}
            aria-label="Tipo de conexión"
            style={controlStyle}
          >
            {CONNECTOR_TYPES.map((info) => (
              <option key={info.type} value={info.type}>
                {info.label}
              </option>
            ))}
          </select>
        </label>

        {visibleFields.map((field) => {
          const isLocale = field.key === 'locale';
          const value = isLocale ? configLocaleSignal.value : (values[field.key] ?? '');
          const isInvalid = configErrorFieldSignal.value === field.key;
          return (
            <label key={`${type}:${field.key}`} style={fieldStyle}>
              <span>{fieldLabel(field)}</span>
              <input
                type="text"
                value={value}
                onInput={(event) =>
                  isLocale
                    ? setConfigLocale(event.currentTarget.value)
                    : setConfigField(field.key, event.currentTarget.value)
                }
                onKeyDown={handleKeyDown}
                data-config-field={field.key}
                aria-label={fieldLabel(field)}
                style={{
                  ...controlStyle,
                  borderColor: isInvalid ? 'var(--color-danger)' : 'var(--color-border)',
                }}
              />
            </label>
          );
        })}

        <div style={{ minHeight: 'var(--space-8)' }}>
          {configErrorSignal.value !== null && (
            <p role="alert" style={{ margin: 0, color: 'var(--color-danger)' }}>
              {configErrorSignal.value}
            </p>
          )}
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 'var(--space-3)',
          }}
        >
          <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>
            Tab para moverte entre campos, Ctrl+Enter para guardar, Esc para cancelar.
          </p>
          <div style={{ display: 'flex', gap: 'var(--space-2)', flexShrink: 0 }}>
            <button type="button" onClick={cancelConfigScreen} style={buttonStyle}>
              Cancelar
            </button>
            <button type="button" onClick={submitConfig} style={buttonStyle}>
              Guardar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Correr los tests de la pantalla**

Run: `pnpm vitest run src/ui/screens/config-screen.test.tsx src/ui/keyboard/config-controller.test.ts`
Expected: PASS. Si `getByLabelText(/API key.*opcional/)` no encuentra el campo, revisar que el `aria-label` incluya el sufijo `(opcional)` (viene de `fieldLabel`). Si falla `document.activeElement` en el test del foco, confirmar que `useFocusOnMount` recibe el ref del `<select>` (no de un input).

- [ ] **Step 8: Verificar que no queda nada del wizard viejo**

Run: `grep -rn "configStepSignal\|configBufferSignal\|configBaseUrlSignal\|configApiKeySignal\|resetConfigFlow\|submitConfigStep\|ConfigStep" src e2e`
Expected: sin resultados.

Run: `pnpm test; pnpm typecheck; pnpm lint`
Expected: todo verde.

Run: `pnpm prettier --check --end-of-line auto src/ui/state/sync-config.ts src/ui/keyboard/config-controller.ts src/ui/keyboard/config-controller.test.ts src/ui/screens/config-screen.tsx src/ui/screens/config-screen.test.tsx`
Expected: sin diferencias.

- [ ] **Step 9: Commit**

```bash
git add -A src
git commit -m "feat: /CONFIG como diálogo modal con selector de tipo de conector (#68, cierra #56)"
```

---

### Task 6: e2e — recorrer el formulario nuevo y probar la migración

Los e2e corren contra el build real (`pnpm build && pnpm preview`) y el minibackend en `:4000`; `playwright.config.ts` levanta ambos. Ver `e2e/README` o `playwright.config.ts` si algo no arranca.

**Files:**
- Modify: `e2e/minibackend-sync.spec.ts`
- Create: `e2e/config-connector.spec.ts`
- (Sin cambios, pero se re-verifica) `e2e/keyboard-only.spec.ts` — su test `/CONFIG → Esc → foco` sigue valiendo: el foco arranca en el selector, que maneja Esc.

**Interfaces:**
- Consumes: la UI del Task 5 (`Tipo de conexión`, `URL del sistema externo`, `API key`, `Locale`, `URL del Web App de Google Apps Script`, `Secreto compartido`, heading `Configurar conexión`).
- Produces: cobertura e2e del flujo teclado-only del modal.

- [ ] **Step 1: Adaptar `e2e/minibackend-sync.spec.ts` al formulario**

En el test `'vender con el minibackend real configurado…'`, reemplazar el tramo que recorría el wizard (desde `const urlInput = …` hasta `await page.getByLabel(/Locale/).press('Enter');`), **conservando el comentario largo sobre el Bearer token del minibackend**, por:

```ts
  const urlInput = page.getByLabel(/URL del sistema externo/);
  await expect(urlInput).toHaveValue(BACKEND_URL);

  // (comentario existente sobre por qué hace falta un Bearer token no vacío)
  const apiKeyInput = page.getByLabel(/API key/);
  await apiKeyInput.fill('demo-api-key');

  // Ctrl+Enter guarda todos los campos juntos (el formulario reemplazó al
  // wizard de 3 pasos; Enter solo ya no avanza nada).
  await apiKeyInput.press('Control+Enter');
  await expect(commandBar).toBeVisible();
```

y borrar las líneas `await urlInput.press('Enter');`, `await apiKeyInput.press('Enter');` y `await page.getByLabel(/Locale/).press('Enter');`.

- [ ] **Step 2: Escribir el spec nuevo**

`e2e/config-connector.spec.ts`:

```ts
import { expect, test, type Page } from '@playwright/test';

const WEB_APP_URL = 'https://script.google.com/macros/s/e2e/exec';
const STORAGE_KEY = 'offline-pos:sync-config';

test.beforeEach(async ({ page }) => {
  // Ningún test de este archivo necesita hablar con Google: si el motor de
  // sync intenta sincronizar contra el Web App, que falle rápido y en silencio.
  await page.route('https://script.google.com/**', (route) => route.abort());
});

async function openConfig(page: Page): Promise<void> {
  const commandBar = page.getByLabel('Barra de comandos');
  await commandBar.fill('/CONFIG');
  await commandBar.press('Enter');
  await expect(page.getByRole('heading', { name: 'Configurar conexión' })).toBeVisible();
}

test('elegir Google Sheets solo con teclado, validar al confirmar, guardar y verlo precargado', async ({
  page,
}) => {
  await page.goto('/');
  await openConfig(page);

  // El foco arranca en el selector de tipo; type-ahead ("G") elige Google Sheets.
  const typeSelect = page.getByLabel('Tipo de conexión');
  await expect(typeSelect).toBeFocused();
  await typeSelect.press('G');
  await expect(typeSelect).toHaveValue('google-sheets');

  // Los campos de REST desaparecen, los de Sheets aparecen, el selector sigue.
  await expect(page.getByLabel(/URL del sistema externo/)).toHaveCount(0);
  await page.keyboard.press('Tab');
  await expect(page.getByLabel(/URL del Web App/)).toBeFocused();

  // Validación solo al confirmar: una URL inválida no molesta mientras se tipea…
  await page.keyboard.type('no-es-una-url');
  await expect(page.getByRole('alert')).toHaveCount(0);
  // …pero Ctrl+Enter la rechaza, se queda en el modal y deja el campo seleccionado.
  await page.keyboard.press('Control+Enter');
  await expect(page.getByRole('alert')).toContainText('URL del Web App');
  await expect(page.getByRole('heading', { name: 'Configurar conexión' })).toBeVisible();

  // El campo quedó enfocado y seleccionado: tipear reemplaza.
  await page.keyboard.type(WEB_APP_URL);
  await page.keyboard.press('Control+Enter');
  await expect(page.getByLabel('Barra de comandos')).toBeFocused();

  const stored = await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY);
  expect(JSON.parse(stored ?? 'null')).toEqual({ type: 'google-sheets', webAppUrl: WEB_APP_URL });

  // Reabrir /CONFIG muestra lo guardado, no los defaults del demo.
  await openConfig(page);
  await expect(page.getByLabel('Tipo de conexión')).toHaveValue('google-sheets');
  await expect(page.getByLabel(/URL del Web App/)).toHaveValue(WEB_APP_URL);
});

test('una config guardada por una versión anterior (sin type) se lee como REST y se precarga', async ({
  page,
}) => {
  await page.addInitScript((key) => {
    localStorage.setItem(
      key,
      JSON.stringify({ baseUrl: 'http://localhost:4123', apiKey: 'clave-vieja' }),
    );
  }, STORAGE_KEY);

  await page.goto('/');
  await openConfig(page);

  await expect(page.getByLabel('Tipo de conexión')).toHaveValue('rest');
  // Valores distintos de los defaults del demo (4000 / demo-token): prueba que
  // se leyó la config vieja y no que cayó a los defaults por "inválida".
  await expect(page.getByLabel(/URL del sistema externo/)).toHaveValue('http://localhost:4123');
  await expect(page.getByLabel(/API key/)).toHaveValue('clave-vieja');
});

test('Esc cancela sin guardar', async ({ page }) => {
  await page.goto('/');
  await openConfig(page);
  await page.getByLabel(/URL del sistema externo/).fill('http://localhost:9999');

  await page.keyboard.press('Escape');

  await expect(page.getByLabel('Barra de comandos')).toBeFocused();
  const stored = await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY);
  expect(stored).toBeNull();
});
```

- [ ] **Step 3: Correr los e2e afectados**

Run: `pnpm build && pnpm test:e2e e2e/config-connector.spec.ts e2e/minibackend-sync.spec.ts e2e/keyboard-only.spec.ts`
Expected: PASS. Si el type-ahead `press('G')` no cambia el valor en el navegador del entorno, usar `typeSelect.selectOption('google-sheets')` en ese paso y dejar un comentario (el resto del flujo sigue siendo teclado-only).

- [ ] **Step 4: Commit**

```bash
git add e2e/minibackend-sync.spec.ts e2e/config-connector.spec.ts
git commit -m "test: e2e del formulario de /CONFIG, selector de conector y migración de config vieja (#68)"
```

---

### Task 7: Documentación

**Files:**
- Modify: `CLAUDE.md`
- Modify: `src/connectors/google-sheets/README.md`

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: CLAUDE.md al día con el registro de conectores, el nuevo `/CONFIG`, el bloqueo de `/DEMO_RESET` y la config guardada con `type`.

- [ ] **Step 1: Ubicar los pasajes a actualizar en `CLAUDE.md`**

Run: `grep -n "rest-fetch-connector\|implementaciones de referencia\|se configura por terminal vía\|/CONFIG\` (configura\|DEMO_RESET\` (Ciclo 8\|Ciclo 10, sobre" CLAUDE.md`

- [ ] **Step 2: Editar `CLAUDE.md`**

1. **"Estructura de proyecto"**: la línea de `connectors/` pasa a
   `connectors/       # un subdirectorio por conector (rest/, google-sheets/): su config, sus campos para /CONFIG y su factory`
   y sumar a `sync/` que ahí vive `connector-registry.ts`.
2. **"Connector API"**: reemplazar "`connectors/rest-fetch-connector.ts` es la implementación de referencia sobre `fetch`." por:
   > `connectors/rest/rest-fetch-connector.ts` es la implementación de referencia sobre `fetch`; `connectors/google-sheets/` implementa el mismo puerto contra una planilla de Google Sheets a través de un puente Apps Script (`bridge.gs`, ver su README). Cada conector es dueño de su schema de config y de la lista ordenada de campos que `/CONFIG` muestra (`configFields`); `sync/connector-registry.ts` arma la unión discriminada por `type` y expone `createConnector(config)`, el único punto que elige implementación (`sync/engine.ts::runSyncCycle` y `sync/account-hold.ts::requestAccountHoldNow` ya no instancian ninguno directo). "Plugin" acá significa un registro cerrado de conectores compilados, no carga de código de terceros en runtime (descartada: ejecución de código arbitrario en una app que maneja ventas y pagos) — un conector nuevo es un PR al repo.
3. **Config runtime**: en la frase "Autenticación (Bearer) se configura por terminal vía `/CONFIG` (runtime, `localStorage` — `sync/config.ts`)" agregar:
   > La config guardada es `{ type, …campos del conector, locale? }`. Una config guardada sin `type` (anterior al registro) se lee como `type: 'rest'` (`z.preprocess` en `syncConfigSchema`), así ninguna terminal ya configurada pierde su conexión al actualizar.
4. **Comandos → `/CONFIG`**: describirlo como diálogo modal con selector de tipo de conector, todos los campos visibles a la vez (Tab/Shift+Tab, Ctrl+Enter guarda, Esc cancela, Enter solo no hace nada), validación solo al confirmar, precargado con la config guardada (o con los defaults del demo si no hay ninguna). Mismo chrome que Cobro. Cierra el issue #56.
5. **`/DEMO_RESET`**: agregar
   > Con un conector que no es REST (hoy Google Sheets) está **bloqueado**: `POST /_demo/reset` solo existe en el minibackend REST de demo y una config de Sheets no tiene `baseUrl`. `storage/demo-reset.ts::checkDemoResetAvailable` lo verifica y `enterDemoResetScreen` muestra el aviso ("no está disponible con Google Sheets") apenas se abre la pantalla; `demoReset()` lo repite de fondo antes de tocar nada.
6. **"Estado del proyecto"**: sumar un bullet tras el Ciclo 10:
   > - Conectores plugin (epic #66, sesión de brainstorming 2026-09-17): Etapa 1 (#67) — conector de Google Sheets aislado con puente Apps Script; Etapa 2 (#68) — registro cerrado de conectores + `/CONFIG` como modal con selector de tipo (absorbe #56) + lectura de la config vieja sin `type` como REST + `/DEMO_RESET` bloqueado con Sheets. Pendiente: Etapa 3 (#69, crédito ilimitado explícito en cuenta corriente).

- [ ] **Step 3: Actualizar el README del conector de Sheets**

En `src/connectors/google-sheets/README.md`:
- Reemplazar el bloque `> Estado: Etapa 1 (#67) …` por `> Estado: conectado al POS desde la Etapa 2 (#68) — se elige en \`/CONFIG\` con el tipo de conexión "Google Sheets".`
- Paso 5 del setup: `Pegar la URL (y el secreto, si lo pusiste) en \`/CONFIG\`: elegir el tipo de conexión "Google Sheets" (con la letra G alcanza) y completar "URL del Web App" y, opcionalmente, "Secreto compartido".`
- Agregar bajo "Limitaciones conocidas": `- \`/DEMO_RESET\` no está disponible con este conector (solo funciona con el backend REST de demo); la planilla nunca se resetea desde el POS.`

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md src/connectors/google-sheets/README.md
git commit -m "docs: registro de conectores, /CONFIG como modal y /DEMO_RESET con Sheets (#68)"
```

---

### Task 8: Verificación final y prueba manual

**Files:** ninguno.

- [ ] **Step 1: Verificación completa**

Run: `pnpm test; pnpm typecheck; pnpm lint; pnpm test:backend`
Expected: todo verde.

Run: `pnpm build && pnpm test:e2e`
Expected: la suite e2e completa pasa.

Run: `git diff --stat origin/main...HEAD` y `grep -rn "connectors/rest-fetch-connector" src demo-backend/src e2e CLAUDE.md`
Expected: el diff solo toca lo listado en "File Structure"; el `grep` no devuelve nada.

- [ ] **Step 2: Prueba manual contra la app real (la hace el usuario)**

`pnpm dev` levanta la app y el minibackend. Casos:

1. **Terminal nueva** (borrar `localStorage` de `offline-pos:sync-config`): `/CONFIG` → el selector "Tipo de conexión" tiene el foco y dice "REST genérico"; URL `http://localhost:4000` y API key `demo-token` precargadas. Tab recorre URL → API key → Locale; Shift+Tab vuelve. Ctrl+Enter guarda, la barra de estado deja de decir "sin configurar" y el catálogo aparece tras `/SINCRONIZAR`.
2. **Reabrir `/CONFIG`**: muestra lo guardado (no los defaults). Tipear una URL inválida + Ctrl+Enter: alerta sobre ese campo, campo seleccionado, no se cierra. Esc cancela sin guardar.
3. **Cambiar a Google Sheets** (con la letra G): los campos de REST se reemplazan por "URL del Web App" y "Secreto compartido", el selector sigue. Pegar la URL del Web App de la planilla de prueba, Ctrl+Enter, `/SINCRONIZAR`: aparece el catálogo de `Productos`. Vender algo en efectivo y verificar las filas en `Ventas` y `Pagos`.
4. **`/DEMO_RESET` con Sheets**: al abrir la pantalla ya dice "no está disponible con Google Sheets…"; Enter no borra nada.
5. **Config vieja**: en DevTools > Application > Local Storage, dejar `offline-pos:sync-config` como `{"baseUrl":"http://localhost:4000","apiKey":"demo-token"}` (sin `type`), recargar: el sync sigue andando y `/CONFIG` abre en REST con esos valores.

- [ ] **Step 3: PR (solo con el OK del usuario tras la prueba manual)**

```bash
git push -u origin claude/sheets-connector-stage-2
gh pr create --base main --head claude/sheets-connector-stage-2 --title "feat: registro de conectores y /CONFIG como modal (#68)"
```

Cuerpo del PR: resumen de las decisiones que ajustan el spec (arriba), plan de pruebas, `Closes #68`, `Closes #56`, parte de #66, y la línea `🤖 Generated with [Claude Code](https://claude.com/claude-code)`. Merge commit normal, no squash. Después: `mcp__ccd_pr__get_status` para leer el CI (no hacer polling con `gh`).

---

## Self-Review

**Spec coverage** (spec "Etapa 2" + "UI de `/CONFIG`", issue #68):
- Mover REST a `connectors/rest/` → Task 2. `restConfigSchema` en `connectors/rest/config.ts` → Task 1.
- `sync/connector-registry.ts` con `z.discriminatedUnion('type', …)` y `createConnector` → Task 3.
- `SyncConfig` = `{ locale? } & (RestConfig | GoogleSheetsConfig)`, `locale` fuera de la unión → Task 3 (`syncConfigSchema`).
- Reemplazar los dos call sites (`runSyncCycle`, `requestAccountHoldNow`) → Task 3, con tests de que eligen por `type`.
- Tests de rutas movidas → Task 2 (el test del conector se mueve con `git mv`).
- `/CONFIG` modal (tarjeta centrada, overlay, chrome de #55), selector de tipo primer campo siempre visible, campos del tipo elegido visibles a la vez + `locale` al final → Task 5.
- Tab/Shift+Tab, Ctrl+Enter guarda todo, Esc cancela, validación solo al confirmar → Task 5 (pantalla + controlador + tests).
- `configFields: { key, label, optional }[]` por conector → Task 1; consumido en Tasks 3 y 5; consistencia con el schema verificada por test.
- Tests de `connector-registry.ts` (elige el conector por `type`, rechaza config inválida) y de controller/pantalla (campos cambian con el tipo, navegación, validación al confirmar) → Tasks 3 y 5.
- Cierra #56 → Task 5 y PR (Task 8).
- **Puntos que el spec no cubría** (decisiones acordadas): config vieja sin `type` (Task 3), `/DEMO_RESET` con Sheets (Tasks 3–4), precarga de lo guardado (Task 5), `createConnector(ConnectorConfig)` y `RestConnectionConfig` (Tasks 2–3).

**Placeholder scan:** sin TBD/TODO. Único texto que el ejecutor debe completar mirando el archivo: el Step 1 del Task 6, que nombra el comentario existente ("comentario existente sobre por qué hace falta un Bearer token no vacío") en vez de copiarlo — es texto que ya está en el archivo y debe conservarse tal cual.

**Type consistency:** `ConfigField<K>` (Task 1) es el tipo de `restConfigFields`/`googleSheetsConfigFields`, de `ConnectorTypeInfo.fields` (Task 3) y de `LOCALE_FIELD` (Task 5). `ConnectorType`/`ConnectorConfig`/`CONNECTOR_TYPES`/`connectorLabel`/`connectorFields`/`toFieldValues`/`createConnector` se definen en el Task 3 y se usan con esos nombres en Tasks 4–5. `checkDemoResetAvailable(config: SyncConfig): Result<void>` se define en el Task 3 y se consume en el Task 4. Los signals `configTypeSignal`/`configFieldValuesSignal`/`configLocaleSignal`/`configErrorSignal`/`configErrorFieldSignal` y las funciones `setConfigType`/`setConfigField`/`setConfigLocale`/`submitConfig` coinciden entre estado, controlador, pantalla y ambos archivos de test. `'demo/unavailable-for-connector'` con meta `{ connectorLabel: string }` idéntico en `result.ts`, `errors.ts`, `demo-reset.ts` y sus tests.
