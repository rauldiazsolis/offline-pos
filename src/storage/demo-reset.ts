import { err, ok, type Result } from '../domain/result.ts';
import { loadSyncConfig, type SyncConfig } from '../sync/config.ts';
import { connectorLabel, type ConnectorType } from '../sync/connector-registry.ts';
import { clearSyncCursors } from '../sync/cursor.ts';
import { resetDemoBackend } from '../sync/demo-backend-reset.ts';
import { runSyncCycle } from '../sync/engine.ts';
import { db } from './db.ts';
import { clearAllTables } from './local-data.ts';

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

/**
 * `/DEMO_RESET` (Ciclo 8, retomado en Fase 7 — issue #36): vuelve la
 * terminal a un estado limpio para reiniciar una demo. Desde que los datos
 * de demo viven en el minibackend (no en un fixture local, ver
 * `docs/superpowers/specs/2026-09-15-fase-7-minibackend-demo-design.md`),
 * el orden importa:
 *
 * 1. Si hay `/CONFIG` configurado, primero `POST /_demo/reset` contra el
 *    backend — si falla (backend no disponible), se corta acá, sin tocar
 *    nada local: dejar la terminal vacía sin poder repoblarla sería peor
 *    que no resetear nada.
 * 2. Borra todo lo local (catálogo, stock, clientes, cuentas, ventas,
 *    movimientos, turnos de caja, la venta en curso y el outbox pendiente).
 * 3. Limpia los cursores de pull (si no, el resync del paso 4 solo traería
 *    deltas desde el cursor viejo).
 * 4. Si había `/CONFIG`, dispara un resync completo (`runSyncCycle`) para
 *    repoblar desde el backend ya reseteado — reusa el motor de sync
 *    existente en vez de duplicar su lógica de pull.
 *
 * Sin `/CONFIG`, se saltan los pasos 1 y 4: la terminal queda vacía (mismo
 * criterio que `bootstrap.ts`, que tampoco siembra nada localmente).
 *
 * A propósito NO toca la configuración de `/CONFIG` (URL, API key, locale)
 * — es la conexión de esta terminal, no un dato de demo.
 *
 * Con un conector que no sea REST se bloquea antes de tocar nada
 * (`checkDemoResetAvailable`).
 */
export async function demoReset(): Promise<Result<void>> {
  const configResult = loadSyncConfig();

  if (configResult.ok) {
    if (configResult.value.type !== 'rest') {
      return unavailableFor(configResult.value.type);
    }
    const backendReset = await resetDemoBackend(configResult.value.baseUrl);
    if (!backendReset.ok) {
      return backendReset;
    }
  }

  try {
    await db.transaction('rw', db.tables, clearAllTables);
  } catch (error) {
    return err('demo/reset-failed', {
      message: error instanceof Error ? error.message : String(error),
    });
  }

  clearSyncCursors();

  if (configResult.ok) {
    await runSyncCycle();
  }

  return ok(undefined);
}
