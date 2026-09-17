import { Index } from 'flexsearch';
import type { TargetedEvent, TargetedKeyboardEvent } from 'preact';
import { useMemo } from 'preact/hooks';
import { calculateProductQuantities, type ProductQuantity } from '../../domain/cash-session.ts';
import type { Sale, SaleLine } from '../../domain/sale.ts';
import type { PaymentMethod } from '../../domain/sale.ts';
import { formatMoney, formatQuantity } from '../format.ts';
import { useFocusOnMount } from '../hooks/use-focus-on-mount.ts';
import { useScrollSelectedIntoView } from '../hooks/use-scroll-selected-into-view.ts';
import { useTicketListNavigation } from '../hooks/use-ticket-list-navigation.ts';
import {
  exitCashSummaryScreen,
  setCashSummaryTab,
  updateProductFilter,
  updateTicketFilter,
} from '../keyboard/cash-summary-controller.ts';
import { PAYMENT_METHOD_LABELS } from '../payment-labels.ts';
import { getCatalogRepository } from '../state/catalog.ts';
import {
  cashSummaryContextSignal,
  cashSummaryTabSignal,
  productFilterSignal,
  selectedProductIndexSignal,
  selectedTicketIndexSignal,
  ticketFilterSignal,
} from '../state/cash-summary.ts';
import { getCustomerRepository } from '../state/customer-repository.ts';

const NON_CASH_METHODS: PaymentMethod[] = ['debit', 'credit', 'transfer', 'qr', 'account'];

const sidebarCardStyle = {
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  boxShadow: 'var(--shadow-card)',
  padding: 'var(--space-3)',
};
const sectionLabelStyle = {
  fontSize: 'var(--font-size-sm)',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.05em',
  color: 'var(--color-text-muted)',
  margin: '0 0 var(--space-1)',
};

const TAB_ORDER: ('tickets' | 'products' | 'payments')[] = ['tickets', 'products', 'payments'];
const TAB_LABELS: Record<(typeof TAB_ORDER)[number], string> = {
  tickets: 'Tickets',
  products: 'Productos',
  payments: 'Medios de pago',
};

function lineLabel(line: SaleLine): string {
  return line.kind === 'product'
    ? (getCatalogRepository().getProduct(line.productId)?.name ?? line.productId)
    : line.description;
}

function filterSales(sales: Sale[], query: string): Sale[] {
  if (query.trim() === '') return sales;
  const index = new Index({ tokenize: 'forward' });
  for (const sale of sales) {
    const customerName = sale.customerId !== undefined ? (getCustomerRepository().getCustomer(sale.customerId)?.name ?? '') : '';
    const lineNames = sale.lines.map(lineLabel).join(' ');
    index.add(sale.id, `${customerName} ${lineNames}`);
  }
  const ids = new Set(index.search(query).map(String));
  return sales.filter((sale) => ids.has(sale.id));
}

/**
 * Fila de ticket como componente propio (no un `.map()` inline en `TicketsTab`) — el ref callback
 * que devuelve `nav.ticketRef(index)` toca `.current` recién cuando React lo invoca (montaje/
 * desmontaje) o dentro de `handleKeyDown` (disparado desde `onKeyDown`, nunca durante el render);
 * como componente separado, esa lectura queda en el nivel superior de SU propio render, que es la
 * forma que el análisis estático de `react-hooks/refs` espera.
 */
