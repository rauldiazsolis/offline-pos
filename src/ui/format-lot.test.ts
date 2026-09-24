import { describe, expect, it } from 'vitest';
import { formatAwaitingLotStatus, formatCleanup, formatPullApplication } from './format-lot.ts';

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

describe('formatCleanup', () => {
  it('sin registro dice que todavía no corrió', () => {
    expect(formatCleanup(undefined)).toEqual({
      last: 'Todavía no corrió',
      anchor: 'Sin turnos cerrados',
    });
  });

  it('resume lo borrado y el ancla', () => {
    const text = formatCleanup({
      at: '2026-09-24T12:00:00.000Z',
      counts: { sales: 3, stockMovements: 4, accountMovements: 1, outbox: 9, cashSessions: 2 },
      anchorClosedAt: '2026-09-20T18:00:00.000Z',
    });
    expect(text.last).toMatch(/3 ventas, 5 movimientos, 9 eventos, 2 turnos/);
    expect(text.anchor).toMatch(/^Último turno cerrado: /);
  });
});
