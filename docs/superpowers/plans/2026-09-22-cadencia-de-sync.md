# Cadencia de sincronización: intervalo de 5 min, envío por evento y reintentos con temporizador — Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Sacar la sincronización del loop de 15 s (~11.500 ejecuciones/día por terminal contra Apps Script, cerca de sus cuotas) sin que las ventas tarden en salir: un ciclo completo cada 5 minutos como red de seguridad, un ciclo **solo de envío** disparado por cada evento nuevo del outbox, y reintentos agendados al vencimiento del backoff.

**Architecture:** Todo en `sync/engine.ts`. `pushOnce` (envío sin pull) junto a `syncOnce`; `runSyncCycle({ pull })` elige. `requestPushSoon(delayMs)` agenda un ciclo de solo envío conservando el temporizador más próximo (agrupa eventos seguidos y nunca posterga un reintento). Un hook `creating` de Dexie sobre `outbox` (registrado por `startSyncEngine`, que ahora devuelve la función para desregistrarlo) cubre todos los caminos que encolan (venta, anulación, cliente, cierre de caja, confirmación/liberación de fiado) sin tocar cada controlador. Al terminar cada ciclo se agenda el próximo reintento según el `nextAttemptAt` más cercano.

**Tech Stack:** Vitest con `vi.useFakeTimers` (solo `setTimeout`/`setInterval`/`Date`), Dexie hooks.

**Diseño acordado** (conversación 2026-09-22): intervalo de 5 min igual para todos los conectores; disparo por evento = solo envío (1 request), sin pull. La foto completa periódica (al arrancar y cada 1 h) y la reconciliación de bajas son el PR siguiente.

## Global Constraints

- El motor sigue sin bloquear la UI, respetando el cerrojo (`tryAcquireSyncLock`) y la pausa de `/CONFIG` (`syncPausedSignal`).
- No cambia el contrato del `Connector` ni de ningún conector.
- `startSyncEngine` sigue llamándose una sola vez desde `bootstrap.ts` (el test de bootstrap lo mockea).
- Tests que usan Dexie con timers falsos: solo `setTimeout`/`clearTimeout`/`setInterval`/`clearInterval`/`Date` (fake-indexeddb usa `setImmediate`).
- Un PR, merge commit; commits en español con `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.

---

### Task 1: `pushOnce` y `runSyncCycle({ pull: false })`

**Files:** Modify `src/sync/engine.ts`, `src/sync/engine.test.ts`.

- [ ] Tests que fallan: `pushOnce` empuja pendientes sin llamar a `pullProducts`/`pullStock`/`pullCustomers`; deja `sync-error` si había una falla de pull sin resolver (`lastSyncFailureSignal`); `runSyncCycle({ pull: false })` con config REST solo hace `POST /sales`.
- [ ] Implementar `pushOnce(connector, now): Promise<PushSummary>` (estado `syncing` → pendientes → `sync-error` si hay falla previa o eventos atascados, si no `online-idle`; no toca `lastSyncedAt` ni los conteos del catálogo) y el parámetro `options: { pull?: boolean }` de `runSyncCycle`.
- [ ] Commit.

### Task 2: `requestPushSoon` y reintentos agendados

**Files:** Modify `src/sync/engine.ts`, `src/sync/engine.test.ts`.

- [ ] Tests con timers falsos: 3 pedidos seguidos → un solo envío a los 2 s; un pedido a 5 s y otro a 1 s dispara a 1 s, y uno a 1 s seguido de otro a 5 s también a 1 s (nunca se posterga); tras un envío fallido (500) se reintenta solo al vencer el backoff (2 s) y el evento queda `synced`.
- [ ] Implementar `requestPushSoon(delayMs = SYNC_DEBOUNCE_MS)` (conserva el vencimiento más cercano) y `scheduleNextRetry()` al final de cada ciclo (delay = `nextAttemptAt` más cercano, acotado a [1 s, 5 min]).
- [ ] Commit.

### Task 3: Intervalo de 5 min, hook del outbox y `startSyncEngine` desmontable

**Files:** Modify `src/sync/engine.ts`, `src/sync/engine.test.ts`; docs `CLAUDE.md`.

- [ ] Tests: `startSyncEngine()` con timers falsos hace un ciclo completo a los 5 min (no antes); crear un evento en `outbox` dispara un envío a los ~2 s sin pull; la función devuelta desregistra el hook, el intervalo y los timers.
- [ ] Implementar `SYNC_INTERVAL_MS = 5 * 60 * 1000`, el hook `db.outbox.hook('creating', …)` y `startSyncEngine(): () => void`.
- [ ] `CLAUDE.md`: actualizar "Patrón outbox" (ya no dice loop fijo) con la cadencia y los disparos.
- [ ] Verificación completa (`pnpm test; pnpm typecheck; pnpm lint; pnpm test:e2e`), push, PR con base `claude/pausar-sync-en-config` (#82) mientras siga abierto.
