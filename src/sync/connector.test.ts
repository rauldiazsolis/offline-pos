import { describe, expect, it } from 'vitest';
import { batchLotStatusSchema, pullBatchResponseSchema, toPullBatchResult } from './connector.ts';

const product = {
  id: 'p1',
  sku: 'S',
  barcodes: [],
  name: 'N',
  price: 1,
  taxRate: 0.21,
  category: 'c',
  tracksStock: true,
  createdAt: '2026-01-01T00:00:00.000Z',
};
const customer = {
  id: 'c1',
  name: 'Ana',
  createdAt: '2026-01-02T00:00:00.000Z',
  blocked: { reason: 'Deuda' },
};

describe('schemas de red v3', () => {
  it('acepta los cuatro estados de lote y issues con eventId opcional', () => {
    for (const status of ['queued', 'processing', 'ok'] as const) {
      expect(batchLotStatusSchema.safeParse({ status }).success).toBe(true);
    }
    expect(
      batchLotStatusSchema.safeParse({
        status: 'issues',
        issues: [{ message: 'x', eventId: 'e1' }, { message: 'y' }],
      }).success,
    ).toBe(true);
    expect(batchLotStatusSchema.safeParse({ status: 'pending' }).success).toBe(false);
    expect(batchLotStatusSchema.safeParse({ status: 'issues', issues: ['texto'] }).success).toBe(
      false,
    );
  });

  it('exige createdAt en productos y clientes y acepta bloqueo', () => {
    const parsed = pullBatchResponseSchema.safeParse({
      products: { items: [product] },
      customers: { items: [customer] },
      stock: [],
      lots: {},
    });
    expect(parsed.success).toBe(true);
    const { createdAt: _omit, ...withoutDate } = product;
    expect(
      pullBatchResponseSchema.safeParse({
        products: { items: [withoutDate] },
        customers: { items: [] },
        stock: [],
        lots: {},
      }).success,
    ).toBe(false);
    const { createdAt: _omitCustomer, ...customerWithoutDate } = customer;
    expect(
      pullBatchResponseSchema.safeParse({
        products: { items: [] },
        customers: { items: [customerWithoutDate] },
        stock: [],
        lots: {},
      }).success,
    ).toBe(false);
  });

  it('toPullBatchResult omite nextCursor ausente y eventId ausente', () => {
    const parsed = pullBatchResponseSchema.parse({
      products: { items: [], nextCursor: 'c9' },
      customers: { items: [] },
      stock: [{ productId: 'p1', quantity: -1.5, updatedAt: 'x' }],
      lots: { l1: { status: 'issues', issues: [{ message: 'x' }] } },
    });
    const result = toPullBatchResult(parsed);
    expect(result.products).toEqual({ items: [], nextCursor: 'c9' });
    expect('nextCursor' in result.customers).toBe(false);
    expect(result.lots).toEqual({ l1: { status: 'issues', issues: [{ message: 'x' }] } });
  });
});
