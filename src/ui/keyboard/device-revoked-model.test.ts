import { describe, expect, it } from 'vitest';
import { formatMoney } from '../format.ts';
import {
  DEVICE_REVOKED_EXPLANATION,
  describePendingGroup,
  describeUnlink,
  deviceRevokedText,
  hasPending,
} from './device-revoked-model.ts';

const EMPTY = { events: 0, byType: {} };

describe('describePendingGroup (4.7.0, #230)', () => {
  it('vacío: nada', () => {
    expect(describePendingGroup(EMPTY)).toBeUndefined();
  });

  it('ventas y cobranzas con su total, el resto como movimientos', () => {
    expect(
      describePendingGroup({
        events: 6,
        byType: {
          sale: { count: 2, total: 1500 },
          'customer-payment': { count: 1, total: 300 },
          'cash-movement': { count: 3 },
        },
      }),
    ).toBe(
      `2 ventas por $${formatMoney(1500)}, 1 cobranza por $${formatMoney(300)} y 3 movimientos más`,
    );
  });

  it('solo movimientos, sin "más"', () => {
    expect(describePendingGroup({ events: 1, byType: { customer: { count: 1 } } })).toBe(
      '1 movimiento',
    );
  });
});

describe('describeUnlink', () => {
  const pending = {
    notSent: { events: 1, byType: { sale: { count: 1, total: 10 } } },
    sentUnconfirmed: EMPTY,
  };

  it('con algo pendiente sin exportar, lo remarca', () => {
    expect(hasPending(pending)).toBe(true);
    expect(describeUnlink(pending, undefined).warning).toMatch(/Todavía no exportaste/);
  });

  it('exportado, o sin nada pendiente, solo la pregunta', () => {
    expect(describeUnlink(pending, 'x.json').warning).toBeUndefined();
    expect(
      describeUnlink({ notSent: EMPTY, sentUnconfirmed: EMPTY }, undefined).warning,
    ).toBeUndefined();
    expect(describeUnlink(pending, undefined).question).toMatch(/¿Desvincular\?$/);
  });
});

describe('deviceRevokedText', () => {
  it('el mensaje del backend, salvo que repita el título', () => {
    expect(deviceRevokedText('La tomó la Caja 2.')).toBe('La tomó la Caja 2.');
    expect(deviceRevokedText('Esta caja fue vinculada en otro dispositivo.')).toBe(
      DEVICE_REVOKED_EXPLANATION,
    );
    expect(deviceRevokedText(undefined)).toBe(DEVICE_REVOKED_EXPLANATION);
  });
});
