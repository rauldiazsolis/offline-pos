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
  /**
   * Bloqueo informativo que declara el backend (contrato v3, #96): nunca
   * impide operar — el POS lo muestra (desde la Etapa 4) y el usuario decide.
   */
  blocked?: { reason: string };
};

/**
 * Cuenta corriente de un cliente. `balance` es lo que el cliente ya debe
 * (cacheado, puede estar desactualizado offline); `margin` es el colchón que
 * el comercio le da a ESE cliente en particular, definido del lado del
 * backend (llega en el pull) — no es una config local del POS. `unrestricted`
 * (Etapa 3, #69) es una capacidad declarada por el backend/conector para ESE
 * cliente puntual — no algo que el POS infiera de qué conector está activo:
 * `canChargeOffline` la usa para aprobar sin evaluar `creditLimit`/`margin`/
 * `balance` en absoluto, que en ese caso quedan sin usar (nunca inventados
 * con un valor real, ver "No inventar datos que no llegaron del backend" en
 * CLAUDE.md).
 */
export type CustomerAccount = {
  customerId: string;
  creditLimit: number;
  margin: number;
  balance: number;
  updatedAt: string; // ISO 8601
  unrestricted?: boolean;
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

/**
 * RF-18: sin red, se permite la venta a cuenta si entra en el crédito
 * disponible — salvo que la cuenta sea `unrestricted` (Etapa 3, #69), en cuyo
 * caso se aprueba sin evaluar `availableCredit` en absoluto.
 */
export function canChargeOffline(account: CustomerAccount, amount: number): boolean {
  if (account.unrestricted) {
    return true;
  }
  return amount <= availableCredit(account);
}

/**
 * Separa la forma cruda de `GET /customers` (un solo recurso, campos de
 * cuenta opcionales — ver `sync/connector.ts::ConnectorCustomer`) en las dos
 * entidades del dominio. Recibe la forma inline (no importa `sync/`: el
 * dominio no depende de vocabulario de red) — `sync/engine.ts` le pasa un
 * `ConnectorCustomer`, que calza estructuralmente. Sin `creditLimit`,
 * `margin` y `balance` los tres a la vez, el backend no maneja cuenta
 * corriente para ese cliente y no hay `CustomerAccount` que crear (§6) —
 * salvo que declare `unrestricted: true` (Etapa 3, #69): ahí sí se arma la
 * cuenta, completando en `0` lo que falte (valores que quedan sin usar, no
 * es "inventar crédito" — es declarar que esos números no aplican).
 *
 * `createdAt` es la fecha de alta real que manda el backend (contrato v3,
 * #96) — antes era la hora del pull, lo que dejaba sin sentido "Alta:
 * <fecha>" en la lista de `@`. `params.now` queda solo como `updatedAt` por
 * defecto de la cuenta.
 */
export function splitConnectorCustomer(
  raw: {
    id: string;
    name: string;
    createdAt: string;
    // `| undefined` explícito (no solo `?`) porque esto recibe directamente
    // un `ConnectorCustomer` inferido de Zod, que con `exactOptionalPropertyTypes`
    // tipa sus opcionales como `T | undefined`, no como ausencia pura.
    document?: string | undefined;
    phone?: string | undefined;
    creditLimit?: number | undefined;
    margin?: number | undefined;
    balance?: number | undefined;
    updatedAt?: string | undefined;
    unrestricted?: boolean | undefined;
    blocked?: { reason: string } | undefined;
  },
  params: { now: string },
): { customer: Customer; account?: CustomerAccount } {
  const customer: Customer = {
    id: raw.id,
    name: raw.name,
    ...(raw.document !== undefined ? { document: raw.document } : {}),
    ...(raw.phone !== undefined ? { phone: raw.phone } : {}),
    createdAt: raw.createdAt,
    ...(raw.blocked !== undefined ? { blocked: { reason: raw.blocked.reason } } : {}),
  };

  const hasFullCreditData =
    raw.creditLimit !== undefined && raw.margin !== undefined && raw.balance !== undefined;

  if (!hasFullCreditData && raw.unrestricted !== true) {
    return { customer };
  }

  return {
    customer,
    account: {
      customerId: raw.id,
      creditLimit: raw.creditLimit ?? 0,
      margin: raw.margin ?? 0,
      balance: raw.balance ?? 0,
      updatedAt: raw.updatedAt ?? params.now,
      ...(raw.unrestricted === true ? { unrestricted: true } : {}),
    },
  };
}

/**
 * Versión en lote de `splitConnectorCustomer`: la usan el pull del motor de
 * sync y la aplicación de una conexión nueva (`sync/apply-connection.ts`), así
 * la transformación vive en un solo lugar.
 */
export function splitConnectorCustomers(
  raws: Parameters<typeof splitConnectorCustomer>[0][],
  params: { now: string },
): { customers: Customer[]; accounts: CustomerAccount[] } {
  const customers: Customer[] = [];
  const accounts: CustomerAccount[] = [];
  for (const raw of raws) {
    const split = splitConnectorCustomer(raw, params);
    customers.push(split.customer);
    if (split.account !== undefined) {
      accounts.push(split.account);
    }
  }
  return { customers, accounts };
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
