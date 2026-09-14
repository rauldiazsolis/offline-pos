import { effect } from '@preact/signals';
import { saveDraftCart } from '../../storage/draft-cart-repository.ts';
import { cartSignal } from './cart.ts';
import { attachedCustomerSignal } from './customer.ts';

/**
 * Primer uso de `effect()` (en vez de un signal leído dentro de un
 * componente) en este código: persiste la venta en curso cada vez que
 * cambia, para que sobreviva un refresh/crash (issue #17). Sin debounce —
 * `cartSignal` solo cambia una vez por acción confirmada (agregar línea,
 * cambiar cantidad, cerrar venta), nunca en cada tecla de la barra de
 * comandos, así que no hay riesgo de escribir a Dexie en cada keystroke.
 *
 * Se llama una sola vez desde `bootstrap()`, después de restaurar un draft
 * ya guardado — así el primer disparo del effect no pisa innecesariamente
 * el mismo valor que se acaba de leer. Devuelve la función de limpieza que
 * ya expone `effect()` (útil para tests; en la app real no se llama nunca,
 * la persistencia dura toda la sesión de la pestaña).
 */
export function startCartPersistence(): () => void {
  return effect(() => {
    void saveDraftCart({
      cart: cartSignal.value,
      ...(attachedCustomerSignal.value !== undefined
        ? { customer: attachedCustomerSignal.value }
        : {}),
    });
  });
}
