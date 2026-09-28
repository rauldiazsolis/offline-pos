import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { saveSyncConfig } from '../../sync/config.ts';
import {
  countDifference,
  countNotice,
  describeDifference,
  describeLastCount,
  exceedsBalance,
  fieldsFor,
  moveCashField,
  MOVEMENT_NOTICE,
} from './cash-form-model.ts';

const at = (d: number, h: number, min: number): string =>
  new Date(2026, 8, d, h, min).toISOString();

beforeEach(() => {
  saveSyncConfig({ type: 'rest', baseUrl: 'http://x', locale: 'es-AR' });
});

afterEach(() => {
  localStorage.clear();
});

describe('cash-form-model', () => {
  it('campos por tipo', () => {
    expect(fieldsFor('count')).toEqual(['counted']);
    expect(fieldsFor('in')).toEqual(['concept', 'description', 'amount']);
    expect(fieldsFor('out')).toEqual(['concept', 'description', 'amount']);
  });

  it('moveCashField avanza y retrocede sin ciclar', () => {
    expect(moveCashField('in', 'concept', 1)).toBe('description');
    expect(moveCashField('in', 'description', -1)).toBe('concept');
    expect(moveCashField('in', 'amount', 1)).toBeUndefined();
    expect(moveCashField('in', 'concept', -1)).toBeUndefined();
    expect(moveCashField('count', 'counted', 1)).toBeUndefined();
  });

  it('countDifference', () => {
    expect(countDifference(1000, 1200)).toEqual({ kind: 'over', amount: 200 });
    expect(countDifference(1000, 900)).toEqual({ kind: 'short', amount: 100 });
    expect(countDifference(1000, 1000)).toEqual({ kind: 'even', amount: 0 });
    expect(countDifference(1000, undefined)).toBeUndefined();
  });

  it('describeDifference y countNotice', () => {
    expect(describeDifference({ kind: 'over', amount: 200 })).toBe('Sobran $200,00');
    expect(describeDifference({ kind: 'short', amount: 100 })).toBe('Faltan $100,00');
    expect(describeDifference({ kind: 'even', amount: 0 })).toBe('Sin diferencia');
    expect(countNotice({ kind: 'over', amount: 200 })).toBe('Arqueo registrado: sobran $200,00');
    expect(countNotice({ kind: 'short', amount: 100 })).toBe('Arqueo registrado: faltan $100,00');
    expect(countNotice({ kind: 'even', amount: 0 })).toBe('Arqueo registrado: sin diferencia');
    expect(MOVEMENT_NOTICE).toEqual({ in: 'Ingreso registrado', out: 'Egreso registrado' });
  });

  it('exceedsBalance solo para un egreso mayor que el saldo', () => {
    expect(exceedsBalance('out', 600, 500)).toBe(true);
    expect(exceedsBalance('out', 500, 500)).toBe(false);
    expect(exceedsBalance('in', 600, 500)).toBe(false);
    expect(exceedsBalance('out', undefined, 500)).toBe(false);
  });

  it('describeLastCount: hoy, ayer, otra fecha o sin arqueo', () => {
    const now = at(24, 15, 0);
    expect(describeLastCount(at(24, 9, 12), now)).toBe('Último arqueo: hoy 09:12');
    expect(describeLastCount(at(23, 18, 40), now)).toBe('Último arqueo: ayer 18:40');
    expect(describeLastCount(at(21, 18, 40), now)).toBe('Último arqueo: 21/09 18:40');
    expect(describeLastCount(undefined, now)).toBe(
      'Sin arqueo previo · esperado desde el inicio de la terminal',
    );
  });
});
