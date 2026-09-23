import { Index } from 'flexsearch';
import type { TargetedEvent, TargetedKeyboardEvent } from 'preact';
import { useMemo } from 'preact/hooks';
import { calculateProductQuantities, type ProductQuantity } from '../../domain/cash-session.ts';
import type { Sale, SaleLine } from '../../domain/sale.ts';
import type { PaymentMethod } from '../../domain/sale.ts';
import { formatMoney, formatQuantity } from '../format.ts';
import { useFocusOnMount } from '../hooks/use-focus-on-mount.ts';
import { useIndexListNavigation } from '../hooks/use-index-list-navigation.ts';
import { useScrollSelectedIntoView } from '../hooks/use-scroll-selected-into-view.ts';
import { useTicketListNavigation } from '../hooks/use-ticket-list-navigation.ts';
import { highlightMatches } from '../highlight.tsx';
import {
  exitCashSummaryScreen,
  setCashSummaryTab,
  updatePaymentFilter,
  updateProductFilter,
  updateTicketFilter,
} from '../keyboard/cash-summary-controller.ts';
import { PAYMENT_METHOD_LABELS } from '../payment-labels.ts';
import { getCatalogRepository } from '../state/catalog.ts';
import {
  cashSummaryContextSignal,
  cashSummaryTabSignal,
  paymentFilterSignal,
  productFilterSignal,
  selectedPaymentIndexSignal,
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
const tabButtonStyle = (active: boolean) => ({
  background: active ? 'var(--color-accent)' : 'transparent',
  color: active ? 'var(--color-chrome-bg)' : 'var(--color-chrome-text)',
  border: '1px solid var(--color-chrome-border)',
  borderRadius: 'var(--radius-md)',
  padding: 'var(--space-1) var(--space-2)',
  cursor: 'pointer',
});
const rowStyle = (selected: boolean) => ({
  background: selected ? 'var(--color-surface)' : undefined,
  cursor: 'pointer',
});

const TAB_ORDER: ('tickets' | 'products' | 'payments')[] = ['tickets', 'products', 'payments'];
const TAB_LABELS: Record<(typeof TAB_ORDER)[number], string> = {
  tickets: 'Tickets',
  products: 'Productos',
  payments: 'Medios de pago',
};
const TAB_HOTKEYS: Record<(typeof TAB_ORDER)[number], string> = {
  tickets: 'Alt+1',
  products: 'Alt+2',
  payments: 'Alt+3',
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
    const customerName =
      sale.customerId !== undefined
        ? (getCustomerRepository().getCustomer(sale.customerId)?.name ?? '')
        : '';
    const lineNames = sale.lines.map(lineLabel).join(' ');
    const lineCodes = sale.lines
      .map((line) =>
        line.kind === 'product' ? getCatalogRepository().getProduct(line.productId) : undefined,
      )
      .filter((p): p is NonNullable<typeof p> => p !== undefined)
      .map((p) => `${p.sku} ${p.barcodes.join(' ')}`)
      .join(' ');
    index.add(sale.id, `${customerName} ${lineNames} ${lineCodes}`);
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
function TicketRow({
  sale,
  index,
  query,
  nav,
  onSelect,
}: {
  sale: Sale;
  index: number;
  query: string;
  nav: ReturnType<typeof useTicketListNavigation>;
  onSelect: (index: number) => void;
}) {
  const customer =
    sale.customerId !== undefined
      ? getCustomerRepository().getCustomer(sale.customerId)
      : undefined;
  const isSelected = index === selectedTicketIndexSignal.value;
  return (
    <div
      ref={nav.ticketRef(index)}
      onClick={() => {
        onSelect(index);
      }}
      style={{
        background: isSelected ? 'var(--color-surface)' : 'transparent',
        borderTop: index > 0 ? '1px solid var(--color-border)' : undefined,
        cursor: 'pointer',
      }}
    >
      <div
        class="ticket__header"
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

/**
 * Presentacional: `filtered`/`nav` los arma `CashSummaryScreen` (no acá) — el `onKeyDown` real
 * vive en el contenedor raíz de la pantalla (único input enfocado más el resto de los elementos
 * clickeables), así que `nav.handleKeyDown` tiene que ser alcanzable desde ahí. Tenerlos como
 * hook/estado local de este componente (como en una versión anterior) los dejaba inalcanzables
 * desde ese `onKeyDown` — un bug real encontrado en revisión de código: las flechas nunca llegaban
 * a mover la selección en la pantalla real, solo en el test aislado del hook (que dispara
 * `keydown` directo sobre su propio contenedor de prueba).
 */
function TicketsTab({
  filtered,
  query,
  nav,
  onSelect,
}: {
  filtered: Sale[];
  query: string;
  nav: ReturnType<typeof useTicketListNavigation>;
  onSelect: (index: number) => void;
}) {
  const rows = filtered.map((sale, index) => (
    <TicketRow
      key={sale.id}
      sale={sale}
      index={index}
      query={query}
      nav={nav}
      onSelect={onSelect}
    />
  ));

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

function sortedProducts(
  sales: Sale[],
  filter: string,
): (ProductQuantity & { name: string; sku: string })[] {
  const quantities = calculateProductQuantities(sales).map((pq) => {
    const product = getCatalogRepository().getProduct(pq.productId);
    return { ...pq, name: product?.name ?? pq.productId, sku: product?.sku ?? '' };
  });
  if (filter.trim() === '') {
    return quantities.sort((a, b) => b.qty - a.qty);
  }
  const index = new Index({ tokenize: 'forward' });
  for (const q of quantities) {
    const barcodes = getCatalogRepository().getProduct(q.productId)?.barcodes ?? [];
    index.add(q.productId, `${q.name} ${q.sku} ${barcodes.join(' ')}`);
  }
  const rankedIds = index.search(filter).map(String);
  const byId = new Map(quantities.map((q) => [q.productId, q]));
  return rankedIds
    .map((id) => byId.get(id))
    .filter((q): q is (typeof quantities)[number] => q !== undefined);
}

function ProductsTab({
  products,
  query,
  onSelect,
}: {
  products: (ProductQuantity & { name: string; sku: string })[];
  query: string;
  onSelect: (index: number) => void;
}) {
  const rowRef = useScrollSelectedIntoView(selectedProductIndexSignal);

  return (
    <div style={{ height: '100%', overflowY: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead style={{ position: 'sticky', top: 0, background: 'var(--color-bg)' }}>
          <tr>
            <th style={{ textAlign: 'left', padding: 'var(--space-2) var(--space-3)' }}>Código</th>
            <th style={{ textAlign: 'left', padding: 'var(--space-2) var(--space-3)' }}>
              Producto
            </th>
            <th style={{ textAlign: 'right', padding: 'var(--space-2) var(--space-3)' }}>Cant.</th>
          </tr>
        </thead>
        <tbody>
          {products.map((p, index) => (
            <tr
              key={p.productId}
              data-testid="product-row"
              ref={rowRef(index)}
              onClick={() => {
                onSelect(index);
              }}
              style={rowStyle(index === selectedProductIndexSignal.value)}
            >
              <td
                style={{
                  padding: 'var(--space-1) var(--space-3)',
                  fontFamily: 'var(--font-mono)',
                  color: 'var(--color-text-muted)',
                }}
              >
                {highlightMatches(p.sku, query)}
              </td>
              <td style={{ padding: 'var(--space-1) var(--space-3)' }}>
                {highlightMatches(p.name, query)}
              </td>
              <td
                style={{
                  padding: 'var(--space-1) var(--space-3)',
                  textAlign: 'right',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                {formatQuantity(p.qty)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const ALL_METHODS: PaymentMethod[] = ['cash', 'debit', 'credit', 'transfer', 'qr', 'account'];

function PaymentsTab({
  totalsByMethod,
  query,
  onSelect,
}: {
  totalsByMethod: Record<PaymentMethod, number>;
  query: string;
  onSelect: (index: number) => void;
}) {
  const rowRef = useScrollSelectedIntoView(selectedPaymentIndexSignal);

  return (
    <div style={{ height: '100%', overflowY: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', padding: 'var(--space-2) var(--space-3)' }}>
              Medio de pago
            </th>
            <th style={{ textAlign: 'right', padding: 'var(--space-2) var(--space-3)' }}>Monto</th>
          </tr>
        </thead>
        <tbody>
          {ALL_METHODS.map((method, index) => (
            <tr
              key={method}
              ref={rowRef(index)}
              onClick={() => {
                onSelect(index);
              }}
              style={rowStyle(index === selectedPaymentIndexSignal.value)}
            >
              <td style={{ padding: 'var(--space-1) var(--space-3)', fontWeight: 600 }}>
                {highlightMatches(PAYMENT_METHOD_LABELS[method], query)}
              </td>
              <td
                style={{
                  padding: 'var(--space-1) var(--space-3)',
                  textAlign: 'right',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                {formatMoney(totalsByMethod[method])}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * `/RESUMEN`: panel lateral fijo + 3 pestañas (Tickets/Productos/Medios de pago).
 */
export function CashSummaryScreen() {
  const filterRef = useFocusOnMount<HTMLInputElement>();
  const context = cashSummaryContextSignal.value;
  const tab = cashSummaryTabSignal.value;

  // Se arman siempre, antes de cualquier `return` condicional — las Rules of Hooks exigen el mismo
  // orden de hooks en cada render, así que ninguno de los hooks de más abajo puede vivir después
  // del `if (context === undefined) return null` de más abajo (bug real encontrado en revisión de
  // código: los hooks quedaban condicionales). Con `sales: []` de fallback, esto no hace ningún
  // trabajo real mientras no haya contexto todavía.
  const sales = context?.sales ?? [];
  // El plugin no sabe que leer `signal.value` en el render ya hace que el componente se
  // re-renderice cuando cambia (así integra @preact/signals) — desde su perspectiva genérica de
  // React, los signals de filtro son "valores externos" y sugiere sacarlos de las deps, pero eso
  // rompería la memoización (se recalcularía siempre con el texto del filtro desactualizado).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const filteredTickets = useMemo(
    () => filterSales(sales, ticketFilterSignal.value),
    [sales, ticketFilterSignal.value],
  );
  const ticketsNav = useTicketListNavigation(selectedTicketIndexSignal, filteredTickets.length);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- ver comentario arriba.
  const products = useMemo(
    () => sortedProducts(sales, productFilterSignal.value),
    [sales, productFilterSignal.value],
  );
  const productsNav = useIndexListNavigation(selectedProductIndexSignal, products.length);
  const paymentsNav = useIndexListNavigation(selectedPaymentIndexSignal, ALL_METHODS.length);

  if (context === undefined) {
    return null; // invariante: no se entra a esta pantalla sin contexto (ver triggerCashSummary)
  }

  const { summary, isClosed } = context;
  const otherPayments = NON_CASH_METHODS.reduce(
    (sum, method) => sum + summary.totalsByMethod[method],
    0,
  );

  const filterValue =
    tab === 'products'
      ? productFilterSignal.value
      : tab === 'payments'
        ? paymentFilterSignal.value
        : ticketFilterSignal.value;
  const updateFilter =
    tab === 'products'
      ? updateProductFilter
      : tab === 'payments'
        ? updatePaymentFilter
        : updateTicketFilter;

  const focusFilter = () => {
    filterRef.current?.focus();
  };

  const handleFilterInput = (event: TargetedEvent<HTMLInputElement>) => {
    updateFilter(event.currentTarget.value);
  };

  const selectTicket = (index: number) => {
    ticketsNav.select(index);
    focusFilter();
  };
  const selectProduct = (index: number) => {
    // `Signal.value =` es la forma correcta de actualizar un signal reactivo (no una mutación de
    // prop) — la regla react-hooks/immutability no distingue signals de props comunes.
    // eslint-disable-next-line react-hooks/immutability
    selectedProductIndexSignal.value = index;
    focusFilter();
  };
  const selectPayment = (index: number) => {
    // eslint-disable-next-line react-hooks/immutability
    selectedPaymentIndexSignal.value = index;
    focusFilter();
  };

  // Hacer click sobre algo no enfocable (el título, una tarjeta del panel lateral) le saca el foco
  // al buscador y lo deja en `<body>` — desde ahí los `keydown` ya no pasan por este contenedor y
  // la pantalla deja de reaccionar al teclado. El foco se pierde en el `mousedown` (no en el
  // `click`), así que se cancela ahí; el `click` de botones y filas se dispara igual. El buscador
  // queda afuera para no romper reubicar el cursor con el mouse dentro del texto.
  const handleMouseDown = (event: MouseEvent) => {
    if (event.target !== filterRef.current) {
      event.preventDefault();
    }
  };

  const handleKeyDown = (event: TargetedKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      exitCashSummaryScreen();
      return;
    }
    if (event.altKey && (event.key === '1' || event.key === '2' || event.key === '3')) {
      event.preventDefault();
      const nextTab = TAB_ORDER[Number(event.key) - 1];
      if (nextTab !== undefined) setCashSummaryTab(nextTab);
      focusFilter();
      return;
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      const currentIdx = TAB_ORDER.indexOf(tab);
      const nextIdx =
        (currentIdx + (event.shiftKey ? -1 : 1) + TAB_ORDER.length) % TAB_ORDER.length;
      const nextTab = TAB_ORDER[nextIdx];
      if (nextTab !== undefined) setCashSummaryTab(nextTab);
      return;
    }

    const navHandled =
      tab === 'tickets'
        ? ticketsNav.handleKeyDown(event)
        : tab === 'products'
          ? productsNav.handleKeyDown(event)
          : paymentsNav.handleKeyDown(event);
    if (navHandled) return;

    // Cualquier otro elemento clickeable de la pantalla (botón de pestaña, "Cerrar", una fila) es
    // ahora un `<button>`/fila enfocable de verdad (issue post-PR #65: antes solo funcionaban con
    // mouse los botones de pestaña) — así que una tecla imprimible puede llegar acá con el foco en
    // cualquiera de ellos, no solo en el buscador. En vez de perderse, vuelve el foco al buscador y
    // continúa el texto ya tipeado en esta pestaña, en vez de arrancar de cero. Espacio/Enter
    // quedan afuera para no romper la activación nativa de un botón enfocado.
    if (
      event.key.length === 1 &&
      event.key !== ' ' &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.metaKey &&
      document.activeElement !== filterRef.current
    ) {
      event.preventDefault();
      updateFilter(filterValue + event.key);
      focusFilter();
    }
  };

  return (
    <div
      onKeyDown={handleKeyDown}
      onMouseDown={handleMouseDown}
      style={{
        height: 'var(--app-height)',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--color-bg)',
        color: 'var(--color-text)',
        fontFamily: 'var(--font-sans)',
      }}
    >
      <div style={{ background: 'var(--color-chrome-bg)', color: 'var(--color-chrome-text)' }}>
        <div
          style={{
            padding: 'var(--space-3) var(--space-4) var(--space-2)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 'var(--space-3)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
            <h1 style={{ margin: 0, fontSize: 'var(--font-size-lg)' }}>Resumen del turno</h1>
            {isClosed && (
              <span
                style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-chrome-text-muted)' }}
              >
                Turno cerrado
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={exitCashSummaryScreen}
            style={{
              background: 'transparent',
              color: 'var(--color-chrome-text-muted)',
              border: 'none',
              cursor: 'pointer',
              fontSize: 'var(--font-size-sm)',
            }}
          >
            [Esc] Cerrar
          </button>
        </div>

        <div
          style={{
            padding: '0 var(--space-4) var(--space-3)',
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-3)',
          }}
        >
          <input
            ref={filterRef}
            type="text"
            aria-label="Buscar"
            placeholder={
              tab === 'products'
                ? 'Buscar producto'
                : tab === 'payments'
                  ? 'Buscar medio de pago'
                  : 'Buscar ticket, cliente o producto'
            }
            value={filterValue}
            onInput={handleFilterInput}
            style={{
              flex: 1,
              background: 'var(--color-chrome-surface)',
              color: 'var(--color-chrome-text)',
              border: '1px solid var(--color-chrome-border)',
              borderRadius: 'var(--radius-md)',
              padding: 'var(--space-1) var(--space-2)',
            }}
          />
          {TAB_ORDER.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => {
                setCashSummaryTab(t);
                focusFilter();
              }}
              style={tabButtonStyle(t === tab)}
            >
              {TAB_LABELS[t]} <span style={{ opacity: 0.75 }}>({TAB_HOTKEYS[t]})</span>
            </button>
          ))}
        </div>
      </div>

      <div
        style={{
          flex: 1,
          display: 'grid',
          gridTemplateColumns: '1fr clamp(240px, 25%, 320px)',
          minHeight: 0,
        }}
      >
        <div data-testid="cash-summary-tab-content" style={{ minHeight: 0, overflow: 'hidden' }}>
          {tab === 'tickets' && (
            <TicketsTab
              filtered={filteredTickets}
              query={ticketFilterSignal.value}
              nav={ticketsNav}
              onSelect={selectTicket}
            />
          )}
          {tab === 'products' && (
            <ProductsTab
              products={products}
              query={productFilterSignal.value}
              onSelect={selectProduct}
            />
          )}
          {tab === 'payments' && (
            <PaymentsTab
              totalsByMethod={summary.totalsByMethod}
              query={paymentFilterSignal.value}
              onSelect={selectPayment}
            />
          )}
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
            <p
              style={{
                margin: 0,
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--font-size-lg)',
                fontWeight: 700,
              }}
            >
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
            <p style={{ margin: 0, fontFamily: 'var(--font-mono)' }}>
              {formatMoney(summary.totalsByMethod.cash)}
            </p>
          </div>
          <div style={sidebarCardStyle}>
            <p style={sectionLabelStyle}>Otros pagos</p>
            <p style={{ margin: 0, fontFamily: 'var(--font-mono)' }}>
              {formatMoney(otherPayments)}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
