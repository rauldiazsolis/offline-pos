import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReceiptDocument } from './receipt-document.ts';
import { createBrowserPrinter } from './browser-printer.tsx';

const doc: ReceiptDocument = {
  header: ['Kiosco'],
  title: 'Comprobante',
  marks: [],
  meta: ['Ticket #1'],
  blocks: [],
  footer: [],
};

afterEach(() => {
  vi.useRealTimers();
});

describe('createBrowserPrinter', () => {
  it('imprime el comprobante en un iframe aparte y lo saca con afterprint', async () => {
    const printed: string[] = [];
    const printer = createBrowserPrinter({
      printWindow: (frameWindow) => {
        printed.push(frameWindow.document.body.textContent);
        expect(frameWindow.document.head.querySelector('style')?.textContent).toContain('@page');
        frameWindow.dispatchEvent(new Event('afterprint'));
      },
    });

    await printer.print(doc, '58mm');

    expect(printed).toHaveLength(1);
    expect(printed[0]).toContain('Kiosco');
    expect(printed[0]).toContain('Ticket #1');
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('si el navegador no dispara afterprint, saca el iframe igual al vencer el tope', async () => {
    vi.useFakeTimers();
    const printer = createBrowserPrinter({ printWindow: () => undefined, timeoutMs: 1000 });

    const done = printer.print(doc, 'a6');
    expect(document.querySelector('iframe')).not.toBeNull();
    await vi.advanceTimersByTimeAsync(1000);
    await done;

    expect(document.querySelector('iframe')).toBeNull();
  });
});
