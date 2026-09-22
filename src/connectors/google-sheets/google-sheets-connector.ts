import { z } from 'zod';
import { productSchema, type Product } from '../../domain/product.ts';
import { ok, type Result } from '../../domain/result.ts';
import { newId } from '../../storage/ids.ts';
import {
  connectorCustomerSchema,
  type AccountHoldResult,
  type Connector,
  type ConnectorCustomer,
  type ConnectorPullResult,
} from '../../sync/connector.ts';
import { callBridge } from './bridge-client.ts';
import type { GoogleSheetsConfig } from './config.ts';

/** Producto tal como lo manda el puente: sin `tracksStock`, que fija este conector. */
const bridgeProductSchema = productSchema.omit({ tracksStock: true });

const productsDataSchema = z.object({ items: z.array(bridgeProductSchema) });
const customersDataSchema = z.object({ items: z.array(connectorCustomerSchema) });

/** Las acciones de escritura del puente responden `data: {}` — no hay nada que leer. */
const emptyDataSchema = z.object({});

/**
 * Implementación del puerto `Connector` contra un Apps Script Web App (ver
 * `README.md` de esta carpeta y el spec de la Etapa 1, #67). Caso de uso:
 * backend completo para un micro-comercio sin ERP — catálogo y ventas viven
 * en una planilla.
 *
 * Lo que **no** llama al puente, a propósito:
 * - `requestAccountHold`/`releaseAccountHold`: el fiado es sin bloqueo, la
 *   decisión siempre es "sí" — no vale un round-trip. Nunca hubo una
 *   reserva real que liberar.
 * - `pullStock`/`pushStockMovement`: no aplican. `pullProducts` fija
 *   `tracksStock: false`, y `storage/sale-repository.ts` solo genera
 *   movimientos para productos que trackean stock, así que
 *   `pushStockMovement` en la práctica nunca se invoca.
 *
 * `pullCustomers` fija `unrestricted: true` en cada cliente (Etapa 3, #69):
 * el fiado contra Sheets es sin bloqueo ni `creditLimit`/`margin` reales que
 * declarar, así que esta es la única forma de decir "sin restricción" sin
 * fabricar esos números.
 */
export function createGoogleSheetsConnector(config: GoogleSheetsConfig): Connector {
  async function push(
    action: string,
    payload: object,
    idempotencyKey: string,
  ): Promise<Result<void>> {
    const result = await callBridge(config, { action, payload, idempotencyKey }, emptyDataSchema);
    if (!result.ok) {
      return result;
    }
    return ok(undefined);
  }

  return {
    async pullProducts(params): Promise<Result<ConnectorPullResult<Product>>> {
      const result = await callBridge(
        config,
        { action: 'pullProducts', payload: params },
        productsDataSchema,
      );
      if (!result.ok) {
        return result;
      }
      // Pull completo, sin delta ni cursor: la planilla de un micro-comercio es chica.
      return ok({ items: result.value.items.map((item) => ({ ...item, tracksStock: false })) });
    },

    async pullCustomers(params): Promise<Result<ConnectorPullResult<ConnectorCustomer>>> {
      const result = await callBridge(
        config,
        { action: 'pullCustomers', payload: params },
        customersDataSchema,
      );
      if (!result.ok) {
        return result;
      }
      return ok({ items: result.value.items.map((item) => ({ ...item, unrestricted: true })) });
    },

    pushSale(sale, idempotencyKey) {
      return push('pushSale', { sale }, idempotencyKey);
    },

    pushSaleVoid(params, idempotencyKey) {
      return push('pushSaleVoid', params, idempotencyKey);
    },

    pushCustomer(customer, idempotencyKey) {
      return push('pushCustomer', { customer }, idempotencyKey);
    },

    pushAccountHoldConfirm(params, idempotencyKey) {
      return push('pushAccountHoldConfirm', params, idempotencyKey);
    },

    pushCashSession(session, idempotencyKey) {
      return push('pushCashSession', { session }, idempotencyKey);
    },

    requestAccountHold(): Promise<Result<AccountHoldResult>> {
      return Promise.resolve(ok({ approved: true, holdId: newId() }));
    },

    releaseAccountHold(): Promise<Result<void>> {
      return Promise.resolve(ok(undefined));
    },

    pullStock() {
      return Promise.resolve(ok([]));
    },

    pushStockMovement(): Promise<Result<void>> {
      return Promise.resolve(ok(undefined));
    },
  };
}
