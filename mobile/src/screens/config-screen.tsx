import { useEffect, useState } from 'preact/hooks';
import type { ConfigField } from '../../../src/connectors/config-field.ts';
import { loadSyncConfig } from '../../../src/sync/config.ts';
import { PROBE_TIMEOUT_MS } from '../../../src/sync/connection.ts';
import {
  connectorFields,
  connectorInfo,
  CONNECTOR_TYPES,
} from '../../../src/sync/connector-registry.ts';
import {
  advance,
  applyWizard,
  backFromWipeConfirmation,
  chooseConnectorType,
  goBack,
  handleWizardEscape,
  retryProbe,
  setConfigField,
  setConfigTerminalField,
  setLocalChoice,
} from '../../../src/ui/keyboard/config-controller.ts';
import {
  WIZARD_STEP_TITLES,
  WIZARD_STEPS,
  type WizardModel,
} from '../../../src/ui/keyboard/config-wizard-model.ts';
import {
  describeLocalDataLoss,
  formHost,
  plural,
  stepSummary,
} from '../../../src/ui/screens/config-wizard/summary.ts';
import { connectionStateSignal } from '../../../src/ui/state/sync.ts';
import {
  configErrorFieldSignal,
  configErrorSignal,
  configFieldValuesSignal,
  configNoticeSignal,
  configTerminalSignal,
  configTypeSignal,
  identityResetSignal,
  localChoiceSignal,
  localDataSignal,
  probeOutcomeSignal,
  probeProgressSignal,
  wipeSummarySignal,
  wizardAsyncSignal,
  wizardModelSignal,
  wizardStepSignal,
  type TerminalFieldKey,
} from '../../../src/ui/state/sync-config.ts';
import { canScan, Scanner } from '../camera/scanner.tsx';
import { connectionTargetFrom, openConnectionTarget } from '../camera/scanned-link.ts';
import { ScanIcon } from '../components/icons.tsx';
import { Sheet } from '../components/sheet.tsx';
import { openTextEntry } from '../keyboards/entry.ts';

const TERMINAL_FIELDS: (ConfigField & { key: TerminalFieldKey })[] = [
  { key: 'branch', label: 'Sucursal', optional: false, placeholder: 'ej. Casa central' },
  { key: 'pointOfSale', label: 'Punto de venta', optional: false, placeholder: 'ej. Caja 1' },
  { key: 'locale', label: 'Locale', optional: true, placeholder: 'ej. es-AR' },
];

function fieldLabel(field: ConfigField): string {
  return field.optional ? `${field.label} (opcional)` : field.label;
}

/** Un campo de texto que se edita con el teclado propio (nunca un `input`). */
function FieldButton(props: {
  field: ConfigField;
  value: string;
  onChange: (value: string) => void;
}) {
  const { field, value } = props;
  const error = configErrorFieldSignal.value === field.key;
  const terminal = field.key === 'branch' || field.key === 'pointOfSale';
  const shown =
    field.secret === true && value !== '' ? '•'.repeat(Math.min(value.length, 12)) : value;
  return (
    <button
      type="button"
      class={error ? 'field field--error' : 'field'}
      data-config-field={field.key}
      onClick={() => {
        openTextEntry({
          title: fieldLabel(field),
          initial: value,
          placeholder: field.placeholder,
          secret: field.secret === true,
          options: { capitalize: terminal ? 'words' : 'none', maxLength: 300 },
          onDone: props.onChange,
        });
      }}
    >
      <small>{fieldLabel(field)}</small>
      {shown === '' ? <span class="ph">{field.placeholder}</span> : <span>{shown}</span>}
    </button>
  );
}

function ValidationError() {
  const error = configErrorSignal.value;
  return error === null ? null : (
    <p class="state-line error" role="alert">
      {error}
    </p>
  );
}

function TerminalStep() {
  const values = configTerminalSignal.value;
  return (
    <div class="stack">
      {identityResetSignal.value && (
        <p class="state-line due">
          Esta terminal perdió su identificación y se borraron sus datos locales. Volvé a
          configurarla.
        </p>
      )}
      {TERMINAL_FIELDS.map((field) => (
        <FieldButton
          key={field.key}
          field={field}
          value={values[field.key]}
          onChange={(value) => {
            setConfigTerminalField(field.key, value);
          }}
        />
      ))}
      <ValidationError />
    </div>
  );
}

