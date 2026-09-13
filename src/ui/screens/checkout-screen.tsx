import { useSignalEffect } from '@preact/signals';
import { useLayoutEffect, useRef } from 'preact/hooks';
import type { TargetedEvent, TargetedKeyboardEvent } from 'preact';
import { calculateTotals } from '../../domain/totals.ts';
import {
  amountPaid,
  cancelCheckout,
  remainingToPay,
  submitCheckout,
} from '../keyboard/checkout-controller.ts';
import { formatMoney } from '../format.ts';
import { cartSignal } from '../state/cart.ts';
import {
  checkoutBufferSignal,
  checkoutErrorSignal,
  checkoutPaymentsSignal,
} from '../state/checkout.ts';
import { attachedCustomerSignal } from '../state/customer.ts';

/**
 * Pantalla de cobro (`/COBRAR` o `Ctrl+Enter`). Un único input, igual que la
 * barra de comandos: cada monto + Enter agrega un pago en efectivo; al
 * cubrir el total, el mismo Enter cierra la venta (ver "UX keyboard-first"
 * en CLAUDE.md).
 */
export function CheckoutScreen() {
  const inputRef = useRef<HTMLInputElement>(null);

  useLayoutEffect(() => {
    inputRef.current?.focus();
  }, []);

  useSignalEffect(() => {
    if (checkoutErrorSignal.value !== null) {
      inputRef.current?.select();
    }
  });

  const handleInput = (event: TargetedEvent<HTMLInputElement>) => {
    checkoutBufferSignal.value = event.currentTarget.value;
    checkoutErrorSignal.value = null;
  };

  const handleKeyDown = (event: TargetedKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      cancelCheckout();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      void submitCheckout();
    }
  };

  const totals = calculateTotals(cartSignal.value);
  const paid = amountPaid();
  const remaining = remainingToPay();

  return (
    <div
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
      <h1 style={{ margin: 0, fontSize: 'var(--font-size-xl)' }}>Cobrar</h1>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: 'var(--font-size-lg)',
        }}
      >
        <span>Total</span>
        <span>{formatMoney(totals.total)}</span>
      </div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          color: 'var(--color-text-muted)',
        }}
      >
        <span>Pagado</span>
        <span>{formatMoney(paid)}</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold' }}>
        <span>{remaining > 0 ? 'Falta' : 'Vuelto'}</span>
        <span>{formatMoney(Math.abs(remaining))}</span>
      </div>

      {checkoutPaymentsSignal.value.length > 0 && (
        <ul style={{ margin: 0, padding: 0, listStyle: 'none', color: 'var(--color-text-muted)' }}>
          {checkoutPaymentsSignal.value.map((payment, index) => (
            <li key={index}>
              {payment.method === 'account' ? 'Pago a cuenta corriente' : 'Pago en efectivo'}:{' '}
              {formatMoney(payment.amount)}
            </li>
          ))}
        </ul>
      )}

      <input
        ref={inputRef}
        type="text"
        value={checkoutBufferSignal.value}
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        aria-label="Monto a cobrar"
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--font-size-lg)',
          padding: 'var(--space-3)',
          border: '1px solid var(--color-border)',
          background: 'var(--color-bg)',
          color: 'var(--color-text)',
        }}
      />
      <div style={{ minHeight: 'var(--space-8)' }}>
        {checkoutErrorSignal.value !== null && (
          <p role="alert" style={{ margin: 0, color: 'var(--color-danger)' }}>
            {checkoutErrorSignal.value}
          </p>
        )}
      </div>
      <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>
        Esc para volver a la venta sin cobrar.
        {attachedCustomerSignal.value !== undefined && ' "/CUENTA" para cobrar a cuenta corriente.'}
      </p>
    </div>
  );
}
