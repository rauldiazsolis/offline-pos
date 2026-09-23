import { beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../src/db.ts';
import {
  finishLot,
  isDelayEnabled,
  listLots,
  lotStatusFor,
  receiveLot,
  setDelayEnabled,
  startLot,
} from '../src/lots.ts';
import { seedIfEmpty } from '../src/seed.ts';

const now = '2026-09-23T10:00:00.000Z';

let db: ReturnType<typeof openDb>;

beforeEach(() => {
  db = openDb(':memory:');
  seedIfEmpty(db, now);
});

const stockOf = (id: string) =>
  (db.prepare('SELECT quantity FROM stock WHERE product_id = ?').get(id) as { quantity: number })
    .quantity;
const balanceOf = (id: string) =>
  (
    JSON.parse(
      (db.prepare('SELECT payload FROM customers WHERE id = ?').get(id) as { payload: string })
        .payload,
    ) as { balance: number }
  ).balance;

describe('lotes (contrato v3)', () => {
  it('recibido queda queued y no aplica efectos hasta terminar', () => {
    receiveLot(
      db,
      {
        id: 'l1',
        deviceId: 'dev-1',
        events: [
          {
            type: 'stock-movement',
            id: 'm1',
            movement: {
              id: 'm1',
              productId: 'alm-001',
              delta: -2.5,
              reason: 'sale',
              createdAt: now,
            },
          },
        ],
      },
      now,
    );
    expect(lotStatusFor(db, 'l1')).toEqual({ status: 'queued' });
    expect(stockOf('alm-001')).toBe(40);

    expect(startLot(db, 'l1', now)).toBe(true);
    expect(lotStatusFor(db, 'l1')).toEqual({ status: 'processing' });

    finishLot(db, 'l1', now);
    expect(lotStatusFor(db, 'l1')).toEqual({ status: 'ok' });
    expect(stockOf('alm-001')).toBe(37.5);
  });

  it('terminar dos veces no reaplica los efectos', () => {
    receiveLot(
      db,
      {
        id: 'l1',
        deviceId: 'd',
        events: [
          {
            type: 'stock-movement',
            id: 'm1',
            movement: { id: 'm1', productId: 'alm-001', delta: -1 },
          },
        ],
      },
      now,
    );

    expect(finishLot(db, 'l1', now)).toBe(true);
    expect(finishLot(db, 'l1', now)).toBe(false);
    expect(startLot(db, 'l1', now)).toBe(false);
    expect(stockOf('alm-001')).toBe(39);
  });

  it('pago a cuenta sin hold suma al saldo (con signo); cobranza resta', () => {
    receiveLot(
      db,
      {
        id: 'l1',
        deviceId: 'd',
        events: [
          {
            type: 'sale',
            id: 's1',
            sale: {
              id: 's1',
              customerId: 'cust-02',
              payments: [{ method: 'account', amount: 300 }],
              lines: [],
              total: 300,
              status: 'closed',
              createdAt: now,
            },
          },
          {
            type: 'sale',
            id: 's2',
            sale: {
              id: 's2',
              customerId: 'cust-02',
              payments: [{ method: 'account', amount: -100 }],
              lines: [],
              total: -100,
              status: 'closed',
              createdAt: now,
            },
          },
          {
            type: 'customer-payment',
            id: 'cp1',
            payment: {
              id: 'cp1',
              customerId: 'cust-02',
              payments: [{ method: 'cash', amount: 400 }],
              total: 400,
              createdAt: now,
            },
          },
        ],
      },
      now,
    );

    finishLot(db, 'l1', now);

    expect(balanceOf('cust-02')).toBe(1200 + 300 - 100 - 400);
  });

  it('un pago a cuenta con hold no mueve el saldo al llegar la venta (lo mueve el confirm)', () => {
    receiveLot(
      db,
      {
        id: 'l1',
        deviceId: 'd',
        events: [
          {
            type: 'sale',
            id: 's1',
            sale: {
              id: 's1',
              customerId: 'cust-02',
              payments: [{ method: 'account', amount: 300, reference: 'h-1' }],
            },
          },
        ],
      },
      now,
    );

    finishLot(db, 'l1', now);

    expect(balanceOf('cust-02')).toBe(1200);
  });

  it('tipo desconocido: issue con eventId, el resto se aplica con su identidad', () => {
    receiveLot(
      db,
      {
        id: 'l1',
        deviceId: 'd',
        events: [
          { type: 'cash-session', id: 'cs1', session: {} },
          {
            type: 'cash-movement',
            id: 'm1',
            origin: { branch: 'Centro' },
            movement: {
              id: 'm1',
              direction: 'in',
              amount: 10,
              concept: 'x',
              source: 'manual',
              createdAt: now,
            },
          },
        ],
      },
      now,
    );

    finishLot(db, 'l1', now);

    expect(lotStatusFor(db, 'l1')).toEqual({
      status: 'issues',
      issues: [{ message: expect.stringContaining('cash-session') as unknown, eventId: 'cs1' }],
    });
    expect(
      db.prepare('SELECT branch, device_id FROM cash_movements WHERE id = ?').get('m1'),
    ).toEqual({ branch: 'Centro', device_id: 'd' });
  });

  it('terminar con aviso agrega el texto del operador', () => {
    receiveLot(db, { id: 'l1', deviceId: 'd', events: [] }, now);

    finishLot(db, 'l1', now, 'Revisar a mano');

    expect(lotStatusFor(db, 'l1')).toEqual({
      status: 'issues',
      issues: [{ message: 'Revisar a mano' }],
    });
  });

  it('listLots resume cada lote para el panel', () => {
    receiveLot(db, { id: 'l1', deviceId: 'dev-1', events: [{ type: 'x', id: 'e1' }] }, now);

    expect(listLots(db)).toEqual([
      { id: 'l1', deviceId: 'dev-1', status: 'queued', eventCount: 1, issues: [], createdAt: now },
    ]);
  });

  it('la demora arranca apagada y se puede prender', () => {
    expect(isDelayEnabled(db)).toBe(false);
    setDelayEnabled(db, true);
    expect(isDelayEnabled(db)).toBe(true);
    setDelayEnabled(db, false);
    expect(isDelayEnabled(db)).toBe(false);
  });
});
