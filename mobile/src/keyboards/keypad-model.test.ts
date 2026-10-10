import { describe, expect, it } from 'vitest';
import {
  keypadState,
  keypadText,
  parseKeypadText,
  pressKeypadKey,
  type KeypadKey,
  type KeypadOptions,
} from './keypad-model.ts';

const AMOUNT: KeypadOptions = { decimals: 2, signed: false };
const QUANTITY: KeypadOptions = { decimals: 3, signed: true };

function type(keys: KeypadKey[], options: KeypadOptions, initial = ''): string {
  let state = keypadState(initial);
  for (const key of keys) {
    state = pressKeypadKey(state, key, options, ',');
  }
  return state.text;
}

describe('pressKeypadKey', () => {
  it('arma un importe con coma decimal y a lo sumo 2 decimales', () => {
    expect(type(['1', '2', 'decimal', '5', '0', '9'], AMOUNT)).toBe('12,50');
  });

  it('la coma sola arranca en "0,"', () => {
    expect(type(['decimal', '5'], AMOUNT)).toBe('0,5');
  });

  it('no repite la coma ni la acepta sin decimales', () => {
    expect(type(['1', 'decimal', 'decimal', '2'], AMOUNT)).toBe('1,2');
    expect(type(['1', 'decimal', '2'], { decimals: 0, signed: false })).toBe('12');
  });

  it('no deja ceros a la izquierda', () => {
    expect(type(['0', '0', '7'], AMOUNT)).toBe('7');
  });

  it('el signo solo si se permite, y se puede sacar', () => {
    expect(type(['sign', '2'], QUANTITY)).toBe('-2');
    expect(type(['2', 'sign', 'sign'], QUANTITY)).toBe('2');
    expect(type(['sign', '2'], AMOUNT)).toBe('2');
  });

  it('borra de a una tecla y todo junto', () => {
    expect(type(['1', '2', 'back'], AMOUNT)).toBe('1');
    expect(type(['1', '2', 'clear'], AMOUNT)).toBe('');
  });

  it('el primer dígito reemplaza lo precargado; el signo lo conserva', () => {
    expect(type(['5'], QUANTITY, '2')).toBe('5');
    expect(type(['decimal', '5'], QUANTITY, '2')).toBe('0,5');
    expect(type(['sign'], QUANTITY, '2')).toBe('-2');
    expect(type(['back'], QUANTITY, '12')).toBe('1');
    expect(type(['3'], QUANTITY, '-2')).toBe('-3');
  });

  it('tope de 9 dígitos', () => {
    expect(type(['1', '2', '3', '4', '5', '6', '7', '8', '9', '1'], AMOUNT)).toBe('123456789');
  });
});

describe('parseKeypadText', () => {
  it('lee el número con el decimal del locale', () => {
    expect(parseKeypadText('12,5', ',')).toBe(12.5);
    expect(parseKeypadText('-0,25', ',')).toBe(-0.25);
    expect(parseKeypadText('3,', ',')).toBe(3);
  });

  it('vacío o solo el signo no es un número', () => {
    expect(parseKeypadText('', ',')).toBeUndefined();
    expect(parseKeypadText('-', ',')).toBeUndefined();
  });

  it('keypadText es la inversa', () => {
    expect(keypadText(1.5, ',')).toBe('1,5');
    expect(parseKeypadText(keypadText(1234.56, ','), ',')).toBe(1234.56);
  });
});
