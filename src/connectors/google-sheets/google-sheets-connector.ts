import { z } from 'zod';
import { ok, type Result } from '../../domain/result.ts';
import { newId } from '../../storage/ids.ts';
import {
  backendInfoSchema,
  batchLotStatusSchema,
  connectorCustomerSchema,
  connectorProductSchema,
  pullResultSchema,
  toBackendInfo,
  toLots,
  withCursor,
  type AccountHoldResult,
  type BackendInfo,
  type Connector,
  type PullBatchParams,
  type PullBatchResult,
  type PushBatch,
} from '../../sync/connector.ts';
import { callBridge } from './bridge-client.ts';
import type { GoogleSheetsConfig } from './config.ts';

/** Producto tal como lo manda el puente: sin `tracksStock`, que fija este conector. */
const bridgeProductSchema = connectorProductSchema.omit({ tracksStock: true });

const pullBatchDataSchema = z.object({
  products: pullResultSchema(bridgeProductSchema),
  customers: pullResultSchema(connectorCustomerSchema),
  lots: z.record(z.string(), batchLotStatusSchema),
});

const emptyDataSchema = z.object({});

/**
 * Implementación del puerto `Connector` contra un Apps Script Web App (ver
 * `README.md` de esta carpeta y el spec de la Etapa 1, #67) — batch real
 * desde la Etapa 2 (#87): `bridge.gs` expone `pushBatch`/`pullBatch`, igual
 * que el conector REST, en vez de una acción por evento/recurso.
 *
 * Contrato v3 (#96): el lote viaja con `deviceId` y cada evento con su sobre
 * (`createdAt`, `origin`); el puente procesa cada lote dentro del request, así
 * que nunca informa `queued`/`processing` — solo `ok` o `issues`.
 *
 * `stock-movement`/`account-hold-release` siguen siendo no-ops del lado de
 * Sheets (nunca hubo llamada real al puente para esto): el fiado contra
 * Sheets es sin bloqueo real que liberar, y `pullBatch` ya fija
 * `tracksStock: false` así que un movimiento de stock nunca se genera para
 * estos productos en la práctica.
 */
export function createGoogleSheetsConnector(config: GoogleSheetsConfig): Connector {
  return {
    async getInfo(): Promise<Result<BackendInfo>> {
      const result = await callBridge(config, { action: 'info' }, backendInfoSchema);
      return result.ok ? ok(toBackendInfo(result.value)) : result;
    },

    async pushBatch(batch: PushBatch, idempotencyId: string): Promise<Result<void>> {
      const result = await callBridge(
        config,
        { action: 'pushBatch', payload: batch, idempotencyKey: idempotencyId },
        emptyDataSchema,
      );
      return result.ok ? ok(undefined) : result;
    },

    async pullBatch(params: PullBatchParams): Promise<Result<PullBatchResult>> {
      const result = await callBridge(
        config,
        {
          action: 'pullBatch',
          payload: {
            deviceId: params.deviceId,
            cursors: params.cursors,
            pendingLotIds: params.pendingLotIds,
          },
        },
        pullBatchDataSchema,
      );
      if (!result.ok) {
        return result;
      }
      const { products, customers, lots } = result.value;
      return ok({
        products: withCursor({
          items: products.items.map((item) => ({ ...item, tracksStock: false })),
          nextCursor: products.nextCursor,
        }),
        customers: withCursor({
          items: customers.items.map((item) => ({ ...item, unrestricted: true })),
          nextCursor: customers.nextCursor,
        }),
        stock: [],
        lots: toLots(lots),
      });
    },

    requestAccountHold(): Promise<Result<AccountHoldResult>> {
      return Promise.resolve(ok({ approved: true, holdId: newId() }));
    },
  };
}
