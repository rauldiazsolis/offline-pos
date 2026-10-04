import { describe, expect, it } from 'vitest';
import type { LocalDataSummary } from '../../storage/local-data.ts';
import { describeTrainingDiscard } from './training-model.ts';

const empty: LocalDataSummary = {
  products: 10,
  customers: 3,
  sales: 0,
  cashMovements: 0,
  cashCounts: 0,
  customerPayments: 0,
  pendingOutbox: 0,
  pendingSales: 0,
  draftCartLines: 0,
};

describe('lo que se descarta al salir del entrenamiento (#177)', () => {
  it('sin nada hecho, lo dice', () => {
    expect(describeTrainingDiscard(empty, 0).lines).toEqual([
      'No hiciste nada en el entrenamiento.',
    ]);
  });

  it('el catálogo y los clientes copiados no cuentan', () => {
    expect(describeTrainingDiscard({ ...empty, products: 500, customers: 80 }, 0).lines).toEqual([
      'No hiciste nada en el entrenamiento.',
    ]);
  });

  it('cuenta ventas, cobranzas, caja, venta en curso y clientes, en plural', () => {
    const lines = describeTrainingDiscard(
      {
        ...empty,
        sales: 3,
        customerPayments: 2,
        cashMovements: 1,
        cashCounts: 1,
        draftCartLines: 2,
      },
      2,
    ).lines;
    expect(lines).toEqual([
      '3 ventas',
      '2 cobranzas',
      '2 movimientos de caja y arqueos',
      'La venta en curso',
      '2 clientes creados',
    ]);
  });

  it('en singular', () => {
    const lines = describeTrainingDiscard(
      { ...empty, sales: 1, customerPayments: 1, cashCounts: 1 },
      1,
    ).lines;
    expect(lines).toEqual([
      '1 venta',
      '1 cobranza',
      '1 movimiento de caja o arqueo',
      '1 cliente creado',
    ]);
  });
});