function TypeStep() {
  const chosen = configTypeSignal.value;
  return (
    <div class="stack" role="group" aria-label="Tipo de conexión">
      {CONNECTOR_TYPES.map((info) => (
        <button
          key={info.type}
          type="button"
          class="option"
          aria-pressed={chosen === info.type}
          onClick={() => {
            chooseConnectorType(info.type);
          }}
        >
          <span class="dot" />
          <span>
            <span class="title">{info.label}</span>
            <br />
            <span class="sub">{info.description}</span>
          </span>
        </button>
      ))}
      <ValidationError />
    </div>
  );
}

function ConnectorStep() {
  const type = configTypeSignal.value;
  if (type === null) {
    return <p class="note">Primero elegí un tipo de conexión.</p>;
  }
  const values = configFieldValuesSignal.value[type];
  return (
    <div class="stack">
      {connectorFields(type).map((field) => (
        <FieldButton
          key={`${type}:${field.key}`}
          field={field}
          value={values[field.key] ?? ''}
          onChange={(value) => {
            setConfigField(field.key, value);
          }}
        />
      ))}
      <ValidationError />
      <p class="section-title">Cómo conseguir estos datos</p>
      <ol class="note" style={{ margin: 0, paddingLeft: '20px' }}>
        {connectorInfo(type).setupHelp.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ol>
    </div>
  );
}

function useElapsedSeconds(startedAt: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 500);
    return () => {
      clearInterval(timer);
    };
  }, []);
  return Math.max(0, Math.floor((now - startedAt) / 1000));
}

function ProbeWaiting({
  stage,
  startedAt,
}: {
  stage: 'waiting-lock' | 'pulling';
  startedAt: number;
}) {
  const seconds = useElapsedSeconds(startedAt);
  return (
    <div class="stack">
      <p class="note" role="status">
        <span class="spinner" />{' '}
        {stage === 'waiting-lock'
          ? 'Esperando que termine una sincronización en curso…'
          : `Pidiendo productos, stock y clientes a ${formHost()}…`}{' '}
        {String(seconds)} s (máx. {String(PROBE_TIMEOUT_MS / 1000)} s)
      </p>
      {configTypeSignal.value === 'google-sheets' && seconds >= 3 && (
        <p class="note">Google Sheets suele tardar entre 5 y 20 segundos.</p>
      )}
    </div>
  );
}

function ProbeStep({ model }: { model: WizardModel }) {
  const progress = probeProgressSignal.value;
  if (wizardAsyncSignal.value === 'probing' && progress !== null) {
    return <ProbeWaiting stage={progress.stage} startedAt={progress.startedAt} />;
  }
  const outcome = probeOutcomeSignal.value;
  if (outcome === null || outcome.key !== model.connectionKey) {
    return <p class="note">Probá la conexión con los datos cargados.</p>;
  }
  switch (outcome.status) {
    case 'ok':
      return (
        <p class="state-line change" role="status">
          Conexión OK: {plural(outcome.products, 'producto', 'productos')},{' '}
          {plural(outcome.customers, 'cliente', 'clientes')}.
        </p>
      );
    case 'failed':
      return (
        <p class="state-line error" role="alert">
          {outcome.message}
        </p>
      );
    case 'cancelled':
      return <p class="note">Prueba cancelada.</p>;
  }
}

