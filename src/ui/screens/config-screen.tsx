import { useSignalEffect } from '@preact/signals';
import type { TargetedEvent, TargetedKeyboardEvent } from 'preact';
import { useRef } from 'preact/hooks';
import type { ConfigField } from '../../connectors/config-field.ts';
import { CONNECTOR_TYPES, connectorFields } from '../../sync/connector-registry.ts';
import { useFocusOnMount } from '../hooks/use-focus-on-mount.ts';
import {
  cancelConfigScreen,
  setConfigField,
  setConfigLocale,
  setConfigType,
  submitConfig,
} from '../keyboard/config-controller.ts';
import {
  configErrorFieldSignal,
  configErrorSignal,
  configFieldValuesSignal,
  configLocaleSignal,
  configTypeSignal,
} from '../state/sync-config.ts';

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
  maxWidth: '560px',
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

const fieldStyle = {
  display: 'flex',
  flexDirection: 'column' as const,
  gap: 'var(--space-2)',
};

const controlStyle = {
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--font-size-base)',
  padding: 'var(--space-2)',
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--color-border)',
  background: 'var(--color-bg)',
  color: 'var(--color-text)',
};

const buttonStyle = {
  padding: 'var(--space-2) var(--space-3)',
  borderRadius: 'var(--radius-md)',
  whiteSpace: 'nowrap' as const,
};

/** `locale` es config de terminal, no de un conector: vive aparte y va siempre al final. */
const LOCALE_FIELD: ConfigField = {
  key: 'locale',
  label: 'Locale (ej. es-AR — en blanco usa el del navegador)',
  optional: true,
};

function fieldLabel(field: ConfigField): string {
  return field.optional ? `${field.label} (opcional)` : field.label;
}

/**
 * `/CONFIG` como diálogo modal (#68, cierra #56): mismo chrome que Cobro
 * (#55) — tarjeta centrada sobre un overlay, todos los campos visibles a la
 * vez. Tab/Shift+Tab (nativo) navega entre ellos, Ctrl+Enter valida y guarda
 * todo junto, Esc cancela; Enter solo no hace nada. El selector de tipo de
 * conector es el primer campo y nunca se oculta: cambiarlo intercambia en el
 * acto los campos específicos de abajo (cada conector declara los suyos en
 * `connectors/<tipo>/config.ts`), y `locale` queda siempre al final.
 */
export function ConfigScreen() {
  const typeRef = useFocusOnMount<HTMLSelectElement>();
  const dialogRef = useRef<HTMLDivElement>(null);

  // Un error apunta a un campo concreto: enfocarlo y seleccionarlo permite
  // retipear de una (mismo criterio que Cobro con `select()`).
  useSignalEffect(() => {
    const key = configErrorFieldSignal.value;
    if (key === null || configErrorSignal.value === null) {
      return;
    }
    const input = dialogRef.current?.querySelector<HTMLInputElement>(
      `[data-config-field="${key}"]`,
    );
    input?.focus();
    input?.select();
  });

  const handleKeyDown = (event: TargetedKeyboardEvent<HTMLInputElement | HTMLSelectElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      cancelConfigScreen();
      return;
    }
    if (event.key === 'Enter' && event.ctrlKey) {
      event.preventDefault();
      submitConfig();
    }
  };

  const handleTypeChange = (event: TargetedEvent<HTMLSelectElement>) => {
    const chosen = CONNECTOR_TYPES.find((info) => info.type === event.currentTarget.value);
    if (chosen !== undefined) {
      setConfigType(chosen.type);
    }
  };

  const type = configTypeSignal.value;
  const values = configFieldValuesSignal.value[type];
  const visibleFields = [...connectorFields(type), LOCALE_FIELD];

  return (
    <div style={overlayStyle}>
      <div ref={dialogRef} style={dialogStyle}>
        <h1 style={{ margin: 0, fontSize: 'var(--font-size-xl)' }}>Configurar conexión</h1>

        <label style={fieldStyle}>
          <span>Tipo de conexión</span>
          <select
            ref={typeRef}
            value={type}
            onChange={handleTypeChange}
            onKeyDown={handleKeyDown}
            aria-label="Tipo de conexión"
            style={controlStyle}
          >
            {CONNECTOR_TYPES.map((info) => (
              <option key={info.type} value={info.type}>
                {info.label}
              </option>
            ))}
          </select>
        </label>

        {visibleFields.map((field) => {
          const isLocale = field.key === 'locale';
          const value = isLocale ? configLocaleSignal.value : (values[field.key] ?? '');
          const isInvalid = configErrorFieldSignal.value === field.key;
          return (
            <label key={`${type}:${field.key}`} style={fieldStyle}>
              <span>{fieldLabel(field)}</span>
              <input
                type="text"
                value={value}
                onInput={(event) => {
                  if (isLocale) {
                    setConfigLocale(event.currentTarget.value);
                  } else {
                    setConfigField(field.key, event.currentTarget.value);
                  }
                }}
                onKeyDown={handleKeyDown}
                data-config-field={field.key}
                aria-label={fieldLabel(field)}
                style={{
                  ...controlStyle,
                  borderColor: isInvalid ? 'var(--color-danger)' : 'var(--color-border)',
                }}
              />
            </label>
          );
        })}

        <div style={{ minHeight: 'var(--space-8)' }}>
          {configErrorSignal.value !== null && (
            <p role="alert" style={{ margin: 0, color: 'var(--color-danger)' }}>
              {configErrorSignal.value}
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
            Tab para moverte entre campos, Ctrl+Enter para guardar, Esc para cancelar.
          </p>
          <div style={{ display: 'flex', gap: 'var(--space-2)', flexShrink: 0 }}>
            <button type="button" onClick={cancelConfigScreen} style={buttonStyle}>
              Cancelar
            </button>
            <button type="button" onClick={submitConfig} style={buttonStyle}>
              Guardar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
