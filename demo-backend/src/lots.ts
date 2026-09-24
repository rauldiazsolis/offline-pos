import type { DatabaseSync } from 'node:sqlite';

/**
 * Lotes de `/sync/push` (contrato v3, #96): la **recepción** de un lote
 * (`receiveLot`, queda `queued`) está separada de su **procesamiento**
 * (`startLot` → `processing`, `finishLot` → `ok`/`issues`), así el panel de
 * demo puede demorar un lote y avanzarlo a mano para mostrar los estados en
 * curso. Los efectos (stock, saldos, filas de ventas) recién se aplican al
 * terminar — igual que un backend real que procesa en diferido.
 */
export type LotIssue = { message: string; eventId?: string };

export type BatchEvent = {
  type: string;
  id: string;
  createdAt?: string;
  origin?: { branch?: string; pointOfSale?: string };
} & Record<string, unknown>;

type Stamp = { deviceId: string; branch: string | null; pointOfSale: string | null };

type Payment = { method: string; amount: number; reference?: string };
type CustomerPayload = { id: string; balance?: number } & Record<string, unknown>;

function stampOf(deviceId: string, event: BatchEvent): Stamp {
  return {
    deviceId,
    branch: event.origin?.branch ?? null,
    pointOfSale: event.origin?.pointOfSale ?? null,
  };
}

/** Mueve el saldo de un cliente con cuenta corriente; sin cuenta, no hay saldo que mover. */
function adjustBalance(db: DatabaseSync, customerId: string, delta: number, now: string): void {
  const row = db.prepare('SELECT payload FROM customers WHERE id = ?').get(customerId) as
    { payload: string } | undefined;
  if (row === undefined) {
    return;
  }
  const customer = JSON.parse(row.payload) as CustomerPayload;
  if (customer.balance === undefined) {
    return;
  }
  db.prepare('UPDATE customers SET payload = ?, updated_at = ? WHERE id = ?').run(
    JSON.stringify({ ...customer, balance: Math.round((customer.balance + delta) * 100) / 100 }),
    now,
    customerId,
  );
}

function insertEvent(
  db: DatabaseSync,
  table: 'sales' | 'stock_movements' | 'cash_movements',
  id: string,
  payload: unknown,
  stamp: Stamp,
  now: string,
): void {
  db.prepare(
    `INSERT INTO ${table} (id, payload, device_id, branch, point_of_sale, created_at) VALUES (?, ?, ?, ?, ?, ?) ` +
      'ON CONFLICT(id) DO UPDATE SET payload = excluded.payload',
  ).run(id, JSON.stringify(payload), stamp.deviceId, stamp.branch, stamp.pointOfSale, now);
}

/** Confirmar suma el monto del hold al saldo; liberar lo descarta. Solo sobre holds `pending`. */
function applyHoldEvent(db: DatabaseSync, event: BatchEvent, now: string): void {
  const holdId = String(event.holdId);
  if (event.type === 'account-hold-release') {
    db.prepare(
      "UPDATE account_holds SET status = 'released', released_at = ? WHERE id = ? AND status = 'pending'",
    ).run(now, holdId);
    return;
  }
  const hold = db
    .prepare('SELECT customer_id, amount, status FROM account_holds WHERE id = ?')
    .get(holdId) as { customer_id: string; amount: number; status: string } | undefined;
  if (hold !== undefined && hold.status === 'pending') {
    adjustBalance(db, hold.customer_id, hold.amount, now);
    db.prepare("UPDATE account_holds SET status = 'confirmed', confirmed_at = ? WHERE id = ?").run(
      now,
      holdId,
    );
  }
}

/**
 * Aplica un evento; devuelve un aviso si no lo reconoce. Nunca rechaza por
 * contenido (el backend nunca rechaza, #87). Upsert por id: un mismo evento
 * en dos lotes distintos pisa en vez de chocar.
 */
function applyEvent(
  db: DatabaseSync,
  event: BatchEvent,
  stamp: Stamp,
  now: string,
): LotIssue | undefined {
  switch (event.type) {
    case 'sale': {
      const sale = event.sale as { customerId?: string; payments?: Payment[] };
      insertEvent(db, 'sales', event.id, sale, stamp, now);
      if (sale.customerId !== undefined) {
        for (const payment of sale.payments ?? []) {
          if (payment.method === 'account' && payment.reference === undefined) {
            // Fiado sin hold (vendido sin red), o acreditación si es negativo — la anulación de
            // una venta a cuenta (4.0.0, #99) es una venta más con el pago invertido.
            adjustBalance(db, sale.customerId, payment.amount, now);
          }
        }
      }
      return undefined;
    }
    case 'stock-movement': {
      const movement = event.movement as { productId: string; delta: number };
      insertEvent(db, 'stock_movements', event.id, movement, stamp, now);
      db.prepare(
        'UPDATE stock SET quantity = quantity + ?, updated_at = ? WHERE product_id = ?',
      ).run(movement.delta, now, movement.productId);
      return undefined;
    }
    case 'customer': {
      const customer = event.customer as { id: string };
      db.prepare(
        'INSERT INTO customers (id, payload, source, device_id, branch, point_of_sale, updated_at) ' +
          'VALUES (?, ?, ?, ?, ?, ?, ?) ' +
          'ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at',
      ).run(
        customer.id,
        JSON.stringify(customer),
        'pos',
        stamp.deviceId,
        stamp.branch,
        stamp.pointOfSale,
        now,
      );
      return undefined;
    }
    case 'account-hold-confirm':
    case 'account-hold-release':
      applyHoldEvent(db, event, now);
      return undefined;
    case 'cash-movement':
      insertEvent(db, 'cash_movements', event.id, event.movement, stamp, now);
      return undefined;
    case 'customer-payment': {
      const payment = event.payment as { customerId: string; total: number };
      const inserted = db
        .prepare(
          'INSERT INTO customer_payments (id, customer_id, payload, device_id, branch, point_of_sale, created_at) ' +
            'VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING',
        )
        .run(
          event.id,
          payment.customerId,
          JSON.stringify(payment),
          stamp.deviceId,
          stamp.branch,
          stamp.pointOfSale,
          now,
        );
      // Una cobranza repetida (mismo id en otro lote) no vuelve a mover el saldo.
      if (inserted.changes > 0) {
        adjustBalance(db, payment.customerId, -payment.total, now);
      }
      return undefined;
    }
    default:
      return {
        message: `Tipo de evento desconocido para el contrato v3: ${event.type}`,
        eventId: event.id,
      };
  }
}

