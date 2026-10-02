import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_PRINTER_CONFIG, type PrinterConfig } from '../../storage/printer-config.ts';
import { printerConfigSignal, setReceiptPrinter } from '../state/printer.ts';
import { receiptSignal } from '../state/receipt.ts';
import { activeScreenSignal } from '../state/screen.ts';
import { reprintReceipt, showOrPrintReceipt } from './after-close.ts';
import type { ReceiptDocument } from './receipt-document.ts';
import type { ReceiptSource } from './resolve-receipt.ts';

const printed: { document: ReceiptDocument; format: string }[] = [];
const source: ReceiptSource = {
  kind: 'sale',
  copy: false,
  sale: {
    id: 's1',
    lines: [{ kind: 'freeform', description: 'Bolsa', qty: 1, unitPrice: 50 }],
    payments: [{ method: 'cash', amount: 50 }],
    total: 50,
    status: 'closed',
    createdAt: '2026-10-02T12:00:00.000Z',
  },
};

function useConfig(config: Partial<PrinterConfig>): void {
  printerConfigSignal.value = { ...DEFAULT_PRINTER_CONFIG, ...config };
}

beforeEach(() => {
  printed.length = 0;
  setReceiptPrinter({
    print: (document, format) => {
      printed.push({ document, format });
      return Promise.resolve();
    },
  });
  receiptSignal.value = null;
  activeScreenSignal.value = 'checkout';
});

afterEach(() => {
  printerConfigSignal.value = DEFAULT_PRINTER_CONFIG;
});

describe('showOrPrintReceipt', () => {
  it('Imprimir: vuelve a la venta e imprime en el formato', () => {
    useConfig({ format: '58mm', onCheckout: 'print' });
    showOrPrintReceipt(source);
    expect(activeScreenSignal.value).toBe('sale');
    expect(receiptSignal.value).toBeNull();
    expect(printed.map((p) => p.format)).toEqual(['58mm']);
  });

  it('Mostrar: va al comprobante sin imprimir', () => {
    useConfig({ format: '80mm', onCheckout: 'show' });
    showOrPrintReceipt(source);
    expect(activeScreenSignal.value).toBe('receipt');
    expect(receiptSignal.value).toEqual({ source, returnTo: 'sale' });
    expect(printed).toEqual([]);
  });

  it('Nada: vuelve directo a la venta', () => {
    useConfig({ format: '80mm', onCheckout: 'skip' });
    showOrPrintReceipt(source);
    expect(activeScreenSignal.value).toBe('sale');
    expect(receiptSignal.value).toBeNull();
    expect(printed).toEqual([]);
  });

  it('"No imprimir" con "Imprimir" muestra el comprobante', () => {
    useConfig({ format: 'none', onCheckout: 'print' });
    showOrPrintReceipt(source);
    expect(activeScreenSignal.value).toBe('receipt');
    expect(printed).toEqual([]);
  });
});

describe('reprintReceipt', () => {
  it('con papel imprime la copia y no cambia de pantalla', () => {
    useConfig({ format: 'a6' });
    activeScreenSignal.value = 'cash-summary';
    reprintReceipt({ ...source, copy: true });
    expect(activeScreenSignal.value).toBe('cash-summary');
    expect(printed[0]?.document.marks).toEqual(['COPIA']);
  });

  it('con "No imprimir" abre el comprobante y vuelve a /RESUMEN', () => {
    useConfig({ format: 'none' });
    activeScreenSignal.value = 'cash-summary';
    reprintReceipt({ ...source, copy: true });
    expect(activeScreenSignal.value).toBe('receipt');
    expect(receiptSignal.value?.returnTo).toBe('cash-summary');
    expect(printed).toEqual([]);
  });
});
