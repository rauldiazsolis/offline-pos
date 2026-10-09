/**
 * Teclado numérico propio (sin el teclado del sistema): arma el texto de un número tecla por tecla.
 * El texto usa el separador decimal del locale de la terminal, sin separador de miles: es el mismo
 * formato que tipea un cajero en el POS de escritorio, así `parseNonNegativeAmount` y los
 * controllers lo leen sin cambios. Puro.
 */
export type KeypadKey =
  '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | 'decimal' | 'back' | 'clear' | 'sign';

export type KeypadOptions = {
  /** Decimales permitidos: 0 (enteros), 2 (importes) o 3 (cantidades). */
  decimals: number;
  /** Si se permite el signo menos (devoluciones, descuentos). */
  signed: boolean;
};

/**
 * `pristine`: el texto vino precargado y todavía no se tocó; el primer dígito (o la coma) lo
 * reemplaza, como un campo con el texto seleccionado.
 */
export type KeypadState = { text: string; pristine: boolean };

const MAX_DIGITS = 9;

export function keypadState(text: string): KeypadState {
  return { text, pristine: text !== '' };
}

function digitCount(text: string): number {
  return text.replace(/[^0-9]/g, '').length;
}

function applyKey(text: string, key: KeypadKey, options: KeypadOptions, decimal: string): string {
  const negative = text.startsWith('-');
  const body = negative ? text.slice(1) : text;
  const sign = negative ? '-' : '';
  switch (key) {
    case 'back':
      return text.slice(0, -1);
    case 'clear':
      return '';
    case 'sign':
      return options.signed ? (negative ? body : `-${body}`) : text;
    case 'decimal':
      if (options.decimals === 0 || body.includes(decimal)) {
        return text;
      }
      return `${sign}${body === '' ? '0' : body}${decimal}`;
    default: {
      const [, fraction] = body.split(decimal);
      if (fraction !== undefined && fraction.length >= options.decimals) {
        return text;
      }
      if (digitCount(body) >= MAX_DIGITS) {
        return text;
      }
      // Sin ceros a la izquierda: "0" seguido de un dígito lo reemplaza.
      return body === '0' ? `${sign}${key}` : `${sign}${body}${key}`;
    }
  }
}

export function pressKeypadKey(
  state: KeypadState,
  key: KeypadKey,
  options: KeypadOptions,
  decimal: string,
): KeypadState {
  const replaces = state.pristine && (/^[0-9]$/.test(key) || key === 'decimal');
  const base = replaces ? (state.text.startsWith('-') ? '-' : '') : state.text;
  return { text: applyKey(base, key, options, decimal), pristine: false };
}

/** El número del texto; `undefined` si está vacío o es solo el signo. */
export function parseKeypadText(text: string, decimal: string): number | undefined {
  const normalized = text.split(decimal).join('.');
  if (normalized === '' || normalized === '-') {
    return undefined;
  }
  const value = Number(normalized.endsWith('.') ? normalized.slice(0, -1) : normalized);
  return Number.isFinite(value) ? value : undefined;
}

/** Texto para precargar el teclado con un número (sin miles, con el decimal del locale). */
export function keypadText(value: number, decimal: string): string {
  return String(value).replace('.', decimal);
}
