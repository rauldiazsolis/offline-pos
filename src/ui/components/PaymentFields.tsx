import type { JSX, RefObject, TargetedEvent, TargetedKeyboardEvent } from 'preact';
import type { MutableRef } from 'preact/hooks';
import type { PaymentMethod } from '../../domain/sale.ts';
import { parseNonNegativeAmount } from '../parse-amount.ts';
import { PAYMENT_METHOD_LABELS } from '../payment-labels.ts';
import { scaledPx } from '../text-scale.ts';

const fieldRowStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 'var(--space-3)',
};

const fieldInputStyle = {
  width: scaledPx(160),
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--font-size-base)',
  padding: 'var(--space-2)',
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--color-border)',
  background: 'var(--color-bg)',
  color: 'var(--color-text)',
  textAlign: 'right' as const,
};

/**
 * Un campo de monto por medio de pago, compartido entre Cobro (seis medios) y la cobranza sin
 * venta (cinco, sin cuenta corriente — #101). Solo marca un campo con texto que no parsea: nunca
 * bloquea el tipeo ni descarta el texto, la validación real pasa recién al confirmar.
 */
export function PaymentFields<M extends PaymentMethod>(props: {
  methods: readonly M[];
  buffers: Record<M, string>;
  isDisabled?: (method: M) => boolean;
  onInput: (method: M, value: string) => void;
  onKeyDown: (method: M, event: TargetedKeyboardEvent<HTMLInputElement>) => void;
  firstFieldRef: RefObject<HTMLInputElement>;
  fieldRefs: MutableRef<Map<M, HTMLInputElement>>;
}): JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      {props.methods.map((method, index) => {
        const disabled = props.isDisabled?.(method) ?? false;
        const raw = props.buffers[method];
        const isInvalid = raw.trim() !== '' && parseNonNegativeAmount(raw) === undefined;
        return (
          <label key={method} style={fieldRowStyle}>
            <span>{PAYMENT_METHOD_LABELS[method]}</span>
            <input
              ref={(element) => {
                if (index === 0) {
                  props.firstFieldRef.current = element;
                }
                if (element === null) {
                  props.fieldRefs.current.delete(method);
                } else {
                  props.fieldRefs.current.set(method, element);
                }
              }}
              type="text"
              inputMode="decimal"
              value={raw}
              onInput={(event: TargetedEvent<HTMLInputElement>) => {
                props.onInput(method, event.currentTarget.value);
              }}
              onKeyDown={(event) => {
                props.onKeyDown(method, event);
              }}
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
  );
}
