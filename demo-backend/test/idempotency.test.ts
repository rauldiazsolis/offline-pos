import { describe, expect, it, vi } from 'vitest';
import { openDb } from '../src/db.ts';
import { withIdempotency } from '../src/idempotency.ts';

describe('withIdempotency', () => {
  it('ejecuta el handler la primera vez y graba el resultado', async () => {
    const db = openDb(':memory:');
    const handler = vi.fn().mockResolvedValue({ status: 200, body: { ok: true } });

    const result = await withIdempotency(db, 'key-1', handler);

    expect(result).toEqual({ status: 200, body: { ok: true } });
    expect(handler).toHaveBeenCalledTimes(1);

    db.close();
  });

  it('con la misma key, devuelve la respuesta grabada sin volver a ejecutar el handler', async () => {
    const db = openDb(':memory:');
    const handler = vi.fn().mockResolvedValue({ status: 200, body: { count: 1 } });

    await withIdempotency(db, 'key-1', handler);
    const second = await withIdempotency(db, 'key-1', handler);

    expect(second).toEqual({ status: 200, body: { count: 1 } });
    expect(handler).toHaveBeenCalledTimes(1);

    db.close();
  });
});
