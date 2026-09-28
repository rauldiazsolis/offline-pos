import { describe, expect, it } from 'vitest';
import { describeLocalDataLoss } from './summary.ts';

describe('describeLocalDataLoss', () => {
  it('nombra arqueos y movimientos de caja en vez de turnos (#100)', () => {
    expect(
      describeLocalDataLoss({
        products: 0,
        customers: 0,
        sales: 3,
        cashMovements: 1,
        cashCounts: 2,
        pendingOutbox: 0,
        pendingSales: 0,
        draftCartLines: 0,
      }),
    ).toBe('3 ventas · 2 arqueos · 1 movimiento de caja');
  });
});
