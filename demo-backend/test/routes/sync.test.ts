import type { Server } from 'node:http';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.ts';
import { openDb } from '../../src/db.ts';
import { registerRoutes } from '../../src/router.ts';
import { accountHoldRoutes } from '../../src/routes/account-holds.ts';
import { syncRoutes } from '../../src/routes/sync.ts';

beforeAll(() => {
  registerRoutes(syncRoutes);
  registerRoutes(accountHoldRoutes);
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

async function push(idempotencyKey: string, events: unknown[]): Promise<Response> {
  return fetch(`${baseUrl}/sync/push`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer demo-token',
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify({ events }),
  });
}

async function pull(body: {
  cursors: Record<string, string>;
  pendingLotIds: string[];
}): Promise<Response> {
  return fetch(`${baseUrl}/sync/pull`, {
    method: 'POST',
    headers: { Authorization: 'Bearer demo-token', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /sync/push', () => {
  it('siempre responde 200, nunca simula rechazo de negocio', async () => {
    const response = await push('lot-1', [
      { type: 'sale', id: 'sale-1', sale: { id: 'sale-1', total: 1200 } },
    ]);
    expect(response.status).toBe(200);
  });

  it('exige Idempotency-Key', async () => {
    const response = await fetch(`${baseUrl}/sync/push`, {
      method: 'POST',
      headers: { Authorization: 'Bearer demo-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ events: [] }),
    });
    expect(response.status).toBe(400);
  });

  it('aplica los 7 tipos de evento en un solo lote', async () => {
    db.prepare('INSERT INTO customers (id, payload, source, updated_at) VALUES (?, ?, ?, ?)').run(
      'cust-01',
      JSON.stringify({ id: 'cust-01', name: 'Ana', creditLimit: 1000, margin: 0, balance: 0 }),
      'seed',
      '2026-01-01T00:00:00.000Z',
    );
    const holdResponse = await fetch(`${baseUrl}/account-holds`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer demo-token',
        'Content-Type': 'application/json',
        'Idempotency-Key': 'hold-req',
      },
      body: JSON.stringify({ customerId: 'cust-01', amount: 300 }),
    });
    const { holdId } = (await holdResponse.json()) as { holdId: string };

    const response = await push('lot-full', [
      { type: 'sale', id: 'sale-1', sale: { id: 'sale-1', total: 300 } },
      {
        type: 'stock-movement',
        id: 'mov-1',
        movement: { id: 'mov-1', productId: 'p1', delta: -1 },
      },
      { type: 'sale-void', id: 'void-1', saleId: 'sale-1', voidedAt: '2026-01-01T00:00:00.000Z' },
      { type: 'customer', id: 'cust-02', customer: { id: 'cust-02', name: 'Beto' } },
      { type: 'account-hold-confirm', id: 'confirm-1', holdId, saleId: 'sale-1' },
      { type: 'cash-session', id: 'cs-1', session: { id: 'cs-1', sales: ['sale-1'] } },
    ]);

    expect(response.status).toBe(200);
    expect(db.prepare('SELECT COUNT(*) c FROM sales').get()).toEqual({ c: 1 });
    expect(db.prepare('SELECT COUNT(*) c FROM stock_movements').get()).toEqual({ c: 1 });
    expect(db.prepare('SELECT COUNT(*) c FROM sale_voids').get()).toEqual({ c: 1 });
    expect(db.prepare('SELECT COUNT(*) c FROM cash_sessions').get()).toEqual({ c: 1 });
    const customer = JSON.parse(
      (
        db.prepare('SELECT payload FROM customers WHERE id = ?').get('cust-01') as {
          payload: string;
        }
      ).payload,
    ) as { balance: number };
    expect(customer.balance).toBe(300); // confirmado por el lote
    const hold = db.prepare('SELECT status FROM account_holds WHERE id = ?').get(holdId) as {
      status: string;
    };
    expect(hold.status).toBe('confirmed');
  });

  it('account-hold-release libera el hold sin tocar el balance', async () => {
    db.prepare('INSERT INTO customers (id, payload, source, updated_at) VALUES (?, ?, ?, ?)').run(
      'cust-01',
      JSON.stringify({ id: 'cust-01', name: 'Ana', creditLimit: 1000, margin: 0, balance: 0 }),
      'seed',
      '2026-01-01T00:00:00.000Z',
    );
    const holdResponse = await fetch(`${baseUrl}/account-holds`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer demo-token',
        'Content-Type': 'application/json',
        'Idempotency-Key': 'hold-req-2',
      },
      body: JSON.stringify({ customerId: 'cust-01', amount: 300 }),
    });
    const { holdId } = (await holdResponse.json()) as { holdId: string };

    await push('lot-release', [{ type: 'account-hold-release', id: 'release-1', holdId }]);

    const hold = db.prepare('SELECT status FROM account_holds WHERE id = ?').get(holdId) as {
      status: string;
    };
    expect(hold.status).toBe('released');
  });

  it('idempotencia por lote: reenviar el mismo idempotency_id no vuelve a insertar', async () => {
    await push('lot-dup', [{ type: 'sale', id: 'sale-9', sale: { id: 'sale-9', total: 100 } }]);
    const second = await push('lot-dup', [
      { type: 'sale', id: 'sale-9', sale: { id: 'sale-9', total: 999 } },
    ]);

    expect(second.status).toBe(200);
    expect(db.prepare('SELECT COUNT(*) c FROM sales').get()).toEqual({ c: 1 });
  });

  it('registra el lote en push_lots como ok', async () => {
    await push('lot-tracked', [
      { type: 'sale', id: 'sale-tracked', sale: { id: 'sale-tracked', total: 1 } },
    ]);

    const lot = db.prepare('SELECT status FROM push_lots WHERE id = ?').get('lot-tracked') as {
      status: string;
    };
    expect(lot.status).toBe('ok');
  });
});

