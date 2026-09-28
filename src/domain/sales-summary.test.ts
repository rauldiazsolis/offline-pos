import { describe, expect, it } from 'vitest';
import type { Sale } from './sale.ts';
import { calculateProductQuantities } from './sales-summary.ts';

function buildSale(overrides: Partial<Sale> = {}): Sale {
  return {
    id: 's1',
    lines: [{ kind: 'product', productId: 'p0', qty: 1, unitPrice: 100 }],
    payments: [{ method: 'cash', amount: 100 }],
    total: 100,
    status: 'closed',
    createdAt: '2026-01-01T10:00:00.000Z',
    ...overrides,
  };
}

describe('calculateProductQuantities', () => {
  it('agrupa por productId, sumando cantidades entre ventas', () => {
    const sales = [
      buildSale({
        id: 's1',
        lines: [{ kind: 'product', productId: 'p1', qty: 2, unitPrice: 100 }],
      }),
      buildSale({
        id: 's2',
        lines: [
          { kind: 'product', productId: 'p1', qty: 3, unitPrice: 100 },
          { kind: 'product', productId: 'p2', qty: 1, unitPrice: 50 },
        ],
      }),
    ];

    const result = calculateProductQuantities(sales);

    expect(result).toEqual(
      expect.arrayContaining([
        { productId: 'p1', qty: 5 },
        { productId: 'p2', qty: 1 },
      ]),
    );
    expect(result).toHaveLength(2);
  });

  it('ignora líneas libres (sin identidad de producto)', () => {
    const sales = [
      buildSale({
        id: 's1',
        lines: [{ kind: 'freeform', description: 'Regalo', qty: 1, unitPrice: 100 }],
      }),
    ];

    expect(calculateProductQuantities(sales)).toEqual([]);
  });

  it('excluye ventas anuladas', () => {
    const sales = [
      buildSale({
        id: 's1',
        lines: [{ kind: 'product', productId: 'p1', qty: 2, unitPrice: 100 }],
        status: 'voided',
      }),
    ];

    expect(calculateProductQuantities(sales)).toEqual([]);
  });

  it('una anulación (líneas negativas) resta la cantidad', () => {
    const sales = [
      buildSale({ id: 's1', lines: [{ kind: 'product', productId: 'p1', qty: 2, unitPrice: 100 }] }),
      buildSale({
        id: 's2',
        voidsSaleId: 's1',
        lines: [{ kind: 'product', productId: 'p1', qty: -2, unitPrice: 100 }],
      }),
    ];

    expect(calculateProductQuantities(sales)).toEqual([{ productId: 'p1', qty: 0 }]);
  });
});
