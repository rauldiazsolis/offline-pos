import { signal } from '@preact/signals';
import type { SyncConfig } from '../../sync/config.ts';
import { toFieldValues, type ConnectorType } from '../../sync/connector-registry.ts';

/** URL default del minibackend de demo (Fase 7) — precargada en REST cuando no hay config guardada, sigue siendo editable. */
export const DEFAULT_BASE_URL = 'http://localhost:4000';
/**
 * API key default de REST, precargada igual que `DEFAULT_BASE_URL` — el
 * minibackend de demo solo exige que el header `Authorization: Bearer <token>`
 * no esté vacío (`router.ts::hasValidBearerToken`), cualquier string no vacío
 * sirve. Sin esto, seguir el camino "obvio" del demo (aceptar la URL
 * precargada, dejar el campo "opcional" en blanco) deja el catálogo vacío por
 * un 401 silencioso (`sync/engine.ts` traga errores de pull) — ver hallazgo
 * de la revisión final de Fase 7.
 */
export const DEFAULT_API_KEY = 'demo-token';

/** Valores de los campos de cada conector, como strings (lo que se tipea). */
export type ConfigFormValues = Record<ConnectorType, Record<string, string>>;

function defaultFormValues(): ConfigFormValues {
  return {
    rest: { baseUrl: DEFAULT_BASE_URL, apiKey: DEFAULT_API_KEY },
    'google-sheets': { webAppUrl: '', sharedSecret: '' },
  };
}

/** Conector elegido en el selector. */
export const configTypeSignal = signal<ConnectorType>('rest');
/**
 * Valores tipeados **por conector**: cambiar el tipo no pierde lo que ya se
 * cargó en el otro, y solo los campos del tipo activo llegan a guardarse.
 */
export const configFieldValuesSignal = signal<ConfigFormValues>(defaultFormValues());
/** `locale` es config de terminal (no de conector): un solo valor, siempre visible. */
export const configLocaleSignal = signal('');
export const configErrorSignal = signal<string | null>(null);
/** Clave del campo al que apunta el error, para enfocarlo y seleccionarlo (`data-config-field`). */
export const configErrorFieldSignal = signal<string | null>(null);

/**
 * Deja el formulario en su estado inicial. Con `saved`, precarga esa config
 * (tipo, campos y locale) — así reconfigurar un solo dato no obliga a
 * retipear los demás; sin ella (terminal nueva), arranca en REST con los
 * defaults del demo.
 */
export function resetConfigForm(saved?: SyncConfig): void {
  const values = defaultFormValues();
  if (saved !== undefined) {
    values[saved.type] = toFieldValues(saved);
  }
  configTypeSignal.value = saved?.type ?? 'rest';
  configFieldValuesSignal.value = values;
  configLocaleSignal.value = saved?.locale ?? '';
  configErrorSignal.value = null;
  configErrorFieldSignal.value = null;
}