describe('POST /sync/pull', () => {
  beforeEach(() => {
    db.prepare('INSERT INTO products (id, payload, updated_at) VALUES (?, ?, ?)').run(
      'p1',
      JSON.stringify({
        id: 'p1',
        sku: 'S1',
        barcodes: [],
        name: 'Arroz',
        price: 100,
        taxRate: 0,
        category: 'x',
        tracksStock: true,
      }),
      '2026-01-01T00:00:01.000Z',
    );
    db.prepare('INSERT INTO stock (product_id, quantity, updated_at) VALUES (?, ?, ?)').run(
      'p1',
      5,
      '2026-01-01T00:00:00.000Z',
    );
  });

  it('sin cursores trae la foto completa de productos/clientes y siempre el stock entero', async () => {
    const response = await pull({ cursors: {}, pendingLotIds: [] });
    const body = (await response.json()) as { products: { items: unknown[] }; stock: unknown[] };

    expect(body.products.items).toHaveLength(1);
    expect(body.stock).toEqual([
      { productId: 'p1', quantity: 5, updatedAt: '2026-01-01T00:00:00.000Z' },
    ]);
  });

  it('con cursor trae solo lo actualizado después, y devuelve nextCursor', async () => {
    const response = await pull({
      cursors: { products: '2026-01-01T00:00:01.000Z' },
      pendingLotIds: [],
    });
    const body = (await response.json()) as { products: { items: unknown[]; nextCursor?: string } };

    expect(body.products.items).toEqual([]);
    expect(body.products.nextCursor).toBeUndefined();
  });

  it('informa el estado de los lotes de push pedidos, y omite los que no reconoce', async () => {
    await push('lot-known', [{ type: 'sale', id: 'sale-1', sale: { id: 'sale-1', total: 1 } }]);

    const response = await pull({ cursors: {}, pendingLotIds: ['lot-known', 'lot-desconocido'] });
    const body = (await response.json()) as { lots: Record<string, { status: string }> };

    expect(body.lots).toEqual({ 'lot-known': { status: 'ok' } });
    expect(body.lots['lot-desconocido']).toBeUndefined();
  });
});
