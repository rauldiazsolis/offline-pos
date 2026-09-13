import { saveSyncConfig, syncConfigSchema } from '../../sync/config.ts';
import { activeScreenSignal } from '../state/screen.ts';
import { setSyncConfigured } from '../state/sync.ts';
import {
  configBaseUrlSignal,
  configBufferSignal,
  configErrorSignal,
  configStepSignal,
  resetConfigFlow,
} from '../state/sync-config.ts';

/** `/CONFIG`: entra al flujo de dos pasos (baseUrl → apiKey opcional). */
export function enterConfigScreen(): void {
  resetConfigFlow();
  activeScreenSignal.value = 'config';
}

/** Esc en cualquier paso: sale sin guardar nada. */
export function cancelConfigScreen(): void {
  resetConfigFlow();
  activeScreenSignal.value = 'sale';
}

function submitBaseUrl(): void {
  const buffer = configBufferSignal.value.trim();
  if (buffer === '') {
    configErrorSignal.value = 'La URL no puede estar vacía.';
    return;
  }

  const parsed = syncConfigSchema.shape.baseUrl.safeParse(buffer);
  if (!parsed.success) {
    configErrorSignal.value = 'Ingresá una URL válida (ej. https://api.miempresa.com).';
    return;
  }

  configBaseUrlSignal.value = parsed.data;
  configBufferSignal.value = '';
  configErrorSignal.value = null;
  configStepSignal.value = 'apiKey';
}

function submitApiKey(): void {
  const buffer = configBufferSignal.value.trim();
  const config = {
    baseUrl: configBaseUrlSignal.value,
    ...(buffer !== '' ? { apiKey: buffer } : {}),
  };

  const saveResult = saveSyncConfig(config);
  if (!saveResult.ok) {
    configErrorSignal.value = 'No se pudo guardar la configuración.';
    return;
  }

  setSyncConfigured(true);
  resetConfigFlow();
  activeScreenSignal.value = 'sale';
}

/** Enter en la pantalla de config: confirma el paso actual y avanza (o guarda, en el último). */
export function submitConfigStep(): void {
  if (configStepSignal.value === 'baseUrl') {
    submitBaseUrl();
    return;
  }
  submitApiKey();
}
