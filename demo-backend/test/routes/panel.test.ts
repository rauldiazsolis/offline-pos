import type { Server } from 'node:http';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.ts';
import { openDb } from '../../src/db.ts';
import { registerRoutes } from '../../src/router.ts';
import { panelRoutes } from '../../src/routes/panel.ts';
import { syncRoutes } from '../../src/routes/sync.ts';
import { seedIfEmpty } from '../../src/seed.ts';

beforeAll(() => {
  registerRoutes(panelRoutes);
  registerRoutes(syncRoutes);
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

describe('GET /_demo', () => {
  it('sirve el HTML del panel sin exigir Authorization', async () => {
    const response = await fetch(`${baseUrl}/_demo`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    const html = await response.text();
    expect(html).toContain('Minibackend de demo');
  });
});

describe('GET /_demo/api/sales', () => {
  it('trae las ventas guardadas, sin exigir Authorization', async () => {
    db.prepare('INSERT INTO sales (id, payload, created_at) VALUES (?, ?, ?)').run(
      's1',
      JSON.stringify({ id: 's1', total: 1200, status: 'closed' }),
      '2026-01-01T00:00:00.000Z',
    );

    const response = await fetch(`${baseUrl}/_demo/api/sales`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { id: string; total: number }[];
    expect(body).toEqual([
      {
        id: 's1',
        total: 1200,
        status: 'closed',
        deviceId: null,
        branch: null,
        pointOfSale: null,
      },
    ]);
  });
});

describe('GET /_demo/api/customers', () => {
  it('trae solo los clientes con source pos, no los sembrados', async () => {
    db.prepare('INSERT INTO customers (id, payload, source, updated_at) VALUES (?, ?, ?, ?)').run(
      'seed-1',
      JSON.stringify({ id: 'seed-1', name: 'Sembrado' }),
      'seed',
      '2026-01-01T00:00:00.000Z',
    );
    db.prepare('INSERT INTO customers (id, payload, source, updated_at) VALUES (?, ?, ?, ?)').run(
      'pos-1',
      JSON.stringify({ id: 'pos-1', name: 'Del POS' }),
      'pos',
      '2026-01-01T00:00:00.000Z',
    );

    const response = await fetch(`${baseUrl}/_demo/api/customers`);
    const body = (await response.json()) as { id: string; name: string }[];
    expect(body).toEqual([{ id: 'pos-1', name: 'Del POS' }]);
  });
});

describe('GET /_demo/api/customer-accounts', () => {
  it('trae solo los clientes con cuenta corriente, con el disponible calculado', async () => {
    db.prepare('INSERT INTO customers (id, payload, source, updated_at) VALUES (?, ?, ?, ?)').run(
      'cust-01',
      JSON.stringify({
        id: 'cust-01',
        name: 'Ana García',
        creditLimit: 5000,
        margin: 1000,
        balance: 200,
      }),
      'seed',
      '2026-01-01T00:00:00.000Z',
    );
    db.prepare('INSERT INTO customers (id, payload, source, updated_at) VALUES (?, ?, ?, ?)').run(
      'sin-cuenta',
      JSON.stringify({ id: 'sin-cuenta', name: 'Sin Cuenta' }),
      'seed',
      '2026-01-01T00:00:00.000Z',
    );

    const response = await fetch(`${baseUrl}/_demo/api/customer-accounts`);
    const body = (await response.json()) as { id: string; available: number }[];
    expect(body).toEqual([
      {
        id: 'cust-01',
        name: 'Ana García',
        creditLimit: 5000,
        margin: 1000,
        balance: 200,
        available: 5800,
      },
    ]);
  });
});

describe('GET /_demo/api/account-holds y DELETE /_demo/api/account-holds/{id}', () => {
  it('lista los holds con el nombre del cliente y permite liberar uno pending sin auth', async () => {
    db.prepare('INSERT INTO customers (id, payload, source, updated_at) VALUES (?, ?, ?, ?)').run(
      'cust-01',
      JSON.stringify({
        id: 'cust-01',
        name: 'Ana García',
        creditLimit: 5000,
        margin: 1000,
        balance: 0,
      }),
      'seed',
      '2026-01-01T00:00:00.000Z',
    );
    db.prepare(
      "INSERT INTO account_holds (id, customer_id, amount, status, created_at) VALUES (?, ?, ?, 'pending', ?)",
    ).run('hold-1', 'cust-01', 300, '2026-01-01T00:00:00.000Z');

    const listResponse = await fetch(`${baseUrl}/_demo/api/account-holds`);
    const list = (await listResponse.json()) as {
      id: string;
      customerName: string;
      status: string;
    }[];
    expect(list).toEqual([
      {
        id: 'hold-1',
        customerId: 'cust-01',
        customerName: 'Ana García',
        amount: 300,
        status: 'pending',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ]);

    const releaseResponse = await fetch(`${baseUrl}/_demo/api/account-holds/hold-1`, {
      method: 'DELETE',
    });
    expect(releaseResponse.status).toBe(200);

    const hold = db.prepare('SELECT status FROM account_holds WHERE id = ?').get('hold-1') as {
      status: string;
    };
    expect(hold.status).toBe('released');
  });
});

const now = '2026-09-23T10:00:00.000Z';

async function pushLot(id: string, events: unknown[]): Promise<void> {
  await fetch(`${baseUrl}/sync/push`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer demo-token',
      'Content-Type': 'application/json',
      'Idempotency-Key': id,
    },
    body: JSON.stringify({ deviceId: 'dev-1', events }),
  });
}

async function pullJson(cursors: Record<string, string | undefined>): Promise<{
  products: { items: unknown[]; nextCursor?: string };
}> {
  const response = await fetch(`${baseUrl}/sync/pull`, {
    method: 'POST',
    headers: { Authorization: 'Bearer demo-token', 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId: 'dev-1', cursors, pendingLotIds: [] }),
  });
  return (await response.json()) as { products: { items: unknown[]; nextCursor?: string } };
}

async function getJson<T>(path: string): Promise<T> {
  return (await (await fetch(`${baseUrl}${path}`)).json()) as T;
}

describe('panel — contrato v3 (#96)', () => {
  it('prende la demora y avanza un lote paso a paso', async () => {
    await fetch(`${baseUrl}/_demo/api/settings`, {
      method: 'PUT',
      body: JSON.stringify({ delayLots: true }),
    });
    expect(await getJson('/_demo/api/settings')).toMatchObject({ delayLots: true });

    await pushLot('l1', []);
    expect(await getJson('/_demo/api/lots')).toMatchObject([
      { id: 'l1', deviceId: 'dev-1', status: 'queued', eventCount: 0 },
    ]);

    await fetch(`${baseUrl}/_demo/api/lots/l1/start`, { method: 'POST' });
    expect(await getJson('/_demo/api/lots')).toMatchObject([{ status: 'processing' }]);

    await fetch(`${baseUrl}/_demo/api/lots/l1/finish`, {
      method: 'POST',
      body: JSON.stringify({ issue: 'Revisar' }),
    });
    expect(await getJson('/_demo/api/lots')).toMatchObject([
      { status: 'issues', issues: [{ message: 'Revisar' }] },
    ]);
  });

  it('terminar sin aviso deja el lote ok', async () => {
    await fetch(`${baseUrl}/_demo/api/settings`, {
      method: 'PUT',
      body: JSON.stringify({ delayLots: true }),
    });
    await pushLot('l1', []);

    await fetch(`${baseUrl}/_demo/api/lots/l1/finish`, { method: 'POST' });

    expect(await getJson('/_demo/api/lots')).toMatchObject([{ status: 'ok', issues: [] }]);
  });

  it('bloquea y desbloquea un producto, y el pull por delta lo trae', async () => {
    seedIfEmpty(db, '2026-01-01T00:00:00.000Z');
    const first = await pullJson({});

    await fetch(`${baseUrl}/_demo/api/catalog/products/alm-001/block`, {
      method: 'POST',
      body: JSON.stringify({ reason: 'Vencido' }),
    });
    const delta = await pullJson({ products: first.products.nextCursor });
    expect(delta.products.items).toEqual([
      expect.objectContaining({ id: 'alm-001', blocked: { reason: 'Vencido' } }),
    ]);

    await fetch(`${baseUrl}/_demo/api/catalog/products/alm-001/block`, { method: 'DELETE' });
    const catalog = await getJson<{ id: string; createdAt: string }[]>(
      '/_demo/api/catalog/products',
    );
    const arroz = catalog.find((item) => item.id === 'alm-001');
    expect(arroz).not.toHaveProperty('blocked');
    expect(arroz?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('bloquea un cliente con motivo vacío', async () => {
    seedIfEmpty(db, '2026-01-01T00:00:00.000Z');

    await fetch(`${baseUrl}/_demo/api/catalog/customers/cust-01/block`, {
      method: 'POST',
      body: JSON.stringify({ reason: '' }),
    });

    const customers = await getJson<{ id: string; blocked?: { reason: string } }[]>(
      '/_demo/api/catalog/customers',
    );
    expect(customers.find((item) => item.id === 'cust-01')?.blocked).toEqual({ reason: '' });
  });

  it('lista ventas, movimientos de caja y cobranzas con su identidad', async () => {
    await pushLot('l1', [
      {
        type: 'cash-movement',
        id: 'm1',
        createdAt: now,
        origin: { branch: 'Centro', pointOfSale: 'Caja 1' },
        movement: {
          id: 'm1',
          direction: 'in',
          amount: 10,
          concept: 'Cambio',
          source: 'manual',
          createdAt: now,
        },
      },
      {
        type: 'customer-payment',
        id: 'cp1',
        createdAt: now,
        origin: { branch: 'Centro' },
        payment: {
          id: 'cp1',
          customerId: 'c1',
          payments: [{ method: 'cash', amount: 5 }],
          total: 5,
          createdAt: now,
        },
      },
      {
        type: 'sale',
        id: 's9',
        createdAt: now,
        origin: { branch: 'Centro', pointOfSale: 'Caja 1' },
        sale: { id: 's9', total: 1, status: 'closed', payments: [] },
      },
    ]);

    expect(await getJson('/_demo/api/cash-movements')).toEqual([
      expect.objectContaining({
        id: 'm1',
        deviceId: 'dev-1',
        branch: 'Centro',
        pointOfSale: 'Caja 1',
      }),
    ]);
    expect(await getJson('/_demo/api/customer-payments')).toEqual([
      expect.objectContaining({
        id: 'cp1',
        deviceId: 'dev-1',
        branch: 'Centro',
        pointOfSale: null,
      }),
    ]);
    expect(await getJson('/_demo/api/sales')).toEqual([
      expect.objectContaining({
        id: 's9',
        deviceId: 'dev-1',
        branch: 'Centro',
        pointOfSale: 'Caja 1',
      }),
    ]);
  });

  it('ya no expone turnos de caja', async () => {
    const response = await fetch(`${baseUrl}/_demo/api/cash-sessions`);
    expect(response.status).toBe(404);
  });
});

describe('panel — estado del backend (#99)', () => {
  it('los ajustes de mantenimiento y contrato se guardan por separado, sin pisar la demora', async () => {
    await fetch(`${baseUrl}/_demo/api/settings`, {
      method: 'PUT',
      body: JSON.stringify({ delayLots: true }),
    });
    await fetch(`${baseUrl}/_demo/api/settings`, {
      method: 'PUT',
      body: JSON.stringify({ maintenance: { enabled: true, message: 'Cierre de mes' } }),
    });
    await fetch(`${baseUrl}/_demo/api/settings`, {
      method: 'PUT',
      body: JSON.stringify({ simulateContract3: true }),
    });

    expect(await getJson('/_demo/api/settings')).toEqual({
      delayLots: true,
      maintenance: { enabled: true, message: 'Cierre de mes' },
      simulateContract3: true,
    });
  });

  it('la lista de ventas muestra a qué venta anula una anulación', async () => {
    await pushLot('l1', [
      { type: 'sale', id: 'v1', sale: { id: 'v1', total: -100, voidsSaleId: 's1' } },
    ]);

    expect(await getJson('/_demo/api/sales')).toMatchObject([{ id: 'v1', voidsSaleId: 's1' }]);
  });
});
