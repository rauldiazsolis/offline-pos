import { hasUserData, type LocalDataSummary } from '../../storage/local-data.ts';
import { syncConfigSchema, type SyncConfig } from '../../sync/config.ts';
import { originKey } from '../../sync/connection.ts';
import {
  connectorConfigSchema,
  connectorFields,
  toFieldValues,
  type ConnectorType,
} from '../../sync/connector-registry.ts';

/**
 * Modelo puro del wizard de `/CONFIG` (Etapa 2, #97): a partir de lo tipeado,
 * lo guardado, la última prueba y los datos locales decide qué pasos se
 * saltean, cuáles están completos, hasta dónde se puede navegar y qué hace
 * Aplicar. Sin DOM ni async — el controller orquesta, la pantalla dibuja.
 */

export type WizardStepId = 'terminal' | 'type' | 'connector' | 'probe' | 'local-data' | 'review';
export const WIZARD_STEPS: readonly WizardStepId[] = [
  'terminal',
  'type',
  'connector',
  'probe',
  'local-data',
  'review',
];
export const WIZARD_STEP_TITLES: Record<WizardStepId, string> = {
  terminal: 'Terminal',
  type: 'Tipo de conexión',
  connector: 'Datos del conector',
  probe: 'Probar',
  'local-data': 'Datos locales',
  review: 'Revisar',
};

export type StepStatus = 'pending' | 'complete' | 'error' | 'skipped';
export type SkipReason = 'connection-unchanged' | 'no-user-data';
export type WizardStep = {
  id: WizardStepId;
  number: number;
  status: StepStatus;
  skipReason?: SkipReason;
};
export type TerminalForm = { branch: string; pointOfSale: string; locale: string };
export type LocalChoice = 'keep' | 'wipe';
/** Resultado de la última prueba, con la clave de la conexión con la que se hizo. */
export type ProbeOutcome =
  | { status: 'ok'; key: string; products: number; customers: number }
  | { status: 'failed'; key: string; message: string }
  | { status: 'cancelled'; key: string };
/** Valores de los campos de cada conector, como strings (lo que se tipea). */
export type ConfigFormValues = Record<ConnectorType, Record<string, string>>;
export type WizardInput = {
  terminal: TerminalForm;
  type: ConnectorType | null;
  fieldValues: ConfigFormValues;
  saved: SyncConfig | undefined;
  probe: ProbeOutcome | null;
  localData: LocalDataSummary | null;
  localChoice: LocalChoice;
  localChoiceConfirmed: boolean;
};
export type ApplyAction =
  | { kind: 'save-terminal' }
  | { kind: 'apply-connection'; local: LocalChoice; originChanged: boolean };
export type WizardModel = {
  steps: WizardStep[];
  /** La config que se guardaría (conector + terminal), si todo lo tipeado es válido. */
  candidate: SyncConfig | undefined;
  /** Identidad de la conexión cargada (tipo + campos del conector), si es válida. */
  connectionKey: string | undefined;
  /** El tipo o algún campo del conector difiere de la config guardada y verificada. */
  connectionChanged: boolean;
  /** El endpoint difiere del guardado (o no hay config guardada). */
  originChanged: boolean;
  /** Hay una prueba exitosa hecha exactamente con la conexión cargada ahora. */
  probeValid: boolean;
  /** Qué hace Aplicar; `null` mientras falte completar algún paso. */
  applyAction: ApplyAction | null;
  firstIncomplete: WizardStepId;
};
export type StepValidation = { ok: true } | { ok: false; field?: string; message: string };

const TERMINAL_LABELS = { branch: 'Sucursal', pointOfSale: 'Punto de venta' } as const;

/** Identidad de la conexión cargada: tipo + cada campo del conector, sin espacios. */
export function formConnectionKey(type: ConnectorType, values: Record<string, string>): string {
  return JSON.stringify([
    type,
    ...connectorFields(type).map((field) => (values[field.key] ?? '').trim()),
  ]);
}

function savedConnectionKey(saved: SyncConfig): string {
  return formConnectionKey(saved.type, toFieldValues(saved));
}

/** Los campos no vacíos del conector elegido, listos para el schema (un opcional en blanco no se guarda). */
function connectorCandidate(
  type: ConnectorType,
  values: Record<string, string>,
): Record<string, string> {
  const candidate: Record<string, string> = { type };
  for (const field of connectorFields(type)) {
    const value = (values[field.key] ?? '').trim();
    if (value !== '') candidate[field.key] = value;
  }
  return candidate;
}

export function validateStep(
  input: WizardInput,
  step: 'terminal' | 'type' | 'connector',
): StepValidation {
  switch (step) {
    case 'terminal':
      for (const key of ['branch', 'pointOfSale'] as const) {
        if (input.terminal[key].trim() === '') {
          return { ok: false, field: key, message: `Completá «${TERMINAL_LABELS[key]}».` };
        }
      }
      return { ok: true };
    case 'type':
      return input.type === null
        ? { ok: false, message: 'Elegí un tipo de conexión.' }
        : { ok: true };
    case 'connector': {
      if (input.type === null) return { ok: false, message: 'Elegí un tipo de conexión.' };
      const raw = input.fieldValues[input.type];
      const parsed = connectorConfigSchema.safeParse(connectorCandidate(input.type, raw));
      if (parsed.success) return { ok: true };
      const offendingKey = parsed.error.issues[0]?.path[0];
      const field = connectorFields(input.type).find((f) => f.key === offendingKey);
      if (field === undefined) return { ok: false, message: 'La configuración no es válida.' };
      const isEmpty = (raw[field.key] ?? '').trim() === '';
      return {
        ok: false,
        field: field.key,
        message: isEmpty ? `Completá «${field.label}».` : `«${field.label}» no es válido.`,
      };
    }
  }
}

