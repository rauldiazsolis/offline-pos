import { describe, expect, it } from 'vitest';
import type { Product } from './product.ts';
import { cartWarnings, customerWarnings, lineWarnings } from './sale-warnings.ts';

const product: Product = {
  id: 'p1',
  sku: 'S',
  barcodes: [],
  name: 'Coca',
  price: 1,
  taxRate: 0,
  category: 'c',
  tracksStock: true,
};
const line = (qty: number) => ({ kind: 'product' as const, productId: 'p1', qty, unitPrice: 1 });

describe('sale-warnings (#99)', () => {
  it('stock insuficiente solo con tracksStock, cantidad positiva y mayor al stock', () => {
    expect(lineWarnings(line(5), { product, stockQuantity: 3 })).toEqual([
      { kind: 'insufficient-stock', productId: 'p1', requested: 5, available: 3 },
    ]);
    expect(lineWarnings(line(3), { product, stockQuantity: 3 })).toEqual([]);
    expect(lineWarnings(line(-5), { product, stockQuantity: 0 })).toEqual([]);
    expect(
      lineWarnings(line(5), { product: { ...product, tracksStock: false }, stockQuantity: 0 }),
    ).toEqual([]);
    expect(lineWarnings(line(1), { product, stockQuantity: undefined })).toEqual([
      { kind: 'insufficient-stock', productId: 'p1', requested: 1, available: 0 },
    ]);
  });

  it('producto bloqueado', () => {
    expect(
      lineWarnings(line(1), {
        product: { ...product, tracksStock: false, blocked: { reason: 'Vencido' } },
        stockQuantity: 0,
      }),
    ).toEqual([{ kind: 'blocked-product', productId: 'p1', reason: 'Vencido' }]);
  });

  it('cliente bloqueado y agregado del carrito con el cliente al final', () => {
    const customer = { id: 'c1', name: 'Ana', createdAt: 'x', blocked: { reason: 'Deuda' } };
    expect(customerWarnings(customer)).toEqual([
      { kind: 'blocked-customer', customerId: 'c1', reason: 'Deuda' },
    ]);
    const warnings = cartWarnings(
      { lines: [line(5)] },
      { productById: () => product, stockOf: () => 3, customer },
    );
    expect(warnings.map((w) => w.kind)).toEqual(['insufficient-stock', 'blocked-customer']);
  });

  it('una línea libre nunca advierte', () => {
    expect(
      lineWarnings(
        { kind: 'freeform', description: 'x', qty: 1, unitPrice: 1 },
        { product: undefined, stockQuantity: undefined },
      ),
    ).toEqual([]);
  });
});
