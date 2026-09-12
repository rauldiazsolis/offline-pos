import { describe, expect, it } from 'vitest';
import { stockItemSchema } from './stock.ts';

describe('stockItemSchema', () => {
  it('acepta un StockItem válido', () => {
    const result = stockItemSchema.safeParse({
      productId: 'p1',
      quantity: 10,
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    expect(result.success).toBe(true);
  });

  it('rechaza un StockItem con quantity no numérica', () => {
    const result = stockItemSchema.safeParse({
      productId: 'p1',
      quantity: 'diez',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    expect(result.success).toBe(false);
  });
});
