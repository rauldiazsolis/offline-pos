import { afterEach, describe, expect, it } from 'vitest';
import { storageKey } from './storage-namespace.ts';
import {
  DEFAULT_PRINTER_CONFIG,
  effectiveCheckoutAction,
  loadPrinterConfig,
  paperFormat,
  savePrinterConfig,
} from './printer-config.ts';

afterEach(() => {
  localStorage.clear();
});

describe('loadPrinterConfig', () => {
  it('sin nada guardado devuelve el default (A6 y mostrar el comprobante)', () => {
    expect(loadPrinterConfig()).toEqual({
      format: 'a6',
      onCheckout: 'show',
      header: '',
      footer: '',
    });
  });

  it('un JSON roto cae al default', () => {
    localStorage.setItem(storageKey('printer'), '{no es json');
    expect(loadPrinterConfig()).toEqual(DEFAULT_PRINTER_CONFIG);
  });

  it('un formato desconocido cae al default', () => {
    localStorage.setItem(
      storageKey('printer'),
      JSON.stringify({ format: '110mm', onCheckout: 'print', header: '', footer: '' }),
    );
    expect(loadPrinterConfig()).toEqual(DEFAULT_PRINTER_CONFIG);
  });

  it('lee lo que se guardó', () => {
    const config = {
      format: '58mm',
      onCheckout: 'print',
      header: 'Kiosco\nAv. Siempreviva 742',
      footer: 'Gracias',
    } as const;
    expect(savePrinterConfig(config)).toEqual({ ok: true, value: undefined });
    expect(loadPrinterConfig()).toEqual(config);
  });
});

describe('effectiveCheckoutAction', () => {
  it('"No imprimir" con "Imprimir" se lee como mostrar el comprobante', () => {
    expect(
      effectiveCheckoutAction({ ...DEFAULT_PRINTER_CONFIG, format: 'none', onCheckout: 'print' }),
    ).toBe('show');
  });

  it('con papel respeta lo elegido', () => {
    expect(
      effectiveCheckoutAction({ ...DEFAULT_PRINTER_CONFIG, format: '80mm', onCheckout: 'print' }),
    ).toBe('print');
    expect(
      effectiveCheckoutAction({ ...DEFAULT_PRINTER_CONFIG, format: 'none', onCheckout: 'skip' }),
    ).toBe('skip');
  });
});

describe('paperFormat', () => {
  it('"No imprimir" se dibuja como A6; el resto, tal cual', () => {
    expect(paperFormat('none')).toBe('a6');
    expect(paperFormat('58mm')).toBe('58mm');
  });
});
