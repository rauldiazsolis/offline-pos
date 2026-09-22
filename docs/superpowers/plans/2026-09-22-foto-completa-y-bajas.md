# Foto completa periódica y reconciliación de bajas — Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Que la terminal refleje lo que se **dio de baja o cambió de id** en el sistema externo. Hoy ningún pull borra nada (el motor solo hace `bulkPut`), así que un producto o cliente borrado de la planilla sobrevive para siempre en la terminal — y un delta nunca lo va a informar.

**Architecture:** Un pull **sin `since`** pasa a ser la fuente de verdad: lo que no vuelve en él se considera dado de baja y se borra localmente. Cada conector declara `pullMode`: `snapshot` (Sheets: no hay delta, todo pull ya es completo → reconcilia siempre) o `delta` (REST: deltas por `since` en cada ciclo, más una **foto completa** al arrancar, cada 1 hora y a pedido con `/SINCRONIZAR`). La foto completa trae productos, stock y clientes **en memoria** (reusa el `pullEverything` de la prueba de conexión), y solo si las tres partes salieron bien aplica todo en **una transacción Dexie** (upsert + borrado de ausentes). Salvaguardas: se conservan los clientes creados localmente con alta pendiente en el outbox; si el backend devuelve una tabla vacía teniendo datos locales, no se borra nada y la barra avisa (`sync/empty-snapshot`).

**Tech Stack:** Dexie (transacción), Vitest con `fake-indexeddb`, timers falsos para los tests del motor.

**Diseño acordado** (conversación 2026-09-22): foto completa al arrancar y cada 1 hora, además de a pedido; catálogo vacío inesperado → conservar y avisar; el intervalo de 5 min y el envío por evento ya están en #83.

## Global Constraints

