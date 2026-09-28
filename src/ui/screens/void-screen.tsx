import type { TargetedEvent, TargetedKeyboardEvent } from 'preact';
import { useLayoutEffect } from 'preact/hooks';
import { candidateId, type VoidCandidate } from '../../storage/void-repository.ts';
import { CollectionDocumentRow, SaleDocumentRow } from '../components/document-rows.tsx';
import { formatMoney } from '../format.ts';
import { voidOfLabel, voidOfReceiptLabel } from '../format-ticket.ts';
import { useFocusOnMount } from '../hooks/use-focus-on-mount.ts';
import { keepFocusOnMouseDown } from '../hooks/use-mouse-keeps-focus.ts';
import { useScrollSelectedIntoView } from '../hooks/use-scroll-selected-into-view.ts';
import {
  activateVoidRow,
  cancelVoidConfirmation,
  candidateCustomerName,
  confirmVoid,
  escapeVoidScreen,
  exitVoidScreen,
  loadVoidCandidates,
  moveVoidSelection,
  selectForVoid,
  updateVoidFilter,
  voidBalancePreview,
  voidQuestion,
} from '../keyboard/void-controller.ts';
import {
  filteredVoidCandidatesSignal,
  voidCandidatesSignal,
  voidConfirmingSignal,
  voidErrorSignal,
  voidFilterSignal,
  voidLoadedSignal,
  voidSelectionIndexSignal,
} from '../state/void.ts';

const emptyMessageStyle = {
  padding: 'var(--space-3)',
  color: 'var(--color-text-muted)',
  margin: 0,
};

/** Marca de una fila sin acción (#99, #125): la original anulada o el documento de una anulación. */
function candidateMark(candidate: VoidCandidate): string | undefined {
  if (candidate.state === 'voided') {
    return 'Anulada';
  }
  if (candidate.state !== 'void-document') {
    return undefined;
  }
  return candidate.kind === 'sale'
    ? voidOfLabel(candidate.sale, candidate.original)
    : voidOfReceiptLabel(candidate.payment, candidate.original);
}

function candidateTotal(candidate: VoidCandidate): number {
  return candidate.kind === 'sale' ? candidate.sale.total : candidate.payment.total;
}

/**
 * `/ANULAR` (#125, con #110 y #58): la lista de Movimientos de `/RESUMEN` con las ventas y las
 * cobranzas de las últimas 24 h y su buscador, que es el único input y nunca pierde el foco. La
 * original anulada y la anulación se ven atenuadas y sin acción: ↑/↓ y el click las saltean. Enter
 * abre un modal chico de confirmación encima de la lista; anular no se puede deshacer. Teclado +
 * mouse: click en una fila anulable = seleccionarla + Enter; cada atajo tiene su botón.
 */
