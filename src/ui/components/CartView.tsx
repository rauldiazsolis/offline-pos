import { calculateLineTotal } from '../../domain/totals.ts';
import type { SaleLine } from '../../domain/sale.ts';
import { calculateTotals } from '../../domain/totals.ts';
import { formatMoney } from '../format.ts';
import { getCatalogRepository } from '../state/catalog.ts';
import { cartSelectionIndexSignal, cartSignal } from '../state/cart.ts';
import { attachedCustomerSignal } from '../state/customer.ts';

const cardStyle = {
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  boxShadow: 'var(--shadow-card)',
  padding: 'var(--space-3)',
};

const moneyStyle = {
  fontFamily: 'var(--font-mono)',
  fontVariantNumeric: 'tabular-nums' as const,
};

function lineLabel(line: SaleLine): string {
  if (line.kind === 'freeform') {
    return line.description;
  }
  return getCatalogRepository().getProduct(line.productId)?.name ?? line.productId;
}

/** SKU debajo del nombre, solo para líneas de producto (una línea libre no tiene código). */
function lineCode(line: SaleLine): string | undefined {
  if (line.kind !== 'product') {
    return undefined;
  }
  return getCatalogRepository().getProduct(line.productId)?.sku;
}

const COLUMNS = '2.5rem 1fr auto auto';

/**
 * Carrito en curso. La selección visual (↑/↓ con la barra de comandos
 * vacía, ver CLAUDE.md) la maneja `cartSelectionIndexSignal`, no un segundo
 * foco de teclado. Cliente adjunto y resumen de venta se muestran como
 * tarjetas (pase de diseño) — siguen en esta misma columna, no se mudan a
 * un panel lateral nuevo.
 */
export function CartView() {
  const cart = cartSignal.value;
  const selectedIndex = cartSelectionIndexSignal.value;
  const totals = calculateTotals(cart);
  const customer = attachedCustomerSignal.value;
  const hasAdjustment =
    cart.globalAdjustmentPercentage !== undefined && cart.globalAdjustmentPercentage !== 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      {customer !== undefined && (
        <div style={cardStyle}>
          Cliente: {customer.name}
        </div>
      )}

      {cart.lines.length === 0 ? (
        <p style={{ color: 'var(--color-text-muted)' }}>El carrito está vacío.</p>
      ) : (
        <div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: COLUMNS,
              gap: 'var(--space-3)',
              padding: 'var(--space-1) var(--space-2)',
              color: 'var(--color-text-muted)',
              fontSize: 'var(--font-size-sm)',
              textTransform: 'uppercase',
              letterSpacing: '.04em',
              borderBottom: '1px solid var(--color-border)',
            }}
          >
            <span>Cant.</span>
            <span>Producto</span>
            <span style={{ textAlign: 'right' }}>Precio</span>
            <span style={{ textAlign: 'right' }}>Subtotal</span>
          </div>
          <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {cart.lines.map((line, index) => {
              const code = lineCode(line);
              return (
                <li
                  key={index}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: COLUMNS,
                    gap: 'var(--space-3)',
                    alignItems: 'baseline',
                    padding: 'var(--space-2)',
                    background: index === selectedIndex ? 'var(--color-surface)' : 'transparent',
                  }}
                >
                  <span>{line.qty}</span>
                  <span>
                    <div>{lineLabel(line)}</div>
                    {code !== undefined && (
                      <div
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: 'var(--font-size-sm)',
                          color: 'var(--color-text-muted)',
                        }}
                      >
                        {code}
                      </div>
                    )}
                  </span>
                  <span style={{ ...moneyStyle, textAlign: 'right' }}>
                    {formatMoney(line.unitPrice)}
                  </span>
                  <span style={{ ...moneyStyle, textAlign: 'right' }}>
                    {formatMoney(calculateLineTotal(line))}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {cart.lines.length > 0 && (
        <div style={{ ...cardStyle, display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
          {hasAdjustment && (
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                color:
                  (cart.globalAdjustmentPercentage ?? 0) > 0
                    ? 'var(--color-danger)'
                    : 'var(--color-success)',
              }}
            >
              <span>
                {(cart.globalAdjustmentPercentage ?? 0) > 0 ? 'Recargo' : 'Descuento'} global (
                {(cart.globalAdjustmentPercentage ?? 0) > 0 ? '+' : ''}
                {cart.globalAdjustmentPercentage}%)
              </span>
              <span style={moneyStyle}>{formatMoney(totals.globalAdjustmentAmount)}</span>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold' }}>
            <span>Total</span>
            <span style={moneyStyle}>{formatMoney(totals.total)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
