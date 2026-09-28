import { signal } from '@preact/signals';
import { db } from '../../storage/db.ts';

/**
 * Toda la tabla `customerBalances` en memoria (#101), para mostrar el saldo del cliente adjunto
 * sin una lectura async: es chica (una fila por cliente con saldo). Se recarga en los mismos
 * puntos que el stock (`ui/state/stock.ts`: arranque, pull aplicado, conexión aplicada, reset de
 * demo, cerrar o anular una venta) y después de una cobranza — así también cubre el cliente
 * restaurado con la venta en curso y el que cambia de saldo por un pull mientras está adjunto.
 */
export const customerBalancesSignal = signal<ReadonlyMap<string, number>>(new Map());

export async function refreshCustomerBalances(): Promise<void> {
  const rows = await db.customerBalances.toArray();
  customerBalancesSignal.value = new Map(rows.map((row) => [row.customerId, row.balance]));
}
