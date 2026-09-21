import type { TargetedEvent, TargetedKeyboardEvent } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';
import type { ConfigField } from '../../connectors/config-field.ts';
import type { LocalDataSummary } from '../../storage/local-data.ts';
import { CONNECTOR_TYPES, connectorFields } from '../../sync/connector-registry.ts';
import {
  backToEditing,
  cancelConfigScreen,
  confirmConfigChange,
  handleConfigEscape,
  setConfigField,
  setConfigLocale,
  setConfigType,
  submitConfig,
} from '../keyboard/config-controller.ts';
import {
  configConfirmationSignal,
  configErrorFieldSignal,
  configErrorSignal,
  configFieldValuesSignal,
  configLocaleSignal,
  configPhaseSignal,
  configTypeSignal,
  type ConfigPhase,
} from '../state/sync-config.ts';
import { connectionStateSignal } from '../state/sync.ts';

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
  outline: 'none',
};

const fieldStyle = { display: 'flex', flexDirection: 'column' as const, gap: 'var(--space-2)' };

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
  placeholder: 'es-AR',
};

function fieldLabel(field: ConfigField): string {
  return field.optional ? `${field.label} (opcional)` : field.label;
}

function plural(count: number, singular: string, pluralForm: string): string {
  return `${String(count)} ${count === 1 ? singular : pluralForm}`;
}

/** Lo que se perdería, en una línea: solo lo que existe. */
function describeLocalDataLoss(summary: LocalDataSummary): string {
  const parts: string[] = [];
  if (summary.sales > 0) parts.push(plural(summary.sales, 'venta', 'ventas'));
  if (summary.cashSessions > 0) {
    parts.push(plural(summary.cashSessions, 'turno de caja', 'turnos de caja'));
  }
  if (summary.draftCartLines > 0) parts.push('la venta en curso');
  if (summary.products > 0) parts.push(plural(summary.products, 'producto', 'productos'));
  if (summary.customers > 0) parts.push(plural(summary.customers, 'cliente', 'clientes'));
  return parts.join(' · ');
}

function ConfirmationCard({ summary }: { summary: LocalDataSummary }) {
  return (
    <div
      style={{
        border: '1px solid var(--color-danger)',
        borderRadius: 'var(--radius-md)',
        padding: 'var(--space-3)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-2)',
      }}
    >
      <p style={{ margin: 0, fontWeight: 'bold' }}>
        Cambiar de conexión borra los datos de esta terminal
      </p>
      <p style={{ margin: 0 }}>Se van a borrar: {describeLocalDataLoss(summary)}.</p>
      {summary.pendingOutbox > 0 && (
        <p style={{ margin: 0, fontWeight: 'bold', color: 'var(--color-danger)' }}>
          {plural(summary.pendingOutbox, 'evento sin enviar', 'eventos sin enviar')} al backend
          actual ({plural(summary.pendingSales, 'venta', 'ventas')}) se perderán.
        </p>
      )}
      <p style={{ margin: 0 }}>La caja empieza limpia con la conexión nueva.</p>
    </div>
  );
}

function footerHint(phase: ConfigPhase, required: boolean): string {
  switch (phase) {
    case 'confirming':
      return 'Enter borra y cambia de conexión · Esc vuelve a editar.';
    case 'probing':
      return 'Esc cancela la prueba.';
    case 'applying':
      return '';
    default:
      return required
        ? 'Tab para moverte entre campos, Ctrl+Enter para probar y guardar.'
        : 'Tab para moverte entre campos, Ctrl+Enter para probar y guardar, Esc para cancelar.';
  }
}

/**
 * `/CONFIG` como diálogo modal con fases (Etapa 2b, #76): editar → probar la
 * conexión → (confirmar el borrado de lo local, si cambia el origen y hay
 * datos del usuario) → aplicar. Tab/Shift+Tab (nativo) navega, Ctrl+Enter
 * prueba y guarda todo junto, Esc según la fase (ver `handleConfigEscape`);
 * Enter solo confirma el borrado en la fase de confirmación. Los atajos se
 * atienden en el contenedor (los eventos suben desde los campos), así siguen
 * llegando aunque el foco pase al contenedor en las fases sin campos
 * editables. Con la conexión todavía no activa es el **modo requerido**: no
 * hay "Cancelar" ni salida hasta tener una conexión probada.
 */
