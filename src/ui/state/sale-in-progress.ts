import { cartSignal } from './cart.ts';
import { attachedCustomerSignal } from './customer.ts';

/**
 * Venta en curso: líneas, cliente o ajuste global (lo que `/DESCARTAR` vacía). Ni `/ACTUALIZAR` (#54)
 * ni `/ENTRENAMIENTO` (#177) arrancan con una venta a medias.
 */
export function saleInProgress(): boolean {
  const cart = cartSignal.value;
  return (
    cart.lines.length > 0 ||
    cart.globalAdjustmentPercentage !== undefined ||
    attachedCustomerSignal.value !== undefined
  );
}
