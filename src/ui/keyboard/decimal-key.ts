import type { TargetedKeyboardEvent } from 'preact';
import { resolveLocale } from '../format.ts';
import { decimalSeparator } from '../parse-amount.ts';

/**
 * Reinterpreta `.`/`,` como el separador decimal del locale configurado,
 * sin importar cuál produce el teclado físico — un teclado que no coincide
 * con la configuración regional (ej. layout US en una terminal con locale
 * es-AR) tipeaba el caracter "equivocado" sin darse cuenta, y desde que
 * `parse-amount.ts` dejó de aceptar separador de miles, ese caracter queda
 * directamente inválido si no se corrige acá. Bloquea un segundo separador
 * si ya hay uno tipeado — un monto no puede tener dos. Usado por los campos
 * de monto de Cobro y `/CAJA` — no por la línea libre de la barra de
 * comandos, que es un buffer compuesto (`descripción$monto`) donde
 * interceptar así requeriría saber si el cursor está en la parte del monto.
 */
export function remapDecimalKey(event: TargetedKeyboardEvent<HTMLInputElement>): void {
  if (event.key !== '.' && event.key !== ',') {
    return;
  }
  const input = event.currentTarget;
  if (input.readOnly || input.disabled) {
    return;
  }
  event.preventDefault();

  const decimal = decimalSeparator(resolveLocale());
  if (input.value.includes(decimal)) {
    return;
  }

  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? input.value.length;
  input.value = input.value.slice(0, start) + decimal + input.value.slice(end);
  input.setSelectionRange(start + 1, start + 1);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}