export function ConfigScreen() {
  const typeRef = useRef<HTMLSelectElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const phase = configPhaseSignal.value;
  const required = connectionStateSignal.value !== 'active';
  const errorField = configErrorFieldSignal.value;
  const error = configErrorSignal.value;
  const type = configTypeSignal.value;
  const editing = phase === 'editing';

  // Foco: editando va al selector; en las demás fases al contenedor, para que
  // Esc/Enter sigan llegando aunque los campos queden de solo lectura.
  // `useLayoutEffect` (no `useSignalEffect`, que corre diferido y dejó una
  // ventana de carrera en la Etapa 2).
  useLayoutEffect(() => {
    if (phase === 'editing') {
      typeRef.current?.focus();
    } else {
      dialogRef.current?.focus();
    }
  }, [phase]);

  // Un error apunta a un campo concreto: enfocarlo y seleccionarlo permite
  // retipear de una. Declarado después del efecto de fase: si cambian juntos, gana este.
  useLayoutEffect(() => {
    if (errorField === null || error === null) {
      return;
    }
    const input = dialogRef.current?.querySelector<HTMLInputElement>(
      `[data-config-field="${errorField}"]`,
    );
    input?.focus();
    input?.select();
  }, [errorField, error]);

  const handleKeyDown = (event: TargetedKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      handleConfigEscape();
      return;
    }
    if (event.key === 'Enter' && event.ctrlKey && phase === 'editing') {
      event.preventDefault();
      void submitConfig();
      return;
    }
    if (event.key === 'Enter' && phase === 'confirming') {
      event.preventDefault();
      void confirmConfigChange();
    }
  };

  const handleTypeChange = (event: TargetedEvent<HTMLSelectElement>) => {
    const chosen = CONNECTOR_TYPES.find((info) => info.type === event.currentTarget.value);
    setConfigType(chosen?.type ?? null);
  };

  const values = type === null ? undefined : configFieldValuesSignal.value[type];
  const visibleFields = type === null ? [] : [...connectorFields(type), LOCALE_FIELD];
  const confirmation = configConfirmationSignal.value;

  return (
    <div style={overlayStyle}>
      <div ref={dialogRef} tabIndex={-1} onKeyDown={handleKeyDown} style={dialogStyle}>
        <h1 style={{ margin: 0, fontSize: 'var(--font-size-xl)' }}>Configurar conexión</h1>
        {required && (
          <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>
            Configurá y probá la conexión para empezar.
          </p>
        )}

        {phase === 'confirming' && confirmation !== null ? (
          <ConfirmationCard summary={confirmation} />
        ) : (
          <>
            <label style={fieldStyle}>
              <span>Tipo de conexión</span>
              <select
                ref={typeRef}
                value={type ?? ''}
                onChange={handleTypeChange}
                disabled={!editing}
                aria-label="Tipo de conexión"
                style={controlStyle}
              >
                <option value="">Elegí un tipo de conexión…</option>
                {CONNECTOR_TYPES.map((info) => (
                  <option key={info.type} value={info.type}>
                    {info.label}
                  </option>
                ))}
              </select>
            </label>

            {visibleFields.map((field) => {
              const isLocale = field.key === 'locale';
              const value = isLocale ? configLocaleSignal.value : (values?.[field.key] ?? '');
              return (
                <label key={`${type ?? ''}:${field.key}`} style={fieldStyle}>
                  <span>{fieldLabel(field)}</span>
                  <input
                    type="text"
                    value={value}
                    readOnly={!editing}
                    placeholder={field.placeholder}
                    onInput={(event) => {
                      if (isLocale) {
                        setConfigLocale(event.currentTarget.value);
                      } else {
                        setConfigField(field.key, event.currentTarget.value);
                      }
                    }}
                    data-config-field={field.key}
                    aria-label={fieldLabel(field)}
                    style={{
                      ...controlStyle,
                      borderColor:
                        errorField === field.key ? 'var(--color-danger)' : 'var(--color-border)',
                    }}
                  />
                </label>
              );
            })}
          </>
        )}

        <div style={{ minHeight: 'var(--space-8)' }}>
          {phase === 'probing' && (
            <p role="status" style={{ margin: 0 }}>
              Probando conexión…
            </p>
          )}
          {phase === 'applying' && (
            <p role="status" style={{ margin: 0 }}>
              Aplicando conexión…
            </p>
          )}
          {editing && error !== null && (
            <p role="alert" style={{ margin: 0, color: 'var(--color-danger)' }}>
              {error}
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
            {footerHint(phase, required)}
          </p>
          <div style={{ display: 'flex', gap: 'var(--space-2)', flexShrink: 0 }}>
            {phase === 'confirming' ? (
              <>
                <button type="button" onClick={backToEditing} style={buttonStyle}>
                  Volver
                </button>
                <button
                  type="button"
                  onClick={() => void confirmConfigChange()}
                  style={buttonStyle}
                >
                  Borrar y cambiar
                </button>
              </>
            ) : (
              <>
                {!required && (
                  <button
                    type="button"
                    onClick={cancelConfigScreen}
                    disabled={!editing}
                    style={buttonStyle}
                  >
                    Cancelar
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void submitConfig()}
                  disabled={!editing}
                  style={buttonStyle}
                >
                  Probar y guardar
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
