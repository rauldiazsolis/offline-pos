import { describe, expect, it } from 'vitest';
import { describeError } from './errors.ts';

describe('describeError', () => {
  it('cash-session/none-ever', () => {
    const message = describeError({ ok: false, error: 'cash-session/none-ever', meta: undefined });

    expect(message).toBe('No hay ningún turno de caja para consultar.');
  });
});
