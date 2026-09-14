import type { TargetedEvent, TargetedKeyboardEvent } from 'preact';
import { useLayoutEffect } from 'preact/hooks';
import type { Payment } from '../../domain/sale.ts';
import { formatMoney } from '../format.ts';
import { useFocusOnMount } from '../hooks/use-focus-on-mount.ts';
import { useSelectOnErrorSignal } from '../hooks/use-select-on-error.ts';
import {
  cancelCashStep,
  loadCashScreen,
  submitCashStep,
  updateCashBuffer,
} from '../keyboard/cash-session-controller.ts';
import { parseAmount } from '../parse-amount.ts';
import {
  cashBufferSignal,
  cashErrorSignal,
  cashSessionSignal,
  cashStepSignal,
  cashSummarySignal,
} from '../state/cash-session.ts';

const PAYMENT_METHOD_LABELS: Record<Payment['method'], string> = {
  cash: 'Efectivo',
  card: 'Tarjeta',
  other: 'Otro',
  account: 'Cuenta corriente',
};

const cardStyle = {
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  boxShadow: 'var(--shadow-card)',
  padding: 'var(--space-3)',
  display: 'flex',
  flexDirection: 'column' as const,
  gap: 'var(--space-1)',
};

const rowStyle = { display: 'flex', justifyContent: 'space-between' };

const STEP_LABELS: Record<string, string> = {
  opening: 'Monto de apertura del turno',
  open: 'Efectivo contado para cerrar el turno',
  'confirming-close': '¿Cerrar el turno con este efectivo contado? Enter confirma, Esc vuelve a editar.',
  closed: 'Turno cerrado. Enter o Esc vuelve a la venta.',
};

/**
 * `/CAJA` (Fase 6): abre/cierra el turno de caja, con arqueo solo de
 * efectivo (decisión del usuario — tarjeta/cuenta corriente no tienen
 * equivalente físico para "contar"). Mismo principio de "un único input
 * siempre enfocado" que el resto de las pantallas: el `<input>` sigue
 * montado en los cuatro pasos (`readOnly` en `'confirming-close'`/
 * `'closed'`) para que `useFocusOnMount` (dispara solo al montar la
 * pantalla, no en cada cambio de paso) siga enfocando el mismo nodo sin
 * necesitar refocalizar a mano en cada transición.
 */
export function CashSessionScreen() {
  const inputRef = useFocusOnMount<HTMLInputElement>();
  useSelectOnErrorSignal(inputRef, cashErrorSignal);

  // Cargar el turno abierto (si hay uno) es una carga de datos al montar,
  // no algo ligado al foco — mismo criterio que VoidSaleScreen.
  useLayoutEffect(() => {
    void loadCashScreen();
  }, []);

  const handleInput = (event: TargetedEvent<HTMLInputElement>) => {
    updateCashBuffer(event.currentTarget.value);
  };

  const handleKeyDown = (event: TargetedKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      cancelCashStep();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      void submitCashStep();
    }
  };

  const step = cashStepSignal.value;
  const summary = cashSummarySignal.value;
  const session = cashSessionSignal.value;

  // En 'confirming-close' el cierre todavía no se persistió, así que
  // `summary.countedCash`/`difference` no están seteados aún — se
  // previsualiza con el monto tipeado. En 'closed' ya son los reales.
  const countedPreview =
    step === 'closed' ? summary?.countedCash : parseAmount(cashBufferSignal.value);
  const differencePreview =
    step === 'closed'
      ? summary?.difference
      : countedPreview !== undefined && summary !== undefined
        ? countedPreview - summary.expectedCash
        : undefined;
  const showArqueo = (step === 'confirming-close' || step === 'closed') && countedPreview !== undefined;

  return (
    <div
      style={{
        height: '100svh',
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
      <h1 style={{ margin: 0, fontSize: 'var(--font-size-xl)' }}>Caja</h1>

      {summary !== undefined && session !== undefined && (
        <div style={cardStyle}>
          <div style={rowStyle}>
            <span>Turno abierto</span>
            <span style={{ fontFamily: 'var(--font-mono)' }}>
              {new Date(session.openedAt).toLocaleString()}
            </span>
          </div>
          <div style={rowStyle}>
            <span>Apertura</span>
            <span style={{ fontFamily: 'var(--font-mono)' }}>
              {formatMoney(session.openingAmount)}
            </span>
          </div>
          <div style={rowStyle}>
            <span>Ventas</span>
            <span style={{ fontFamily: 'var(--font-mono)' }}>{summary.salesCount}</span>
          </div>
          {(Object.keys(summary.totalsByMethod) as Payment['method'][]).map((method) => (
            <div style={rowStyle} key={method}>
              <span>{PAYMENT_METHOD_LABELS[method]}</span>
              <span style={{ fontFamily: 'var(--font-mono)' }}>
                {formatMoney(summary.totalsByMethod[method])}
              </span>
            </div>
          ))}
          <div style={{ ...rowStyle, fontWeight: 'bold' }}>
            <span>Efectivo esperado</span>
            <span style={{ fontFamily: 'var(--font-mono)' }}>
              {formatMoney(summary.expectedCash)}
            </span>
          </div>
          {showArqueo && (
            <>
              <div style={rowStyle}>
                <span>Efectivo contado</span>
                <span style={{ fontFamily: 'var(--font-mono)' }}>{formatMoney(countedPreview)}</span>
              </div>
              <div
                style={{
                  ...rowStyle,
                  fontWeight: 'bold',
                  color:
                    (differencePreview ?? 0) < 0
                      ? 'var(--color-danger)'
                      : (differencePreview ?? 0) > 0
                        ? 'var(--color-accent)'
                        : 'var(--color-success)',
                }}
              >
                <span>Diferencia</span>
                <span style={{ fontFamily: 'var(--font-mono)' }}>
                  {formatMoney(differencePreview ?? 0)}
                </span>
              </div>
            </>
          )}
        </div>
      )}

      <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        {STEP_LABELS[step]}
        <input
          ref={inputRef}
          type="text"
          value={cashBufferSignal.value}
          readOnly={step === 'confirming-close' || step === 'closed'}
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          aria-label={STEP_LABELS[step]}
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--font-size-lg)',
            padding: 'var(--space-3)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--color-border)',
            background: 'var(--color-bg)',
            color: 'var(--color-text)',
          }}
        />
      </label>

      <div style={{ minHeight: 'var(--space-8)' }}>
        {cashErrorSignal.value !== null && (
          <p role="alert" style={{ margin: 0, color: 'var(--color-danger)' }}>
            {cashErrorSignal.value}
          </p>
        )}
      </div>
      <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>Esc para volver a la venta.</p>
    </div>
  );
}
