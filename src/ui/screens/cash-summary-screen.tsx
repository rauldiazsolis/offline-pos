import { Index } from 'flexsearch';
import type { TargetedEvent, TargetedKeyboardEvent } from 'preact';
import { useMemo } from 'preact/hooks';
import type { CashCount } from '../../domain/cash-count.ts';
import type { CashMovement } from '../../domain/cash-movement.ts';
import { isVoidedPayment, type CustomerPayment } from '../../domain/customer-payment.ts';
import type { DayEntry } from '../../domain/day-summary.ts';
import type { PaymentMethod, Sale } from '../../domain/sale.ts';
import { roundAmount } from '../../domain/rounding.ts';
import { isVoided } from '../../domain/sale-lifecycle.ts';
import { calculateProductQuantities, type ProductQuantity } from '../../domain/sales-summary.ts';
import { localDateKey } from '../../domain/ticket-number.ts';
import type { DayView } from '../../storage/cash-summary-repository.ts';
import { formatMoney, formatQuantity, formatTime } from '../format.ts';
import { formatDayHeading } from '../format-day.ts';
import { CollectionDocumentRow, SaleDocumentRow } from '../components/document-rows.tsx';
import { collectionSearchText, filterByText, saleSearchText } from '../document-search.ts';
import { voidOfLabel, voidOfReceiptLabel } from '../format-ticket.ts';
import { highlightMatches } from '../highlight.tsx';
import { useFocusOnMount } from '../hooks/use-focus-on-mount.ts';
import { useIndexListNavigation } from '../hooks/use-index-list-navigation.ts';
import { keepFocusOnMouseDown } from '../hooks/use-mouse-keeps-focus.ts';
import { useScrollSelectedIntoView } from '../hooks/use-scroll-selected-into-view.ts';
import { useTicketListNavigation } from '../hooks/use-ticket-list-navigation.ts';
import {
  countDifference,
  describeDifference,
  formatCashAmount,
} from '../keyboard/cash-form-model.ts';
import {
  exitCashSummaryScreen,
  setCashSummaryTab,
  showNextDay,
  showPreviousDay,
  updateMovementFilter,
  updatePaymentFilter,
  updateProductFilter,
} from '../keyboard/cash-summary-controller.ts';
import { PAYMENT_METHOD_LABELS } from '../payment-labels.ts';
import { getCatalogRepository } from '../state/catalog.ts';
import {
  cashSummaryTabSignal,
  dayViewSignal,
  movementFilterSignal,
  paymentFilterSignal,
  productFilterSignal,
  selectedEntryIndexSignal,
  selectedPaymentIndexSignal,
  selectedProductIndexSignal,
  type CashSummaryTab,
} from '../state/cash-summary.ts';
import { scaledPx } from '../text-scale.ts';

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
const sidebarRowStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--font-size-sm)',
};
// Botones de la franja: nunca parten su etiqueta (#111).
const tabButtonStyle = (active: boolean) => ({
  whiteSpace: 'nowrap' as const,
  background: active ? 'var(--color-accent)' : 'transparent',
  color: active ? 'var(--color-chrome-bg)' : 'var(--color-chrome-text)',
  border: '1px solid var(--color-chrome-border)',
  borderRadius: 'var(--radius-md)',
  padding: 'var(--space-1) var(--space-2)',
  cursor: 'pointer',
});
const dayButtonStyle = {
  whiteSpace: 'nowrap' as const,
  background: 'transparent',
  color: 'var(--color-chrome-text)',
  border: '1px solid var(--color-chrome-border)',
  borderRadius: 'var(--radius-md)',
  padding: 'var(--space-1) var(--space-2)',
  cursor: 'pointer',
};

const TAB_ORDER: CashSummaryTab[] = ['movements', 'products', 'payments'];
const TAB_LABELS: Record<CashSummaryTab, string> = {
  movements: 'Movimientos',
  products: 'Productos',
  payments: 'Medios de pago',
};
const TAB_HOTKEYS: Record<CashSummaryTab, string> = {
  movements: 'Alt+1',
  products: 'Alt+2',
  payments: 'Alt+3',
};

