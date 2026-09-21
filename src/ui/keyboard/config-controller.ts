import { summarizeLocalData } from '../../storage/local-data.ts';
import { applyConnection, flushPendingBeforeWipe } from '../../sync/apply-connection.ts';
import { loadSyncConfig, syncConfigSchema, type SyncConfig } from '../../sync/config.ts';
import {
  planConnectionChange,
  probeConnection,
  type ProbeSnapshot,
} from '../../sync/connection.ts';
import { connectorFields, type ConnectorType } from '../../sync/connector-registry.ts';
import { runSyncCycle } from '../../sync/engine.ts';
import { describeError } from '../errors.ts';
import { cartSelectionIndexSignal, cartSignal } from '../state/cart.ts';
import { resetAttachedCustomer } from '../state/customer.ts';
import { activeScreenSignal } from '../state/screen.ts';
import { connectionStateSignal } from '../state/sync.ts';
import {
  configConfirmationSignal,
  configErrorFieldSignal,
  configErrorSignal,
  configFieldValuesSignal,
  configLocaleSignal,
  configPhaseSignal,
  configTypeSignal,
  resetConfigForm,
} from '../state/sync-config.ts';

type PendingApply = { candidate: SyncConfig; snapshot: ProbeSnapshot; wipe: boolean };

/**
 * Token de la prueba en curso: `handleConfigEscape` lo incrementa para
 * cancelar, y la prueba, al volver, descarta su resultado si el token ya no
 * es el suyo (no se cancela el `fetch`, solo se ignora lo que traiga).
 */
let submitToken = 0;
/** Lo que se aplica si el usuario confirma el borrado (fase `confirming`). */
let pendingApply: PendingApply | undefined;

/** `/CONFIG`: abre el formulario, precargado con la config guardada (o vacío si no hay). */
export function enterConfigScreen(): void {
  submitToken += 1;
  pendingApply = undefined;
  const saved = loadSyncConfig();
  resetConfigForm(saved.ok ? saved.value : undefined);
  activeScreenSignal.value = 'config';
}

/** Sale de la pantalla sin guardar nada (solo con la conexión activa; ver `handleConfigEscape`). */
export function cancelConfigScreen(): void {
  submitToken += 1;
  pendingApply = undefined;
  resetConfigForm();
  activeScreenSignal.value = 'sale';
}

/** Vuelve del paso de confirmación a editar el formulario, sin borrar nada. */
export function backToEditing(): void {
  pendingApply = undefined;
  configConfirmationSignal.value = null;
  configPhaseSignal.value = 'editing';
}

/**
 * Esc según la fase: probando → cancela la prueba; confirmando → vuelve a
 * editar; aplicando → se ignora (es corto y no se puede interrumpir); editando
 * → sale, salvo en modo requerido (conexión todavía no activa), donde no hay
 * a dónde salir.
 */
export function handleConfigEscape(): void {
  switch (configPhaseSignal.value) {
    case 'probing':
      submitToken += 1;
      configPhaseSignal.value = 'editing';
      return;
    case 'confirming':
      backToEditing();
      return;
    case 'applying':
      return;
    default:
      if (connectionStateSignal.value === 'active') {
        cancelConfigScreen();
      }
  }
}

function clearConfigError(): void {
  configErrorSignal.value = null;
  configErrorFieldSignal.value = null;
}

/** Cambia el conector elegido — los campos que se muestran cambian en el acto, sin perder lo tipeado en el otro. */
export function setConfigType(type: ConnectorType | null): void {
  configTypeSignal.value = type;
  clearConfigError();
}

/** Edita un campo del conector activo. */
export function setConfigField(key: string, value: string): void {
  const type = configTypeSignal.value;
  if (type === null) {
    return;
  }
  const all = configFieldValuesSignal.value;
  configFieldValuesSignal.value = { ...all, [type]: { ...all[type], [key]: value } };
  clearConfigError();
}

