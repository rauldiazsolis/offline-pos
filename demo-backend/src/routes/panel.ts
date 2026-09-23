import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { DatabaseSync } from 'node:sqlite';
import { readJsonBody, sendJson } from '../http-helpers.ts';
import { finishLot, isDelayEnabled, listLots, setDelayEnabled, startLot } from '../lots.ts';
import type { RouteDef } from '../router.ts';

const panelHtmlPath = fileURLToPath(new URL('../panel.html', import.meta.url));
const panelHtml = readFileSync(panelHtmlPath, 'utf-8');

function listPayloads(db: DatabaseSync, sql: string): unknown[] {
  const rows = db.prepare(sql).all() as { payload: string }[];
  return rows.map((row) => JSON.parse(row.payload) as unknown);
}

/** Payload de cada evento más la identidad con que llegó (dispositivo del lote, origen del evento). */
function listWithIdentity(
  db: DatabaseSync,
  table: 'sales' | 'cash_movements' | 'customer_payments',
): unknown[] {
  const rows = db
    .prepare(
      `SELECT payload, device_id, branch, point_of_sale FROM ${table} ORDER BY created_at DESC`,
    )
    .all() as {
    payload: string;
    device_id: string | null;
    branch: string | null;
    point_of_sale: string | null;
  }[];
  return rows.map((row) => ({
    ...(JSON.parse(row.payload) as Record<string, unknown>),
    deviceId: row.device_id,
    branch: row.branch,
    pointOfSale: row.point_of_sale,
  }));
}

/** Bloqueo informativo (contrato v3): toca el payload y `updated_at`, así viaja en el pull por delta. */
function setBlocked(
  db: DatabaseSync,
  table: 'products' | 'customers',
  id: string,
  blocked: { reason: string } | undefined,
): void {
  const row = db.prepare(`SELECT payload FROM ${table} WHERE id = ?`).get(id) as
    { payload: string } | undefined;
  if (row === undefined) {
    return;
  }
  const { blocked: _previous, ...rest } = JSON.parse(row.payload) as Record<string, unknown>;
  const payload = blocked === undefined ? rest : { ...rest, blocked };
  db.prepare(`UPDATE ${table} SET payload = ?, updated_at = ? WHERE id = ?`).run(
    JSON.stringify(payload),
    new Date().toISOString(),
    id,
  );
}

function catalogKind(params: Record<string, string>): 'products' | 'customers' {
  return params.kind === 'products' ? 'products' : 'customers';
}

const BLOCK_PATTERN = /^\/_demo\/api\/catalog\/(?<kind>products|customers)\/(?<id>[^/]+)\/block$/;

