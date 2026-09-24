import { useSignalEffect } from '@preact/signals';
import type { TargetedEvent, TargetedKeyboardEvent } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';
import type { PaymentMethod } from '../../domain/sale.ts';
import { cartWarnings } from '../../domain/sale-warnings.ts';
import { tenderMode } from '../../domain/tender.ts';
import { calculateTotals } from '../../domain/totals.ts';
import { formatMoney } from '../format.ts';
import { formatWarning } from '../format-warning.ts';
import { useFocusOnMount } from '../hooks/use-focus-on-mount.ts';
import { keepFocusOnMouseDown } from '../hooks/use-mouse-keeps-focus.ts';
import {
  amountTendered,
  cancelCheckout,
  changePreview,
  moveCheckoutField,
  submitCheckout,
} from '../keyboard/checkout-controller.ts';
import { remapDecimalKey } from '../keyboard/decimal-key.ts';
import { parseNonNegativeAmount } from '../parse-amount.ts';
import { PAYMENT_METHOD_LABELS } from '../payment-labels.ts';
import { cartSignal } from '../state/cart.ts';
import { getCatalogRepository } from '../state/catalog.ts';
import { stockSnapshotSignal } from '../state/stock.ts';
import {
  checkoutBuffersSignal,
  checkoutErrorSignal,
  TENDERABLE_METHODS,
} from '../state/checkout.ts';
import { attachedCustomerSignal } from '../state/customer.ts';

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
  maxWidth: '720px',
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

const fieldInputStyle = {
  width: '160px',
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--font-size-base)',
  padding: 'var(--space-2)',
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--color-border)',
  background: 'var(--color-bg)',
  color: 'var(--color-text)',
  textAlign: 'right' as const,
};

const cardStyle = {
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  padding: 'var(--space-3)',
  display: 'flex',
  flexDirection: 'column' as const,
  gap: 'var(--space-2)',
};

const rowStyle = { display: 'flex', justifyContent: 'space-between' };

const sectionLabelStyle = {
  fontSize: 'var(--font-size-sm)',
  color: 'var(--color-text-muted)',
  textTransform: 'uppercase' as const,
  letterSpacing: '.04em',
};

/**
 * Pantalla de cobro (`/COBRAR`, `Ctrl+Enter` o Enter con la barra vacía) —
 * diálogo modal con un campo de monto simultáneo por medio de pago (issue
 * #55, sesión de brainstorming 2026-09-16). Efectivo arranca con el total
 * precargado y seleccionado (#99). Enter y ↓ pasan al campo siguiente, ↑ al
 * anterior, sin ciclar y salteando un campo deshabilitado; Ctrl+Enter
 * confirma el cobro completo, Esc cancela. La validación (falta cubrir el
 * total, un medio no-efectivo excedido) pasa recién al confirmar, nunca
 * mientras se tipea. Con total negativo trabaja en modo devolución: se tipea
 * en positivo cuánto se devuelve por medio, sin vuelto.
 */
