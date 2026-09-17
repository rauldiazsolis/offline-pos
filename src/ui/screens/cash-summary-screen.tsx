import type { TargetedEvent, TargetedKeyboardEvent } from 'preact';
import type { PaymentMethod } from '../../domain/sale.ts';
import { formatMoney } from '../format.ts';
import { useFocusOnMount } from '../hooks/use-focus-on-mount.ts';
import {
  exitCashSummaryScreen,
  setCashSummaryTab,
  updateProductFilter,
  updateTicketFilter,
} from '../keyboard/cash-summary-controller.ts';
import { cashSummaryContextSignal, cashSummaryTabSignal, productFilterSignal, ticketFilterSignal } from '../state/cash-summary.ts';

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
          {tab === 'tickets' && <div />}
          {tab === 'products' && <div />}
          {tab === 'payments' && <div />}
        </div>
        <div
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