function movementTitle(movement: CashMovement): string {
  return `${movement.direction === 'in' ? 'Ingreso' : 'Egreso'} · ${movement.concept}`;
}

function countText(count: CashCount): string {
  const difference = countDifference(count.expected, count.counted) ?? {
    kind: 'even' as const,
    amount: 0,
  };
  const detail = describeDifference(difference);
  return (
    `Arqueo · contado ${formatCashAmount(count.counted)} · esperado ` +
    `${formatCashAmount(count.expected)} · ${detail.charAt(0).toLocaleLowerCase()}${detail.slice(1)}`
  );
}

/** Texto en el que busca el filtro de Movimientos, por tipo de fila. */
function entrySearchText(entry: DayEntry, customerNames: ReadonlyMap<string, string>): string {
  switch (entry.kind) {
    case 'sale':
      return saleSearchText(entry.sale);
    case 'movement':
      return `${entry.movement.direction === 'in' ? 'ingreso' : 'egreso'} ${entry.movement.concept} ${
        entry.movement.description ?? ''
      }`;
    case 'count':
      return 'arqueo';
    case 'collection':
      return collectionSearchText(entry.payment, customerNames.get(entry.payment.customerId) ?? '');
  }
}

function entryKey(entry: DayEntry): string {
  switch (entry.kind) {
    case 'sale':
      return `s:${entry.sale.id}`;
    case 'movement':
      return `m:${entry.movement.id}`;
    case 'count':
      return `c:${entry.count.id}`;
    case 'collection':
      return `p:${entry.payment.id}`;
  }
}

/** El buscador encuentra también por número de ticket o de recibo ("12" o "#12"). */
function filterEntries(
  entries: DayEntry[],
  query: string,
  customerNames: ReadonlyMap<string, string>,
): DayEntry[] {
  return filterByText(entries, query, (entry) => entrySearchText(entry, customerNames));
}

/** Marca de un ticket anulado o de una anulación (#99, con el número desde #120). */
function saleMark(sale: Sale, view: DayView): string | undefined {
  if (sale.voidsSaleId !== undefined) {
    return voidOfLabel(sale, view.voidOriginals.get(sale.voidsSaleId));
  }
  return isVoided(sale, view.voidedSaleIds) ? 'Anulada' : undefined;
}

/** Marca de una cobranza anulada o de una anulación (#125), como la de los tickets. */
function collectionMark(payment: CustomerPayment, view: DayView): string | undefined {
  if (payment.voidsPaymentId !== undefined) {
    return voidOfReceiptLabel(payment, view.paymentVoidOriginals.get(payment.voidsPaymentId));
  }
  return isVoidedPayment(payment, view.voidedPaymentIds) ? 'Anulada' : undefined;
}

type RowProps = {
  index: number;
  query: string;
  nav: ReturnType<typeof useTicketListNavigation>;
  onSelect: (index: number) => void;
};

function rowContainerStyle(index: number) {
  const isSelected = index === selectedEntryIndexSignal.value;
  return {
    isSelected,
    // La selección la pinta `.selectable-row[data-selected]` (tokens.css, #112).
    style: {
      borderTop: index > 0 ? '1px solid var(--color-border)' : undefined,
      cursor: 'pointer',
    },
  };
}

/**
 * Un ticket en Movimientos: la fila compartida con `/ANULAR` (#125) más la selección y la marca de
 * `/RESUMEN`. Componente propio (no un `.map()` inline) — el ref callback que devuelve
 * `nav.ticketRef(index)` toca `.current` recién cuando Preact lo invoca o dentro de
 * `handleKeyDown`, nunca durante el render; como componente separado, esa lectura queda en el
 * nivel superior de SU propio render, que es la forma que espera `react-hooks/refs`.
 */
