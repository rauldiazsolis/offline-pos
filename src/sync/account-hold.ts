import { err, type Result } from '../domain/result.ts';
import { deviceRevokedSignal } from '../ui/state/sync.ts';
import type { AccountHoldResult } from './connector.ts';
import { loadSyncConfig } from './config.ts';
import { createConnector } from './connector-registry.ts';
import { markDeviceRevoked } from './device-revoked.ts';

/**
 * Pide un hold síncrono contra el saldo real (§5, RF-17) — arma el conector
 * real desde la config guardada, mismo criterio que `runSyncCycle`, así la
 * UI (`checkout-controller.ts`) nunca arma un `Connector` directamente. A
 * diferencia de `runSyncCycle`, esto no es un ciclo periódico: se llama una
 * vez, en el momento del cobro, y su resultado decide el flujo ahí mismo —
 * nunca pasa por el outbox.
 *
 * 4.7.0 (#230): con la caja vinculada en otro dispositivo no se pide (daría el mismo 409) y
 * devuelve `sync/device-revoked`; un 409 así la marca. Quien llama (`checkout-controller.ts`) lo
 * trata como sin red: evalúa offline, así el POS nunca se autobloquea.
 */
export async function requestAccountHoldNow(params: {
  customerId: string;
  amount: number;
  idempotencyKey: string;
}): Promise<Result<AccountHoldResult>> {
  const revoked = deviceRevokedSignal.value;
  if (revoked !== undefined) {
    return err(
      'sync/device-revoked',
      revoked.message !== undefined ? { message: revoked.message } : {},
    );
  }
  const configResult = loadSyncConfig();
  if (!configResult.ok) {
    return configResult;
  }

  const connector = createConnector(configResult.value);
  const result = await connector.requestAccountHold(
    { customerId: params.customerId, amount: params.amount },
    params.idempotencyKey,
  );
  if (!result.ok && result.error === 'sync/device-revoked') {
    markDeviceRevoked(new Date().toISOString(), result.meta.message);
  }
  return result;
}
