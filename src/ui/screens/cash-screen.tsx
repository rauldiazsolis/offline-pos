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
  setCashKind,
  submitCash,
  updateCashField,
} from '../keyboard/cash-controller.ts';
import {
  CASH_KIND_LABELS,
  CASH_KINDS,
  countDifference,
  describeDifference,
  describeLastCount,
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

const kindButtonStyle = (selected: boolean) => ({
  flex: 1,
  padding: 'var(--space-2)',
  borderRadius: 'var(--radius-md)',
  border: `1px solid ${selected ? 'var(--color-accent)' : 'var(--color-border)'}`,
  background: selected ? 'var(--color-accent)' : 'transparent',
  color: selected ? 'var(--color-chrome-bg)' : 'var(--color-text)',
  cursor: 'pointer',
});

const FIELD_LABELS: Record<CashField, string> = {
  counted: 'Contado',
  concept: 'Concepto',
  description: 'Descripción',
  amount: 'Monto',
};

const KIND_HOTKEYS: Record<CashKind, string> = { count: 'Alt+1', in: 'Alt+2', out: 'Alt+3' };

/**
 * `/CAJA` (Etapa 5 de #94, #100; criterios de #57): tarjeta centrada con un selector Arqueo /
 * Ingreso / Egreso (radio: Alt+1/2/3, click, o ↑/↓ con el foco en el selector) y todos los campos
 * del tipo visibles. El arqueo no es ciego: muestra el esperado y la diferencia en vivo. Enter y ↓
 * pasan al campo siguiente, ↑ al anterior; Ctrl+Enter confirma (Enter también en el arqueo) y Esc
 * cancela — salvo con las sugerencias de Concepto abiertas, que primero se cierran.
 */
export function CashScreen() {
  const fieldRefs = useRef(new Map<CashField, HTMLInputElement>());
  const kindRefs = useRef(new Map<CashKind, HTMLButtonElement>());
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

  // Al abrir y al cambiar de tipo, el foco va al primer campo del tipo.
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

  const chooseKind = (next: CashKind) => {
    setCashKind(next);
  };

  const handleContainerKeyDown = (event: TargetedKeyboardEvent<HTMLDivElement>) => {
    // Un botón enfocado con Tab se activa con Enter de forma nativa: no repetir el atajo.
    if (event.target instanceof HTMLButtonElement && event.key === 'Enter' && !event.ctrlKey) {
      return;
    }
    if (event.altKey && (event.key === '1' || event.key === '2' || event.key === '3')) {
      event.preventDefault();
      const next = CASH_KINDS[Number(event.key) - 1];
      if (next !== undefined) {
        chooseKind(next);
      }
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

  const handleKindKeyDown = (event: TargetedKeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
      return;
    }
    event.preventDefault();
    const index = CASH_KINDS.indexOf(kind) + (event.key === 'ArrowDown' ? 1 : -1);
    const next = CASH_KINDS[index];
    if (next !== undefined) {
      setCashKind(next);
      kindRefs.current.get(next)?.focus();
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
      if (event.key === 'Enter' && field === 'counted') {
        event.preventDefault();
        void submitCash();
        return;
      }
      if (event.key === 'Enter' || event.key === 'ArrowDown') {
        event.preventDefault();
        const selected = conceptSuggestionIndexSignal.value;
        if (suggestionsOpen && event.key === 'Enter' && selected !== null) {
          chooseConceptSuggestion(selected);
        } else if (field === 'concept') {
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
                focusField('description');
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
      <div style={dialogStyle} onKeyDown={handleContainerKeyDown}>
        <h1 style={{ margin: 0, fontSize: 'var(--font-size-xl)' }}>Caja</h1>

        <div
          role="radiogroup"
          aria-label="Tipo de movimiento"
          style={{ display: 'flex', gap: 'var(--space-2)' }}
        >
          {CASH_KINDS.map((option) => (
            <button
              key={option}
              ref={(element) => {
                if (element === null) {
                  kindRefs.current.delete(option);
                } else {
                  kindRefs.current.set(option, element);
                }
              }}
              type="button"
              role="radio"
              aria-checked={option === kind}
              tabIndex={option === kind ? 0 : -1}
              onClick={() => {
                chooseKind(option);
              }}
              onKeyDown={handleKindKeyDown}
              style={kindButtonStyle(option === kind)}
            >
              {CASH_KIND_LABELS[option]} ({KIND_HOTKEYS[option]})
            </button>
          ))}
        </div>

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
          <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>
            Alt+1/2/3 cambia el tipo. Enter o ↓ pasa al campo siguiente, ↑ al anterior. Ctrl+Enter
            confirma, Esc cancela.
          </p>
          <div style={{ display: 'flex', gap: 'var(--space-2)', flexShrink: 0 }}>
            <button type="button" class="btn" onClick={cancelCash}>
              Cancelar (Esc)
            </button>
            <button type="button" class="btn btn-primary" onClick={() => void submitCash()}>
              Confirmar (Ctrl+Enter)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