/** Registra un lote recibido como `queued`, sin aplicar nada. Un id ya visto no se toca. */
export function receiveLot(
  db: DatabaseSync,
  params: { id: string; deviceId: string; events: BatchEvent[] },
  now: string,
): void {
  db.prepare(
    'INSERT INTO push_lots (id, device_id, status, events, issues, created_at, updated_at) ' +
      'VALUES (?, ?, ?, ?, NULL, ?, ?) ON CONFLICT(id) DO NOTHING',
  ).run(params.id, params.deviceId, 'queued', JSON.stringify(params.events), now, now);
}

/** `queued` → `processing`. Devuelve `false` si el lote no estaba en cola. */
export function startLot(db: DatabaseSync, id: string, now: string): boolean {
  return (
    db
      .prepare(
        "UPDATE push_lots SET status = 'processing', updated_at = ? WHERE id = ? AND status = 'queued'",
      )
      .run(now, id).changes > 0
  );
}

/**
 * Aplica el lote y lo deja `ok`, o `issues` si algún evento no se reconoció
 * (o el operador agregó un aviso). Solo desde `queued`/`processing`:
 * terminar dos veces no reaplica.
 */
export function finishLot(db: DatabaseSync, id: string, now: string, extraIssue?: string): boolean {
  const row = db
    .prepare(
      "SELECT device_id, events FROM push_lots WHERE id = ? AND status IN ('queued', 'processing')",
    )
    .get(id) as { device_id: string | null; events: string } | undefined;
  if (row === undefined) {
    return false;
  }
  const issues: LotIssue[] = [];
  for (const event of JSON.parse(row.events) as BatchEvent[]) {
    const issue = applyEvent(db, event, stampOf(row.device_id ?? '', event), now);
    if (issue !== undefined) {
      issues.push(issue);
    }
  }
  if (extraIssue !== undefined && extraIssue.trim() !== '') {
    issues.push({ message: extraIssue.trim() });
  }
  db.prepare('UPDATE push_lots SET status = ?, issues = ?, updated_at = ? WHERE id = ?').run(
    issues.length > 0 ? 'issues' : 'ok',
    issues.length > 0 ? JSON.stringify(issues) : null,
    now,
    id,
  );
  return true;
}

/** Estado de un lote tal como lo informa `/sync/pull`; `undefined` si no lo conocemos. */
export function lotStatusFor(
  db: DatabaseSync,
  id: string,
): { status: string; issues?: LotIssue[] } | undefined {
  const row = db.prepare('SELECT status, issues FROM push_lots WHERE id = ?').get(id) as
    { status: string; issues: string | null } | undefined;
  if (row === undefined) {
    return undefined;
  }
  return row.issues !== null
    ? { status: row.status, issues: JSON.parse(row.issues) as LotIssue[] }
    : { status: row.status };
}

export type LotSummary = {
  id: string;
  deviceId: string | null;
  status: string;
  eventCount: number;
  issues: LotIssue[];
  createdAt: string;
};

export function listLots(db: DatabaseSync): LotSummary[] {
  const rows = db
    .prepare(
      'SELECT id, device_id, status, events, issues, created_at FROM push_lots ORDER BY created_at DESC',
    )
    .all() as {
    id: string;
    device_id: string | null;
    status: string;
    events: string;
    issues: string | null;
    created_at: string;
  }[];
  return rows.map((row) => ({
    id: row.id,
    deviceId: row.device_id,
    status: row.status,
    eventCount: (JSON.parse(row.events) as unknown[]).length,
    issues: row.issues === null ? [] : (JSON.parse(row.issues) as LotIssue[]),
    createdAt: row.created_at,
  }));
}

/** "Demorar lotes nuevos" del panel: arranca apagado — sin demora, cada lote se procesa al recibirlo. */
export function isDelayEnabled(db: DatabaseSync): boolean {
  const row = db.prepare("SELECT value FROM demo_settings WHERE key = 'delayLots'").get() as
    { value: string } | undefined;
  return row?.value === 'true';
}

export function setDelayEnabled(db: DatabaseSync, enabled: boolean): void {
  db.prepare(
    "INSERT INTO demo_settings (key, value) VALUES ('delayLots', ?) " +
      'ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(String(enabled));
}
