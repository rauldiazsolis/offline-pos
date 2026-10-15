import { useSignalEffect } from '@preact/signals';
import type { TargetedEvent, TargetedKeyboardEvent } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';
import { useScrollSelectedIntoView } from '../hooks/use-scroll-selected-into-view.ts';
import { keepFocusOnMouseDown } from '../hooks/use-mouse-keeps-focus.ts';
import {
  cancelCash,
  chooseConceptSuggestion,
  closeConceptSuggestions,
  loadCashScreen,
  moveConceptSuggestion,
  openConceptSuggestions,
  submitCash,
  updateCashField,
} from '../keyboard/cash-controller.ts';
import {
  CASH_KIND_TITLES,
  countDifference,
  describeDifference,
  describeLastCount,
  enterSubmits,
  exceedsBalance,
  fieldsFor,
  formatCashAmount,
  moveCashField,
  type CashField,
  type CashKind,
} from '../keyboard/cash-form-model.ts';
import { remapDecimalKey } from '../keyboard/decimal-key.ts';
import { parseAmount, parseNonNegativeAmount } from '../parse-amount.ts';
import {
  cashBalanceSignal,
  cashErrorSignal,
  cashFieldsSignal,
  cashKindSignal,
  conceptSuggestionIndexSignal,
  conceptSuggestionsOpenSignal,
  conceptSuggestionsSignal,
} from '../state/cash.ts';
import { scaledPx } from '../text-scale.ts';

const overlayStyle = {
  height: 'var(--app-height)',
  overflowY: 'auto' as const,
  display: 'flex',
  flexDirection: 'column' as const,
  alignItems: 'center',
  justifyContent: 'center',
  padding: 'var(--space-4)',
  background: 'var(--color-surface)',
};

const dialogStyle = {
  width: '100%',
  maxWidth: scaledPx(560),
  background: 'var(--color-bg)',
  borderRadius: 'var(--radius-md)',
  boxShadow: 'var(--shadow-card)',
  padding: 'var(--space-4)',
  display: 'flex',
  flexDirection: 'column' as const,
  gap: 'var(--space-3)',
  color: 'var(--color-text)',
  fontFamily: 'var(--font-sans)',
};

const fieldRowStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 'var(--space-3)',
};

const inputStyle = {
  width: scaledPx(280),
  fontSize: 'var(--font-size-base)',
  padding: 'var(--space-2)',
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--color-border)',
  background: 'var(--color-bg)',
  color: 'var(--color-text)',
};

const amountInputStyle = {
  ...inputStyle,
  width: scaledPx(160),
  fontFamily: 'var(--font-mono)',
  textAlign: 'right' as const,
};

/** Un color por tipo (#224): el borde superior y el título, para no confundir un ingreso con un egreso. */
const KIND_COLORS: Record<CashKind, string> = {
  count: 'var(--color-accent)',
  in: 'var(--color-success)',
  out: 'var(--color-warning)',
};

const FIELD_LABELS: Record<CashField, string> = {
  counted: 'Contado',
  concept: 'Concepto',
  description: 'Descripción',
  amount: 'Monto',
};

const HINTS: Record<CashKind, string> = {
  count: 'Enter confirma, Esc cancela.',
  in: 'Enter pasa al concepto y confirma. ↓ o Tab, la descripción. Esc cancela.',
  out: 'Enter pasa al concepto y confirma. ↓ o Tab, la descripción. Esc cancela.',
};

/**
 * Un formulario por función (#224): `/ARQUEO`, `/INGRESO` y `/EGRESO` abren esta tarjeta centrada
 * en su tipo, sin selector — el comando ya es la decisión —, con su título y su color. El arqueo
 * no es ciego: muestra el esperado y la diferencia en vivo. En un movimiento va el Monto primero:
 * Enter pasa al Concepto y Enter en el Concepto (o en la Descripción, opcional, a la que se llega
 * con ↓ o Tab) confirma; con una sugerencia elegida con ↓, el primer Enter la toma y el segundo
 * confirma. ↑ vuelve al campo anterior, Ctrl+Enter confirma desde cualquier campo y Esc cancela —
 * salvo con las sugerencias de Concepto abiertas, que primero se cierran.
 */
