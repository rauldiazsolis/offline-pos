# Comandos por conector — Etapa 2c Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que cada tipo de conector declare sus propios comandos de la barra (hoy solo `/DEMO_RESET`), y que el POS ofrezca los del núcleo más los del conector activo.

**Architecture:** Declarativo con acciones tipadas: cada tipo declara `commands: { name, description, action }[]` donde `action` es un id tipado (`ConnectorActionId`); la UI resuelve la acción en un mapa exhaustivo (`Record<ConnectorActionId, () => void>`). `connectors/` no importa `ui/`. Un tipo nuevo `'rest-demo'` ("REST (minibackend de demo)") reusa la implementación REST y es el único que declara `/DEMO_RESET`.

**Tech Stack:** TypeScript estricto, Zod 4, Preact + `@preact/signals`, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-21-conexion-verificada-y-comandos-por-conector-design.md` — Parte 2. Issue: #77, parte del epic #66. Depende de la Etapa 2b (#76, PR #78).

## Global Constraints

- Las mismas de la Etapa 2b: `any` prohibido, `Result<T>` en negocio, imports con extensión `.ts`, `exactOptionalPropertyTypes`, todo `ErrorCode` nuevo en `ErrorMeta` y `errors.ts`, cada commit con `pnpm test`, `pnpm typecheck` y `pnpm lint` en verde, verificar formato con `pnpm prettier --check --end-of-line auto <archivos>` sin reformatear lo que ya venía sin formatear, no tocar procesos ajenos (puertos 4000/4173 libres antes de correr e2e), y **usar `Edit`, no `cat >>`, en archivos existentes** (mezcla LF/CRLF).
- Los tests que arrancan el motor de sync o disparan un ciclo en background mockean solo eso (`vi.mock('../sync/engine.ts', …)`), para no dejar trabajo corriendo cuando el test cierra la base.
- Commits terminan con: `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.
- Rama: `claude/comandos-por-conector-2c` (parte de `claude/conexion-verificada-2b`). PR con base en esa rama mientras el #78 esté abierto.

## Impacto conocido

Las terminales de demo con config `rest` (la migrada) pierden `/DEMO_RESET` hasta reconfigurarse como "REST (minibackend de demo)". El origen no cambia (el `type` no forma parte del origen, Etapa 2b), así que reconfigurar no borra nada.

---

### Task 1: Declaración de comandos y tipo `rest-demo` en el registro

**Files:**
- Create: `src/connectors/connector-command.ts`, `src/connectors/rest-demo/config.ts`, `src/connectors/rest-demo/config.test.ts`
- Modify: `src/sync/connector-registry.ts`, `src/sync/connector-registry.test.ts`, `src/sync/connection.ts`, `src/ui/state/sync-config.ts`

**Interfaces:**
- Produces: `type ConnectorActionId = 'demo-reset'`; `type ConnectorCommand = { name: string; description: string; action: ConnectorActionId }`; `restDemoConfigSchema` (`type: 'rest-demo'`, mismos campos que REST), `restDemoConfigFields`, `restDemoCommands`; en el registro: `ConnectorTypeInfo.commands`, `connectorCommands(type: ConnectorType | null): ConnectorCommand[]`, y `'rest-demo'` como tercer tipo.

- [ ] **Step 1: Tests (fallan)** — `src/connectors/rest-demo/config.test.ts`: acepta `{ type: 'rest-demo', baseUrl }` con `apiKey` opcional, rechaza `type: 'rest'` y una URL inválida; `restDemoCommands` = `[{ name: 'DEMO_RESET', description: 'Borrar todos los datos locales y reiniciar la demo', action: 'demo-reset' }]`. En `connector-registry.test.ts`: `CONNECTOR_TYPES` lista `['rest', 'REST genérico'], ['rest-demo', 'REST (minibackend de demo)'], ['google-sheets', 'Google Sheets']`; el test de consistencia de campos suma `'rest-demo': restDemoConfigSchema` a `schemas`; `createConnector({ type: 'rest-demo', baseUrl })` hace `GET {baseUrl}/products`; `connectorCommands('rest-demo')` devuelve el comando y `connectorCommands('rest')`, `connectorCommands('google-sheets')` y `connectorCommands(null)` devuelven `[]`; `toFieldValues` de `rest-demo` devuelve `{ baseUrl, apiKey }`. En `connection.test.ts`: `originKey({ type: 'rest-demo', baseUrl: 'https://Api.Example.com/' })` es igual a `originKey({ type: 'rest', baseUrl: 'https://api.example.com' })` (el tipo no forma parte del origen).