function SaleEntryRow({
  sale,
  view,
  index,
  query,
  nav,
  onSelect,
}: RowProps & { sale: Sale; view: DayView }) {
  return (
    <SaleDocumentRow
      sale={sale}
      index={index}
      query={query}
      selected={index === selectedEntryIndexSignal.value}
      mark={saleMark(sale, view)}
      rowRef={nav.ticketRef(index)}
      onClick={() => {
        onSelect(index);
      }}
    />
  );
}

/** Una cobranza en Movimientos (#101), con su marca de anulada o de anulación (#125). */
function CollectionEntryRow({
  payment,
  customerName,
  view,
  index,
  query,
  nav,
  onSelect,
}: RowProps & { payment: CustomerPayment; customerName: string; view: DayView }) {
  return (
    <CollectionDocumentRow
      payment={payment}
      customerName={customerName}
      index={index}
      query={query}
      selected={index === selectedEntryIndexSignal.value}
      mark={collectionMark(payment, view)}
      rowRef={nav.ticketRef(index)}
      onClick={() => {
        onSelect(index);
      }}
    />
  );
}

/** Ingreso, egreso o ajuste por arqueo: una sola fila con hora, texto y monto con signo. */
function MovementEntryRow({
  movement,
  index,
  query,
  nav,
  onSelect,
}: RowProps & { movement: CashMovement }) {
  const { isSelected, style } = rowContainerStyle(index);
  const sign = movement.direction === 'in' ? '+' : '−';
  return (
    <div
      ref={nav.ticketRef(index)}
      class="selectable-row"
      data-selected={isSelected ? '' : undefined}
      onClick={() => {
        onSelect(index);
      }}
      style={{
        ...style,
        padding: 'var(--space-2) var(--space-3)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-2)' }}>
        <span style={{ fontWeight: 600 }}>{highlightMatches(movementTitle(movement), query)}</span>
        <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-text-muted)' }}>
          {formatTime(movement.createdAt)}
        </span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-2)' }}>
        <span style={{ color: 'var(--color-text-muted)' }}>
          {movement.description !== undefined ? highlightMatches(movement.description, query) : ''}
        </span>
        <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
          {sign}
          {formatMoney(movement.amount)}
        </span>
      </div>
    </div>
  );
}

function CountEntryRow({ count, index, nav, onSelect }: RowProps & { count: CashCount }) {
  const { isSelected, style } = rowContainerStyle(index);
  return (
    <div
      ref={nav.ticketRef(index)}
      class="selectable-row"
      data-selected={isSelected ? '' : undefined}
      onClick={() => {
        onSelect(index);
      }}
      style={{
        ...style,
        padding: 'var(--space-2) var(--space-3)',
        display: 'flex',
        justifyContent: 'space-between',
        gap: 'var(--space-2)',
      }}
    >
      <span style={{ fontWeight: 600 }}>{countText(count)}</span>
      <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-text-muted)' }}>
        {formatTime(count.createdAt)}
      </span>
    </div>
  );
}

/**
 * Presentacional: `filtered`/`nav` los arma `CashSummaryScreen` — el `onKeyDown` real vive en el
 * contenedor raíz de la pantalla, así que `nav.handleKeyDown` tiene que ser alcanzable desde ahí
 * (bug real de una versión anterior: las flechas nunca llegaban a mover la selección).
 */
