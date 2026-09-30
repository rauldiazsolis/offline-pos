import type { CustomerPayment } from '../../domain/customer-payment.ts';
import type { Sale, SaleLine } from '../../domain/sale.ts';
import { formatMoney, formatQuantity, formatTime } from '../format.ts';
import { receiptLabel, ticketLabel } from '../format-ticket.ts';
import { highlightMatches } from '../highlight.tsx';
import { PAYMENT_METHOD_LABELS } from '../payment-labels.ts';
import { getCatalogRepository } from '../state/catalog.ts';
import { getCustomerRepository } from '../state/customer-repository.ts';

/** El nombre de una línea: el del producto en el catálogo, o la descripción de una línea libre. */
export function lineLabel(line: SaleLine): string {
  return line.kind === 'product'
    ? (getCatalogRepository().getProduct(line.productId)?.name ?? line.productId)
    : line.description;
}

/**
 * Lo que necesita una fila de documento, sin depender de la pantalla que la dibuja (#125): la usan
 * Movimientos de `/RESUMEN` y `/ANULAR`. `index` es la posición en la lista que se dibuja (decide el
 * borde de arriba); `mark` es la marca ya resuelta ("Anulada", "Anulación del #1").
 */
export type DocumentRowProps = {
  index: number;
  query: string;
  selected: boolean;
  /** Atenuada y sin cursor de mano: una fila sin acción en `/ANULAR`. */
  dimmed?: boolean;
  mark?: string | undefined;
  rowRef?: (el: HTMLDivElement | null) => void;
  onClick: () => void;
  testId?: string;
};

// La selección (relleno + barra) la pinta `.selectable-row[data-selected]` (tokens.css, #112).
function rowContainerStyle(index: number, dimmed: boolean) {
  return {
    borderTop: index > 0 ? '1px solid var(--color-border)' : undefined,
    cursor: dimmed ? 'default' : 'pointer',
    ...(dimmed ? { opacity: 0.5 } : {}),
  };
}

function Mark({ mark }: { mark: string | undefined }) {
  if (mark === undefined) {
    return null;
  }
  return (
    <span
      style={{
        marginLeft: 'var(--space-2)',
        fontWeight: 'normal',
        color: 'var(--color-text-muted)',
      }}
    >
      · {mark}
    </span>
  );
}

/**
 * Un ticket completo: número, marca, hora, cliente, líneas, medios y total. Componente propio (no un
 * `.map()` inline): el ref callback se lee en el nivel superior de su render, la forma que espera
 * `react-hooks/refs`.
 */
export function SaleDocumentRow({
  sale,
  index,
  query,
  selected,
  dimmed = false,
  mark,
  rowRef,
  onClick,
  testId,
}: DocumentRowProps & { sale: Sale }) {
  const customer =
    sale.customerId !== undefined
      ? getCustomerRepository().getCustomer(sale.customerId)
      : undefined;
  return (
    <div
      ref={rowRef ?? null}
      data-testid={testId}
      onClick={onClick}
      class="selectable-row"
      data-selected={selected ? '' : undefined}
      style={rowContainerStyle(index, dimmed)}
    >
      <div
        class="ticket__header"
        style={{
          position: 'sticky',
          top: 0,
          // Opaco para tapar lo que scrollea debajo; seleccionado, lo pinta tokens.css.
          background: selected ? undefined : 'var(--color-bg)',
          padding: 'var(--space-2) var(--space-3)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ fontWeight: 600 }}>
            {highlightMatches(ticketLabel(sale), query.replace(/^#/, ''))}
            <Mark mark={mark} />
          </span>
          <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-text-muted)' }}>
            {formatTime(sale.createdAt)}
          </span>
        </div>
        {customer !== undefined && (
          <p
            style={{ margin: 0, fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}
          >
            <b style={{ color: 'var(--color-text)' }}>{highlightMatches(customer.name, query)}</b>
          </p>
        )}
      </div>
      <div style={{ padding: 'var(--space-1) var(--space-3)' }}>
        {sale.lines.map((line, lineIndex) => (
          <div
            key={lineIndex}
            style={{ display: 'grid', gridTemplateColumns: '28px 1fr auto', gap: 'var(--space-2)' }}
          >
            <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-text-muted)' }}>
              {formatQuantity(line.qty)}x
            </span>
            <span>{highlightMatches(lineLabel(line), query)}</span>
            <span style={{ fontFamily: 'var(--font-mono)' }}>
              {formatMoney(line.unitPrice * line.qty)}
            </span>
          </div>
        ))}
      </div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          padding: 'var(--space-1) var(--space-3) var(--space-3)',
        }}
      >
        <span>{sale.payments.map((p) => PAYMENT_METHOD_LABELS[p.method]).join(', ')}</span>
        <span class="ticket__total" style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
          {formatMoney(sale.total)}
        </span>
      </div>
    </div>
  );
}

/** Cobranza sin venta (#101): "Recibo #3 · Ana", su marca (#125), su total y, debajo, los medios. */
export function CollectionDocumentRow({
  payment,
  customerName,
  index,
  query,
  selected,
  dimmed = false,
  mark,
  rowRef,
  onClick,
  testId,
}: DocumentRowProps & { payment: CustomerPayment; customerName: string }) {
  return (
    <div
      ref={rowRef ?? null}
      data-testid={testId}
      onClick={onClick}
      class="selectable-row"
      data-selected={selected ? '' : undefined}
      style={{
        ...rowContainerStyle(index, dimmed),
        padding: 'var(--space-2) var(--space-3)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-2)' }}>
        <span style={{ fontWeight: 600 }}>
          {highlightMatches(`${receiptLabel(payment)} · ${customerName}`, query.replace(/^#/, ''))}
          <Mark mark={mark} />
        </span>
        <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-text-muted)' }}>
          {formatTime(payment.createdAt)}
        </span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-2)' }}>
        <span style={{ color: 'var(--color-text-muted)' }}>
          {payment.payments
            .map((item) => `${PAYMENT_METHOD_LABELS[item.method]} $${formatMoney(item.amount)}`)
            .join(' · ')}
        </span>
        <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
          {formatMoney(payment.total)}
        </span>
      </div>
    </div>
  );
}
