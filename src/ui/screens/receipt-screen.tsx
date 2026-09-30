import type { ComponentChildren, TargetedKeyboardEvent } from 'preact';
import { calculateLineTotal, calculateTotals } from '../../domain/totals.ts';
import type { Sale, SaleLine } from '../../domain/sale.ts';
import { formatMoney } from '../format.ts';
import { useFocusOnMount } from '../hooks/use-focus-on-mount.ts';
import { keepFocusOnMouseDown } from '../hooks/use-mouse-keeps-focus.ts';
import { getCatalogRepository } from '../state/catalog.ts';
import { PAYMENT_METHOD_LABELS } from '../payment-labels.ts';
import {
  receiptCollectionSignal,
  receiptSaleSignal,
  type CollectionReceipt,
} from '../state/receipt.ts';
import { activeScreenSignal } from '../state/screen.ts';
import { formatBalance } from '../format-balance.ts';
import { receiptLabel, ticketLabel } from '../format-ticket.ts';
import './receipt-screen.css';
import { scaledPx } from '../text-scale.ts';

function lineLabel(line: SaleLine): string {
  if (line.kind === 'freeform') {
    return line.description;
  }
  return getCatalogRepository().getProduct(line.productId)?.name ?? line.productId;
}

function continueToSale(): void {
  receiptSaleSignal.value = null;
  receiptCollectionSignal.value = null;
  activeScreenSignal.value = 'sale';
}

/**
 * Confirmación de la venta recién cerrada o de la cobranza recién registrada (#101), con impresión
 * vía `window.print()` como solución puente antes de ESC/POS real (Fase 5). Enter imprime, Esc
 * vuelve a la venta — el mismo principio de "un único foco" que el resto de la app, acá sobre el
 * contenedor de la pantalla en vez de un input de texto.
 */
export function ReceiptScreen() {
  const sale = receiptSaleSignal.value;
  const collection = receiptCollectionSignal.value;

  if (sale !== null) {
    return (
      <ReceiptFrame>
        <SaleReceiptBody sale={sale} />
      </ReceiptFrame>
    );
  }
  if (collection !== null) {
    return (
      <ReceiptFrame>
        <CollectionReceiptBody receipt={collection} />
      </ReceiptFrame>
    );
  }
  // Invariante de infraestructura: no debería poder llegarse acá sin una
  // venta o una cobranza recién registrada — si pasa, se vuelve a la venta.
  continueToSale();
  return null;
}

/** El contenedor, las teclas y los botones: iguales para la venta y la cobranza. */
function ReceiptFrame({ children }: { children: ComponentChildren }) {
  const containerRef = useFocusOnMount<HTMLDivElement>();

  const handleKeyDown = (event: TargetedKeyboardEvent<HTMLDivElement>) => {
    // Un botón enfocado con Tab se activa solo con Enter (nativo): no duplicar
    // la acción con el atajo del contenedor.
    if (event.key === 'Enter' && event.target instanceof HTMLButtonElement) {
      return;
    }
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
      // Teclado + mouse (Etapa 2 de #94): ver ui/hooks/use-mouse-keeps-focus.ts.
      onMouseDown={keepFocusOnMouseDown}
      style={{
        height: 'var(--app-height)',
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
          maxWidth: scaledPx(360),
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
        {children}
      </div>

      <div class="receipt-no-print" style={{ display: 'flex', gap: 'var(--space-3)' }}>
        <button
          type="button"
          class="btn btn-primary"
          onClick={() => {
            window.print();
          }}
        >
          Imprimir (Enter)
        </button>
        <button type="button" class="btn" onClick={continueToSale}>
          Continuar (Esc)
        </button>
      </div>
    </div>
  );
}

function SaleReceiptBody({ sale }: { sale: Sale }) {
  // Reusa calculateTotals sobre un Cart armado con los datos ya cerrados de
  // la venta — mismo cálculo que en el carrito, sin duplicar la fórmula.
  const totals = calculateTotals({
    lines: sale.lines,
    ...(sale.globalAdjustmentPercentage !== undefined
      ? { globalAdjustmentPercentage: sale.globalAdjustmentPercentage }
      : {}),
  });

  return (
    <>
      <h1 style={{ fontSize: 'var(--font-size-lg)', margin: 0 }}>Comprobante</h1>
      <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>{ticketLabel(sale)}</p>
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
          <span>{PAYMENT_METHOD_LABELS[payment.method]}</span>
          <span>{formatMoney(payment.amount)}</span>
        </div>
      ))}
    </>
  );
}

const dividerStyle = { border: 'none', borderTop: '1px dashed var(--color-border)' };
const receiptRowStyle = { display: 'flex', justifyContent: 'space-between' };

/**
 * Recibo de una cobranza sin venta (#101): número del día, cliente, pagos por medio, total y cómo
 * quedó el saldo. Sin vuelto: el total es lo acreditado.
 */
function CollectionReceiptBody({ receipt }: { receipt: CollectionReceipt }) {
  const { payment } = receipt;
  return (
    <>
      <h1 style={{ fontSize: 'var(--font-size-lg)', margin: 0 }}>Recibo de cobranza</h1>
      <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>{receiptLabel(payment)}</p>
      <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>
        {new Date(payment.createdAt).toLocaleString()}
      </p>
      <p style={{ margin: 0 }}>{receipt.customerName}</p>
      <hr style={dividerStyle} />
      {payment.payments.map((item, index) => (
        <div key={index} style={receiptRowStyle}>
          <span>{PAYMENT_METHOD_LABELS[item.method]}</span>
          <span>{formatMoney(item.amount)}</span>
        </div>
      ))}
      <hr style={dividerStyle} />
      <div style={{ ...receiptRowStyle, fontWeight: 'bold' }}>
        <span>Total</span>
        <span>{formatMoney(payment.total)}</span>
      </div>
      <p style={{ margin: 0 }}>{`Saldo anterior: ${formatBalance(receipt.balanceBefore)}`}</p>
      <p style={{ margin: 0, fontWeight: 'bold' }}>
        {`Saldo nuevo: ${formatBalance(receipt.balanceAfter)}`}
      </p>
    </>
  );
}
