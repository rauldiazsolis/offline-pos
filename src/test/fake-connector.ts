import { ok } from '../domain/result.ts';
import { POS_CONTRACT_VERSION } from '../domain/contract-version.ts';
import type { AccountHoldResult, Connector, PullBatchResult } from '../sync/connector.ts';

/** `Connector` de mentira para tests: todo responde OK y vacío; cada test pisa lo que le importa. */
export function fakeConnector(overrides: Partial<Connector> = {}): Connector {
  return {
    getInfo: () => Promise.resolve(ok({ contractVersion: POS_CONTRACT_VERSION, status: 'ok' })),
    pushBatch: () => Promise.resolve(ok(undefined)),
    pullBatch: () =>
      Promise.resolve(
        ok<PullBatchResult>({
          products: { items: [] },
          customers: { items: [] },
          stock: [],
          lots: {},
        }),
      ),
    requestAccountHold: () =>
      Promise.resolve(ok<AccountHoldResult>({ approved: true, holdId: 'hold-1' })),
    ...overrides,
  };
}
