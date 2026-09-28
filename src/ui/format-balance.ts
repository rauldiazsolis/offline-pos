import { describeBalance } from '../domain/customer-balance.ts';
import { formatMoney } from './format.ts';

/** Saldo de un cliente para la UI (#101): "Debe $X", "A favor $X" o "Sin saldo" (0 o desconocido). */
export function formatBalance(balance: number | undefined): string {
  const description = describeBalance(balance);
  switch (description.kind) {
    case 'none':
      return 'Sin saldo';
    case 'owes':
      return `Debe $${formatMoney(description.amount)}`;
    case 'in-favor':
      return `A favor $${formatMoney(description.amount)}`;
  }
}
