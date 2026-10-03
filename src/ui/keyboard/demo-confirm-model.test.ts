import { describe, expect, it } from 'vitest';
import { err, ok, type Result } from '../../domain/result.ts';
import type { LocalDataSummary } from '../../storage/local-data.ts';
import type { SyncConfig } from '../../sync/config.ts';
import { describeDemoLoss } from './demo-confirm-model.ts';

const EMPTY: LocalDataSummary = {
  products: 10,
  customers: 5,
  sales: 0,
  cashMovements: 0,
  cashCounts: 0,
  customerPayments: 0,
  pendingOutbox: 0,
  pendingSales: 0,
  draftCartLines: 0,
};
const REAL: Result<SyncConfig> = ok({
  type: 'rest',
  baseUrl: 'https://erp.x/api',
  apiKey: 'k',
  branch: 'Centro',
  pointOfSale: 'Caja 2',
});
const DEMO: Result<SyncConfig> = ok({
  type: 'rest',
  baseUrl: 'https://b.x',
  apiKey: 'demo-1',
  demo: {
    template: 'kiosco',
    onboarding: { url: 'https://b.x/alta', label: 'Alta' },
    startedAt: 'x',
  },
});

describe('describeDemoLoss (#176)', () => {
  it('lo pendiente, la venta en curso, el historial y la conexión real', () => {
    const loss = describeDemoLoss(
      {
        ...EMPTY,
        sales: 5,
        customerPayments: 1,
        cashMovements: 2,
        cashCounts: 1,
        pendingOutbox: 5,
        pendingSales: 3,
        draftCartLines: 4,
      },
      REAL,
    );
    expect(loss).toEqual({
      pending: 'Sin enviar a erp.x: 3 ventas y 2 movimientos más. Se pierden para siempre.',
      draft: 'La venta en curso (4 líneas).',
      history:
        'El historial de esta terminal (5 ventas, 1 cobranza, 2 movimientos de caja, 1 arqueo): se borra de esta terminal; lo ya enviado queda en erp.x.',
      connection:
        'Conexión a erp.x · Sucursal Centro · Punto de venta Caja 2. Se reemplaza por la de la demo.',
    });
  });

  it('solo movimientos pendientes, en singular', () => {
    const loss = describeDemoLoss({ ...EMPTY, pendingOutbox: 1, draftCartLines: 1 }, REAL);
    expect(loss.pending).toBe('Sin enviar a erp.x: 1 movimiento. Se pierden para siempre.');
    expect(loss.draft).toBe('La venta en curso (1 línea).');
  });

  it('en demo: la conexión es la demo; sin nada local, solo la conexión', () => {
    expect(describeDemoLoss(EMPTY, DEMO)).toEqual({
      connection: 'Demo de kiosco en b.x. Se reemplaza por la de la demo.',
    });
  });

  it('sin config: sin conexión, y lo pendiente sin host', () => {
    const loss = describeDemoLoss(
      { ...EMPTY, pendingOutbox: 2, pendingSales: 2 },
      err('sync/config-missing', undefined),
    );
    expect(loss).toEqual({
      pending: 'Sin enviar al backend: 2 ventas. Se pierden para siempre.',
    });
  });

  it('config ilegible', () => {
    const loss = describeDemoLoss(EMPTY, err('sync/config-invalid', { issues: [] }));
    expect(loss.connection).toBe(
      'La configuración guardada, que no se puede leer. Se reemplaza por la de la demo.',
    );
  });
});
