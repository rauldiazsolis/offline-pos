/**
 * Teclado de letras propio (sin el teclado del sistema). Dos capas: letras (con mayúscula de una vez
 * o fija) y números y símbolos, que alcanzan para nombres, búsquedas, URLs y claves. Puro.
 */
export type TextLayer = 'letters' | 'symbols';
export type ShiftState = 'off' | 'once' | 'lock';

export type TextKeyboardState = {
  text: string;
  layer: TextLayer;
  shift: ShiftState;
};

export type TextKey =
  | { kind: 'char'; char: string }
  /** Un caracter tal cual, ya con su mayúscula (una tecla física). */
  | { kind: 'raw'; char: string }
  | { kind: 'space' }
  | { kind: 'back' }
  | { kind: 'clear' }
  | { kind: 'shift' }
  | { kind: 'layer' };

/** Filas de cada capa. Las teclas especiales las agrega el componente al final de cada fila. */
export const LETTER_ROWS: readonly (readonly string[])[] = [
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', 'ñ'],
  ['z', 'x', 'c', 'v', 'b', 'n', 'm'],
];
export const SYMBOL_ROWS: readonly (readonly string[])[] = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
  ['@', '.', '/', ':', '-', '_', '=', '?', '&', '#'],
  ['%', '+', '~', ',', "'", '(', ')', '!', '$', '*'],
];

export type TextKeyboardOptions = {
  /** Mayúscula automática al empezar y después de un espacio (nombres). */
  capitalize: 'words' | 'none';
  maxLength: number;
};

export function textKeyboardState(text: string, options: TextKeyboardOptions): TextKeyboardState {
  return { text, layer: 'letters', shift: autoShift(text, options) };
}

function autoShift(text: string, options: TextKeyboardOptions): ShiftState {
  if (options.capitalize === 'none') {
    return 'off';
  }
  return text === '' || text.endsWith(' ') ? 'once' : 'off';
}

function append(state: TextKeyboardState, char: string, options: TextKeyboardOptions, raw = false) {
  if (state.text.length >= options.maxLength) {
    return state;
  }
  const upper = !raw && state.layer === 'letters' && state.shift !== 'off';
  const text = state.text + (upper ? char.toUpperCase() : char);
  const shift = state.shift === 'lock' ? 'lock' : autoShift(text, options);
  return { ...state, text, shift };
}

export function pressTextKey(
  state: TextKeyboardState,
  key: TextKey,
  options: TextKeyboardOptions,
): TextKeyboardState {
  switch (key.kind) {
    case 'char':
      return append(state, key.char, options);
    case 'raw':
      return append(state, key.char, options, true);
    case 'space':
      // Sin espacios al principio ni dos seguidos: nunca suman en un nombre o una búsqueda.
      if (state.text === '' || state.text.endsWith(' ')) {
        return state;
      }
      return append(state, ' ', options);
    case 'back': {
      const text = state.text.slice(0, -1);
      return { ...state, text, shift: state.shift === 'lock' ? 'lock' : autoShift(text, options) };
    }
    case 'clear':
      return {
        ...state,
        text: '',
        shift: state.shift === 'lock' ? 'lock' : autoShift('', options),
      };
    case 'shift':
      return {
        ...state,
        shift: state.shift === 'off' ? 'once' : state.shift === 'once' ? 'lock' : 'off',
      };
    case 'layer':
      return { ...state, layer: state.layer === 'letters' ? 'symbols' : 'letters' };
  }
}
