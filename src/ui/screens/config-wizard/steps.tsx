import { useEffect, useState } from 'preact/hooks';
import type { ConfigField } from '../../../connectors/config-field.ts';
import type { LocalDataSummary } from '../../../storage/local-data.ts';
import { PROBE_TIMEOUT_MS } from '../../../sync/connection.ts';
import {
  CONNECTOR_TYPES,
  connectorFields,
  connectorInfo,
} from '../../../sync/connector-registry.ts';
import {
  chooseConnectorType,
  setConfigField,
  setConfigTerminalField,
  setLocalChoice,
} from '../../keyboard/config-controller.ts';
import {
  WIZARD_STEPS,
  WIZARD_STEP_TITLES,
  type WizardModel,
  type WizardStepId,
} from '../../keyboard/config-wizard-model.ts';
import {
  configErrorFieldSignal,
  configErrorSignal,
  configFieldValuesSignal,
  configTerminalSignal,
  configTypeSignal,
  identityResetSignal,
  localChoiceSignal,
  localDataSignal,
  probeOutcomeSignal,
  probeProgressSignal,
  savedConfigSignal,
  wipeSummarySignal,
  wizardAsyncSignal,
  type TerminalFieldKey,
} from '../../state/sync-config.ts';
import { Spinner } from '../../components/Spinner.tsx';
import { describeLocalDataLoss, formHost, plural, savedHost, stepSummary } from './summary.ts';

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

const paragraph = { margin: 0 };
const muted = { margin: 0, color: 'var(--color-text-muted)' };

const optionStyle = (selected: boolean) => ({
  display: 'flex',
  flexDirection: 'column' as const,
  gap: 'var(--space-1)',
  textAlign: 'left' as const,
  padding: 'var(--space-3)',
  borderRadius: 'var(--radius-md)',
  border: `${selected ? '2px' : '1px'} solid ${selected ? 'var(--color-accent)' : 'var(--color-border)'}`,
  background: selected ? 'var(--color-surface)' : 'var(--color-bg)',
  color: 'var(--color-text)',
  fontFamily: 'var(--font-sans)',
  fontSize: 'var(--font-size-base)',
  cursor: 'pointer',
});

const statusStyle = {
  margin: 0,
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-2)',
};

/** Aviso destacado dentro de un paso (identidad perdida, qué se va a borrar). */
const noticeStyle = (color: string) => ({
  border: `1px solid ${color}`,
  borderRadius: 'var(--radius-md)',
  padding: 'var(--space-3)',
  display: 'flex',
  flexDirection: 'column' as const,
  gap: 'var(--space-2)',
});

const TERMINAL_FIELDS: (ConfigField & { key: TerminalFieldKey })[] = [
  { key: 'branch', label: 'Sucursal', optional: false, placeholder: 'Casa central' },
  { key: 'pointOfSale', label: 'Punto de venta', optional: false, placeholder: 'Caja 1' },
  { key: 'locale', label: 'Locale', optional: true, placeholder: 'es-AR' },
];

export function fieldLabel(field: ConfigField): string {
  return field.optional ? `${field.label} (opcional)` : field.label;
}

function TextField(props: {
  field: ConfigField;
  value: string;
  autofocus: boolean;
  onInput: (value: string) => void;
  hint?: string;
}) {
  const hasError = configErrorFieldSignal.value === props.field.key;
  return (
    <label style={fieldStyle}>
      <span>{fieldLabel(props.field)}</span>
      <input
        type="text"
        value={props.value}
        placeholder={props.field.placeholder}
        onInput={(event) => {
          props.onInput(event.currentTarget.value);
        }}
        data-config-field={props.field.key}
        data-step-autofocus={props.autofocus ? '' : undefined}
        aria-label={fieldLabel(props.field)}
        style={{
          ...controlStyle,
          borderColor: hasError ? 'var(--color-danger)' : 'var(--color-border)',
        }}
      />
      {props.hint !== undefined && <span style={muted}>{props.hint}</span>}
    </label>
  );
}

function TerminalStep() {
  const values = configTerminalSignal.value;
  return (
    <>
      {identityResetSignal.value && (
        <div style={noticeStyle('var(--color-danger)')}>
          <p style={{ ...paragraph, fontWeight: 'bold' }}>
            Esta terminal no tenía identidad: se reinició con datos vacíos.
          </p>
          <p style={paragraph}>Revisá la configuración y volvé a probar la conexión.</p>
        </div>
      )}
      <p style={muted}>
        Sucursal y punto de venta identifican a esta terminal en cada venta que envía.
      </p>
      {TERMINAL_FIELDS.map((field, index) => (
        <TextField
          key={field.key}
          field={field}
          value={values[field.key]}
          autofocus={index === 0}
          onInput={(value) => {
            setConfigTerminalField(field.key, value);
          }}
          {...(field.key === 'locale'
            ? { hint: 'En blanco usa el del navegador (formato de montos y fechas).' }
            : {})}
        />
      ))}
    </>
  );
}

