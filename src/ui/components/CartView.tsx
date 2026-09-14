import { calculateLineTotal } from '../../domain/totals.ts';
import type { SaleLine } from '../../domain/sale.ts';
import { calculateTotals } from '../../domain/totals.ts';
import { formatMoney } from '../format.ts';
import { getCatalogRepository } from '../state/catalog.ts';
import { cartSelectionIndexSignal, cartSignal } from '../state/cart.ts';

function lineLabel(line: SaleLine): string {
  if (line.kind === 'freeform') {
    return line.description;
  }
  return getCatalogRepository().getProduct(line.productId)?.name ?? line.productId;
}

/**
 * Lista del carrito en curso. La selección visual (↑/↓ con la barra de
 * comandos vacía, ver CLAUDE.md) la maneja `cartSelectionIndexSignal`, no un
 * segundo foco de teclado.
 */
export function CartView() {
  const cart = cartSignal.value;
  const selectedIndex = cartSelectionIndexSignal.value;
  const totals = calculateTotals(cart);

  if (cart.lines.length === 0) {
    return <p style={{ color: 'var(--color-text-muted)' }}>El carrito está vacío.</p>;
  }

  return (
    <div>
      <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
        {cart.lines.map((line, index) => (
          <li
            key={index}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: 'var(--space-3)',
              padding: 'var(--space-1) var(--space-2)',
              background: index === selectedIndex ? 'var(--color-surface)' : 'transparent',
            }}
          >
            <span>
              {line.qty} × {lineLabel(line)}
            </span>
            <span>{formatMoney(calculateLineTotal(line))}</span>
          </li>
        ))}
      </ul>
      {cart.globalAdjustmentPercentage !== undefined && cart.globalAdjustmentPercentage !== 0 && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            padding: 'var(--space-1) var(--space-2)',
            color: cart.globalAdjustmentPercentage > 0 ? 'var(--color-danger)' : 'var(--color-success)',
          }}
        >
          <span>
            {cart.globalAdjustmentPercentage > 0 ? 'Recargo' : 'Descuento'} global (
            {cart.globalAdjustmentPercentage > 0 ? '+' : ''}
            {cart.globalAdjustmentPercentage}%)
          </span>
          <span>{formatMoney(totals.globalAdjustmentAmount)}</span>
        </div>
      )}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          padding: 'var(--space-2)',
          fontWeight: 'bold',
          borderTop: '1px solid var(--color-border)',
        }}
      >
        <span>Total</span>
        <span>{formatMoney(totals.total)}</span>
      </div>
    </div>
  );
}
