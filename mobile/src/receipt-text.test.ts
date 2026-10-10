import { describe, expect, it } from 'vitest';
import { receiptText } from './receipt-text.ts';

describe('receiptText', () => {
  it('arma el comprobante en texto con las filas alineadas a 32 columnas', () => {
    const text = receiptText({
      header: ['Kiosco'],
      title: 'Ticket #4',
      marks: ['COPIA'],
      meta: ['09/10/2026 10:00'],
      blocks: [
        { kind: 'row', left: '1 x Alfajor', right: '650,00' },
        { kind: 'divider' },
        { kind: 'row', left: 'Total', right: '650,00', bold: true },
        { kind: 'text', text: 'Gracias' },
      ],
      footer: ['Vuelva pronto'],
    });
    const lines = text.split('\n');
    expect(lines.slice(0, 4)).toEqual(['Kiosco', 'Ticket #4', 'COPIA', '09/10/2026 10:00']);
    expect(lines).toContain('1 x Alfajor               650,00');
    expect(lines.at(-1)).toBe('Vuelva pronto');
    expect(lines.filter((line) => line.startsWith('Total'))[0]).toHaveLength(32);
  });
});