export function CheckoutScreen() {
  const firstFieldRef = useFocusOnMount<HTMLInputElement>();
  const fieldRefs = useRef(new Map<PaymentMethod, HTMLInputElement>());

  // Efectivo viene con el total precargado (#99): seleccionado, así tipear
  // lo reemplaza sin borrar a mano.
  useLayoutEffect(() => {
    firstFieldRef.current?.select();
  }, [firstFieldRef]);

  const focusField = (target: PaymentMethod | undefined) => {
    if (target === undefined) {
      return;
    }
    const input = fieldRefs.current.get(target);
    input?.focus();
    input?.select();
  };

  // A diferencia del resto de la app (un único input, siempre el mismo),
  // acá hay 6 campos — un error tiene que seleccionar el que tenía el foco
  // en ese momento (para poder retipear rápido), no siempre el primero. Por
  // eso no usa `useSelectOnErrorSignal` (atado a un ref fijo): selecciona
  // `document.activeElement` tal cual está, sin moverlo.
  useSignalEffect(() => {
    if (checkoutErrorSignal.value !== null && document.activeElement instanceof HTMLInputElement) {
      document.activeElement.select();
    }
  });

  const handleKeyDown =
    (method: PaymentMethod) => (event: TargetedKeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        cancelCheckout();
        return;
      }
      if (event.key === 'Enter' && event.ctrlKey) {
        event.preventDefault();
        void submitCheckout();
        return;
      }
      if (event.key === 'Enter' || event.key === 'ArrowDown') {
        event.preventDefault();
        focusField(moveCheckoutField(method, 1));
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        focusField(moveCheckoutField(method, -1));
        return;
      }
      remapDecimalKey(event);
    };

  const handleInput = (method: PaymentMethod) => (event: TargetedEvent<HTMLInputElement>) => {
    checkoutBuffersSignal.value = {
      ...checkoutBuffersSignal.value,
      [method]: event.currentTarget.value,
    };
    checkoutErrorSignal.value = null;
  };

  const totals = calculateTotals(cartSignal.value);
  const paid = amountTendered();
  const change = changePreview();
  const hasCustomer = attachedCustomerSignal.value !== undefined;
  const mode = tenderMode(totals.total);
  const catalog = getCatalogRepository();
  // #99: advertir en vez de bloquear — la lista completa, sin pedir confirmación.
  const warnings = cartWarnings(cartSignal.value, {
    productById: (id) => catalog.getProduct(id),
    stockOf: (id) => stockSnapshotSignal.value.get(id),
    customer: attachedCustomerSignal.value,
  });

  return (
    <div style={overlayStyle} onMouseDown={keepFocusOnMouseDown}>
      <div style={dialogStyle}>
        {/* Devolución (#99): título, importe y confirmación en rojo, para que no se confunda con un cobro. */}
        <h1
          style={{
            margin: 0,
            fontSize: 'var(--font-size-xl)',
            ...(mode === 'refund' ? { color: 'var(--color-danger)' } : {}),
          }}
        >
          {mode === 'refund' ? `Devolver ${formatMoney(Math.abs(totals.total))}` : 'Cobrar venta'}
        </h1>

        {warnings.length > 0 && (
          <div
            role="status"
            style={{
              ...cardStyle,
              borderColor: 'var(--color-warning)',
              color: 'var(--color-warning)',
            }}
          >
            <div style={{ ...sectionLabelStyle, color: 'var(--color-warning)' }}>Advertencias</div>
            <ul style={{ margin: 0, paddingLeft: 'var(--space-4)' }}>
              {warnings.map((warning, index) => (
                <li key={index}>
                  {formatWarning(warning, (id) => catalog.getProduct(id)?.name ?? id)}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 'var(--space-4)' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {TENDERABLE_METHODS.map((method, index) => {
              const disabled = method === 'account' && !hasCustomer;
              const raw = checkoutBuffersSignal.value[method];
              // Solo marca el campo — nunca bloquea el tipeo ni descarta el
              // texto: la validación real (y el error) pasa recién al
              // confirmar (Ctrl+Enter).
              const isInvalid = raw.trim() !== '' && parseNonNegativeAmount(raw) === undefined;
              return (
                <label key={method} style={fieldRowStyle}>
                  <span>{PAYMENT_METHOD_LABELS[method]}</span>
                  <input
                    ref={(element) => {
                      if (index === 0) {
                        firstFieldRef.current = element;
                      }
                      if (element === null) {
                        fieldRefs.current.delete(method);
                      } else {
                        fieldRefs.current.set(method, element);
                      }
                    }}
                    type="text"
                    inputMode="decimal"
                    value={raw}
                    onInput={handleInput(method)}
                    onKeyDown={handleKeyDown(method)}
                    disabled={disabled}
                    placeholder="0,00"
                    aria-label={PAYMENT_METHOD_LABELS[method]}
                    style={{
                      ...fieldInputStyle,
                      opacity: disabled ? 0.5 : 1,
                      borderColor: isInvalid ? 'var(--color-danger)' : 'var(--color-border)',
                    }}
                  />
                </label>
              );
            })}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            <div style={cardStyle}>
              <div style={sectionLabelStyle}>
                {mode === 'refund' ? 'Total a devolver' : 'Total a pagar'}
              </div>
              <div
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 'var(--font-size-xl)',
                  fontWeight: 'bold',
                  ...(mode === 'refund' ? { color: 'var(--color-danger)' } : {}),
                }}
              >
                {formatMoney(Math.abs(totals.total))}
              </div>
              <div style={rowStyle}>
                <span>Cantidad de ítems</span>
                <span style={{ fontFamily: 'var(--font-mono)' }}>
                  {cartSignal.value.lines.length}
                </span>
              </div>
              <div style={rowStyle}>
                <span>{mode === 'refund' ? 'Suma devuelta' : 'Suma de pagos'}</span>
                <span style={{ fontFamily: 'var(--font-mono)' }}>{formatMoney(paid)}</span>
              </div>
            </div>
            {mode === 'charge' && (
              <div style={cardStyle}>
                <div style={sectionLabelStyle}>Vuelto</div>
                <div
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 'var(--font-size-xl)',
                    color: 'var(--color-success)',
                  }}
                >
                  {formatMoney(change)}
                </div>
              </div>
            )}
          </div>
        </div>

        <div style={{ minHeight: 'var(--space-8)' }}>
          {checkoutErrorSignal.value !== null && (
            <p role="alert" style={{ margin: 0, color: 'var(--color-danger)' }}>
              {checkoutErrorSignal.value}
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
            Enter o ↓ pasa al campo siguiente, ↑ al anterior. Ctrl+Enter confirma, Esc cancela.
            {!hasCustomer && ' Adjuntá un cliente con @ para habilitar cuenta corriente.'}
          </p>
          <div style={{ display: 'flex', gap: 'var(--space-2)', flexShrink: 0 }}>
            <button type="button" class="btn" onClick={cancelCheckout}>
              Cancelar (Esc)
            </button>
            <button
              type="button"
              class={mode === 'refund' ? 'btn btn-danger' : 'btn btn-primary'}
              onClick={() => void submitCheckout()}
            >
              {mode === 'refund'
                ? 'Confirmar devolución (Ctrl+Enter)'
                : 'Confirmar cobro (Ctrl+Enter)'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