function LocalDataStep({ model }: { model: WizardModel }) {
  const async = wizardAsyncSignal.value;
  const pending = localDataSignal.value?.pendingOutbox ?? 0;
  if (async === 'flushing') {
    return (
      <p class="note" role="status">
        <span class="spinner" /> Enviando{' '}
        {plural(pending, 'evento pendiente', 'eventos pendientes')}…
      </p>
    );
  }
  const summary = wipeSummarySignal.value;
  if (async === 'confirming-wipe' && summary !== null) {
    return (
      <div class="stack">
        <p class="state-line error">Cambiar de conexión borrando los datos de esta terminal</p>
        <p class="note">Se van a borrar: {describeLocalDataLoss(summary)}.</p>
        {summary.pendingOutbox > 0 && (
          <p class="note neg" style={{ fontWeight: 700 }}>
            {plural(summary.pendingOutbox, 'evento sin enviar', 'eventos sin enviar')} a la conexión
            actual ({plural(summary.pendingSales, 'venta', 'ventas')}) se perderán.
          </p>
        )}
      </div>
    );
  }
  const choice = localChoiceSignal.value;
  return (
    <div class="stack" role="group" aria-label="Datos locales">
      <p class="note">
        Esta terminal tiene ventas o movimientos propios. ¿Qué hacemos con ellos al cambiar de
        conexión?
      </p>
      <button
        type="button"
        class="option"
        aria-pressed={choice === 'keep'}
        onClick={() => {
          setLocalChoice('keep');
        }}
      >
        <span class="dot" />
        <span>
          <span class="title">Mantener</span>
          <br />
          <span class="sub">
            Las ventas y lo pendiente se conservan; el catálogo y los clientes se reemplazan por los
            de la conexión nueva.
          </span>
        </span>
      </button>
      <button
        type="button"
        class="option"
        aria-pressed={choice === 'wipe'}
        onClick={() => {
          setLocalChoice('wipe');
        }}
      >
        <span class="dot" />
        <span>
          <span class="title">Borrar</span>
          <br />
          <span class="sub">
            La terminal empieza de cero. Antes se intenta enviar lo pendiente a la conexión actual.
          </span>
        </span>
      </button>
      {choice === 'keep' && model.originChanged && pending > 0 && (
        <p class="note" style={{ fontWeight: 700 }}>
          {plural(pending, 'evento sin enviar se va', 'eventos sin enviar se van')} a mandar a la
          conexión nueva.
        </p>
      )}
    </div>
  );
}

function applyPhrase(model: WizardModel): string {
  const action = model.applyAction;
  if (action === null) return 'Falta completar algún paso.';
  if (action.kind === 'save-terminal')
    return 'Se guarda la sucursal, el punto de venta y el locale.';
  const host = formHost();
  const localStep = model.steps.find((step) => step.id === 'local-data');
  if (localStep?.status === 'skipped' && localStep.skipReason === 'no-user-data') {
    return `Se conecta a ${host} y se cargan sus productos y clientes.`;
  }
  return action.local === 'wipe'
    ? `Se conecta a ${host} y se borran los datos locales.`
    : `Se conecta a ${host} y se conservan los datos locales.`;
}

function ReviewStep({ model }: { model: WizardModel }) {
  return (
    <div class="stack">
      <div class="card">
        {WIZARD_STEPS.filter((id) => id !== 'review').map((id) => (
          <div class="kv" key={id}>
            <span>{WIZARD_STEP_TITLES[id]}</span>
            <span>{stepSummary(id, model) || '—'}</span>
          </div>
        ))}
      </div>
      <p style={{ fontWeight: 700, margin: 0 }}>{applyPhrase(model)}</p>
      {wizardAsyncSignal.value === 'applying' && (
        <p class="note" role="status">
          <span class="spinner" /> Aplicando…
        </p>
      )}
      <ValidationError />
    </div>
  );
}

function StepBody({ model }: { model: WizardModel }) {
  switch (wizardStepSignal.value) {
    case 'terminal':
      return <TerminalStep />;
    case 'type':
      return <TypeStep />;
    case 'connector':
      return <ConnectorStep />;
    case 'probe':
      return <ProbeStep model={model} />;
    case 'local-data':
      return <LocalDataStep model={model} />;
    case 'review':
      return <ReviewStep model={model} />;
  }
}

function PrimaryAction({ model }: { model: WizardModel }) {
  const step = wizardStepSignal.value;
  const async = wizardAsyncSignal.value;
  if (step === 'probe') {
    if (async === 'probing') {
      return (
        <button type="button" class="btn" onClick={handleWizardEscape}>
          Cancelar la prueba
        </button>
      );
    }
    return model.probeValid ? (
      <button type="button" class="btn btn-primary" onClick={advance}>
        Siguiente
      </button>
    ) : (
      <button type="button" class="btn btn-primary" onClick={retryProbe}>
        Probar
      </button>
    );
  }
  if (step === 'local-data' && async === 'confirming-wipe') {
    return (
      <>
        <button type="button" class="btn" onClick={backFromWipeConfirmation}>
          Volver
        </button>
        <button type="button" class="btn btn-danger" onClick={advance}>
          Borrar y cambiar
        </button>
      </>
    );
  }
  if (step === 'review') {
    return (
      <button
        type="button"
        class="btn btn-primary"
        disabled={async !== 'idle'}
        onClick={() => void applyWizard()}
      >
        Aplicar
      </button>
    );
  }
  return (
    <button type="button" class="btn btn-primary" disabled={async !== 'idle'} onClick={advance}>
      Siguiente
    </button>
  );
}

