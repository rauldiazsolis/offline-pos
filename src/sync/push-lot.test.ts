import { beforeEach, describe, expect, it } from 'vitest';
import { buildPushLot } from '../domain/push-lot.ts';
import {
  addAwaitingLot,
  clearCurrentPushLot,
  clearPushLotState,
  getAwaitingLots,
  getCurrentPushLot,
  resolveAwaitingLots,
  setCurrentPushLot,
} from './push-lot.ts';

beforeEach(() => {
  localStorage.clear();
});

describe('lote en curso', () => {
  it('undefined si nunca se guardó nada', () => {
    expect(getCurrentPushLot()).toBeUndefined();
  });

  it('guarda y devuelve el mismo lote', () => {
    const lot = buildPushLot(['e1', 'e2'], { id: 'lot-1', now: '2026-01-01T00:00:00.000Z' });
    setCurrentPushLot(lot);
    expect(getCurrentPushLot()).toEqual(lot);
  });

  it('clearCurrentPushLot lo borra', () => {
    setCurrentPushLot(buildPushLot(['e1'], { id: 'lot-1', now: '2026-01-01T00:00:00.000Z' }));
    clearCurrentPushLot();
    expect(getCurrentPushLot()).toBeUndefined();
  });
});

describe('lotes esperando resolución', () => {
  it('arranca vacío', () => {
    expect(getAwaitingLots()).toEqual([]);
  });

  it('addAwaitingLot acumula', () => {
    addAwaitingLot({ id: 'lot-1', sentAt: '2026-01-01T00:00:00.000Z' });
    addAwaitingLot({ id: 'lot-2', sentAt: '2026-01-01T00:01:00.000Z' });
    expect(getAwaitingLots().map((l) => l.id)).toEqual(['lot-1', 'lot-2']);
  });

  it('resolveAwaitingLots saca solo los ids resueltos', () => {
    addAwaitingLot({ id: 'lot-1', sentAt: '2026-01-01T00:00:00.000Z' });
    addAwaitingLot({ id: 'lot-2', sentAt: '2026-01-01T00:01:00.000Z' });

    resolveAwaitingLots(new Set(['lot-1']));

    expect(getAwaitingLots().map((l) => l.id)).toEqual(['lot-2']);
  });

  it('sin tope: el POS no tiene autoridad para decidir dejar de rastrear un lote (a discutir más adelante una pantalla/indicador para el humano)', () => {
    for (let i = 0; i < 25; i += 1) {
      addAwaitingLot({ id: `lot-${String(i)}`, sentAt: '2026-01-01T00:00:00.000Z' });
    }
    const ids = getAwaitingLots().map((l) => l.id);
    expect(ids).toHaveLength(25);
    expect(ids[0]).toBe('lot-0');
    expect(ids.at(-1)).toBe('lot-24');
  });
});

describe('clearPushLotState', () => {
  it('borra el lote en curso y la lista de espera', () => {
    setCurrentPushLot(buildPushLot(['e1'], { id: 'lot-1', now: '2026-01-01T00:00:00.000Z' }));
    addAwaitingLot({ id: 'lot-2', sentAt: '2026-01-01T00:00:00.000Z' });

    clearPushLotState();

    expect(getCurrentPushLot()).toBeUndefined();
    expect(getAwaitingLots()).toEqual([]);
  });
});
