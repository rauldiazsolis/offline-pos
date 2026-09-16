import { useSignalEffect } from '@preact/signals';
import type { TargetedEvent, TargetedKeyboardEvent } from 'preact';
import type { PaymentMethod } from '../../domain/sale.ts';
import { calculateTotals } from '../../domain/totals.ts';
import { formatMoney } from '../format.ts';
import { useFocusOnMount } from '../hooks/use-focus-on-mount.ts';
import { amountTendered, cancelCheckout, changePreview, submitCheckout } from '../keyboard/checkout-controller.ts';
import { parseNonNegativeAmount } from '../parse-amount.ts';
import { PAYMENT_METHOD_LABELS } from '../payment-labels.ts';
import { cartSignal } from '../state/cart.ts';
import { checkoutBuffersSignal, checkoutErrorSignal, TENDERABLE_METHODS } from '../state/checkout.ts';
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
 * Pantalla de cobro (`/COBRAR` o `Ctrl+Enter`) — diálogo modal con un campo
 * de monto simultáneo por medio de pago (issue #55, sesión de brainstorming
 * 2026-09-16). A diferencia del resto de la app, acá Enter solo no confirma
 * nada (moverse entre campos con Tab es el flujo normal de un formulario
 * con varios campos) — Ctrl+Enter confirma el cobro completo, Esc cancela.
 * La validación (falta cubrir el total, un medio no-efectivo excedido) pasa
 * recién al confirmar, nunca mientras se tipea.
 */
export function CheckoutScreen() {
  const firstFieldRef = useFocusOnMount<HTMLInputElement>();

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

  const handleKeyDown = (event: TargetedKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      cancelCheckout();
      return;
    }
    if (event.key === 'Enter' && event.ctrlKey) {
      event.preventDefault();
      void submitCheckout();
    }
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

  return (
    <div style={overlayStyle}>
      <div style={dialogStyle}>
        <h1 style={{ margin: 0, fontSize: 'var(--font-size-xl)' }}>Cobrar venta</h1>

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
                    {...(index === 0 ? { ref: firstFieldRef } : {})}
                    type="text"
                    inputMode="decimal"
                    value={raw}
                    onInput={handleInput(method)}
                    onKeyDown={handleKeyDown}
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
              <div style={sectionLabelStyle}>Total a pagar</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-xl)', fontWeight: 'bold' }}>
                {formatMoney(totals.total)}
              </div>
              <div style={rowStyle}>
                <span>Cantidad de ítems</span>
                <span style={{ fontFamily: 'var(--font-mono)' }}>{cartSignal.value.lines.length}</span>
              </div>
              <div style={rowStyle}>
                <span>Suma de pagos</span>
                <span style={{ fontFamily: 'var(--font-mono)' }}>{formatMoney(paid)}</span>
              </div>
            </div>
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
          </div>
        </div>

        <div style={{ minHeight: 'var(--space-8)' }}>
          {checkoutErrorSignal.value !== null && (
            <p role="alert" style={{ margin: 0, color: 'var(--color-danger)' }}>
              {checkoutErrorSignal.value}
            </p>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>
            Ctrl+Enter para confirmar, Esc para cancelar.
            {!hasCustomer && ' Adjuntá un cliente con @ para habilitar cuenta corriente.'}
          </p>
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <button
              type="button"
              onClick={cancelCheckout}
              style={{ padding: 'var(--space-2) var(--space-3)', borderRadius: 'var(--radius-md)' }}
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => void submitCheckout()}
              style={{ padding: 'var(--space-2) var(--space-3)', borderRadius: 'var(--radius-md)' }}
            >
              Confirmar Cobro
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
