import type { Cart } from '../domain/cart.ts';
import type { Customer } from '../domain/customer.ts';
import { db } from './db.ts';

const DRAFT_ID = 'current';

/**
 * La venta en curso (issue #17) vivía solo en memoria (`cartSignal`) — un
 * refresh, un crash del navegador o quedarse sin batería la borraba sin
 * ningún rastro. Distinto de `outbox`: no es un evento de negocio que viaje
 * a ningún backend, es estado propio de esta terminal para sobrevivir a un
 * reinicio, así que no se valida con Zod (no cruza la red, la misma versión
 * de la app que lo escribió es la que lo lee — mismo criterio que
 * `sales`/`customers`, que tampoco se validan al leer de Dexie).
 */
export async function saveDraftCart(params: { cart: Cart; customer?: Customer }): Promise<void> {
  await db.draftCart.put({
    id: DRAFT_ID,
    cart: params.cart,
    ...(params.customer !== undefined ? { customer: params.customer } : {}),
  });
}

export async function loadDraftCart(): Promise<{ cart: Cart; customer?: Customer } | undefined> {
  const draft = await db.draftCart.get(DRAFT_ID);
  if (draft === undefined) {
    return undefined;
  }
  return { cart: draft.cart, ...(draft.customer !== undefined ? { customer: draft.customer } : {}) };
}
