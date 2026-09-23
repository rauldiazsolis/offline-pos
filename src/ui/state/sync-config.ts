import { signal } from '@preact/signals';
import type { LocalDataSummary } from '../../storage/local-data.ts';
import type { SyncConfig } from '../../sync/config.ts';
import { toFieldValues, type ConnectorType } from '../../sync/connector-registry.ts';

/** Valores de los campos de cada conector, como strings (lo que se tipea). */
export type ConfigFormValues = Record<ConnectorType, Record<string, string>>;

/** Sin valores por omisión (Etapa 2b): todo arranca vacío; los ejemplos son `placeholder`s. */
function blankFormValues(): ConfigFormValues {
  return {
    rest: { baseUrl: '', apiKey: '' },
    'rest-demo': { baseUrl: '', apiKey: '' },
    'google-sheets': { webAppUrl: '', sharedSecret: '' },
  };
}

/** Fase del diálogo: editar → probar → (confirmar el borrado) → aplicar. */
export type ConfigPhase = 'editing' | 'probing' | 'confirming' | 'applying';

/** Conector elegido en el selector; `null` = todavía no se eligió ninguno. */
export const configTypeSignal = signal<ConnectorType | null>(null);
/**
 * Valores tipeados **por conector**: cambiar el tipo no pierde lo que ya se
 * cargó en el otro, y solo los campos del tipo activo llegan a guardarse.
 */
export const configFieldValuesSignal = signal<ConfigFormValues>(blankFormValues());
/**
 * Campos de terminal (no de un conector): locale, sucursal y punto de venta
 * (estos dos estampados en cada evento al encolarlo, contrato v3 — #96). Un
 * solo valor cada uno, fuera de la unión por `type`, visibles una vez elegido
 * un tipo y siempre al final de /CONFIG.
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
export const configPhaseSignal = signal<ConfigPhase>('editing');
/** Lo que se perdería al cambiar de conexión — solo tiene valor en la fase `confirming`. */
export const configConfirmationSignal = signal<LocalDataSummary | null>(null);

/**
 * Deja el formulario en su estado inicial. Con `saved`, precarga esa config
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
  configPhaseSignal.value = 'editing';
  configConfirmationSignal.value = null;
}

/**
 * Etapa 2 (#97): el arranque encontró la terminal sin id de dispositivo y
 * borró sus datos. El paso 1 del wizard lo avisa; se apaga al aplicar.
 */
export const identityResetSignal = signal(false);