export function setConfigLocale(value: string): void {
  configLocaleSignal.value = value;
  clearConfigError();
}

/**
 * Valida el formulario (solo al confirmar, nunca mientras se tipea) y arma la
 * config candidata. Un valor vacío se omite (un opcional en blanco no se
 * guarda). En caso de error deja el mensaje y el campo señalado en los signals.
 */
function validateForm(): SyncConfig | undefined {
  const type = configTypeSignal.value;
  if (type === null) {
    configErrorSignal.value = 'Elegí un tipo de conexión.';
    return undefined;
  }
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
  if (parsed.success) {
    return parsed.data;
  }
  const offendingKey = parsed.error.issues[0]?.path[0];
  const field = fields.find((candidateField) => candidateField.key === offendingKey);
  if (field === undefined) {
    configErrorSignal.value = 'La configuración no es válida.';
    return undefined;
  }
  const isEmpty = (raw[field.key] ?? '').trim() === '';
  configErrorFieldSignal.value = field.key;
  configErrorSignal.value = isEmpty
    ? `Completá «${field.label}».`
    : `«${field.label}» no es válido.`;
  return undefined;
}

async function applyAndFinish(pending: PendingApply): Promise<void> {
  configPhaseSignal.value = 'applying';
  const result = await applyConnection({ ...pending, now: new Date().toISOString() });
  if (!result.ok) {
    configPhaseSignal.value = 'editing';
    configErrorSignal.value = describeError(result);
    return;
  }
  if (pending.wipe) {
    // La venta en curso ya no existe en la base: se vacía también en memoria.
    cartSignal.value = { lines: [] };
    cartSelectionIndexSignal.value = null;
    resetAttachedCustomer();
  }
  pendingApply = undefined;
  resetConfigForm();
  activeScreenSignal.value = 'sale';
  void runSyncCycle();
}

/**
 * Ctrl+Enter: valida, **prueba** la conexión (pull completo en memoria,
 * todo o nada), **planea** (¿cambió el origen? ¿se perderían datos del
 * usuario?) y, según eso, aplica directo o pide confirmación. Nada local ni
 * guardado cambia hasta que la prueba salió bien y, si hace falta, el usuario
 * confirmó el borrado.
 */
export async function submitConfig(): Promise<void> {
  if (configPhaseSignal.value !== 'editing') {
    return;
  }
  const candidate = validateForm();
  if (candidate === undefined) {
    return;
  }

  clearConfigError();
  submitToken += 1;
  const token = submitToken;
  configPhaseSignal.value = 'probing';

  const probe = await probeConnection(candidate);
  if (token !== submitToken) {
    return;
  }
  if (!probe.ok) {
    configPhaseSignal.value = 'editing';
    configErrorSignal.value = describeError(probe);
    return;
  }

  const currentResult = loadSyncConfig();
  const current = currentResult.ok ? currentResult.value : undefined;
  const plan = planConnectionChange({
    current,
    candidate,
    localData: await summarizeLocalData(),
  });
  const pending: PendingApply = { candidate, snapshot: probe.value, wipe: plan.wipe };

  if (!plan.needsConfirmation) {
    await applyAndFinish(pending);
    return;
  }

  // Antes de advertir qué se pierde: un último intento de enviar lo pendiente
  // al backend ACTUAL, así el conteo de "sin enviar" es el que de verdad queda.
  if (current !== undefined && navigator.onLine) {
    await flushPendingBeforeWipe(current);
  }
  const summary = await summarizeLocalData();
  if (token !== submitToken) {
    return;
  }
  pendingApply = pending;
  configConfirmationSignal.value = summary;
  configPhaseSignal.value = 'confirming';
}

/** Enter en la confirmación: borra lo local y aplica la conexión nueva. */
export async function confirmConfigChange(): Promise<void> {
  const pending = pendingApply;
  if (configPhaseSignal.value !== 'confirming' || pending === undefined) {
    return;
  }
  await applyAndFinish(pending);
}
