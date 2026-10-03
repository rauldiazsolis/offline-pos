import { getCashBalance } from '../storage/cash-repository.ts';
import { cartSelectionIndexSignal, cartSignal } from './state/cart.ts';
import { lastCashCountAtSignal } from './state/cash.ts';
import { resetAttachedCustomer } from './state/customer.ts';
import { identityResetSignal } from './state/sync-config.ts';

/**
 * Después de aplicar una demo borrando lo local (#128, #176): la venta en curso y el cliente
 * adjunto en memoria ya no existen en la base, y el último arqueo tampoco (aviso "Sin arqueo en
 * 24 h"). Lo usan `bootstrap` y la pantalla "Abrir una demo".
 */
export async function resetSessionAfterWipe(): Promise<void> {
  cartSignal.value = { lines: [] };
  cartSelectionIndexSignal.value = null;
  resetAttachedCustomer();
  identityResetSignal.value = false;
  lastCashCountAtSignal.value = (await getCashBalance()).lastCountAt;
}
