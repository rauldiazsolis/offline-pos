import { useSignalEffect, type Signal } from '@preact/signals';
import type { RefObject } from 'preact';

/**
 * Selecciona todo el contenido de un input cuando un signal de error pasa a
 * no-`null` — así el cajero puede reemplazar sin retipear (ver "Errores de
 * parseo" en §7 del doc de diseño). Consolida el mismo patrón que repetían
 * `CommandBarInput`, `CheckoutScreen` y `ConfigScreen` cada uno por su
 * cuenta.
 */
export function useSelectOnErrorSignal(
  ref: RefObject<HTMLInputElement>,
  errorSignal: Signal<string | null>,
): void {
  useSignalEffect(() => {
    if (errorSignal.value !== null) {
      ref.current?.select();
    }
  });
}