function TicketRow({ sale, index, nav }: { sale: Sale; index: number; nav: ReturnType<typeof useTicketListNavigation> }) {
  const customer = sale.customerId !== undefined ? getCustomerRepository().getCustomer(sale.customerId) : undefined;
  const isSelected = index === selectedTicketIndexSignal.value;
  return (
    <div
      ref={nav.ticketRef(index)}
      style={{
        background: isSelected ? 'var(--color-surface)' : 'transparent',
        borderTop: index > 0 ? '1px solid var(--color-border)' : undefined,
      }}
    >
      <div
        className="ticket__header"
        style={{
          position: 'sticky',
          top: 0,
          background: isSelected ? 'var(--color-surface)' : 'var(--color-bg)',
          padding: 'var(--space-2) var(--space-3)',
          boxShadow: isSelected ? 'inset 3px 0 0 var(--color-accent)' : undefined,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ fontWeight: 600 }}>Ticket #{sale.id}</span>
          <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-text-muted)' }}>
            {new Date(sale.createdAt).toLocaleString()}
          </span>
        </div>
        {customer !== undefined && (
          <p style={{ margin: 0, fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>
            Cliente: <b style={{ color: 'var(--color-text)' }}>{customer.name}</b>
          </p>
        )}
      </div>
      <div style={{ padding: 'var(--space-1) var(--space-3)' }}>
        {sale.lines.map((line, lineIndex) => (
          <div key={lineIndex} style={{ display: 'grid', gridTemplateColumns: '28px 1fr auto', gap: 'var(--space-2)' }}>
            <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-text-muted)' }}>{formatQuantity(line.qty)}x</span>
            <span>{lineLabel(line)}</span>
            <span style={{ fontFamily: 'var(--font-mono)' }}>{formatMoney(line.unitPrice * line.qty)}</span>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: 'var(--space-1) var(--space-3) var(--space-3)' }}>
        <span>{sale.payments.map((p) => PAYMENT_METHOD_LABELS[p.method]).join(', ')}</span>
        <span className="ticket__total" style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
          {formatMoney(sale.total)}
        </span>
      </div>
    </div>
  );
}

function TicketsTab({ sales, filter }: { sales: Sale[]; filter: string }) {
  const filtered = useMemo(() => filterSales(sales, filter), [sales, filter]);
  const nav = useTicketListNavigation(selectedTicketIndexSignal, filtered.length);
  const rows = filtered.map((sale, index) => <TicketRow key={sale.id} sale={sale} index={index} nav={nav} />);

  // `nav.containerRef` solo toca `.current` cuando React lo invoca (montaje/desmontaje) o dentro
  // de `handleKeyDown` (vía `onKeyDown`, nunca durante el render) — el análisis estático del
  // plugin no distingue eso al ver que otro miembro del mismo hook comparte esa ref.
  return (
    // eslint-disable-next-line react-hooks/refs
    <div ref={nav.containerRef} style={{ height: '100%', overflowY: 'auto', outline: 'none' }}>
      {filtered.length === 0 && (
        <p style={{ padding: 'var(--space-3)', color: 'var(--color-text-muted)' }}>
          Ningún ticket coincide con la búsqueda.
        </p>
      )}
      {rows}
    </div>
  );
}

function sortedProducts(sales: Sale[], filter: string): (ProductQuantity & { name: string; sku: string })[] {
  const quantities = calculateProductQuantities(sales).map((pq) => {
    const product = getCatalogRepository().getProduct(pq.productId);
    return { ...pq, name: product?.name ?? pq.productId, sku: product?.sku ?? '' };
  });
  if (filter.trim() === '') {
    return quantities.sort((a, b) => b.qty - a.qty);
  }
  const index = new Index({ tokenize: 'forward' });
  for (const q of quantities) index.add(q.productId, q.name);
  const rankedIds = index.search(filter).map(String);
  const byId = new Map(quantities.map((q) => [q.productId, q]));
  return rankedIds.map((id) => byId.get(id)).filter((q): q is (typeof quantities)[number] => q !== undefined);
}

function ProductsTab({ sales, filter }: { sales: Sale[]; filter: string }) {
  const products = useMemo(() => sortedProducts(sales, filter), [sales, filter]);
  const rowRef = useScrollSelectedIntoView(selectedProductIndexSignal);

  return (
    <div style={{ height: '100%', overflowY: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead style={{ position: 'sticky', top: 0, background: 'var(--color-bg)' }}>
          <tr>
            <th style={{ textAlign: 'left', padding: 'var(--space-2) var(--space-3)' }}>Código</th>
            <th style={{ textAlign: 'left', padding: 'var(--space-2) var(--space-3)' }}>Producto</th>
            <th style={{ textAlign: 'right', padding: 'var(--space-2) var(--space-3)' }}>Cant.</th>
          </tr>
        </thead>
        <tbody>
          {products.map((p, index) => (
            <tr
              key={p.productId}
              data-testid="product-row"
              ref={rowRef(index)}
              style={{ background: index === selectedProductIndexSignal.value ? 'var(--color-surface)' : undefined }}
            >
              <td style={{ padding: 'var(--space-1) var(--space-3)', fontFamily: 'var(--font-mono)', color: 'var(--color-text-muted)' }}>{p.sku}</td>
              <td style={{ padding: 'var(--space-1) var(--space-3)' }}>{p.name}</td>
              <td style={{ padding: 'var(--space-1) var(--space-3)', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{formatQuantity(p.qty)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * `/RESUMEN`: panel lateral fijo + 3 pestañas (Tickets/Productos/Medios de pago). El contenido de
 * cada pestaña vive en componentes propios agregados en tareas siguientes del plan.
 */
export function CashSummaryScreen() {
  const filterRef = useFocusOnMount<HTMLInputElement>();
  const context = cashSummaryContextSignal.value;
  const tab = cashSummaryTabSignal.value;

  if (context === undefined) {
    return null; // invariante: no se entra a esta pantalla sin contexto (ver triggerCashSummary)
  }

  const { summary, isClosed } = context;
  const otherPayments = NON_CASH_METHODS.reduce((sum, method) => sum + summary.totalsByMethod[method], 0);

  const filterValue = tab === 'products' ? productFilterSignal.value : ticketFilterSignal.value;
  const updateFilter = tab === 'products' ? updateProductFilter : updateTicketFilter;

  const handleFilterInput = (event: TargetedEvent<HTMLInputElement>) => {
    updateFilter(event.currentTarget.value);
  };

  const handleKeyDown = (event: TargetedKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      exitCashSummaryScreen();
      return;
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      const currentIdx = TAB_ORDER.indexOf(tab);
      const nextIdx = (currentIdx + (event.shiftKey ? -1 : 1) + TAB_ORDER.length) % TAB_ORDER.length;
      const nextTab = TAB_ORDER[nextIdx];
      if (nextTab !== undefined) setCashSummaryTab(nextTab);
    }
  };

  return (
    <div
      style={{
        height: 'var(--app-height)',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--color-bg)',
        color: 'var(--color-text)',
        fontFamily: 'var(--font-sans)',
      }}
    >
      <div
        style={{
          background: 'var(--color-chrome-bg)',
          color: 'var(--color-chrome-text)',
          padding: 'var(--space-3) var(--space-4)',
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-3)',
        }}
      >
        <h1 style={{ margin: 0, fontSize: 'var(--font-size-lg)' }}>Resumen del turno</h1>
        {isClosed && (
          <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-chrome-text-muted)' }}>
            Turno cerrado
          </span>
        )}
        {TAB_ORDER.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => {
              setCashSummaryTab(t);
              filterRef.current?.focus();
            }}
            style={{
              background: t === tab ? 'var(--color-accent)' : 'transparent',
              color: t === tab ? 'var(--color-chrome-bg)' : 'var(--color-chrome-text)',
              border: '1px solid var(--color-chrome-border)',
              borderRadius: 'var(--radius-md)',
              padding: 'var(--space-1) var(--space-2)',
              cursor: 'pointer',
            }}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
        <input
          ref={filterRef}
          type="text"
          aria-label="Buscar"
          placeholder={tab === 'products' ? 'Buscar producto' : 'Buscar ticket, cliente o producto'}
          value={filterValue}
          onInput={handleFilterInput}
          onKeyDown={handleKeyDown}
          style={{
            flex: 1,
            background: 'var(--color-chrome-surface)',
            color: 'var(--color-chrome-text)',
            border: '1px solid var(--color-chrome-border)',
            borderRadius: 'var(--radius-md)',
            padding: 'var(--space-1) var(--space-2)',
          }}
        />
        <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-chrome-text-muted)' }}>
          [Esc] Cerrar
        </span>
      </div>

      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr clamp(240px, 25%, 320px)', minHeight: 0 }}>
        <div style={{ minHeight: 0, overflow: 'hidden' }}>
          {tab === 'tickets' && <TicketsTab sales={context.sales} filter={ticketFilterSignal.value} />}
          {tab === 'products' && <ProductsTab sales={context.sales} filter={productFilterSignal.value} />}
          {tab === 'payments' && <div />}
        </div>
        <div
          data-testid="cash-summary-sidebar"
          style={{
            borderLeft: '1px solid var(--color-border)',
            padding: 'var(--space-3)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-3)',
            overflowY: 'auto',
          }}
        >
          <div style={sidebarCardStyle}>
            <p style={sectionLabelStyle}>Total recaudado</p>
            <p style={{ margin: 0, fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-lg)', fontWeight: 700 }}>
              {formatMoney(summary.totalCollected)}
            </p>
          </div>
          <div style={sidebarCardStyle}>
            <p style={sectionLabelStyle}>Tickets emitidos</p>
            <p style={{ margin: 0, fontFamily: 'var(--font-mono)' }}>{summary.salesCount}</p>
          </div>
          <div style={sidebarCardStyle}>
            <p style={sectionLabelStyle}>Desc/Recargos</p>
            <p
              style={{
                margin: 0,
                fontFamily: 'var(--font-mono)',
                color: summary.adjustmentTotal < 0 ? 'var(--color-danger)' : 'var(--color-text)',
              }}
            >
              {formatMoney(summary.adjustmentTotal)}
            </p>
          </div>
          <div style={sidebarCardStyle}>
            <p style={sectionLabelStyle}>Efectivo</p>
            <p style={{ margin: 0, fontFamily: 'var(--font-mono)' }}>{formatMoney(summary.totalsByMethod.cash)}</p>
          </div>
          <div style={sidebarCardStyle}>
            <p style={sectionLabelStyle}>Otros pagos</p>
            <p style={{ margin: 0, fontFamily: 'var(--font-mono)' }}>{formatMoney(otherPayments)}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
