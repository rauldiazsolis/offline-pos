import type { Server } from 'node:http';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.ts';
import { openDb } from '../../src/db.ts';
import { ensureRegister } from '../../src/device-claim.ts';
import { registerRoutes } from '../../src/router.ts';
import { snapshotRoutes } from '../../src/routes/snapshot.ts';
import { syncRoutes } from '../../src/routes/sync.ts';
import { setDemoSettings } from '../../src/settings.ts';
import { arrayField, isRecord, readJson, stringField } from '../json-helpers.ts';

beforeAll(() => {
  registerRoutes(syncRoutes);
  registerRoutes(snapshotRoutes);
});

let server: Server;
let baseUrl: string;
let db: ReturnType<typeof openDb>;

beforeEach(async () => {
  db = openDb(':memory:');
  server = createApp(db);
  await new Promise<void>((resolve) => {
    server.listen(0, resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('No se pudo obtener el puerto del servidor de test');
  }
  baseUrl = `http://localhost:${String(address.port)}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
});

const CAJA_1 = { branch: 'CENTRAL', pointOfSale: 'Caja 1' };
const CAJA_2 = { branch: 'CENTRAL', pointOfSale: 'Caja 2' };

function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 3_600_000).toISOString();
}

function headers(key: string): Record<string, string> {
  return {
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    'X-POS-Contract-Version': '4.7.0',
  };
}

let lotCount = 0;

async function push(key: string, events: unknown[]): Promise<void> {
  lotCount += 1;
  const response = await fetch(`${baseUrl}/sync/push`, {
    method: 'POST',
    headers: { ...headers(key), 'Idempotency-Key': `lot-${String(lotCount)}` },
    body: JSON.stringify({ deviceId: 'dev-a', events }),
  });
  expect(response.status).toBe(200);
}

function sale(
  id: string,
  origin: typeof CAJA_1,
  createdAt: string,
  ticket: { date: string; number: number },
): unknown {
  return { type: 'sale', id, origin, sale: { id, total: 100, createdAt, ticket } };
}

function payment(
  id: string,
  origin: typeof CAJA_1,
  createdAt: string,
  receipt: { date: string; number: number },
): unknown {
  return {
    type: 'customer-payment',
    id,
    origin,
    payment: {
      id,
      customerId: 'cust-01',
      payments: [{ method: 'cash', amount: 50 }],
      total: 50,
      createdAt,
      receipt,
    },
  };
}

function cash(
  id: string,
  origin: typeof CAJA_1,
  createdAt: string,
  counted?: number,
): Record<string, unknown> {
  const movement =
    counted === undefined
      ? { id, direction: 'in', amount: 10, concept: 'Cambio', source: 'manual', createdAt }
      : {
          id,
          direction: 'in',
          amount: 5,
          concept: 'Ajuste por arqueo',
          source: 'count-adjustment',
          count: { expected: counted - 5, counted },
          createdAt,
        };
  return { type: 'cash-movement', id, origin, movement };
}

async function snapshot(key: string): Promise<Response> {
  return fetch(`${baseUrl}/snapshot`, { headers: headers(key) });
}

function ids(list: unknown[]): string[] {
  return list.map((item) => stringField(item, 'id'));
}

describe('GET /snapshot (4.7.0, #230)', () => {
  it('trae la foto de la caja de la key con lo empujado por el push', async () => {
    const { apiKey } = ensureRegister(db, CAJA_1, new Date());
    const anchorAt = hoursAgo(4);
    const s2At = hoursAgo(1);
    await push(apiKey, [
      sale('s-old', CAJA_1, hoursAgo(30), { date: '2026-11-17', number: 40 }),
      sale('s1', CAJA_1, hoursAgo(2), { date: '2026-11-19', number: 3 }),
      sale('s2', CAJA_1, s2At, { date: '2026-11-19', number: 4 }),
      sale('s-otra', CAJA_2, hoursAgo(1), { date: '2026-11-20', number: 99 }),
      payment('cp-old', CAJA_1, hoursAgo(30), { date: '2026-11-18', number: 7 }),
      payment('cp1', CAJA_1, hoursAgo(1), { date: '2026-11-19', number: 2 }),
      payment('cp-otra', CAJA_2, hoursAgo(1), { date: '2026-11-21', number: 1 }),
      cash('cm-antes', CAJA_1, hoursAgo(10)),
      cash('arqueo-viejo', CAJA_1, hoursAgo(9), 1000),
      cash('cm-medio', CAJA_1, hoursAgo(5)),
      cash('arqueo', CAJA_1, anchorAt, 1500),
      cash('cm-despues', CAJA_1, hoursAgo(1)),
      cash('arqueo-otra', CAJA_2, hoursAgo(0.5), 9999),
    ]);

    const response = await snapshot(apiKey);

    expect(response.status).toBe(200);
    const body = await readJson(response);
    expect(Date.parse(stringField(body, 'generatedAt'))).toBeGreaterThan(Date.now() - 60_000);
    expect(body).toMatchObject({
      lastTicket: { date: '2026-11-19', number: 4 },
      lastReceipt: { date: '2026-11-19', number: 2 },
      cashAnchor: { countedAt: anchorAt, amount: 1500 },
    });
    const sales = arrayField(body, 'recentSales');
    expect(ids(sales)).toEqual(['s2', 's1']);
    expect(sales[0]).toEqual({
      id: 's2',
      total: 100,
      createdAt: s2At,
      ticket: { date: '2026-11-19', number: 4 },
      origin: CAJA_1,
    });
    expect(ids(arrayField(body, 'recentCustomerPayments'))).toEqual(['cp1']);
    expect(arrayField(body, 'recentCustomerPayments')[0]).toMatchObject({
      receipt: { date: '2026-11-19', number: 2 },
      origin: CAJA_1,
    });
    const movements = arrayField(body, 'cashMovements');
    expect(ids(movements)).toEqual(['arqueo', 'cm-despues']);
    expect(movements[0]).toMatchObject({ source: 'count-adjustment', origin: CAJA_1 });
  });

  it('con el ancla de hace más de 24 h, las ventas y cobranzas van desde el ancla', async () => {
    const { apiKey } = ensureRegister(db, CAJA_1, new Date());
    await push(apiKey, [
      sale('s-antes', CAJA_1, hoursAgo(40), { date: '2026-11-17', number: 1 }),
      cash('arqueo', CAJA_1, hoursAgo(30), 800),
      sale('s-desde-ancla', CAJA_1, hoursAgo(26), { date: '2026-11-18', number: 2 }),
      payment('cp-desde-ancla', CAJA_1, hoursAgo(27), { date: '2026-11-18', number: 1 }),
      sale('s-hoy', CAJA_1, hoursAgo(1), { date: '2026-11-19', number: 1 }),
    ]);

    const body = await readJson(await snapshot(apiKey));

    expect(ids(arrayField(body, 'recentSales'))).toEqual(['s-hoy', 's-desde-ancla']);
    expect(ids(arrayField(body, 'recentCustomerPayments'))).toEqual(['cp-desde-ancla']);
  });

  it('sin arqueo, sin ancla y con todo: movimientos, ventas y cobranzas (la base es 0)', async () => {
    const { apiKey } = ensureRegister(db, CAJA_1, new Date());
    await push(apiKey, [
      cash('cm-1', CAJA_1, hoursAgo(50)),
      cash('cm-2', CAJA_1, hoursAgo(1)),
      sale('s-vieja', CAJA_1, hoursAgo(72), { date: '2026-11-16', number: 5 }),
    ]);

    const body = await readJson(await snapshot(apiKey));

    expect(ids(arrayField(body, 'cashMovements'))).toEqual(['cm-1', 'cm-2']);
    expect(ids(arrayField(body, 'recentSales'))).toEqual(['s-vieja']);
    expect(body).not.toHaveProperty('cashAnchor');
  });

  it('sin documentos, sin números', async () => {
    const { apiKey } = ensureRegister(db, CAJA_1, new Date());
    await push(apiKey, [cash('cm-1', CAJA_1, hoursAgo(50)), cash('cm-2', CAJA_1, hoursAgo(1))]);

    const body = await readJson(await snapshot(apiKey));

    expect(isRecord(body) ? Object.keys(body).sort() : body).toEqual(
      ['cashMovements', 'generatedAt', 'recentCustomerPayments', 'recentSales'].sort(),
    );
    expect(ids(arrayField(body, 'cashMovements'))).toEqual(['cm-1', 'cm-2']);
    expect(arrayField(body, 'recentSales')).toEqual([]);
  });

  it('otra caja no ve lo de esta', async () => {
    const caja1 = ensureRegister(db, CAJA_1, new Date());
    const caja2 = ensureRegister(db, CAJA_2, new Date());
    await push(caja1.apiKey, [sale('s1', CAJA_1, hoursAgo(1), { date: '2026-11-19', number: 1 })]);

    const body = await readJson(await snapshot(caja2.apiKey));

    expect(arrayField(body, 'recentSales')).toEqual([]);
    expect(body).not.toHaveProperty('lastTicket');
  });

  it('una key que no es de ninguna caja → 404 snapshot-not-available', async () => {
    const response = await snapshot('demo-api-key');

    expect(response.status).toBe(404);
    expect(await readJson(response)).toMatchObject({ code: 'snapshot-not-available' });
  });

  it('con "cash-snapshot" apagado en el panel, la ruta no existe', async () => {
    const { apiKey } = ensureRegister(db, CAJA_1, new Date());
    setDemoSettings(db, { cashSnapshot: false });

    const response = await snapshot(apiKey);

    expect(response.status).toBe(404);
    expect(await readJson(response)).toEqual({ error: 'No existe GET /snapshot' });
  });

  it('pide autenticación', async () => {
    expect((await fetch(`${baseUrl}/snapshot`)).status).toBe(401);
  });
});
