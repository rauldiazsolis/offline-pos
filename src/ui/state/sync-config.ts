import { signal } from '@preact/signals';

export type ConfigStep = 'baseUrl' | 'apiKey' | 'locale';

export const configStepSignal = signal<ConfigStep>('baseUrl');
/** `baseUrl` ya confirmado (paso 1), mientras se tipea el `apiKey` opcional (paso 2). */
export const configBaseUrlSignal = signal('');
/** `apiKey` ya confirmado (paso 2, vacío = sin apiKey), mientras se tipea el `locale` opcional (paso 3). */
export const configApiKeySignal = signal('');
export const configBufferSignal = signal('');
export const configErrorSignal = signal<string | null>(null);

export function resetConfigFlow(): void {
  configStepSignal.value = 'baseUrl';
  configBaseUrlSignal.value = '';
  configApiKeySignal.value = '';
  configBufferSignal.value = '';
  configErrorSignal.value = null;
}
