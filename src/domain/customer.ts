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

/** Construye un `Customer` nuevo, creado localmente desde `@<nombre>`. */
export function buildCustomer(name: string, params: { id: string; now: string }): Customer {
  return { id: params.id, name, createdAt: params.now };
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