function TypeStep() {
  const selected = configTypeSignal.value;
  return (
    <div
      role="group"
      aria-label="Tipo de conexión"
      tabIndex={-1}
      data-step-autofocus=""
      style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', outline: 'none' }}
    >
      {CONNECTOR_TYPES.map((info) => (
        <button
          key={info.type}
          type="button"
          class="wizard-option"
          aria-pressed={selected === info.type}
          onClick={() => {
            chooseConnectorType(info.type);
          }}
          style={optionStyle(selected === info.type)}
        >
          <strong>{info.label}</strong>
          <span style={{ color: 'var(--color-text-muted)' }}>{info.description}</span>
        </button>
      ))}
    </div>
  );
}

function ConnectorStep() {
  const type = configTypeSignal.value;
  if (type === null) {
    return <p style={muted}>Primero elegí un tipo de conexión.</p>;
  }
  const values = configFieldValuesSignal.value[type];
  return (
    <>
      {connectorFields(type).map((field, index) => (
        <TextField
          key={`${type}:${field.key}`}
          field={field}
          value={values[field.key] ?? ''}
          autofocus={index === 0}
          onInput={(value) => {
            setConfigField(field.key, value);
          }}
        />
      ))}
      <div>
        <p style={{ ...paragraph, fontWeight: 'bold' }}>Cómo conseguir estos datos</p>
        <ol style={{ margin: 'var(--space-2) 0 0', paddingLeft: 'var(--space-6)' }}>
          {connectorInfo(type).setupHelp.map((line) => (
            <li key={line} style={{ marginBottom: 'var(--space-1)' }}>
              {line}
            </li>
          ))}
        </ol>
      </div>
    </>
  );
}

/** Segundos desde `startedAt`, refrescados varias veces por segundo mientras el paso está a la vista. */
function useElapsedSeconds(startedAt: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 250);
    return () => {
      clearInterval(timer);
    };
  }, []);
  return Math.max(0, Math.floor((now - startedAt) / 1000));
}

function ProbeWaiting(props: { stage: 'waiting-lock' | 'pulling'; startedAt: number }) {
  const seconds = useElapsedSeconds(props.startedAt);
  const text =
    props.stage === 'waiting-lock'
      ? 'Esperando que termine una sincronización en curso…'
      : `Pidiendo productos, stock y clientes a ${formHost()}…`;
  return (
    <>
      <p role="status" style={statusStyle}>
        <Spinner />
        <span>
          {text} · {String(seconds)} s (máx. {String(PROBE_TIMEOUT_MS / 1000)} s)
        </span>
      </p>
      {configTypeSignal.value === 'google-sheets' && seconds >= 3 && (
        <p style={muted}>Google Sheets suele tardar entre 5 y 20 segundos.</p>
      )}
    </>
  );
}

function ProbeStep({ model }: { model: WizardModel }) {
  const progress = probeProgressSignal.value;
  if (wizardAsyncSignal.value === 'probing' && progress !== null) {
    return <ProbeWaiting stage={progress.stage} startedAt={progress.startedAt} />;
  }
  const outcome = probeOutcomeSignal.value;
  if (outcome === null || outcome.key !== model.connectionKey) {
    return <p style={muted}>Enter prueba la conexión con los datos cargados.</p>;
  }
  switch (outcome.status) {
    case 'ok':
      return (
        <p role="status" style={{ ...paragraph, color: 'var(--color-success)' }}>
          Conexión OK: {plural(outcome.products, 'producto', 'productos')},{' '}
          {plural(outcome.customers, 'cliente', 'clientes')}.
        </p>
      );
    case 'failed':
      return (
        <p role="alert" style={{ ...paragraph, color: 'var(--color-danger)' }}>
          {outcome.message}
        </p>
      );
    case 'cancelled':
      return <p style={paragraph}>Prueba cancelada.</p>;
  }
}

function WipeConfirmation({ summary }: { summary: LocalDataSummary }) {
  return (
    <div style={noticeStyle('var(--color-danger)')}>
      <p style={{ ...paragraph, fontWeight: 'bold' }}>
        Cambiar de conexión borrando los datos de esta terminal
      </p>
      <p style={paragraph}>Se van a borrar: {describeLocalDataLoss(summary)}.</p>
      {summary.pendingOutbox > 0 && (
        <p style={{ ...paragraph, fontWeight: 'bold', color: 'var(--color-danger)' }}>
          {plural(summary.pendingOutbox, 'evento sin enviar', 'eventos sin enviar')} a la conexión
          actual ({plural(summary.pendingSales, 'venta', 'ventas')}) se perderán.
        </p>
      )}
      <p style={paragraph}>La caja empieza limpia con la conexión nueva.</p>
    </div>
  );
}

