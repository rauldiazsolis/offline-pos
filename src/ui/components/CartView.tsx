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

const headCellStyle = {
  textAlign: 'left' as const,
  fontWeight: 'normal' as const,
  padding: 'var(--space-1) var(--space-2)',
};

const bodyCellStyle = {
  padding: 'var(--space-2)',
  verticalAlign: 'baseline' as const,
};

// Más padding a la izquierda que a la derecha en Precio/Subtotal — separa
// esas dos columnas entre sí y de "Producto" (issue #10: quedaban muy
// pegadas, la razón original de alinear los montos a la derecha — que la
// lectura horizontal del renglón sea más fácil — se perdía si no hay aire
// entre ellas).
const amountCellStyle = {
  textAlign: 'right' as const,
  paddingLeft: 'var(--space-6)',
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
        // <table> real, no un grid por fila — así el navegador calcula un
        // único ancho de columna compartido entre todas las filas (issue
        // #10: con grids independientes por fila, "Precio"/"Subtotal" no
        // quedaban alineados entre renglones de distinto largo).
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr
              style={{
                color: 'var(--color-text-muted)',
                fontSize: 'var(--font-size-sm)',
                textTransform: 'uppercase',
                letterSpacing: '.04em',
                borderBottom: '1px solid var(--color-border)',
              }}
            >
              <th style={headCellStyle}>Cant.</th>
              <th style={headCellStyle}>Producto</th>
              <th style={{ ...headCellStyle, ...amountCellStyle }}>Precio</th>
              <th style={{ ...headCellStyle, ...amountCellStyle }}>Subtotal</th>
            </tr>
          </thead>
          <tbody>
            {cart.lines.map((line, index) => {
              const code = lineCode(line);
              return (
                <tr
                  key={index}
                  style={{ background: index === selectedIndex ? 'var(--color-surface)' : 'transparent' }}
                >
                  <td style={bodyCellStyle}>{line.qty}</td>
                  <td style={bodyCellStyle}>
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
                  </td>
                  <td style={{ ...bodyCellStyle, ...amountCellStyle, ...moneyStyle }}>
                    {formatMoney(line.unitPrice)}
                  </td>
                  <td style={{ ...bodyCellStyle, ...amountCellStyle, ...moneyStyle }}>
                    {formatMoney(calculateLineTotal(line))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
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
