import { useSignalEffect } from '@preact/signals';
import type { TargetedKeyboardEvent } from 'preact';
import { useRef } from 'preact/hooks';
import type { CollectionMethod } from '../../domain/customer-payment.ts';
import { COLLECTION_METHODS } from '../../domain/customer-payment.ts';
import { PaymentFields } from '../components/PaymentFields.tsx';
import { formatMoney } from '../format.ts';
import { formatBalance } from '../format-balance.ts';
import { useFocusOnMount } from '../hooks/use-focus-on-mount.ts';
import { keepFocusOnMouseDown } from '../hooks/use-mouse-keeps-focus.ts';
import {
  cancelCollection,
  collectionBalancePreview,
  collectionTotalPreview,
  moveCollectionField,
  submitCollection,
} from '../keyboard/collection-controller.ts';
import { remapDecimalKey } from '../keyboard/decimal-key.ts';
import { collectionBuffersSignal, collectionErrorSignal } from '../state/collection.ts';
import { attachedCustomerSignal } from '../state/customer.ts';
import { cardStyle, dialogStyle, overlayStyle, sectionLabelStyle } from './dialog-styles.ts';

/**
 * Cobranza sin venta (#101): Enter con la barra vacía, `/COBRAR` o Ctrl+Enter sin artículos y con
 * un cliente adjunto. El mismo diálogo que Cobro (mismos campos y teclas), con cinco medios —
 * sin Cuenta corriente —, todos vacíos y sin vuelto: lo que se ingresa es lo que se acredita, sin
 * tope (pagar de más deja saldo a favor). El saldo del cliente se ve en vivo, informativo.
 */
export function CollectionScreen() {
  const firstFieldRef = useFocusOnMount<HTMLInputElement>();
  const fieldRefs = useRef(new Map<CollectionMethod, HTMLInputElement>());

  const focusField = (target: CollectionMethod | undefined) => {
    if (target === undefined) {
      return;
    }
    const input = fieldRefs.current.get(target);
    input?.focus();
    input?.select();
  };

  // Mismo criterio que Cobro: un error selecciona el campo que tenía el foco.
  useSignalEffect(() => {
    if (
      collectionErrorSignal.value !== null &&
      document.activeElement instanceof HTMLInputElement
    ) {
      document.activeElement.select();
    }
  });

  const handleKeyDown = (
    method: CollectionMethod,
    event: TargetedKeyboardEvent<HTMLInputElement>,
  ): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      cancelCollection();
      return;
    }
    if (event.key === 'Enter' && event.ctrlKey) {
      event.preventDefault();
      void submitCollection();
      return;
    }
    if (event.key === 'Enter' || event.key === 'ArrowDown') {
      event.preventDefault();
      focusField(moveCollectionField(method, 1));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      focusField(moveCollectionField(method, -1));
      return;
    }
    remapDecimalKey(event);
  };

  const handleInput = (method: CollectionMethod, value: string): void => {
    collectionBuffersSignal.value = { ...collectionBuffersSignal.value, [method]: value };
    collectionErrorSignal.value = null;
  };

  const customer = attachedCustomerSignal.value;
  const total = collectionTotalPreview();
  const balance = collectionBalancePreview();

  return (
    <div style={overlayStyle} onMouseDown={keepFocusOnMouseDown}>
      <div style={dialogStyle}>
        <h1 style={{ margin: 0, fontSize: 'var(--font-size-xl)' }}>
          Cobranza a {customer?.name ?? ''}
        </h1>

        {customer?.blocked !== undefined && (
          <div
            role="status"
            style={{
              ...cardStyle,
              borderColor: 'var(--color-warning)',
              color: 'var(--color-warning)',
            }}
          >
            {`⚠ Bloqueado: ${customer.blocked.reason}`}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 'var(--space-4)' }}>
          <PaymentFields
            methods={COLLECTION_METHODS}
            buffers={collectionBuffersSignal.value}
            onInput={handleInput}
            onKeyDown={handleKeyDown}
            firstFieldRef={firstFieldRef}
            fieldRefs={fieldRefs}
          />

          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            <div style={cardStyle}>
              <div style={sectionLabelStyle}>Total de la cobranza</div>
              <div
                data-testid="collection-total"
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 'var(--font-size-xl)',
                  fontWeight: 'bold',
                }}
              >
                {formatMoney(total)}
              </div>
            </div>
            <div style={cardStyle}>
              <div style={sectionLabelStyle}>Saldo del cliente</div>
              <div>{`Saldo actual: ${formatBalance(balance.before)}`}</div>
              <div style={{ fontWeight: 'bold' }}>{`Después: ${formatBalance(balance.after)}`}</div>
            </div>
          </div>
        </div>

        <div style={{ minHeight: 'var(--space-8)' }}>
          {collectionErrorSignal.value !== null && (
            <p role="alert" style={{ margin: 0, color: 'var(--color-danger)' }}>
              {collectionErrorSignal.value}
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
            Enter o ↓ pasa al campo siguiente, ↑ al anterior. Ctrl+Enter confirma, Esc cancela. Sin
            vuelto: lo que se ingresa es lo que se acredita.
          </p>
          <div style={{ display: 'flex', gap: 'var(--space-2)', flexShrink: 0 }}>
            <button type="button" class="btn" onClick={cancelCollection}>
              Cancelar (Esc)
            </button>
            <button type="button" class="btn btn-primary" onClick={() => void submitCollection()}>
              Confirmar cobranza (Ctrl+Enter)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
