import { describe, expect, it } from 'vitest';
import { applyUiModeClass, resolveUiMode, setUiMode, uiModeSignal } from './ui-mode.ts';

describe('resolveUiMode', () => {
  it('sin elegir, el ancho decide: por debajo de 600 px, la de celular', () => {
    expect(resolveUiMode(null, 412)).toBe('mobile');
    expect(resolveUiMode(null, 600)).toBe('desktop');
    expect(resolveUiMode(null, 1280)).toBe('desktop');
  });

  it('lo elegido gana sobre el ancho; un valor desconocido se ignora', () => {
    expect(resolveUiMode('desktop', 412)).toBe('desktop');
    expect(resolveUiMode('mobile', 1280)).toBe('mobile');
    expect(resolveUiMode('tablet', 412)).toBe('mobile');
  });
});

describe('setUiMode', () => {
  it('cambia la vista y la recuerda', () => {
    setUiMode('mobile');
    expect(uiModeSignal.value).toBe('mobile');
    expect(Object.values(localStorage).includes('mobile')).toBe(true);
    setUiMode('desktop');
    expect(uiModeSignal.value).toBe('desktop');
  });
});

describe('applyUiModeClass', () => {
  it('pone o saca la clase de la vista de celular', () => {
    const root = document.createElement('html');
    applyUiModeClass('mobile', root);
    expect(root.classList.contains('pos-mobile')).toBe(true);
    applyUiModeClass('desktop', root);
    expect(root.classList.contains('pos-mobile')).toBe(false);
  });
});