export const panelRoutes: RouteDef[] = [
  {
    method: 'GET',
    pattern: /^\/_demo$/,
    requiresAuth: false,
    handler: (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(panelHtml);
    },
  },
  {
    method: 'GET',
    pattern: /^\/_demo\/api\/sales$/,
    requiresAuth: false,
    handler: (_req, res, ctx) => {
      sendJson(res, 200, listWithIdentity(ctx.db, 'sales'));
    },
  },
  {
    method: 'GET',
    pattern: /^\/_demo\/api\/cash-movements$/,
    requiresAuth: false,
    handler: (_req, res, ctx) => {
      sendJson(res, 200, listWithIdentity(ctx.db, 'cash_movements'));
    },
  },
  {
    method: 'GET',
    pattern: /^\/_demo\/api\/customer-payments$/,
    requiresAuth: false,
    handler: (_req, res, ctx) => {
      sendJson(res, 200, listWithIdentity(ctx.db, 'customer_payments'));
    },
  },
  {
    method: 'GET',
    pattern: /^\/_demo\/api\/settings$/,
    requiresAuth: false,
    handler: (_req, res, ctx) => {
      sendJson(res, 200, { delayLots: isDelayEnabled(ctx.db) });
    },
  },
  {
    method: 'PUT',
    pattern: /^\/_demo\/api\/settings$/,
    requiresAuth: false,
    handler: async (req, res, ctx) => {
      const body = (await readJsonBody(req)) as { delayLots?: boolean } | undefined;
      setDelayEnabled(ctx.db, body?.delayLots === true);
      sendJson(res, 200, { delayLots: isDelayEnabled(ctx.db) });
    },
  },
  {
    // Lotes de push (contrato v3): con "Demorar lotes nuevos" prendido quedan `queued` hasta que el
    // operador los avance acá, para poder ver en el POS los estados en curso.
    method: 'GET',
    pattern: /^\/_demo\/api\/lots$/,
    requiresAuth: false,
    handler: (_req, res, ctx) => {
      sendJson(res, 200, listLots(ctx.db));
    },
  },
  {
    method: 'POST',
    pattern: /^\/_demo\/api\/lots\/(?<id>[^/]+)\/start$/,
    requiresAuth: false,
    handler: (_req, res, ctx) => {
      startLot(ctx.db, ctx.params.id ?? '', new Date().toISOString());
      sendJson(res, 200, {});
    },
  },
  {
    method: 'POST',
    pattern: /^\/_demo\/api\/lots\/(?<id>[^/]+)\/finish$/,
    requiresAuth: false,
    handler: async (req, res, ctx) => {
      const body = (await readJsonBody(req)) as { issue?: string } | undefined;
      finishLot(ctx.db, ctx.params.id ?? '', new Date().toISOString(), body?.issue);
      sendJson(res, 200, {});
    },
  },
  {
    method: 'GET',
    pattern: /^\/_demo\/api\/catalog\/(?<kind>products|customers)$/,
    requiresAuth: false,
    handler: (_req, res, ctx) => {
      const rows = ctx.db
        .prepare(`SELECT payload FROM ${catalogKind(ctx.params)} ORDER BY id`)
        .all() as { payload: string }[];
      sendJson(
        res,
        200,
        rows.map((row) => {
          const item = JSON.parse(row.payload) as {
            id: string;
            name: string;
            createdAt?: string;
            blocked?: { reason: string };
          };
          return {
            id: item.id,
            name: item.name,
            createdAt: item.createdAt,
            ...(item.blocked !== undefined ? { blocked: item.blocked } : {}),
          };
        }),
      );
    },
  },
  {
    method: 'POST',
    pattern: BLOCK_PATTERN,
    requiresAuth: false,
    handler: async (req, res, ctx) => {
      const body = (await readJsonBody(req)) as { reason?: string } | undefined;
      setBlocked(ctx.db, catalogKind(ctx.params), ctx.params.id ?? '', {
        reason: body?.reason ?? '',
      });
      sendJson(res, 200, {});
    },
  },
  {
    method: 'DELETE',
    pattern: BLOCK_PATTERN,
    requiresAuth: false,
    handler: (_req, res, ctx) => {
      setBlocked(ctx.db, catalogKind(ctx.params), ctx.params.id ?? '', undefined);
      sendJson(res, 200, {});
    },
  },
  {
    method: 'GET',
    pattern: /^\/_demo\/api\/customers$/,
    requiresAuth: false,
    handler: (_req, res, ctx) => {
      sendJson(
        res,
        200,
        listPayloads(
          ctx.db,
          "SELECT payload FROM customers WHERE source = 'pos' ORDER BY updated_at DESC",
        ),
      );
    },
  },
  {
    method: 'GET',
    pattern: /^\/_demo\/api\/account-holds$/,
    requiresAuth: false,
    handler: (_req, res, ctx) => {
      const rows = ctx.db
        .prepare(
          'SELECT id, customer_id, amount, status, created_at FROM account_holds ORDER BY created_at DESC',
        )
        .all() as {
        id: string;
        customer_id: string;
        amount: number;
        status: string;
        created_at: string;
      }[];
      sendJson(
        res,
        200,
        rows.map((row) => {
          const customerRow = ctx.db
            .prepare('SELECT payload FROM customers WHERE id = ?')
            .get(row.customer_id) as { payload: string } | undefined;
          const customerName =
            customerRow === undefined
              ? row.customer_id
              : ((JSON.parse(customerRow.payload) as { name?: string }).name ?? row.customer_id);
          return {
            id: row.id,
            customerId: row.customer_id,
            customerName,
            amount: row.amount,
            status: row.status,
            createdAt: row.created_at,
          };
        }),
      );
    },
  },
  {
    method: 'GET',
    pattern: /^\/_demo\/api\/customer-accounts$/,
    requiresAuth: false,
    handler: (_req, res, ctx) => {
      const rows = ctx.db.prepare('SELECT payload FROM customers').all() as { payload: string }[];
      const accounts = rows
        .map(
          (row) =>
            JSON.parse(row.payload) as {
              id: string;
              name: string;
              creditLimit?: number;
              margin?: number;
              balance?: number;
            },
        )
        .filter(
          (customer) =>
            customer.creditLimit !== undefined &&
            customer.margin !== undefined &&
            customer.balance !== undefined,
        )
        .map((customer) => ({
          id: customer.id,
          name: customer.name,
          creditLimit: customer.creditLimit,
          margin: customer.margin,
          balance: customer.balance,
          available: (customer.creditLimit ?? 0) + (customer.margin ?? 0) - (customer.balance ?? 0),
        }));
      sendJson(res, 200, accounts);
    },
  },
  {
    // Libera un hold desde el panel — mismo verbo que el endpoint real del
    // contrato (`DELETE /account-holds/{id}`) para no mezclar semántica,
    // pero bajo `/_demo/api/` y sin auth: es una acción del operador del
    // demo, no del POS, mismo criterio que el resto de `/_demo/api/*`.
    method: 'DELETE',
    pattern: /^\/_demo\/api\/account-holds\/(?<holdId>[^/]+)$/,
    requiresAuth: false,
    handler: (_req, res, ctx) => {
      ctx.db
        .prepare(
          "UPDATE account_holds SET status = 'released', released_at = ? WHERE id = ? AND status = 'pending'",
        )
        .run(new Date().toISOString(), ctx.params.holdId ?? '');
      sendJson(res, 200, {});
    },
  },
];
