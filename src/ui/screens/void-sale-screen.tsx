import { useSignalEffect } from '@preact/signals';
import { useLayoutEffect } from 'preact/hooks';
import type { TargetedKeyboardEvent } from 'preact';
import { formatMoney } from '../format.ts';
import { useFocusOnMount } from '../hooks/use-focus-on-mount.ts';
import {
  cancelVoidConfirmation,
  confirmVoid,
  exitVoidScreen,
  loadVoidableSales,
  moveVoidSelection,
  selectForVoid,
} from '../keyboard/void-controller.ts';
import {
  voidConfirmingSignal,
  voidErrorSignal,
  voidSelectionIndexSignal,
  voidableSalesSignal,
} from '../state/void-sale.ts';

/**
 * `/ANULAR`: mismo patrón lista→↑↓→Enter que la búsqueda de productos, sobre
 * las últimas ventas cerradas. Confirmación explícita antes de anular
 * (Enter otra vez) — anular no se puede deshacer.
 */
export function VoidSaleScreen() {
  const containerRef = useFocusOnMount<HTMLDivElement>();

  // Cargar las ventas anulables es una carga de datos al montar, no algo
  // ligado al foco — useFocusOnMount solo se ocupa del foco, esto va aparte.
  useLayoutEffect(() => {
    void loadVoidableSales();
  }, []);

  useSignalEffect(() => {
    if (voidErrorSignal.value !== null) {
      containerRef.current?.focus();
    }
  });

  const handleKeyDown = (event: TargetedKeyboardEvent<HTMLDivElement>) => {
    if (voidConfirmingSignal.value) {
      if (event.key === 'Enter') {
        event.preventDefault();
        void confirmVoid();
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        cancelVoidConfirmation();
      }
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveVoidSelection(-1);
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveVoidSelection(1);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      selectForVoid();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      exitVoidScreen();
    }
  };

  const sales = voidableSalesSignal.value;
  const selectedIndex = voidSelectionIndexSignal.value;
  const selectedSale = selectedIndex !== null ? sales[selectedIndex] : undefined;

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      style={{
        minHeight: '100svh',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-3)',
        padding: 'var(--space-4)',
        background: 'var(--color-bg)',
        color: 'var(--color-text)',
        fontFamily: 'var(--font-sans)',
      }}
    >
      <h1 style={{ margin: 0, fontSize: 'var(--font-size-xl)' }}>Anular venta</h1>

      {voidConfirmingSignal.value && selectedSale ? (
        <div>
          <p>
            Venta {selectedSale.id} — {formatMoney(selectedSale.total)}
          </p>
          <p style={{ fontWeight: 'bold' }}>¿Anular esta venta? Enter confirma, Esc cancela.</p>
        </div>
      ) : sales.length === 0 ? (
        <p style={{ color: 'var(--color-text-muted)' }}>No hay ventas cerradas para anular.</p>
      ) : (
        <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
          {sales.map((sale, index) => (
            <li
              key={sale.id}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                padding: 'var(--space-1) var(--space-2)',
                background: index === selectedIndex ? 'var(--color-surface)' : 'transparent',
              }}
            >
              <span>{new Date(sale.createdAt).toLocaleString()}</span>
              <span>{formatMoney(sale.total)}</span>
            </li>
          ))}
        </ul>
      )}

      <div style={{ minHeight: 'var(--space-8)' }}>
        {voidErrorSignal.value !== null && (
          <p role="alert" style={{ margin: 0, color: 'var(--color-danger)' }}>
            {voidErrorSignal.value}
          </p>
        )}
      </div>
      <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>Esc para volver a la venta.</p>
    </div>
  );
}
