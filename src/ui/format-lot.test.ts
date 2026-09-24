import { describe, expect, it } from 'vitest';
import { formatAwaitingLotStatus, formatPullApplication } from './format-lot.ts';

describe('formatAwaitingLotStatus', () => {
  it('suma la cantidad de eventos cuando se conoce', () => {
    expect(
      formatAwaitingLotStatus({
        id: 'a',
        sentAt: 'x',
        lastStatus: 'queued',
        eventIds: ['e1', 'e2'],
      }),
    ).toBe('en cola · 2 eventos');
    expect(formatAwaitingLotStatus({ id: 'a', sentAt: 'x', eventIds: ['e1'] })).toBe(
      'sin informar · 1 evento',
    );
    expect(formatAwaitingLotStatus({ id: 'a', sentAt: 'x', lastStatus: 'processing' })).toBe(
      'procesando',
    );
  });
});

describe('formatPullApplication', () => {
  it('describe las tres formas de aplicar un pull', () => {
    expect(formatPullApplication({ kind: 'applied' })).toBe('Aplicado completo');
    expect(formatPullApplication({ kind: 'reapplied', events: 3 })).toBe(
      'Aplicado + 3 eventos reaplicados (lotes en cola y pendientes)',
    );
    expect(formatPullApplication({ kind: 'retained', lotIds: ['L1', 'L2'] })).toBe(
      'Stock y saldos retenidos: lote L1, L2 procesando — cursor de clientes retenido',
    );
  });
});