- El puerto `Connector` no cambia (`pullProducts({ since? })`, `pullCustomers({ since? })`, `pullStock()`): la foto completa es "llamar sin `since`".
- **Contrato** (`docs/connector-api.openapi.yaml`): dejar escrito que un pull sin `since` devuelve el conjunto completo y es la fuente de verdad para las bajas; un backend que pagine o trunque esa respuesta rompería la reconciliación (hoy el minibackend no pagina).
- Nunca se borran ventas, turnos, movimientos ni el outbox; solo `products`, `stock`, `customers` y `customerAccounts`.
- Reusar el cerrojo de sync y la pausa de `/CONFIG`; sin cambios de UI salvo el mensaje de la barra.
- Formato: `pnpm prettier --check --end-of-line auto` solo en archivos que ya estaban formateados en `origin/main`; `Edit`, no `cat >>`. Merge commit, commits en español con `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.
- Aceptado (raro, documentado en CLAUDE.md): una venta en curso (`draftCart`) puede referir un producto o cliente que la foto acaba de dar de baja; la línea conserva su precio y la venta cierra igual.

---

### Task 1: `pullMode` por conector y `pullEverything` compartido

**Files:** Modify `src/sync/connector-registry.ts`, `src/sync/connector-registry.test.ts`, `src/sync/connection.ts`; Create `src/sync/pull-snapshot.ts`.

- [ ] Test: `connectorPullMode('rest')` y `'rest-demo'` → `'delta'`; `'google-sheets'` → `'snapshot'`; `ConnectorTypeInfo.pullMode` presente en todos.
- [ ] Agregar `pullMode: 'delta' | 'snapshot'` a `ConnectorTypeInfo` y `connectorPullMode(type)`.
- [ ] Mover `pullEverything` y `ProbeSnapshot` de `connection.ts` a `pull-snapshot.ts` (sin dependencias del motor, así el motor puede importarlo sin ciclo); `connection.ts` los re-exporta. Los tests existentes de `connection.test.ts` siguen verdes sin cambios.
- [ ] Commit.

### Task 2: Cuándo toca una foto completa

**Files:** Modify `src/sync/cursor.ts` (+ test); Create `src/sync/full-refresh.ts`, `src/sync/full-refresh.test.ts`.

- [ ] Tests de `isFullRefreshDue({ mode, lastFullAt, now, doneThisSession, forced })`: `snapshot` → siempre `true`; `delta` → `true` si `forced`, si no se hizo en esta sesión, o si pasó ≥ 1 h (`FULL_REFRESH_INTERVAL_MS = 60 * 60 * 1000`); `false` en el resto. Tests de `getLastFullSyncAt/setLastFullSyncAt` y de que `clearSyncCursors` lo borra.
- [ ] Implementar (`localStorage`, best-effort como el resto de `cursor.ts`).
- [ ] Commit.

### Task 3: `reconcileSnapshot` (la transacción que borra ausentes)

**Files:** Create `src/storage/reconcile.ts`, `src/storage/reconcile.test.ts`; Modify `src/domain/result.ts`, `src/ui/errors.ts`, `src/ui/errors.test.ts`.

**Interfaces:** `reconcileSnapshot(snapshot: ProbeSnapshot, options: { now: string }): Promise<Result<{ skipped: SnapshotTable[] }>>` con `SnapshotTable = 'products' | 'stock' | 'customers'`; `ErrorMeta['sync/empty-snapshot'] = { tables: SnapshotTable[] }`.

- [ ] Tests (`fake-indexeddb`): con `products` locales `[p1, p2, p3]` y snapshot `[p1, p2]` → queda `[p1, p2]` con los datos del snapshot; lo mismo para `stock` (por `productId`), `customers` y `customerAccounts` (una cuenta cuyo cliente ya no está también se borra); un cliente **local con `customer` pendiente en el outbox** ausente del snapshot se conserva (y su cuenta); uno ausente cuyo evento ya está `synced` se borra; snapshot de productos **vacío** con productos locales → no borra productos y devuelve `skipped: ['products']` (y sigue reconciliando el resto); tabla vacía sin datos locales → nada que hacer, no cuenta como omitida; ventas, turnos, outbox y `draftCart` intactos.
- [ ] Implementar en una sola `db.transaction('rw', db.products, db.stock, db.customers, db.customerAccounts, db.outbox, …)`: `bulkPut` de lo que llegó (clientes vía `splitConnectorCustomers`, igual que `applyConnection`); borrado de ausentes con `db.table.where('id').noneOf(ids).delete()`; guarda de vacío por tabla. Envolver en `try/catch` → `err('connection/apply-failed', …)`? No: nuevo uso, mismo patrón que `demoReset` (`demo/reset-failed`) — usar `err('sync/reconcile-failed', { message })` (código nuevo) para no confundir el mensaje de "aplicar la conexión".
- [ ] `describeError('sync/empty-snapshot')`: "El sistema externo devolvió {productos|clientes|stock} vacíos; se conservaron los datos locales." y `describeError('sync/reconcile-failed')`.
- [ ] Commit.

### Task 4: El motor hace la foto completa

**Files:** Modify `src/sync/engine.ts`, `src/sync/engine.test.ts`.

- [ ] Tests con conector fake y config REST: (a) el primer ciclo de la sesión es completo: llama a `pullProducts({})` **sin** `since` aunque haya cursor guardado, y reconcilia (un producto local ausente se borra); (b) el segundo ciclo (misma sesión, < 1 h) es delta: manda `since`; (c) con el reloj a +1 h vuelve a ser completo; (d) `runSyncCycle({ full: true })` fuerza foto completa; (e) con un conector `snapshot` (config Sheets) todo ciclo es completo; (f) si **una** de las tres partes falla, no se aplica nada (ni upsert ni borrado), estado `sync-error` con el motivo real y `lastFullSyncAt` sin tocar; (g) tabla vacía con datos locales → datos conservados y `lastSyncFailure` = `sync/empty-snapshot`; (h) tras una foto completa exitosa, los cursores quedan fijados con los `nextCursor` recibidos y `lastFullSyncAt = now`; (i) el ciclo de solo envío (`pull: false`) nunca hace foto completa.
- [ ] Implementar `syncFull(connector, now)` (push → `pullEverything` → `reconcileSnapshot` → cursores, repositorios en memoria, conteos, estado) y elegir en `runSyncCycle` con `isFullRefreshDue`; `doneThisSession` en memoria del módulo (se reinicia con la página).
- [ ] `/SINCRONIZAR` (`command-bar-controller.ts`) pasa `{ full: true }`; ajustar su test.
- [ ] Commit.

### Task 5: Contrato, documentación, verificación y PR

- [ ] `docs/connector-api.openapi.yaml`: descripción de `since` en `/products` y `/customers` (sin `since` = completo = fuente de verdad para bajas; no paginar esa respuesta).
- [ ] `CLAUDE.md`: "Patrón outbox" (foto completa), "Estado del proyecto" y el aviso de la venta en curso.
- [ ] Verificación completa (`pnpm test; pnpm typecheck; pnpm typecheck:backend; pnpm lint; pnpm test:backend; pnpm test:e2e`) y una **verificación real en Chromium** contra el minibackend: borrar un producto en la base del minibackend, esperar la foto completa (o `/SINCRONIZAR`) y ver que desaparece de la terminal.
- [ ] Push, PR con base `claude/cadencia-sync` (#83) mientras siga abierto (`main` si ya se mergeó), `Part of #66`, con el aviso de contrato y las salvaguardas en la descripción. Notificar.

## Self-review

**Cobertura del diseño acordado:** foto completa al arrancar + cada 1 h + a pedido (Tasks 2, 4); `snapshot` vs `delta` por conector (Task 1); bajas reconciliadas con transacción y sin tocar ventas (Task 3); clientes con alta pendiente protegidos (Task 3); vacío inesperado conserva y avisa en la barra (Tasks 3–4); contrato documentado (Task 5).

**Riesgo principal:** una respuesta "completa" que en realidad está truncada o paginada borra de más. Mitigaciones: guarda de vacío, todo-o-nada por foto, el contrato lo prohíbe explícitamente y el minibackend no pagina. Fuera de alcance, para el backlog: bajas explícitas en el contrato (`active: false` / `deletedIds`) para backends con delta exacto.

**Consistencia de nombres:** `pullMode`, `connectorPullMode`, `isFullRefreshDue`, `FULL_REFRESH_INTERVAL_MS`, `getLastFullSyncAt`/`setLastFullSyncAt`, `reconcileSnapshot`, `SnapshotTable`, `sync/empty-snapshot`, `sync/reconcile-failed`, `syncFull`, `runSyncCycle({ pull, full })` se usan igual en todas las tareas.