- [ ] **Step 2: Implementación**
  - `connector-command.ts`: los dos tipos de arriba, con un comentario que explique que `ConnectorActionId` es el contrato entre `connectors/` y `ui/keyboard/connector-actions.ts`.
  - `rest-demo/config.ts`: `restDemoConfigSchema = restConfigSchema.extend({ type: z.literal('rest-demo') })`, `RestDemoConfig`, `restDemoConfigFields = restConfigFields`, `restDemoCommands`.
  - `connector-registry.ts`: sumar `restDemoConfigSchema` a la unión; `commands: ConnectorCommand[]` a `ConnectorTypeInfo` (vacío para `rest` y `google-sheets`); la entrada `rest-demo`; `connectorCommands(type)`; `createConnector` y `toFieldValues` agrupan `case 'rest': case 'rest-demo':`.
  - `connection.ts::originKey`: `case 'rest': case 'rest-demo':`.
  - `ui/state/sync-config.ts::blankFormValues`: sumar `'rest-demo': { baseUrl: '', apiKey: '' }`.

- [ ] **Step 3: Verificar y commitear** — `pnpm test; pnpm typecheck; pnpm lint`; commit `feat: declaración de comandos por conector y tipo rest-demo (#77)`.

### Task 2: La barra ofrece los comandos del conector activo; `/DEMO_RESET` solo con `rest-demo`

**Files:**
- Create: `src/ui/keyboard/connector-actions.ts`
- Modify: `src/ui/state/sync.ts`, `src/ui/keyboard/commands.ts`, `src/ui/state/command-bar.ts`, `src/ui/keyboard/command-bar-controller.ts` (+ test), `src/ui/bootstrap.ts` (+ test), `src/sync/apply-connection.ts` (+ test), `src/storage/demo-reset.ts` (+ test), `src/ui/keyboard/demo-reset-controller.ts` (+ test)

**Interfaces:**
- Consumes: `connectorCommands`, `ConnectorActionId` (Task 1).
- Produces: `activeConnectorTypeSignal: Signal<ConnectorType | null>` + `setActiveConnectorType(type)` en `ui/state/sync.ts`; `CORE_COMMANDS` y `availableCommands()` en `ui/keyboard/commands.ts` (reemplazan a `AVAILABLE_COMMANDS`); `CONNECTOR_ACTIONS: Record<ConnectorActionId, () => void>` en `ui/keyboard/connector-actions.ts`.

- [ ] **Step 1: Tests (fallan)**
  - `command-bar-controller.test.ts`: el test de `/DEMO_RESET` pasa a fijar `activeConnectorTypeSignal.value = 'rest-demo'`; agregar: con `'rest'` (o `null`) `/DEMO_RESET` da `Comando desconocido: /DEMO_RESET`, no cambia de pantalla; y `availableCommands()` incluye `DEMO_RESET` solo con `'rest-demo'` y siempre los 7 del núcleo.
  - `bootstrap.test.ts`: con config `rest-demo` activa, `activeConnectorTypeSignal.value` es `'rest-demo'`; sin config, `null`.
  - `apply-connection.test.ts`: tras aplicar un candidato `google-sheets`, `activeConnectorTypeSignal.value` es `'google-sheets'`.
  - `demo-reset.test.ts`: los tests que esperan que el reset funcione siembran `type: 'rest-demo'`; uno nuevo: con `type: 'rest'` devuelve `demo/unavailable-for-connector` con `connectorLabel: 'REST genérico'` sin llamar a `fetch`.
  - `demo-reset-controller.test.ts`: se borran los dos tests del aviso al abrir (Sheets muestra aviso; REST o sin config no muestra); se mantiene el de "Enter no borra nada y mantiene el aviso" (la verificación de fondo).

