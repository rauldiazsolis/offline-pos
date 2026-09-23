import { computed, signal } from '@preact/signals';
import type { LocalDataSummary } from '../../storage/local-data.ts';
import type { SyncConfig } from '../../sync/config.ts';
import type { ProbeStage } from '../../sync/connection.ts';
import { toFieldValues, type ConnectorType } from '../../sync/connector-registry.ts';
import {
  buildWizardModel,
  type ConfigFormValues,
  type LocalChoice,
  type ProbeOutcome,
  type WizardInput,
  type WizardModel,
  type WizardStepId,
} from '../keyboard/config-wizard-model.ts';

export type { ConfigFormValues };

/** Sin valores por omisión (Etapa 2b): todo arranca vacío; los ejemplos son `placeholder`s. */
function blankFormValues(): ConfigFormValues {
  return {
    rest: { baseUrl: '', apiKey: '' },
    'rest-demo': { baseUrl: '', apiKey: '' },
    'google-sheets': { webAppUrl: '', sharedSecret: '' },
  };
}

/** Conector elegido en el paso "Tipo de conexión"; `null` = todavía no se eligió ninguno. */
export const configTypeSignal = signal<ConnectorType | null>(null);
/**
 * Valores tipeados **por conector**: cambiar el tipo no pierde lo que ya se
 * cargó en el otro, y solo los campos del tipo activo llegan a guardarse.
 */
export const configFieldValuesSignal = signal<ConfigFormValues>(blankFormValues());
/**
 * Campos de terminal (paso 1 del wizard, no de un conector): sucursal y punto
 * de venta (obligatorios desde la Etapa 2 de #94, estampados en cada evento al
 * encolarlo) y locale (opcional). Fuera de la unión por `type`.
 */
export type TerminalFieldKey = 'locale' | 'branch' | 'pointOfSale';

export const configTerminalSignal = signal<Record<TerminalFieldKey, string>>({
  locale: '',
  branch: '',
  pointOfSale: '',
});
export const configErrorSignal = signal<string | null>(null);
/** Clave del campo al que apunta el error, para enfocarlo y seleccionarlo (`data-config-field`). */
export const configErrorFieldSignal = signal<string | null>(null);

/**
 * Lo que el wizard espera ahora (Etapa 2 de #94): nada, la prueba de conexión,
 * el envío de pendientes antes de borrar, la confirmación del borrado o el
 * aplicar. Cada estado cambia qué hacen Enter y Esc.
 */
export type WizardAsync = 'idle' | 'probing' | 'flushing' | 'confirming-wipe' | 'applying';

/** Config guardada al abrir el wizard (o ninguna): contra ella se decide si la conexión cambió. */
export const savedConfigSignal = signal<SyncConfig | undefined>(undefined);
export const wizardStepSignal = signal<WizardStepId>('terminal');
export const wizardAsyncSignal = signal<WizardAsync>('idle');
export const probeOutcomeSignal = signal<ProbeOutcome | null>(null);
/** Etapa de la prueba en curso y cuándo arrancó (para el contador de segundos). */
export const probeProgressSignal = signal<{ stage: ProbeStage; startedAt: number } | null>(null);
/** Resumen de lo local (para saber si hay datos del usuario); `null` mientras se cuenta. */
export const localDataSignal = signal<LocalDataSummary | null>(null);
export const localChoiceSignal = signal<LocalChoice>('keep');
/** El usuario pasó por "Datos locales" con la opción actual (se invalida al editar la conexión). */
export const localChoiceConfirmedSignal = signal(false);
/** Lo que se va a borrar, contado después del envío previo — solo en `confirming-wipe`. */
export const wipeSummarySignal = signal<LocalDataSummary | null>(null);

/**
 * Etapa 2 (#97): el arranque encontró la terminal sin id de dispositivo y
 * borró sus datos. El paso 1 del wizard lo avisa; se apaga al aplicar.
 */
export const identityResetSignal = signal(false);

/** Lo que el modelo puro necesita, leído de los signals (el controller lo usa para validar). */
export function currentWizardInput(): WizardInput {
  return {
    terminal: configTerminalSignal.value,
    type: configTypeSignal.value,
    fieldValues: configFieldValuesSignal.value,
    saved: savedConfigSignal.value,
    probe: probeOutcomeSignal.value,
    localData: localDataSignal.value,
    localChoice: localChoiceSignal.value,
    localChoiceConfirmed: localChoiceConfirmedSignal.value,
  };
}

export const wizardModelSignal = computed<WizardModel>(() =>
  buildWizardModel(currentWizardInput()),
);

/**
 * Deja el wizard en su estado inicial. Con `saved`, precarga esa config
 * (tipo, campos y config de terminal) — así reconfigurar un solo dato no obliga a
 * retipear los demás; sin ella (terminal nueva), todo vacío y sin tipo.
 */
export function resetConfigForm(saved?: SyncConfig): void {
  const values = blankFormValues();
  if (saved !== undefined) {
    values[saved.type] = toFieldValues(saved);
  }
  configTypeSignal.value = saved?.type ?? null;
  configFieldValuesSignal.value = values;
  configTerminalSignal.value = {
    locale: saved?.locale ?? '',
    branch: saved?.branch ?? '',
    pointOfSale: saved?.pointOfSale ?? '',
  };
  configErrorSignal.value = null;
  configErrorFieldSignal.value = null;
  savedConfigSignal.value = saved;
  wizardStepSignal.value = 'terminal';
  wizardAsyncSignal.value = 'idle';
  probeOutcomeSignal.value = null;
  probeProgressSignal.value = null;
  localDataSignal.value = null;
  localChoiceSignal.value = 'keep';
  localChoiceConfirmedSignal.value = false;
  wipeSummarySignal.value = null;
}
