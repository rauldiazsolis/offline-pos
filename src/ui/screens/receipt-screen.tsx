import type { TargetedKeyboardEvent } from 'preact';
import { calculateLineTotal, calculateTotals } from '../../domain/totals.ts';
import type { SaleLine } from '../../domain/sale.ts';
import { formatMoney } from '../format.ts';
import { useFocusOnMount } from '../hooks/use-focus-on-mount.ts';
import { getCatalogRepository } from '../state/catalog.ts';
import { receiptSaleSignal } from '../state/receipt.ts';
import { activeScreenSignal } from '../state/screen.ts';
import './receipt-screen.css';

function lineLabel(line: SaleLine): string {
  if (line.kind === 'freeform') {
    return line.description;
  }
  return getCatalogRepository().getProduct(line.productId)?.name ?? line.productId;
}

function continueToSale(): void {
  receiptSaleSignal.value = null;
  activeScreenSignal.value = 'sale';
}

/**
 * Confirmación de la venta recién cerrada, con impresión vía `window.print()`
 * como solución puente antes de ESC/POS real (Fase 5). Enter imprime, Esc
 * vuelve a la venta — el mismo principio de "un único foco" que el resto de
 * la app, acá sobre el contenedor de la pantalla en vez de un input de texto.
 */
export function ReceiptScreen() {
  const containerRef = useFocusOnMount<HTMLDivElement>();
  const sale = receiptSaleSignal.value;

  if (sale === null) {
    // Invariante de infraestructura: no debería poder llegarse acá sin una
    // venta recién cerrada — si pasa, se vuelve a la venta en vez de romper.
    continueToSale();
    return null;
  }

  const paid = sale.payments.reduce((sum, payment) => sum + payment.amount, 0);
  const change = paid - sale.total;
  // Reusa calculateTotals sobre un Cart armado con los datos ya cerrados de
  // la venta — mismo cálculo que en el carrito, sin duplicar la fórmula.
  const totals = calculateTotals({
    lines: sale.lines,
    ...(sale.globalAdjustmentPercentage !== undefined
      ? { globalAdjustmentPercentage: sale.globalAdjustmentPercentage }
      : {}),
  });

  const handleKeyDown = (event: TargetedKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      window.print();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      continueToSale();
    }
  };

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      style={{
        height: '100svh',
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: 'var(--space-4)',
        gap: 'var(--space-4)',
        background: 'var(--color-bg)',
        color: 'var(--color-text)',
        fontFamily: 'var(--font-sans)',
      }}
    >
      <div
        class="receipt"
        style={{
          width: '100%',
          maxWidth: '360px',
          fontFamily: 'var(--font-mono)',
          fontVariantNumeric: 'tabular-nums',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-md)',
          boxShadow: 'var(--shadow-card)',
          padding: 'var(--space-4)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-2)',
        }}
      >
        <h1 style={{ fontSize: 'var(--font-size-lg)', margin: 0 }}>Comprobante</h1>
        <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>Venta {sale.id}</p>
        <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>
          {new Date(sale.createdAt).toLocaleString()}
        </p>
        <hr style={{ border: 'none', borderTop: '1px dashed var(--color-border)' }} />
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {sale.lines.map((line, index) => (
            <li key={index} style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>
                {line.qty} × {lineLabel(line)}
              </span>
              <span>{formatMoney(calculateLineTotal(line))}</span>
            </li>
          ))}
        </ul>
        <hr style={{ border: 'none', borderTop: '1px dashed var(--color-border)' }} />
        {sale.globalAdjustmentPercentage !== undefined && sale.globalAdjustmentPercentage !== 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>
              {sale.globalAdjustmentPercentage > 0 ? 'Recargo' : 'Descuento'} global (
              {sale.globalAdjustmentPercentage > 0 ? '+' : ''}
              {sale.globalAdjustmentPercentage}%)
            </span>
            <span>{formatMoney(totals.globalAdjustmentAmount)}</span>
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold' }}>
          <span>Total</span>
          <span>{formatMoney(sale.total)}</span>
        </div>
        {sale.payments.map((payment, index) => (
          <div key={index} style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>Pago ({payment.method})</span>
            <span>{formatMoney(payment.amount)}</span>
          </div>
        ))}
        {change > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>Vuelto</span>
            <span>{formatMoney(change)}</span>
          </div>
        )}
      </div>

      <div class="receipt-no-print" style={{ display: 'flex', gap: 'var(--space-3)' }}>
        <button
          type="button"
          onClick={() => {
            window.print();
          }}
          style={{ padding: 'var(--space-2) var(--space-3)', borderRadius: 'var(--radius-md)' }}
        >
          Imprimir (Enter)
        </button>
        <button
          type="button"
          onClick={continueToSale}
          style={{ padding: 'var(--space-2) var(--space-3)', borderRadius: 'var(--radius-md)' }}
        >
          Continuar (Esc)
        </button>
      </div>
    </div>
  );
}