- [ ] **Step 2: Implementación**
  - `ui/state/sync.ts` (con `Edit`): `activeConnectorTypeSignal` y `setActiveConnectorType`.
  - `commands.ts`: `CORE_COMMANDS` (COBRAR, CAJA, RESUMEN, ANULAR, DESCARTAR, CONFIG, SINCRONIZAR — sin DEMO_RESET) y `availableCommands()` = núcleo + `connectorCommands(activeConnectorTypeSignal.value)` (solo `name`/`description`).
  - `command-bar.ts`: `commandResultsSignal` usa `availableCommands()`.
  - `connector-actions.ts`: `{ 'demo-reset': enterDemoResetScreen }`.
  - `command-bar-controller.ts::runCommand`: sacar el `case 'DEMO_RESET'` y su import; en el `default`, buscar el comando en `connectorCommands(activeConnectorTypeSignal.value)`; si no está, `Comando desconocido`; si está, `CONNECTOR_ACTIONS[command.action]()` y `clearBuffer()`.
  - `bootstrap.ts` y `apply-connection.ts`: `setActiveConnectorType(...)` (desde la config guardada / el candidato aplicado).
  - `demo-reset.ts`: el guard de `demoReset()` pasa a `type !== 'rest-demo'`; se elimina `checkDemoResetAvailable` (ya no lo usa nadie); `unavailableFor` queda como la defensa.
  - `demo-reset-controller.ts::enterDemoResetScreen`: vuelve a ser el simple (sin precheck ni `loadSyncConfig`).

- [ ] **Step 3: Verificar y commitear** — `pnpm test; pnpm typecheck; pnpm lint`; commit `feat: la barra ofrece los comandos del conector activo; /DEMO_RESET solo con rest-demo (#77)`.

### Task 3: e2e, documentación y PR

- [ ] **Step 1: e2e.** `e2e/minibackend-sync.spec.ts`: `selectOption('rest-demo')` en vez de `'rest'`, y tras la configuración verificar que `/` ofrece `DEMO_RESET`. Spec nuevo `e2e/connector-commands.spec.ts` (sin backend): con el fixture (config `rest` activa) el menú de `/` **no** ofrece `DEMO_RESET` y `/DEMO_RESET` + Enter da `Comando desconocido`; con una config `rest-demo` activa sembrada con `addInitScript`, el menú sí lo ofrece y Enter abre "Reiniciar demo".
- [ ] **Step 2: Docs.** `CLAUDE.md`: en "Comandos disponibles" y en "Connector API" documentar los comandos por conector (`connectors/connector-command.ts`, `ui/keyboard/connector-actions.ts`, `availableCommands()`), el tipo `rest-demo`, que `/DEMO_RESET` solo existe con él, y el impacto en terminales de demo con config `rest`; actualizar el bullet de "Estado del proyecto" (2c hecha, pendiente la Etapa 3, #69). `src/connectors/google-sheets/README.md`: la limitación de `/DEMO_RESET` ahora es "no se ofrece con este conector".
- [ ] **Step 3: Verificación final.** `pnpm test; pnpm typecheck; pnpm typecheck:backend; pnpm lint; pnpm test:backend; pnpm test:e2e` (puertos libres) y repetir los specs nuevos con `--repeat-each=10`.
- [ ] **Step 4: PR.** Push de la rama y `gh pr create --base claude/conexion-verificada-2b` (mientras #78 siga abierto; si ya se mergeó, `--base main`), `Closes #77`, parte de #66; bind + `get_status` del PR y una `PushNotification` al terminar.
