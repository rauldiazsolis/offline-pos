/**
 * Identificación de cliente (RF-16) — separada a propósito de la cuenta
 * corriente: un `Customer` no sabe nada de crédito. `CustomerAccount` es el
 * módulo aparte y opcional (ver "Modelo de dominio" en CLAUDE.md).
 */
export type Customer = {
  id: string; // ULID si se crea local; el id del backend si vino de un pull
  name: string;
  document?: string;
  phone?: string;
  createdAt: string; // ISO 8601
};

/**
 * Cuenta corriente de un cliente. `balance` es lo que el cliente ya debe
 * (cacheado, puede estar desactualizado offline); `margin` es el colchón que
 * el comercio le da a ESE cliente en particular, definido del lado del
 * backend (llega en el pull) — no es una config local del POS.
 */
export type CustomerAccount = {
  customerId: string;
  creditLimit: number;
  margin: number;
  balance: number;
  updatedAt: string; // ISO 8601
};

/**
 * Registro local de auditoría de un movimiento de cuenta corriente — mismo
 * rol que `StockMovement` para el stock: además de servir de rastro
 * (RNF-07), se usa para descontar `CustomerAccount.balance` cacheado en el
 * momento (ver `storage/sale-repository.ts`), así una segunda venta a cuenta
 * en la misma sesión offline ve el saldo ya actualizado.
 */
export type AccountMovement = {
  id: string; // ULID
  customerId: string;
  type: 'sale' | 'payment' | 'adjustment';
  amount: number;
  saleId?: string;
  holdId?: string;
  createdAt: string; // ISO 8601
};

/**
 * Construye un `Customer` nuevo. `document`/`phone` opcionales — hoy solo
 * los usa el sembrado de clientes de ejemplo (`storage/seed-customers.ts`,
 * Ciclo 7); crear desde `@<nombre>` (RF-16) sigue sin pasarlos, no hay
 * todavía ninguna UI para tipearlos ahí.
 */
export function buildCustomer(
  name: string,
  params: { id: string; now: string; document?: string; phone?: string },
): Customer {
  return {
    id: params.id,
    name,
    ...(params.document !== undefined ? { document: params.document } : {}),
    ...(params.phone !== undefined ? { phone: params.phone } : {}),
    createdAt: params.now,
  };
}

/**
 * Crédito disponible para gastar offline: lo que el backend permite
 * (`creditLimit`), más el margen que le dio a este cliente en particular,
 * menos lo que ya debe.
 */
export function availableCredit(account: CustomerAccount): number {
  return account.creditLimit + account.margin - account.balance;
}

/** RF-18: sin red, se permite la venta a cuenta si entra en el crédito disponible. */
export function canChargeOffline(account: CustomerAccount, amount: number): boolean {
  return amount <= availableCredit(account);
}

/**
 * Separa la forma cruda de `GET /customers` (un solo recurso, campos de
 * cuenta opcionales — ver `sync/connector.ts::ConnectorCustomer`) en las dos
 * entidades del dominio. Recibe la forma inline (no importa `sync/`: el
 * dominio no depende de vocabulario de red) — `sync/engine.ts` le pasa un
 * `ConnectorCustomer`, que calza estructuralmente. Sin `creditLimit`,
 * `margin` y `balance` los tres a la vez, el backend no maneja cuenta
 * corriente para ese cliente y no hay `CustomerAccount` que crear (§6).
 */
export function splitConnectorCustomer(
  raw: {
    id: string;
    name: string;
    // `| undefined` explícito (no solo `?`) porque esto recibe directamente
    // un `ConnectorCustomer` inferido de Zod, que con `exactOptionalPropertyTypes`
    // tipa sus opcionales como `T | undefined`, no como ausencia pura.
    document?: string | undefined;
    phone?: string | undefined;
    creditLimit?: number | undefined;
    margin?: number | undefined;
    balance?: number | undefined;
    updatedAt?: string | undefined;
  },
  params: { now: string },
): { customer: Customer; account?: CustomerAccount } {
  const customer: Customer = {
    id: raw.id,
    name: raw.name,
    ...(raw.document !== undefined ? { document: raw.document } : {}),
    ...(raw.phone !== undefined ? { phone: raw.phone } : {}),
    createdAt: params.now,
  };

  if (raw.creditLimit === undefined || raw.margin === undefined || raw.balance === undefined) {
    return { customer };
  }

  return {
    customer,
    account: {
      customerId: raw.id,
      creditLimit: raw.creditLimit,
      margin: raw.margin,
      balance: raw.balance,
      updatedAt: raw.updatedAt ?? params.now,
    },
  };
}

/** Movimiento de cuenta generado al cerrar una venta con un pago `'account'`. */
export function buildAccountMovementForSale(params: {
  id: string;
  customerId: string;
  amount: number;
  saleId: string;
  holdId?: string;
  now: string;
}): AccountMovement {
  return {
    id: params.id,
    customerId: params.customerId,
    type: 'sale',
    amount: params.amount,
    saleId: params.saleId,
    ...(params.holdId !== undefined ? { holdId: params.holdId } : {}),
    createdAt: params.now,
  };
}