function MovementsTab({
  view,
  filtered,
  query,
  nav,
  onSelect,
}: {
  view: DayView;
  filtered: DayEntry[];
  query: string;
  nav: ReturnType<typeof useTicketListNavigation>;
  onSelect: (index: number) => void;
}) {
  const rows = filtered.map((entry, index) => {
    const props = { index, query, nav, onSelect };
    switch (entry.kind) {
      case 'sale':
        return <SaleEntryRow key={entryKey(entry)} sale={entry.sale} view={view} {...props} />;
      case 'movement':
        return <MovementEntryRow key={entryKey(entry)} movement={entry.movement} {...props} />;
      case 'count':
        return <CountEntryRow key={entryKey(entry)} count={entry.count} {...props} />;
      case 'collection':
        return (
          <CollectionEntryRow
            key={entryKey(entry)}
            payment={entry.payment}
            customerName={view.customerNames.get(entry.payment.customerId) ?? ''}
            view={view}
            {...props}
          />
        );
    }
  });
  const isOldest = view.date === view.oldestDate && !view.isToday;

  return (
    // `nav.containerRef` solo toca `.current` cuando Preact lo invoca o dentro de `handleKeyDown`
    // (vía `onKeyDown`, nunca durante el render) — el análisis estático del plugin no distingue
    // eso al ver que otro miembro del mismo hook comparte esa ref.
    // eslint-disable-next-line react-hooks/refs
    <div ref={nav.containerRef} style={{ height: '100%', overflowY: 'auto', outline: 'none' }}>
      {view.entries.length === 0 ? (
        <p style={{ padding: 'var(--space-3)', color: 'var(--color-text-muted)' }}>
          Sin movimientos este día
        </p>
      ) : (
        filtered.length === 0 && (
          <p style={{ padding: 'var(--space-3)', color: 'var(--color-text-muted)' }}>
            Ningún movimiento coincide con la búsqueda.
          </p>
        )
      )}
      {rows}
      {isOldest && (
        <p
          style={{
            padding: 'var(--space-3)',
            color: 'var(--color-text-muted)',
            fontSize: 'var(--font-size-sm)',
          }}
        >
          Los datos de más de 7 días se limpian de esta terminal
        </p>
      )}
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
              class="selectable-row"
              data-selected={index === selectedProductIndexSignal.value ? '' : undefined}
              style={{ cursor: 'pointer' }}
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

/** Por medio: ventas, cobranzas (#101) y el total de las dos. */
function PaymentsTab({
  totalsByMethod,
  collectionsByMethod,
  query,
  onSelect,
}: {
  totalsByMethod: Record<PaymentMethod, number>;
  collectionsByMethod: Record<PaymentMethod, number>;
  query: string;
  onSelect: (index: number) => void;
}) {
  const amountCellStyle = {
    padding: 'var(--space-1) var(--space-3)',
    textAlign: 'right' as const,
    fontFamily: 'var(--font-mono)',
  };
  const rowRef = useScrollSelectedIntoView(selectedPaymentIndexSignal);
  return (
    <div style={{ height: '100%', overflowY: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', padding: 'var(--space-2) var(--space-3)' }}>
              Medio de pago
            </th>
            <th style={{ textAlign: 'right', padding: 'var(--space-2) var(--space-3)' }}>Ventas</th>
            <th style={{ textAlign: 'right', padding: 'var(--space-2) var(--space-3)' }}>
              Cobranzas
            </th>
            <th style={{ textAlign: 'right', padding: 'var(--space-2) var(--space-3)' }}>Total</th>
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
              class="selectable-row"
              data-selected={index === selectedPaymentIndexSignal.value ? '' : undefined}
              style={{ cursor: 'pointer' }}
            >
              <td style={{ padding: 'var(--space-1) var(--space-3)', fontWeight: 600 }}>
                {highlightMatches(PAYMENT_METHOD_LABELS[method], query)}
              </td>
              <td style={amountCellStyle}>{formatMoney(totalsByMethod[method])}</td>
              <td style={amountCellStyle}>{formatMoney(collectionsByMethod[method])}</td>
              <td style={{ ...amountCellStyle, fontWeight: 700 }}>
                {formatMoney(roundAmount(totalsByMethod[method] + collectionsByMethod[method]))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Sidebar({ view }: { view: DayView }) {
  const { summary, balance } = view;
  return (
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
        <p style={sectionLabelStyle}>Total vendido</p>
        <p
          style={{
            margin: 0,
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--font-size-lg)',
            fontWeight: 700,
          }}
        >
          {formatMoney(summary.totalSold)}
        </p>
      </div>
      <div style={sidebarCardStyle}>
        <p style={sectionLabelStyle}>Tickets emitidos</p>
        <p style={{ margin: 0, fontFamily: 'var(--font-mono)' }}>
          {summary.ticketCount}
          {summary.voidedCount > 0 && (
            <span style={{ color: 'var(--color-text-muted)' }}>
              {' '}
              ({summary.voidedCount} anuladas)
            </span>
          )}
        </p>
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
        <p style={sectionLabelStyle}>Otros pagos</p>
        <p style={{ margin: 0, fontFamily: 'var(--font-mono)' }}>
          {formatMoney(summary.otherPayments)}
        </p>
      </div>
      <div style={sidebarCardStyle}>
        <p style={sectionLabelStyle}>Cobranzas</p>
        <p style={{ margin: 0, fontFamily: 'var(--font-mono)' }}>
          {formatMoney(summary.collections.total)}
          {summary.collections.count > 0 && (
            <span style={{ color: 'var(--color-text-muted)' }}>
              {' '}
              {`(${String(summary.collections.count)} recibos${
                summary.collections.voidedCount > 0
                  ? `, ${String(summary.collections.voidedCount)} anulados`
                  : ''
              })`}
            </span>
          )}
        </p>
      </div>
      <div style={sidebarCardStyle}>
        <p style={sectionLabelStyle}>Efectivo</p>
        <div style={sidebarRowStyle}>
          <span>Cobros</span>
          <span>{formatMoney(summary.cash.sales)}</span>
        </div>
        <div style={sidebarRowStyle} data-testid="cash-collections-row">
          <span>Cobranzas</span>
          <span>{formatMoney(summary.cash.collections)}</span>
        </div>
        <div style={sidebarRowStyle}>
          <span>Ingresos</span>
          <span>{formatMoney(summary.cash.income)}</span>
        </div>
        <div style={sidebarRowStyle}>
          <span>Egresos</span>
          <span>{formatMoney(summary.cash.expense)}</span>
        </div>
        <div style={sidebarRowStyle}>
          <span>Ajustes por arqueo</span>
          <span>{formatMoney(summary.cash.countAdjustments)}</span>
        </div>
      </div>
      {balance !== undefined && (
        <div style={sidebarCardStyle}>
          <p style={sectionLabelStyle}>Saldo de efectivo actual</p>
          <p style={{ margin: 0, fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
            {formatMoney(balance.balance)}
          </p>
          <p
            style={{ margin: 0, fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}
          >
            {balance.lastCountAt !== undefined
              ? `desde el arqueo de ${formatTime(balance.lastCountAt)}`
              : 'sin arqueo previo'}
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * `/RESUMEN` por día calendario (Etapa 5 de #94, #100): arranca en hoy y navega de a un día con
 * "‹ Anterior (Alt+←)" / "Siguiente (Alt+→) ›", acotado entre el día más viejo con datos locales y
 * hoy. Panel lateral fijo más 3 pestañas: Movimientos (ventas, anulaciones, ingresos, egresos,
 * arqueos y cobranzas — #101 —, por hora), Productos y Medios de pago (ventas y cobranzas).
 */
export function CashSummaryScreen() {
  const filterRef = useFocusOnMount<HTMLInputElement>();
  const view = dayViewSignal.value;
  const tab = cashSummaryTabSignal.value;
  // Se arman siempre, antes de cualquier `return` condicional — las Rules of Hooks exigen el mismo
  // orden de hooks en cada render. Con listas vacías de fallback, no hacen trabajo real mientras
  // no haya un día cargado.
  const movementQuery = movementFilterSignal.value;
  const productQuery = productFilterSignal.value;
  const filteredEntries = useMemo(
    () => filterEntries(view?.entries ?? [], movementQuery, view?.customerNames ?? new Map()),
    [view, movementQuery],
  );
  const entriesNav = useTicketListNavigation(selectedEntryIndexSignal, filteredEntries.length);
  const products = useMemo(
    () => sortedProducts(view?.sales ?? [], productQuery),
    [view, productQuery],
  );
  const productsNav = useIndexListNavigation(selectedProductIndexSignal, products.length);
  const paymentsNav = useIndexListNavigation(selectedPaymentIndexSignal, ALL_METHODS.length);

  if (view === undefined) {
    return null; // invariante: no se entra a esta pantalla sin un día cargado (triggerCashSummary)
  }
  const today = localDateKey(new Date().toISOString());
  const canGoBack = view.date > view.oldestDate;
  const canGoForward = !view.isToday;

  const filterValue =
    tab === 'products'
      ? productFilterSignal.value
      : tab === 'payments'
        ? paymentFilterSignal.value
        : movementFilterSignal.value;
  const updateFilter =
    tab === 'products'
      ? updateProductFilter
      : tab === 'payments'
        ? updatePaymentFilter
        : updateMovementFilter;
  const focusFilter = () => {
    filterRef.current?.focus();
  };
  const handleFilterInput = (event: TargetedEvent<HTMLInputElement>) => {
    updateFilter(event.currentTarget.value);
  };
  const selectEntry = (index: number) => {
    entriesNav.select(index);
    focusFilter();
  };
  const selectProduct = (index: number) => {
    selectedProductIndexSignal.value = index;
    focusFilter();
  };
  const selectPayment = (index: number) => {
    selectedPaymentIndexSignal.value = index;
    focusFilter();
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
    if (event.altKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      event.preventDefault();
      void (event.key === 'ArrowLeft' ? showPreviousDay() : showNextDay());
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
      tab === 'movements'
        ? entriesNav.handleKeyDown(event)
        : tab === 'products'
          ? productsNav.handleKeyDown(event)
          : paymentsNav.handleKeyDown(event);
    if (navHandled) return;
    // Una tecla imprimible con el foco en un botón vuelve al buscador y continúa el texto ya
    // tipeado en esta pestaña. Espacio/Enter quedan afuera para no romper la activación nativa.
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
      // Patrón teclado + mouse: ver ui/hooks/use-mouse-keeps-focus.ts.
      onMouseDown={keepFocusOnMouseDown}
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
          {/* Con el texto más grande a 600 px (#111) los botones de día bajan de renglón. */}
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              columnGap: 'var(--space-3)',
              rowGap: 'var(--space-1)',
            }}
          >
            <h1 style={{ margin: 0, fontSize: 'var(--font-size-lg)', whiteSpace: 'nowrap' }}>
              Resumen del día
            </h1>
            <span
              data-testid="day-heading"
              style={{ color: 'var(--color-chrome-text-muted)', whiteSpace: 'nowrap' }}
            >
              {formatDayHeading(view.date, today)}
            </span>
            <button
              type="button"
              disabled={!canGoBack}
              onClick={() => {
                void showPreviousDay();
                focusFilter();
              }}
              style={{ ...dayButtonStyle, opacity: canGoBack ? 1 : 0.4 }}
            >
              ‹ Anterior (Alt+←)
            </button>
            <button
              type="button"
              disabled={!canGoForward}
              onClick={() => {
                void showNextDay();
                focusFilter();
              }}
              style={{ ...dayButtonStyle, opacity: canGoForward ? 1 : 0.4 }}
            >
              Siguiente (Alt+→) ›
            </button>
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
              whiteSpace: 'nowrap',
            }}
          >
            Cerrar (Esc)
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
                  : 'Buscar ticket (#12), cliente, producto o concepto'
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
          gridTemplateColumns: `1fr clamp(${scaledPx(240)}, 25%, ${scaledPx(320)})`,
          minHeight: 0,
        }}
      >
        <div data-testid="cash-summary-tab-content" style={{ minHeight: 0, overflow: 'hidden' }}>
          {tab === 'movements' && (
            <MovementsTab
              view={view}
              filtered={filteredEntries}
              query={movementQuery}
              nav={entriesNav}
              onSelect={selectEntry}
            />
          )}
          {tab === 'products' && (
            <ProductsTab products={products} query={productQuery} onSelect={selectProduct} />
          )}
          {tab === 'payments' && (
            <PaymentsTab
              totalsByMethod={view.summary.totalsByMethod}
              collectionsByMethod={view.summary.collectionsByMethod}
              query={paymentFilterSignal.value}
              onSelect={selectPayment}
            />
          )}
        </div>
        <Sidebar view={view} />
      </div>
    </div>
  );
}
