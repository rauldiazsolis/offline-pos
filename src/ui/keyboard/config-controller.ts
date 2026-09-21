import { loadSyncConfig, saveSyncConfig, syncConfigSchema } from '../../sync/config.ts';
import { connectorFields, type ConnectorType } from '../../sync/connector-registry.ts';
import { activeScreenSignal } from '../state/screen.ts';
import { setSyncConfigured } from '../state/sync.ts';
import {
  configErrorFieldSignal,
  configErrorSignal,
  configFieldValuesSignal,
  configLocaleSignal,
  configTypeSignal,
  resetConfigForm,
} from '../state/sync-config.ts';

/** `/CONFIG`: abre el formulario, precargado con la config guardada (o los defaults del demo si no hay). */
export function enterConfigScreen(): void {
  const saved = loadSyncConfig();
  resetConfigForm(saved.ok ? saved.value : undefined);
  activeScreenSignal.value = 'config';
}

/** Esc: sale sin guardar nada. */
export function cancelConfigScreen(): void {
  resetConfigForm();
  activeScreenSignal.value = 'sale';
}

function clearConfigError(): void {
  configErrorSignal.value = null;
  configErrorFieldSignal.value = null;
}

/** Cambia el conector elegido — los campos que se muestran cambian en el acto, sin perder lo tipeado en el otro. */
export function setConfigType(type: ConnectorType): void {
  configTypeSignal.value = type;
  clearConfigError();
}

/** Edita un campo del conector activo. */
export function setConfigField(key: string, value: string): void {
  const type = configTypeSignal.value;
  const all = configFieldValuesSignal.value;
  configFieldValuesSignal.value = { ...all, [type]: { ...all[type], [key]: value } };
  clearConfigError();
}

export function setConfigLocale(value: string): void {
  configLocaleSignal.value = value;
  clearConfigError();
}

/**
 * Ctrl+Enter: valida todo junto y guarda. La validación ocurre solo acá,
 * nunca mientras se tipea (mismo criterio que Cobro, #55). Un valor vacío se
 * omite de la config guardada (un opcional en blanco no se guarda).
 */
export function submitConfig(): void {
  const type = configTypeSignal.value;
  const fields = connectorFields(type);
  const raw = configFieldValuesSignal.value[type];

  const candidate: Record<string, string> = { type };
  for (const field of fields) {
    const value = (raw[field.key] ?? '').trim();
    if (value !== '') {
      candidate[field.key] = value;
    }
  }
  const locale = configLocaleSignal.value.trim();
  if (locale !== '') {
    candidate.locale = locale;
  }

  const parsed = syncConfigSchema.safeParse(candidate);
  if (!parsed.success) {
    const offendingKey = parsed.error.issues[0]?.path[0];
    const field = fields.find((candidateField) => candidateField.key === offendingKey);
    if (field === undefined) {
      configErrorSignal.value = 'La configuración no es válida.';
      return;
    }
    const isEmpty = (raw[field.key] ?? '').trim() === '';
    configErrorFieldSignal.value = field.key;
    configErrorSignal.value = isEmpty
      ? `Completá «${field.label}».`
      : `«${field.label}» no es válido.`;
    return;
  }

  const saveResult = saveSyncConfig(parsed.data);
  if (!saveResult.ok) {
    configErrorSignal.value = 'No se pudo guardar la configuración.';
    return;
  }

  setSyncConfigured(true);
  resetConfigForm();
  activeScreenSignal.value = 'sale';
}
