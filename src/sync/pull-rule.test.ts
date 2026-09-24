import { describe, expect, it } from 'vitest';
import { buildPushLot } from '../domain/push-lot.ts';
import { classifyLots } from './pull-rule.ts';

const sentAt = '2026-09-24T10:00:00.000Z';
const currentLot = buildPushLot(['e9'], { id: 'cur', now: sentAt });

describe('classifyLots', () => {
  it('ok e issues resuelven el lote y juntan los avisos', () => {
    const result = classifyLots({
      awaiting: [
        { id: 'a', sentAt, eventIds: ['e1'] },
        { id: 'b', sentAt, eventIds: ['e2'] },
      ],
      currentLot: undefined,
      reported: {
        a: { status: 'ok' },
        b: { status: 'issues', issues: [{ message: 'x', eventId: 'e2' }] },
      },
    });
    expect(result.resolvedIds).toEqual(new Set(['a', 'b']));
    expect(result.issues).toEqual([{ message: 'x', eventId: 'e2' }]);
    expect(result.retainingLotIds).toEqual([]);
    expect(result.queuedEventIds).toEqual([]);
  });

  it('queued reaplica sus eventos y guarda el estado', () => {
    const result = classifyLots({
      awaiting: [{ id: 'a', sentAt, eventIds: ['e1', 'e2'] }],
      currentLot: undefined,
      reported: { a: { status: 'queued' } },
    });
    expect(result.queuedEventIds).toEqual(['e1', 'e2']);
    expect(result.inProgress).toEqual({ a: 'queued' });
    expect(result.retainingLotIds).toEqual([]);
  });

  it('processing retiene', () => {
    const result = classifyLots({
      awaiting: [{ id: 'a', sentAt, eventIds: ['e1'] }],
      currentLot: undefined,
      reported: { a: { status: 'processing' } },
    });
    expect(result.retainingLotIds).toEqual(['a']);
    expect(result.inProgress).toEqual({ a: 'processing' });
    expect(result.queuedEventIds).toEqual([]);
  });

  it('un lote con ack no informado retiene (contrato v3)', () => {
    const result = classifyLots({
      awaiting: [{ id: 'a', sentAt, eventIds: ['e1'] }],
      currentLot: undefined,
      reported: {},
    });
    expect(result.retainingLotIds).toEqual(['a']);
    expect(result.inProgress).toEqual({});
  });

  it('un lote queued guardado antes de la Etapa 3 (sin eventIds) retiene', () => {
    const result = classifyLots({
      awaiting: [{ id: 'a', sentAt }],
      currentLot: undefined,
      reported: { a: { status: 'queued' } },
    });
    expect(result.retainingLotIds).toEqual(['a']);
    expect(result.inProgress).toEqual({ a: 'queued' });
  });

  it('el lote en curso no informado: no recibido, sin retener ni recuperar', () => {
    const result = classifyLots({ awaiting: [], currentLot, reported: {} });
    expect(result.currentLotNotReceived).toBe(true);
    expect(result.recoveredLot).toBeUndefined();
    expect(result.retainingLotIds).toEqual([]);
  });

  it('el lote en curso informado se recupera como lote en espera y se clasifica por su estado', () => {
    const queued = classifyLots({
      awaiting: [],
      currentLot,
      reported: { cur: { status: 'queued' } },
    });
    expect(queued.recoveredLot).toEqual({ id: 'cur', sentAt, eventIds: ['e9'] });
    expect(queued.currentLotNotReceived).toBe(false);
    expect(queued.queuedEventIds).toEqual(['e9']);

    const processing = classifyLots({
      awaiting: [],
      currentLot,
      reported: { cur: { status: 'processing' } },
    });
    expect(processing.retainingLotIds).toEqual(['cur']);

    const done = classifyLots({ awaiting: [], currentLot, reported: { cur: { status: 'ok' } } });
    expect(done.resolvedIds).toEqual(new Set(['cur']));
  });

  it('un lote que retiene no impide juntar los eventos de otro en cola', () => {
    const result = classifyLots({
      awaiting: [
        { id: 'a', sentAt, eventIds: ['e1'] },
        { id: 'b', sentAt, eventIds: ['e2'] },
      ],
      currentLot: undefined,
      reported: { a: { status: 'processing' }, b: { status: 'queued' } },
    });
    expect(result.retainingLotIds).toEqual(['a']);
    expect(result.queuedEventIds).toEqual(['e2']);
  });
});