function LocalDataStep({ model }: { model: WizardModel }) {
  const async = wizardAsyncSignal.value;
  const pending = localDataSignal.value?.pendingOutbox ?? 0;
  if (async === 'flushing') {
    const current = savedConfigSignal.value;
    return (
      <p role="status" style={statusStyle}>
        <Spinner />
        <span>
          Enviando {plural(pending, 'evento pendiente', 'eventos pendientes')}
          {current === undefined ? '' : ` a ${savedHost(current)}`}…
        </span>
      </p>
    );
  }
  const wipeSummary = wipeSummarySignal.value;
  if (async === 'confirming-wipe' && wipeSummary !== null) {
    return <WipeConfirmation summary={wipeSummary} />;
  }
  const choice = localChoiceSignal.value;
  return (
    <>
      <p style={muted}>
        Esta terminal tiene ventas o movimientos propios. ¿Qué hacemos con ellos al cambiar de
        conexión?
      </p>
      <div
        role="group"
        aria-label="Datos locales"
        tabIndex={-1}
        data-step-autofocus=""
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-2)',
          outline: 'none',
        }}
      >
        <button
          type="button"
          class="wizard-option"
          aria-pressed={choice === 'keep'}
          aria-label="Mantener los datos locales"
          onClick={() => {
            setLocalChoice('keep');
          }}
          style={optionStyle(choice === 'keep')}
        >
          <strong>Mantener</strong>
          <span style={{ color: 'var(--color-text-muted)' }}>
            Las ventas, turnos y lo pendiente se conservan; el catálogo y los clientes se reemplazan
            por los de la conexión nueva.
          </span>
        </button>
        <button
          type="button"
          class="wizard-option"
          aria-pressed={choice === 'wipe'}
          aria-label="Borrar los datos locales"
          onClick={() => {
            setLocalChoice('wipe');
          }}
          style={optionStyle(choice === 'wipe')}
        >
          <strong>Borrar</strong>
          <span style={{ color: 'var(--color-text-muted)' }}>
            La terminal empieza de cero con la conexión nueva. Antes se intenta enviar lo pendiente
            a la conexión actual.
          </span>
        </button>
      </div>
      {choice === 'keep' && model.originChanged && pending > 0 && (
        <p style={{ ...paragraph, fontWeight: 'bold' }}>
          {plural(pending, 'evento sin enviar se va', 'eventos sin enviar se van')} a mandar a la
          conexión nueva.
        </p>
      )}
    </>
  );
}

function applyPhrase(model: WizardModel): string {
  const action = model.applyAction;
  if (action === null) {
    return 'Falta completar algún paso.';
  }
  if (action.kind === 'save-terminal') {
    return 'Se guarda la sucursal, el punto de venta y el locale.';
  }
  const host = formHost();
  if (action.local === 'wipe') {
    return `Se conecta a ${host} y se borran los datos locales.`;
  }
  const sales = localDataSignal.value?.sales ?? 0;
  return sales > 0
    ? `Se conecta a ${host} y ${sales === 1 ? 'se conserva' : 'se conservan'} ${plural(sales, 'venta', 'ventas')}.`
    : `Se conecta a ${host} y se conservan los datos locales.`;
}

function ReviewStep({ model }: { model: WizardModel }) {
  const error = configErrorSignal.value;
  return (
    <>
      <dl
        style={{
          margin: 0,
          display: 'grid',
          gridTemplateColumns: 'auto 1fr',
          gap: 'var(--space-2) var(--space-4)',
        }}
      >
        {WIZARD_STEPS.filter((id) => id !== 'review').map((id) => (
          <div key={id} style={{ display: 'contents' }}>
            <dt style={{ color: 'var(--color-text-muted)' }}>{WIZARD_STEP_TITLES[id]}</dt>
            <dd style={{ margin: 0, overflowWrap: 'anywhere' }}>{stepSummary(id, model) || '—'}</dd>
          </div>
        ))}
      </dl>
      <p style={{ ...paragraph, fontWeight: 'bold' }}>{applyPhrase(model)}</p>
      {wizardAsyncSignal.value === 'applying' && (
        <p role="status" style={statusStyle}>
          <Spinner />
          <span>Aplicando…</span>
        </p>
      )}
      {error !== null && (
        <p role="alert" style={{ ...paragraph, color: 'var(--color-danger)' }}>
          {error}
        </p>
      )}
    </>
  );
}

/** Slot de altura fija para el error de validación de los pasos con campos (nunca corre el layout). */
function ValidationSlot() {
  const error = configErrorSignal.value;
  return (
    <div style={{ minHeight: 'var(--space-6)' }}>
      {error !== null && (
        <p role="alert" style={{ ...paragraph, color: 'var(--color-danger)' }}>
          {error}
        </p>
      )}
    </div>
  );
}

export function StepContent({ step, model }: { step: WizardStepId; model: WizardModel }) {
  switch (step) {
    case 'terminal':
      return (
        <>
          <TerminalStep />
          <ValidationSlot />
        </>
      );
    case 'type':
      return (
        <>
          <TypeStep />
          <ValidationSlot />
        </>
      );
    case 'connector':
      return (
        <>
          <ConnectorStep />
          <ValidationSlot />
        </>
      );
    case 'probe':
      return <ProbeStep model={model} />;
    case 'local-data':
      return <LocalDataStep model={model} />;
    case 'review':
      return <ReviewStep model={model} />;
  }
}
