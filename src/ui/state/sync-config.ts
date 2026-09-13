import { signal } from '@preact/signals';

export type ConfigStep = 'baseUrl' | 'apiKey';

export const configStepSignal = signal<ConfigStep>('baseUrl');
/** `baseUrl` ya confirmado (paso 1), mientras se tipea el `apiKey` opcional (paso 2). */
export const configBaseUrlSignal = signal('');
export const configBufferSignal = signal('');
export const configErrorSignal = signal<string | null>(null);

export function resetConfigFlow(): void {
  configStepSignal.value = 'baseUrl';
  configBaseUrlSignal.value = '';
  configBufferSignal.value = '';
  configErrorSignal.value = null;
}
