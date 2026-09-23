import { z } from 'zod';
import { productSchema } from '../../domain/product.ts';
import { ok, type Result } from '../../domain/result.ts';
import { newId } from '../../storage/ids.ts';
import {
  connectorCustomerSchema,
  type AccountHoldResult,
  type Connector,
  type OutboxBatchItem,
  type PullBatchParams,
  type PullBatchResult,
} from '../../sync/connector.ts';
import { callBridge } from './bridge-client.ts';
import type { GoogleSheetsConfig } from './config.ts';

/** Producto tal como lo manda el puente: sin `tracksStock`, que fija este conector. */
const bridgeProductSchema = productSchema.omit({ tracksStock: true });

const pullResultSchema = <T extends z.ZodType>(itemSchema: T) =>
  z.object({ items: z.array(itemSchema), nextCursor: z.string().optional() });

const lotStatusSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('pending') }),
  z.object({ status: z.literal('ok') }),
  z.object({ status: z.literal('issues'), issues: z.array(z.string()) }),
]);

const pullBatchDataSchema = z.object({
  products: pullResultSchema(bridgeProductSchema),
  customers: pullResultSchema(connectorCustomerSchema),
  lots: z.record(z.string(), lotStatusSchema),
});

const emptyDataSchema = z.object({});

/**
 * Implementación del puerto `Connector` contra un Apps Script Web App (ver
 * `README.md` de esta carpeta y el spec de la Etapa 1, #67) — batch real
 * desde la Etapa 2 (#87): `bridge.gs` expone `pushBatch`/`pullBatch`, igual
 * que el conector REST, en vez de una acción por evento/recurso.
 *
 * `stock-movement`/`account-hold-release` siguen siendo no-ops del lado de
 * Sheets (nunca hubo llamada real al puente para esto): el fiado contra
 * Sheets es sin bloqueo real que liberar, y `pullBatch` ya fija
 * `tracksStock: false` así que un movimiento de stock nunca se genera para
 * estos productos en la práctica.
 */
export function createGoogleSheetsConnector(config: GoogleSheetsConfig): Connector {
  return {
    async pushBatch(items: OutboxBatchItem[], idempotencyId: string): Promise<Result<void>> {
      const result = await callBridge(
        config,
        { action: 'pushBatch', payload: { events: items }, idempotencyKey: idempotencyId },
        emptyDataSchema,
      );
      return result.ok ? ok(undefined) : result;
    },

    async pullBatch(params: PullBatchParams): Promise<Result<PullBatchResult>> {
      const result = await callBridge(
        config,
        {
          action: 'pullBatch',
          payload: { cursors: params.cursors, pendingLotIds: params.pendingLotIds },
        },
        pullBatchDataSchema,
      );
      if (!result.ok) {
        return result;
      }
      const { products, customers, lots } = result.value;
      return ok({
        products: {
          items: products.items.map((item) => ({ ...item, tracksStock: false })),
          ...(products.nextCursor !== undefined ? { nextCursor: products.nextCursor } : {}),
        },
        customers: {
          items: customers.items.map((item) => ({ ...item, unrestricted: true })),
          ...(customers.nextCursor !== undefined ? { nextCursor: customers.nextCursor } : {}),
        },
        stock: [],
        lots,
      });
    },

    requestAccountHold(): Promise<Result<AccountHoldResult>> {
      return Promise.resolve(ok({ approved: true, holdId: newId() }));
    },
  };
}
