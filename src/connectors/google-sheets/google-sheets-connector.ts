import { z } from 'zod';
import { productSchema } from '../../domain/product.ts';
import { ok, type Result } from '../../domain/result.ts';
import { newId } from '../../storage/ids.ts';
import {
  connectorCustomerSchema,
  type AccountHoldResult,
  type BatchLotStatus,
  type Connector,
  type OutboxBatchItem,
  type PullBatchParams,
  type PullBatchResult,
} from '../../sync/connector.ts';
import { callBridge } from './bridge-client.ts';
import type { GoogleSheetsConfig } from './config.ts';

/** Producto tal como lo manda el puente: sin `tracksStock`, que fija este conector. */
const bridgeProductSchema = productSchema.omit({ tracksStock: true });

const productsDataSchema = z.object({ items: z.array(bridgeProductSchema) });
const customersDataSchema = z.object({ items: z.array(connectorCustomerSchema) });
const emptyDataSchema = z.object({});

/**
 * Implementación del puerto `Connector` contra un Apps Script Web App (ver
 * `README.md` de esta carpeta y el spec de la Etapa 1, #67) — adaptada al
 * contrato batch (#87) de forma **mecánica**: `bridge.gs` sigue exponiendo
 * las mismas acciones de siempre, una por evento; este conector solo cambia
 * su cara hacia `sync/engine.ts`, no su forma de hablar con el puente. La
 * Etapa 2 le da a `bridge.gs` un batch real puertas adentro — ver CLAUDE.md,
 * "Connector API".
 *
 * `stock-movement`/`account-hold-release` siguen siendo no-ops (nunca hubo
 * llamada real al puente para esto, ver la implementación anterior a #87):
 * el fiado contra Sheets es sin bloqueo real que liberar, y `pullProducts`
 * ya fija `tracksStock: false` así que un movimiento de stock nunca se
 * genera para estos productos en la práctica.
 */
export function createGoogleSheetsConnector(config: GoogleSheetsConfig): Connector {
  async function pushOne(item: OutboxBatchItem): Promise<Result<void>> {
    switch (item.type) {
      case 'sale':
        return callBridge(
          config,
          { action: 'pushSale', payload: { sale: item.sale }, idempotencyKey: item.id },
          emptyDataSchema,
        ).then((r) => (r.ok ? ok(undefined) : r));
      case 'sale-void': {
        const payload = {
          saleId: item.saleId,
          voidedAt: item.voidedAt,
          ...(item.voidReason !== undefined ? { voidReason: item.voidReason } : {}),
        };
        return callBridge(
          config,
          { action: 'pushSaleVoid', payload, idempotencyKey: item.id },
          emptyDataSchema,
        ).then((r) => (r.ok ? ok(undefined) : r));
      }
      case 'customer':
        return callBridge(
          config,
          { action: 'pushCustomer', payload: { customer: item.customer }, idempotencyKey: item.id },
          emptyDataSchema,
        ).then((r) => (r.ok ? ok(undefined) : r));
      case 'account-hold-confirm':
        return callBridge(
          config,
          {
            action: 'pushAccountHoldConfirm',
            payload: { holdId: item.holdId, saleId: item.saleId },
            idempotencyKey: item.id,
          },
          emptyDataSchema,
        ).then((r) => (r.ok ? ok(undefined) : r));
      case 'cash-session':
        return callBridge(
          config,
          { action: 'pushCashSession', payload: { session: item.session }, idempotencyKey: item.id },
          emptyDataSchema,
        ).then((r) => (r.ok ? ok(undefined) : r));
      case 'stock-movement':
      case 'account-hold-release':
        return Promise.resolve(ok(undefined));
      default: {
        const exhaustiveCheck: never = item;
        throw new Error(`Tipo de evento de outbox desconocido: ${JSON.stringify(exhaustiveCheck)}`);
      }
    }
  }

  return {
    async pushBatch(items: OutboxBatchItem[]): Promise<Result<void>> {
      for (const item of items) {
        const result = await pushOne(item);
        if (!result.ok) {
          return result;
        }
      }
      return ok(undefined);
    },

    async pullBatch(params: PullBatchParams): Promise<Result<PullBatchResult>> {
      const productsResult = await callBridge(config, { action: 'pullProducts', payload: {} }, productsDataSchema);
      if (!productsResult.ok) {
        return productsResult;
      }
      const customersResult = await callBridge(config, { action: 'pullCustomers', payload: {} }, customersDataSchema);
      if (!customersResult.ok) {
        return customersResult;
      }

      const lots: Record<string, BatchLotStatus> = {};
      for (const id of params.pendingLotIds) {
        lots[id] = { status: 'ok' };
      }

      return ok({
        products: { items: productsResult.value.items.map((item) => ({ ...item, tracksStock: false })) },
        customers: { items: customersResult.value.items.map((item) => ({ ...item, unrestricted: true })) },
        stock: [],
        lots,
      });
    },

    requestAccountHold(): Promise<Result<AccountHoldResult>> {
      return Promise.resolve(ok({ approved: true, holdId: newId() }));
    },
  };
}
