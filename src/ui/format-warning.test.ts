import { describe, expect, it } from 'vitest';
import { formatWarning, formatWarningInContext } from './format-warning.ts';

const name = () => 'Coca';

describe('formatWarning (#99)', () => {
  it('nombra el producto o el cliente', () => {
    expect(
      formatWarning(
        { kind: 'insufficient-stock', productId: 'p1', requested: 5, available: 3 },
        name,
      ),
    ).toBe('Coca: stock disponible 3');
    expect(
      formatWarning({ kind: 'blocked-product', productId: 'p1', reason: 'Vencido' }, name),
    ).toBe('Coca: bloqueado — Vencido');
    expect(
      formatWarning({ kind: 'blocked-customer', customerId: 'c1', reason: 'Deuda' }, name),
    ).toBe('Cliente bloqueado — Deuda');
  });

  it('en contexto, sin el nombre', () => {
    expect(
      formatWarningInContext({
        kind: 'insufficient-stock',
        productId: 'p1',
        requested: 5,
        available: 3,
      }),
    ).toBe('Stock disponible: 3');
    expect(
      formatWarningInContext({ kind: 'blocked-customer', customerId: 'c1', reason: 'Deuda' }),
    ).toBe('Bloqueado: Deuda');
  });
});