/** La forma fácil: un QR o un link del backend (demo, alta o planilla), sin tipear nada. */
function QuickConnect() {
  const [scanning, setScanning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  if (!canScan()) {
    return (
      <div class="card">
        <p class="note">
          La forma más fácil de conectar es abrir en este celular el link de conexión de tu sistema
          (una demo, el alta de tu comercio o tu planilla). También podés completar los datos a mano
          acá abajo.
        </p>
      </div>
    );
  }
  return (
    <div class="card" style={{ paddingBlock: '12px' }}>
      <div class="stack">
        <p class="note" style={{ margin: 0 }}>
          ¿Tu sistema te muestra un código QR para conectar el POS? Escanealo y listo. También podés
          completar los datos a mano acá abajo.
        </p>
        <button
          type="button"
          class="btn btn-primary btn-block"
          onClick={() => {
            setMessage(null);
            setScanning(true);
          }}
        >
          <span style={{ display: 'inline-flex', gap: '8px', alignItems: 'center' }}>
            <ScanIcon /> Escanear el QR
          </span>
        </button>
        {message !== null && (
          <p class="state-line error" role="alert">
            {message}
          </p>
        )}
      </div>
      {scanning && (
        <Sheet
          title="Escanear el QR"
          onClose={() => {
            setScanning(false);
          }}
        >
          <Scanner
            kind="qr"
            onCode={(code) => {
              setScanning(false);
              const target = connectionTargetFrom(code, window.location.href);
              if (target === null) {
                setMessage('Ese código no es un link de conexión del POS.');
                return;
              }
              openConnectionTarget(target);
            }}
          />
        </Sheet>
      )}
    </div>
  );
}

/**
 * La conexión de la terminal: el mismo wizard de `/CONFIG` (modelo y controller de escritorio), un
 * paso por pantalla. Sin conexión activa es lo único que se ve (modo requerido); con la terminal
 * activa se abre desde "Más" y se puede cancelar.
 */
export function ConfigScreen() {
  const model = wizardModelSignal.value;
  const step = wizardStepSignal.value;
  const index = WIZARD_STEPS.indexOf(step);
  const active = connectionStateSignal.value === 'active';
  const notice = configNoticeSignal.value;
  const neverConfigured = !loadSyncConfig().ok;
  const async = wizardAsyncSignal.value;
  const canGoBack = index > 0 && async === 'idle';
  return (
    <div class="app" data-testid="config-screen">
      <header class="top">
        <div class="brand">
          <h1>Conexión</h1>
          <p>
            Paso {String(index + 1)} de {String(WIZARD_STEPS.length)}: {WIZARD_STEP_TITLES[step]}
          </p>
        </div>
        {active && (
          <button type="button" class="close" onClick={handleWizardEscape}>
            Cancelar
          </button>
        )}
      </header>
      <div class="steps" aria-hidden="true" style={{ paddingTop: '8px' }}>
        {WIZARD_STEPS.map((id, position) => (
          <span key={id} class={position <= index ? 'done' : undefined} />
        ))}
      </div>
      <main class="content">
        <div class="page stack">
          {notice !== null && (
            <p class="state-line due" role="status">
              {notice}
            </p>
          )}
          {!active && neverConfigured && step === 'terminal' && <QuickConnect />}
          <StepBody model={model} />
        </div>
      </main>
      <footer class="sheet-foot" style={{ background: 'var(--surface)' }}>
        {canGoBack && (
          <button type="button" class="btn" onClick={goBack}>
            Atrás
          </button>
        )}
        <PrimaryAction model={model} />
      </footer>
    </div>
  );
}
