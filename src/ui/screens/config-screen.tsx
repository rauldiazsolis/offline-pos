import type { TargetedEvent, TargetedKeyboardEvent } from 'preact';
import { cancelConfigScreen, submitConfigStep } from '../keyboard/config-controller.ts';
import { useFocusOnMount } from '../hooks/use-focus-on-mount.ts';
import { useSelectOnErrorSignal } from '../hooks/use-select-on-error.ts';
import {
  configBaseUrlSignal,
  configBufferSignal,
  configErrorSignal,
  configStepSignal,
} from '../state/sync-config.ts';

const STEP_LABELS: Record<string, string> = {
  baseUrl: 'URL del sistema externo (ej. https://api.miempresa.com)',
  apiKey: 'API key (opcional — Enter en blanco para omitir)',
  locale: 'Locale (opcional, ej. es-AR — Enter en blanco usa el del navegador)',
};

/**
 * `/CONFIG`: mismo principio que el resto de las pantallas (un único input
 * siempre enfocado). Tres pasos secuenciales — `baseUrl`, `apiKey` y
 * `locale` — cada `Enter` confirma el paso actual y avanza (o guarda, en el
 * último).
 */
export function ConfigScreen() {
  const inputRef = useFocusOnMount<HTMLInputElement>();
  useSelectOnErrorSignal(inputRef, configErrorSignal);

  const handleInput = (event: TargetedEvent<HTMLInputElement>) => {
    configBufferSignal.value = event.currentTarget.value;
    configErrorSignal.value = null;
  };

  const handleKeyDown = (event: TargetedKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      cancelConfigScreen();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      submitConfigStep();
    }
  };

  const step = configStepSignal.value;

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
      <h1 style={{ margin: 0, fontSize: 'var(--font-size-xl)' }}>Configurar conexión</h1>

      {step !== 'baseUrl' && (
        <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>
          URL: {configBaseUrlSignal.value}
        </p>
      )}

      <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        {STEP_LABELS[step]}
        <input
          ref={inputRef}
          type="text"
          value={configBufferSignal.value}
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          aria-label={STEP_LABELS[step]}
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--font-size-lg)',
            padding: 'var(--space-3)',
            border: '1px solid var(--color-border)',
            background: 'var(--color-bg)',
            color: 'var(--color-text)',
          }}
        />
      </label>

      <div style={{ minHeight: 'var(--space-8)' }}>
        {configErrorSignal.value !== null && (
          <p role="alert" style={{ margin: 0, color: 'var(--color-danger)' }}>
            {configErrorSignal.value}
          </p>
        )}
      </div>
      <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>Esc para cancelar.</p>
    </div>
  );
}
