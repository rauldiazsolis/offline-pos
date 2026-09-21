import type { Result } from '../domain/result.ts';
import type { AccountHoldResult } from './connector.ts';
import { loadSyncConfig } from './config.ts';
import { createConnector } from './connector-registry.ts';

/**
 * Pide un hold síncrono contra el saldo real (§5, RF-17) — arma el conector
 * real desde la config guardada, mismo criterio que `runSyncCycle`, así la
 * UI (`checkout-controller.ts`) nunca arma un `Connector` directamente. A
 * diferencia de `runSyncCycle`, esto no es un ciclo periódico: se llama una
 * vez, en el momento del cobro, y su resultado decide el flujo ahí mismo —
 * nunca pasa por el outbox.
 */
export async function requestAccountHoldNow(params: {
  customerId: string;
  amount: number;
  idempotencyKey: string;
}): Promise<Result<AccountHoldResult>> {
  const configResult = loadSyncConfig();
  if (!configResult.ok) {
    return configResult;
  }

  const connector = createConnector(configResult.value);
  return connector.requestAccountHold(
    { customerId: params.customerId, amount: params.amount },
    params.idempotencyKey,
  );
}