function buildCandidate(input: WizardInput): SyncConfig | undefined {
  if (input.type === null) return undefined;
  const candidate: Record<string, string> = connectorCandidate(
    input.type,
    input.fieldValues[input.type],
  );
  for (const [key, value] of Object.entries(input.terminal)) {
    const trimmed = value.trim();
    if (trimmed !== '') candidate[key] = trimmed;
  }
  const parsed = syncConfigSchema.safeParse(candidate);
  return parsed.success ? parsed.data : undefined;
}

export function buildWizardModel(input: WizardInput): WizardModel {
  const terminalOk = validateStep(input, 'terminal').ok;
  const typeOk = validateStep(input, 'type').ok;
  const connectorOk = typeOk && validateStep(input, 'connector').ok;
  const candidate = terminalOk && connectorOk ? buildCandidate(input) : undefined;
  const connectionKey =
    input.type !== null && connectorOk
      ? formConnectionKey(input.type, input.fieldValues[input.type])
      : undefined;

  const saved = input.saved;
  const connectionChanged =
    saved?.verifiedAt === undefined ||
    connectionKey === undefined ||
    savedConnectionKey(saved) !== connectionKey;
  const originChanged =
    saved === undefined || candidate === undefined || originKey(saved) !== originKey(candidate);

  const probeValid = input.probe?.status === 'ok' && input.probe.key === connectionKey;
  const probeFailedNow = input.probe?.status === 'failed' && input.probe.key === connectionKey;

  const localSkip: SkipReason | undefined = !connectionChanged
    ? 'connection-unchanged'
    : input.localData !== null && !hasUserData(input.localData)
      ? 'no-user-data'
      : undefined;

  const statusOf = (id: WizardStepId): WizardStep => {
    const number = WIZARD_STEPS.indexOf(id) + 1;
    switch (id) {
      case 'terminal':
        return { id, number, status: terminalOk ? 'complete' : 'pending' };
      case 'type':
        return { id, number, status: typeOk ? 'complete' : 'pending' };
      case 'connector':
        return { id, number, status: connectorOk ? 'complete' : 'pending' };
      case 'probe':
        if (!connectionChanged)
          return { id, number, status: 'skipped', skipReason: 'connection-unchanged' };
        return {
          id,
          number,
          status: probeValid ? 'complete' : probeFailedNow ? 'error' : 'pending',
        };
      case 'local-data':
        if (localSkip !== undefined)
          return { id, number, status: 'skipped', skipReason: localSkip };
        return { id, number, status: input.localChoiceConfirmed ? 'complete' : 'pending' };
      case 'review':
        return { id, number, status: 'pending' };
    }
  };
  const steps = WIZARD_STEPS.map(statusOf);
  const firstIncomplete =
    steps.find(
      (step) => step.id !== 'review' && (step.status === 'pending' || step.status === 'error'),
    )?.id ?? 'review';

  let applyAction: ApplyAction | null = null;
  if (firstIncomplete === 'review') {
    applyAction = !connectionChanged
      ? { kind: 'save-terminal' }
      : {
          kind: 'apply-connection',
          local: localSkip !== undefined ? (originChanged ? 'wipe' : 'keep') : input.localChoice,
          originChanged,
        };
  }

  return {
    steps,
    candidate,
    connectionKey,
    connectionChanged,
    originChanged,
    probeValid,
    applyAction,
    firstIncomplete,
  };
}

const indexOf = (id: WizardStepId): number => WIZARD_STEPS.indexOf(id);
const isSkipped = (model: WizardModel, id: WizardStepId): boolean =>
  model.steps.find((step) => step.id === id)?.status === 'skipped';

export function nextStep(model: WizardModel, from: WizardStepId): WizardStepId {
  for (let i = indexOf(from) + 1; i < WIZARD_STEPS.length; i += 1) {
    const id = WIZARD_STEPS[i];
    if (id !== undefined && !isSkipped(model, id)) return id;
  }
  return 'review';
}

export function previousStep(model: WizardModel, from: WizardStepId): WizardStepId {
  for (let i = indexOf(from) - 1; i >= 0; i -= 1) {
    const id = WIZARD_STEPS[i];
    if (id !== undefined && !isSkipped(model, id)) return id;
  }
  return from;
}

export function isReachable(model: WizardModel, step: WizardStepId): boolean {
  return !isSkipped(model, step) && indexOf(step) <= indexOf(model.firstIncomplete);
}

export function initialStep(
  model: WizardModel,
  params: { active: boolean; identityReset: boolean },
): WizardStepId {
  if (params.identityReset) return 'terminal';
  return params.active ? 'review' : model.firstIncomplete;
}
