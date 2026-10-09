import { describe, expect, it } from 'vitest';
import {
  pressTextKey,
  textKeyboardState,
  type TextKey,
  type TextKeyboardOptions,
} from './text-keyboard-model.ts';

const NAME: TextKeyboardOptions = { capitalize: 'words', maxLength: 40 };
const PLAIN: TextKeyboardOptions = { capitalize: 'none', maxLength: 40 };

const c = (char: string): TextKey => ({ kind: 'char', char });

function type(keys: TextKey[], options: TextKeyboardOptions, initial = ''): string {
  let state = textKeyboardState(initial, options);
  for (const key of keys) {
    state = pressTextKey(state, key, options);
  }
  return state.text;
}

describe('pressTextKey', () => {
  it('con mayúscula por palabra, arma un nombre', () => {
    expect(type([c('a'), c('n'), c('a'), { kind: 'space' }, c('p'), c('é')], NAME)).toBe('Ana Pé');
  });

  it('sin mayúsculas automáticas, todo en minúscula', () => {
    expect(type([c('y'), c('e'), c('r')], PLAIN)).toBe('yer');
  });

  it('la mayúscula de una vez y la fija', () => {
    const once = [{ kind: 'shift' } as const, c('a'), c('b')];
    expect(type(once, PLAIN)).toBe('Ab');
    const lock = [{ kind: 'shift' } as const, { kind: 'shift' } as const, c('a'), c('b')];
    expect(type(lock, PLAIN)).toBe('AB');
  });

  it('los símbolos nunca van en mayúscula', () => {
    const keys = [{ kind: 'layer' } as const, { kind: 'shift' } as const, c('@'), c('1')];
    expect(type(keys, PLAIN)).toBe('@1');
  });

  it('no deja espacios al principio ni dos seguidos', () => {
    expect(type([{ kind: 'space' }, c('a'), { kind: 'space' }, { kind: 'space' }], PLAIN)).toBe(
      'a ',
    );
  });

  it('borra de a una y todo; vuelve la mayúscula al quedar vacío', () => {
    let state = textKeyboardState('', NAME);
    for (const key of [c('a'), { kind: 'back' } as const, c('b')]) {
      state = pressTextKey(state, key, NAME);
    }
    expect(state.text).toBe('B');
    expect(type([c('a'), c('b'), { kind: 'clear' }], PLAIN, 'xy')).toBe('');
  });

  it('una tecla física va tal cual, sin la mayúscula del teclado propio', () => {
    expect(
      type(
        [
          { kind: 'raw', char: 'x' },
          { kind: 'raw', char: 'Y' },
        ],
        NAME,
      ),
    ).toBe('xY');
  });

  it('respeta el largo máximo', () => {
    expect(type([c('a'), c('b'), c('c')], { capitalize: 'none', maxLength: 2 })).toBe('ab');
  });
});
