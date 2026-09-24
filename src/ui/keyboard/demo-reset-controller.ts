import { loadCatalogRepository } from '../../storage/catalog-repository.ts';
import { loadCustomerRepository } from '../../storage/customer-repository.ts';
import { demoReset } from '../../storage/demo-reset.ts';
import { describeError } from '../errors.ts';
import { setCatalogRepository } from '../state/catalog.ts';
import { refreshStockSnapshot } from '../state/stock.ts';
import { cartSelectionIndexSignal, cartSignal } from '../state/cart.ts';
import { resetAttachedCustomer } from '../state/customer.ts';
import { setCustomerRepository } from '../state/customer-repository.ts';
import { demoResetErrorSignal, demoResetInProgressSignal } from '../state/demo-reset.ts';
import { activeScreenSignal } from '../state/screen.ts';

/**
 * `/DEMO_RESET`: entra a la pantalla de confirmación dedicada (mismo patrón
 * que `/ANULAR`). Solo se llega acá desde el comando que declara el conector
 * `rest-demo` (ver `connector-actions.ts`).
 */
export function enterDemoResetScreen(): void {
  demoResetErrorSignal.value = null;
  demoResetInProgressSignal.value = false;
  activeScreenSignal.value = 'demo-reset';
}

/** Esc: sale sin reiniciar nada. */
export function exitDemoResetScreen(): void {
  demoResetErrorSignal.value = null;
  activeScreenSignal.value = 'sale';
}

/**
 * Enter en la pantalla de confirmación: ejecuta el reset y, si sale bien,
 * reconstruye todo el estado en memoria que dependía de lo que se acaba de
 * borrar — mismo repertorio que `bootstrap.ts` arma al arrancar la app, más
 * limpiar la venta en curso (líneas, cliente, selección), que ya no tiene
 * sentido después de borrar catálogo/clientes.
 */
export async function confirmDemoReset(): Promise<void> {
  demoResetInProgressSignal.value = true;
  demoResetErrorSignal.value = null;

  const result = await demoReset();
  demoResetInProgressSignal.value = false;

  if (!result.ok) {
    demoResetErrorSignal.value = describeError(result);
    return;
  }

  setCatalogRepository(await loadCatalogRepository());
  setCustomerRepository(await loadCustomerRepository());
  await refreshStockSnapshot();
  cartSignal.value = { lines: [] };
  cartSelectionIndexSignal.value = null;
  resetAttachedCustomer();

  activeScreenSignal.value = 'sale';
}