export function VoidScreen() {
  const searchRef = useFocusOnMount<HTMLInputElement>();
  const rowRef = useScrollSelectedIntoView(voidSelectionIndexSignal);

  // Cargar al montar, reseteando antes del primer `await` (lo hace `loadVoidCandidates`).
  useLayoutEffect(() => {
    void loadVoidCandidates();
  }, []);

  const handleKeyDown = (event: TargetedKeyboardEvent<HTMLDivElement>) => {
    // Un botón enfocado con Tab se activa solo con Enter (nativo): no duplicar la acción.
    if (event.key === 'Enter' && event.target instanceof HTMLButtonElement) {
      return;
    }
    if (voidConfirmingSignal.value) {
      if (event.key === 'Enter') {
        event.preventDefault();
        void confirmVoid();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        cancelVoidConfirmation();
      } else if (event.key !== 'Tab') {
        // Con el modal abierto, el buscador no recibe texto.
        event.preventDefault();
      }
      return;
    }
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      moveVoidSelection(event.key === 'ArrowUp' ? -1 : 1);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      selectForVoid();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      escapeVoidScreen();
    }
  };

  const handleInput = (event: TargetedEvent<HTMLInputElement>) => {
    updateVoidFilter(event.currentTarget.value);
  };

  const candidates = filteredVoidCandidatesSignal.value;
  const selectedIndex = voidSelectionIndexSignal.value;
  const selected = selectedIndex !== null ? candidates[selectedIndex] : undefined;
  const loaded = voidLoadedSignal.value;
  const hasVoidable = voidCandidatesSignal.value.some((c) => c.state === 'voidable');
  const preview = selected !== undefined ? voidBalancePreview(selected) : undefined;
  const query = voidFilterSignal.value;

  return (
    <div
      onKeyDown={handleKeyDown}
      onMouseDown={keepFocusOnMouseDown}
      style={{
        height: 'var(--app-height)',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        overflow: 'hidden',
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
          }}
        >
          <h1 style={{ margin: 0, fontSize: 'var(--font-size-lg)' }}>Anular</h1>
          <button
            type="button"
            onClick={exitVoidScreen}
            style={{
              background: 'transparent',
              color: 'var(--color-chrome-text-muted)',
              border: 'none',
              cursor: 'pointer',
              fontSize: 'var(--font-size-sm)',
            }}
          >
            Volver a la venta (Esc)
          </button>
        </div>
        <div style={{ padding: '0 var(--space-4) var(--space-3)' }}>
          <input
            ref={searchRef}
            type="text"
            aria-label="Buscar"
            placeholder="Buscar ticket (#12), recibo, cliente o producto"
            value={query}
            onInput={handleInput}
            style={{
              width: '100%',
              boxSizing: 'border-box',
              background: 'var(--color-chrome-surface)',
              color: 'var(--color-chrome-text)',
              border: '1px solid var(--color-chrome-border)',
              borderRadius: 'var(--radius-md)',
              padding: 'var(--space-1) var(--space-2)',
            }}
          />
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {loaded && !hasVoidable && (
          <p style={emptyMessageStyle}>
            No hay ventas ni cobranzas de las últimas 24 horas para anular.
          </p>
        )}
        {loaded && hasVoidable && candidates.length === 0 && (
          <p style={emptyMessageStyle}>Ningún documento coincide con la búsqueda.</p>
        )}
        {candidates.map((candidate, index) => {
          const common = {
            index,
            query,
            selected: index === selectedIndex,
            dimmed: candidate.state !== 'voidable',
            mark: candidateMark(candidate),
            rowRef: rowRef(index),
            onClick: () => {
              activateVoidRow(index);
              searchRef.current?.focus();
            },
            testId: 'void-row',
          };
          return candidate.kind === 'sale' ? (
            <SaleDocumentRow key={candidateId(candidate)} sale={candidate.sale} {...common} />
          ) : (
            <CollectionDocumentRow
              key={candidateId(candidate)}
              payment={candidate.payment}
              customerName={candidateCustomerName(candidate)}
              {...common}
            />
          );
        })}
      </div>

      {voidConfirmingSignal.value && selected !== undefined && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.35)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Confirmar anulación"
            style={{
              background: 'var(--color-bg)',
              borderRadius: 'var(--radius-md)',
              boxShadow: 'var(--shadow-card)',
              padding: 'var(--space-4)',
              width: 'min(420px, 90%)',
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-2)',
            }}
          >
            <p style={{ margin: 0, fontWeight: 600 }}>{voidQuestion(selected)}</p>
            <p style={{ margin: 0, fontFamily: 'var(--font-mono)' }}>
              Total {formatMoney(candidateTotal(selected))}
            </p>
            {preview !== undefined && <p style={{ margin: 0 }}>{preview}</p>}
            <div style={{ minHeight: 'var(--space-6)' }}>
              {voidErrorSignal.value !== null && (
                <p role="alert" style={{ margin: 0, color: 'var(--color-danger)' }}>
                  {voidErrorSignal.value}
                </p>
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)' }}>
              <button type="button" class="btn" onClick={cancelVoidConfirmation}>
                Volver (Esc)
              </button>
              <button type="button" class="btn btn-danger" onClick={() => void confirmVoid()}>
                Anular (Enter)
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
