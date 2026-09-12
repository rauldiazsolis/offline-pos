import { describe, expect, it } from 'vitest';
import { err, ok } from './result.ts';

describe('Result', () => {
  it('ok() produce un Result exitoso con el valor dado', () => {
    const result = ok(42);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(42);
    }
  });

  it('err() produce un Result fallido con el código y la metadata dados', () => {
    const result = err('sale/insufficient-stock', {
      productId: 'p1',
      requested: 5,
      available: 2,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('sale/insufficient-stock');
      expect(result.meta).toEqual({ productId: 'p1', requested: 5, available: 2 });
    }
  });
});
