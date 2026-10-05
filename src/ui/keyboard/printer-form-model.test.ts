import { describe, expect, it } from 'vitest';
import { DEFAULT_PRINTER_CONFIG } from '../../storage/printer-config.ts';
import { checkoutOptions, withFormat } from './printer-form-model.ts';

describe('printer-form-model', () => {
  it('sin papel no se ofrece "Imprimir"', () => {
    expect(checkoutOptions('none')).toEqual(['show', 'skip']);
    expect(checkoutOptions('58mm')).toEqual(['print', 'show', 'skip']);
  });

  it('pasar a "No imprimir" con "Imprimir" elegido cambia a mostrar el comprobante', () => {
    const form = { ...DEFAULT_PRINTER_CONFIG, format: '80mm', onCheckout: 'print' } as const;
    expect(withFormat(form, 'none')).toEqual({ ...form, format: 'none', onCheckout: 'show' });
    expect(withFormat(form, '58mm')).toEqual({ ...form, format: '58mm' });
  });
});
