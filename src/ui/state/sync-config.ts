import { signal } from '@preact/signals';

export type ConfigStep = 'baseUrl' | 'apiKey' | 'locale';

/** URL default del minibackend de demo (Fase 7) — precargada en el primer paso de /CONFIG, sigue siendo editable. */
export const DEFAULT_BASE_URL = 'http://localhost:4000';
/**
 * API key default para el paso 2 de /CONFIG, precargada igual que
 * `DEFAULT_BASE_URL` — el minibackend de demo solo exige que el header
 * `Authorization: Bearer <token>` no esté vacío (`router.ts::hasValidBearerToken`),
 * cualquier string no vacío sirve. Sin esto, seguir el camino "obvio" del demo
 * (aceptar la URL precargada, Enter en blanco en "opcional") deja el catálogo
 * vacío por un 401 silencioso (`sync/engine.ts` traga errores de pull) — ver
 * hallazgo de la revisión final de Fase 7.
 */
export const DEFAULT_API_KEY = 'demo-token';

export const configStepSignal = signal<ConfigStep>('baseUrl');
/** `baseUrl` ya confirmado (paso 1), mientras se tipea el `apiKey` opcional (paso 2). */
export const configBaseUrlSignal = signal('');
/** `apiKey` ya confirmado (paso 2, vacío = sin apiKey), mientras se tipea el `locale` opcional (paso 3). */
export const configApiKeySignal = signal('');
export const configBufferSignal = signal(DEFAULT_BASE_URL);
export const configErrorSignal = signal<string | null>(null);

export function resetConfigFlow(): void {
  configStepSignal.value = 'baseUrl';
  configBaseUrlSignal.value = '';
  configApiKeySignal.value = '';
  configBufferSignal.value = DEFAULT_BASE_URL;
  configErrorSignal.value = null;
}
