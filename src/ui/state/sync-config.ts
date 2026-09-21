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
/** `locale` es config de terminal (no de conector): un solo valor, visible una vez elegido un tipo. */
export const configLocaleSignal = signal('');
export const configErrorSignal = signal<string | null>(null);
/** Clave del campo al que apunta el error, para enfocarlo y seleccionarlo (`data-config-field`). */
export const configErrorFieldSignal = signal<string | null>(null);
export const configPhaseSignal = signal<ConfigPhase>('editing');
/** Lo que se perdería al cambiar de conexión — solo tiene valor en la fase `confirming`. */
export const configConfirmationSignal = signal<LocalDataSummary | null>(null);

/**
 * Deja el formulario en su estado inicial. Con `saved`, precarga esa config
 * (tipo, campos y locale) — así reconfigurar un solo dato no obliga a
 * retipear los demás; sin ella (terminal nueva), todo vacío y sin tipo.
 */
export function resetConfigForm(saved?: SyncConfig): void {
  const values = blankFormValues();
  if (saved !== undefined) {
    values[saved.type] = toFieldValues(saved);
  }
  configTypeSignal.value = saved?.type ?? null;
  configFieldValuesSignal.value = values;
  configLocaleSignal.value = saved?.locale ?? '';
  configErrorSignal.value = null;
  configErrorFieldSignal.value = null;
  configPhaseSignal.value = 'editing';
  configConfirmationSignal.value = null;
}
