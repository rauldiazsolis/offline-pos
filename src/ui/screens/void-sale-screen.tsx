import { useSignalEffect } from '@preact/signals';
import { useLayoutEffect } from 'preact/hooks';
import type { TargetedKeyboardEvent } from 'preact';
import type { VoidCandidate } from '../../storage/sale-repository.ts';
import { formatMoney, formatTime } from '../format.ts';
import { useFocusOnMount } from '../hooks/use-focus-on-mount.ts';
import { keepFocusOnMouseDown } from '../hooks/use-mouse-keeps-focus.ts';
import {
  activateVoidRow,
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
  voidLoadedSignal,
  voidSelectionIndexSignal,
  voidableSalesSignal,
} from '../state/void-sale.ts';

/** Texto de una fila sin acción (#99): la original ya anulada, o el ticket de una anulación. */
function candidateLabel(candidate: VoidCandidate): string | undefined {
  if (candidate.state === 'voided') {
    return 'Anulada';
  }
  if (candidate.state === 'void-ticket') {
    const { original } = candidate;
    return original !== undefined
      ? `Anulación de ${formatTime(original.createdAt)} · ${formatMoney(original.total)}`
      : 'Anulación';
  }
  return undefined;
}

/**
 * `/ANULAR`: mismo patrón lista→↑↓→Enter que la búsqueda de productos, sobre
 * los últimos 20 tickets de las últimas 24 h (#99: ventana móvil, cubre el
 * turno noche). Una original ya anulada y el ticket de una anulación se ven
 * atenuados y sin acción: ↑/↓ y el click los saltean. La búsqueda y el ticket
 * completo en la confirmación quedan en #110. Confirmación explícita antes de
 * anular (Enter otra vez) — anular genera un ticket negativo que no se puede
 * deshacer. Teclado + mouse (Etapa 2 de #94): click en una venta =
 * seleccionarla + Enter; cada atajo tiene su botón.
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
    // Un botón enfocado con Tab se activa solo con Enter (nativo): no duplicar
    // la acción con el atajo del contenedor.
    if (event.key === 'Enter' && event.target instanceof HTMLButtonElement) {
      return;
    }
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

  const candidates = voidableSalesSignal.value;
  const selectedIndex = voidSelectionIndexSignal.value;
  const selectedSale = selectedIndex !== null ? candidates[selectedIndex]?.sale : undefined;
  const hasVoidable = candidates.some((candidate) => candidate.state === 'voidable');

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      onMouseDown={keepFocusOnMouseDown}
      style={{
        height: 'var(--app-height)',
        overflowY: 'auto',
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
        <div
          style={{
            border: '1px solid var(--color-danger)',
            borderRadius: 'var(--radius-md)',
            padding: 'var(--space-3)',
          }}
        >
          <p style={{ margin: '0 0 var(--space-2)' }}>
            Venta {selectedSale.id} —{' '}
            <span style={{ fontFamily: 'var(--font-mono)' }}>
              {formatMoney(selectedSale.total)}
            </span>
          </p>
          <p style={{ margin: 0, fontWeight: 'bold', color: 'var(--color-danger)' }}>
            ¿Anular esta venta? Enter confirma, Esc cancela.
          </p>
          <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-3)' }}>
            <button type="button" class="btn" onClick={cancelVoidConfirmation}>
              Volver (Esc)
            </button>
            <button type="button" class="btn btn-danger" onClick={() => void confirmVoid()}>
              Anular (Enter)
            </button>
          </div>
        </div>
      ) : !voidLoadedSignal.value ? null : !hasVoidable ? (
        <p style={{ color: 'var(--color-text-muted)' }}>
          No hay ventas de las últimas 24 horas para anular.
        </p>
      ) : (
        <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
          {candidates.map((candidate, index) => {
            const { sale } = candidate;
            const label = candidateLabel(candidate);
            const actionable = candidate.state === 'voidable';
            return (
              <li
                key={sale.id}
                onClick={() => {
                  activateVoidRow(index);
                }}
                style={{
                  cursor: actionable ? 'pointer' : 'default',
                  opacity: actionable ? 1 : 0.5,
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 'var(--space-3)',
                  padding: 'var(--space-2)',
                  borderRadius: 'var(--radius-md)',
                  background: index === selectedIndex ? 'var(--color-surface)' : 'transparent',
                }}
              >
                <span>
                  {new Date(sale.createdAt).toLocaleString()}
                  {label !== undefined && (
                    <span
                      style={{ marginLeft: 'var(--space-2)', color: 'var(--color-text-muted)' }}
                    >
                      {label}
                    </span>
                  )}
                </span>
                <span style={{ fontFamily: 'var(--font-mono)' }}>{formatMoney(sale.total)}</span>
              </li>
            );
          })}
        </ul>
      )}

      <div style={{ minHeight: 'var(--space-8)' }}>
        {voidErrorSignal.value !== null && (
          <p role="alert" style={{ margin: 0, color: 'var(--color-danger)' }}>
            {voidErrorSignal.value}
          </p>
        )}
      </div>
      {!voidConfirmingSignal.value && (
        <div>
          <button type="button" class="btn" onClick={exitVoidScreen}>
            Volver a la venta (Esc)
          </button>
        </div>
      )}
    </div>
  );
}
