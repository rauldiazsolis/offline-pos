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
    const result = err('sale/not-found', { saleId: 's1' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('sale/not-found');
      expect(result.meta).toEqual({ saleId: 's1' });
    }
  });
});