export function CashScreen() {
  const fieldRefs = useRef(new Map<CashField, HTMLInputElement>());
  const suggestionRowRef = useScrollSelectedIntoView(conceptSuggestionIndexSignal);
  const kind = cashKindSignal.value;

  useLayoutEffect(() => {
    void loadCashScreen();
  }, []);

  const focusField = (field: CashField | undefined) => {
    if (field === undefined) {
      return;
    }
    const input = fieldRefs.current.get(field);
    input?.focus();
    input?.select();
  };

  // Al abrir, el foco va al primer campo del tipo.
  useLayoutEffect(() => {
    focusField(fieldsFor(kind)[0]);
  }, [kind]);

  // El error dice en qué campo está: se enfoca y selecciona ese para retipear.
  useSignalEffect(() => {
    const error = cashErrorSignal.value;
    if (error !== null) {
      focusField(error.field);
    }
  });

  const handleContainerKeyDown = (event: TargetedKeyboardEvent<HTMLDivElement>) => {
    // Un botón enfocado con Tab se activa con Enter de forma nativa: no repetir el atajo.
    if (event.target instanceof HTMLButtonElement && event.key === 'Enter' && !event.ctrlKey) {
      return;
    }
    if (event.key === 'Enter' && event.ctrlKey) {
      event.preventDefault();
      void submitCash();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      if (conceptSuggestionsOpenSignal.value) {
        closeConceptSuggestions();
      } else {
        cancelCash();
      }
    }
  };

  const handleFieldKeyDown =
    (field: CashField) => (event: TargetedKeyboardEvent<HTMLInputElement>) => {
      if (event.altKey || event.ctrlKey || event.key === 'Escape') {
        return; // los maneja el contenedor
      }
      const suggestionsOpen =
        field === 'concept' &&
        conceptSuggestionsOpenSignal.value &&
        conceptSuggestionsSignal.value.length > 0;
      if (suggestionsOpen && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
        event.preventDefault();
        moveConceptSuggestion(event.key === 'ArrowDown' ? 1 : -1);
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        const selected = conceptSuggestionIndexSignal.value;
        if (suggestionsOpen && selected !== null) {
          // El primer Enter toma la sugerencia y deja verla; el segundo confirma.
          chooseConceptSuggestion(selected);
          return;
        }
        if (enterSubmits(field)) {
          closeConceptSuggestions();
          void submitCash();
        } else {
          focusField(moveCashField(kind, field, 1));
        }
        return;
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        if (field === 'concept') {
          closeConceptSuggestions();
        }
        focusField(moveCashField(kind, field, 1));
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        focusField(moveCashField(kind, field, -1));
        return;
      }
      if (field === 'counted' || field === 'amount') {
        remapDecimalKey(event);
      }
    };

  const handleInput = (field: CashField) => (event: TargetedEvent<HTMLInputElement>) => {
    updateCashField(field, event.currentTarget.value);
  };

  const fields = cashFieldsSignal.value;
  const balance = cashBalanceSignal.value;
  const error = cashErrorSignal.value;
  const difference =
    balance !== undefined && fields.counted.trim() !== ''
      ? countDifference(balance.balance, parseNonNegativeAmount(fields.counted))
      : undefined;
  const showSuggestions =
    kind !== 'count' &&
    conceptSuggestionsOpenSignal.value &&
    conceptSuggestionsSignal.value.length > 0;

  const renderInput = (field: CashField) => (
    <div key={field} style={{ position: 'relative' }}>
      <label style={fieldRowStyle}>
        <span>
          {FIELD_LABELS[field]}
          {field === 'description' && (
            <span style={{ color: 'var(--color-text-muted)' }}> (opcional)</span>
          )}
        </span>
        <input
          ref={(element) => {
            if (element === null) {
              fieldRefs.current.delete(field);
            } else {
              fieldRefs.current.set(field, element);
            }
          }}
          type="text"
          autocomplete="off"
          inputMode={field === 'counted' || field === 'amount' ? 'decimal' : undefined}
          aria-label={FIELD_LABELS[field]}
          value={fields[field]}
          onInput={handleInput(field)}
          onKeyDown={handleFieldKeyDown(field)}
          onFocus={field === 'concept' ? openConceptSuggestions : undefined}
          style={{
            ...(field === 'counted' || field === 'amount' ? amountInputStyle : inputStyle),
            borderColor: error?.field === field ? 'var(--color-danger)' : 'var(--color-border)',
          }}
        />
      </label>
      {field === 'concept' && showSuggestions && (
        <ul
          aria-label="Sugerencias"
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            width: scaledPx(280),
            zIndex: 1,
            margin: 0,
            padding: 'var(--space-1)',
            listStyle: 'none',
            maxHeight: '220px',
            overflowY: 'auto',
            background: 'var(--color-bg)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-card)',
          }}
        >
          {conceptSuggestionsSignal.value.map((concept, index) => (
            <li
              key={concept}
              ref={suggestionRowRef(index)}
              onClick={() => {
                chooseConceptSuggestion(index);
                focusField('concept');
              }}
              class="selectable-row"
              data-selected={index === conceptSuggestionIndexSignal.value ? '' : undefined}
              style={{
                padding: 'var(--space-1) var(--space-2)',
                borderRadius: 'var(--radius-md)',
                cursor: 'pointer',
              }}
            >
              {concept}
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  return (
    <div style={overlayStyle} onMouseDown={keepFocusOnMouseDown}>
      <div
        style={{ ...dialogStyle, borderTop: `4px solid ${KIND_COLORS[kind]}` }}
        onKeyDown={handleContainerKeyDown}
      >
        <h1 style={{ margin: 0, fontSize: 'var(--font-size-xl)', color: KIND_COLORS[kind] }}>
          {CASH_KIND_TITLES[kind]}
        </h1>

        {kind === 'count' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            <div style={fieldRowStyle}>
              <span>Esperado</span>
              <span style={{ fontFamily: 'var(--font-mono)' }}>
                {balance !== undefined ? formatCashAmount(balance.balance) : '…'}
              </span>
            </div>
            <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>
              {balance !== undefined
                ? describeLastCount(balance.lastCountAt, new Date().toISOString())
                : ''}
            </p>
            {renderInput('counted')}
            <p role="status" style={{ margin: 0, minHeight: '1.5em', textAlign: 'right' }}>
              {difference !== undefined ? describeDifference(difference) : ''}
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {fieldsFor(kind).map(renderInput)}
            {balance !== undefined &&
              exceedsBalance(kind, parseAmount(fields.amount), balance.balance) && (
                <p role="status" style={{ margin: 0, color: 'var(--color-warning)' }}>
                  El egreso supera el saldo esperado ({formatCashAmount(balance.balance)})
                </p>
              )}
          </div>
        )}

        <div style={{ minHeight: 'var(--space-8)' }}>
          {error !== null && (
            <p role="alert" style={{ margin: 0, color: 'var(--color-danger)' }}>
              {error.message}
            </p>
          )}
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 'var(--space-3)',
          }}
        >
          <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>{HINTS[kind]}</p>
          <div style={{ display: 'flex', gap: 'var(--space-2)', flexShrink: 0 }}>
            <button type="button" class="btn" onClick={cancelCash}>
              Cancelar (Esc)
            </button>
            <button type="button" class="btn btn-primary" onClick={() => void submitCash()}>
              Confirmar (Enter)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
