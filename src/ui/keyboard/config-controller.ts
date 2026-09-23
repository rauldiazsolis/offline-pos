import { summarizeLocalData } from '../../storage/local-data.ts';
import {
  applyConnection,
  applyTerminalSettings,
  flushPendingBeforeWipe,
} from '../../sync/apply-connection.ts';
import { loadSyncConfig } from '../../sync/config.ts';
import { probeConnection, type ProbeSnapshot } from '../../sync/connection.ts';
import { CONNECTOR_TYPES, type ConnectorType } from '../../sync/connector-registry.ts';
import { runPushThenPull } from '../../sync/engine.ts';
import { describeError } from '../errors.ts';
import { cartSelectionIndexSignal, cartSignal } from '../state/cart.ts';
import { resetAttachedCustomer } from '../state/customer.ts';
import { activeScreenSignal } from '../state/screen.ts';
import { connectionStateSignal, setSyncPaused } from '../state/sync.ts';
import {
  configErrorFieldSignal,
  configErrorSignal,
  configFieldValuesSignal,
  configTerminalSignal,
  configTypeSignal,
  currentWizardInput,
  identityResetSignal,
  localChoiceConfirmedSignal,
  localChoiceSignal,
  localDataSignal,
  probeOutcomeSignal,
  probeProgressSignal,
  resetConfigForm,
  savedConfigSignal,
  wipeSummarySignal,
  wizardAsyncSignal,
  wizardModelSignal,
  wizardStepSignal,
  type TerminalFieldKey,
} from '../state/sync-config.ts';
import {
  initialStep,
  isReachable,
  nextStep,
  previousStep,
  validateStep,
  WIZARD_STEPS,
  type LocalChoice,
  type StepValidation,
  type WizardModel,
  type WizardStepId,
} from './config-wizard-model.ts';

/**
 * `/CONFIG` como wizard (Etapa 2 de #94, #97). Las reglas (salteos, qué hace
 * Aplicar) viven en el modelo puro (`config-wizard-model.ts`, vía
 * `wizardModelSignal`); acá solo se orquesta lo async — probar, enviar lo
 * pendiente antes de borrar, aplicar — y la navegación. Mientras el wizard
 * está abierto no hay sync de fondo (`syncPausedSignal`).
 */

/**
 * Token de la prueba en curso: Esc lo incrementa y la prueba, al volver,
 * descarta su resultado si el token ya no es el suyo (no se cancela el
 * `fetch`, solo se ignora lo que traiga).
 */
let probeToken = 0;
/** Foto de la última prueba exitosa, con la clave de conexión con que se hizo. */
let lastSnapshot: { key: string; snapshot: ProbeSnapshot } | undefined;

function model(): WizardModel {
  return wizardModelSignal.value;
}

function clearError(): void {
  configErrorSignal.value = null;
  configErrorFieldSignal.value = null;
}

async function refreshLocalData(): Promise<void> {
  localDataSignal.value = await summarizeLocalData();
}

function openWizard(): void {
  probeToken += 1;
  lastSnapshot = undefined;
  const saved = loadSyncConfig();
  resetConfigForm(saved.ok ? saved.value : undefined);
  // Mientras se configura no hay ciclos de sync (ver `syncPausedSignal`); se
  // reanuda al cancelar o al aplicar.
  setSyncPaused(true);
}

/** `/CONFIG` con la terminal activa: abre en Revisar, con todo precargado. */
export function enterConfigScreen(): void {
  openWizard();
  void refreshLocalData();
  goToStep(initialStep(model(), { active: true, identityReset: identityResetSignal.value }));
  activeScreenSignal.value = 'config';
}

/**
 * Arranque sin conexión activa (modo requerido: instalación, `unverified`,
 * `incomplete` o identidad perdida): lo llama `bootstrap`. Abre en el primer
 * paso no completo.
 */
export async function openRequiredWizard(): Promise<void> {
  openWizard();
  await refreshLocalData();
  goToStep(initialStep(model(), { active: false, identityReset: identityResetSignal.value }));
}

function leaveWizard(): void {
  probeToken += 1;
  lastSnapshot = undefined;
  resetConfigForm();
  setSyncPaused(false);
  activeScreenSignal.value = 'sale';
}

/**
 * Navegación interna, sin chequear alcance. Entrar a Probar sin una prueba
 * vigente la lanza sola. Irse de un paso mientras se prueba cancela la prueba.
 */
export function goToStep(step: WizardStepId): void {
  const async = wizardAsyncSignal.value;
  if (async !== 'idle' && async !== 'probing') {
    return;
  }
  if (async === 'probing') {
    if (step === 'probe') {
      return;
    }
    cancelProbe();
  }
  clearError();
  wizardStepSignal.value = step;
  if (step === 'probe' && !model().probeValid) {
    void runProbe();
  }
}

/** Salto desde la columna de pasos o Alt+N: solo a un paso alcanzable. */
export function jumpToStep(step: WizardStepId): void {
  if (isReachable(model(), step)) {
    goToStep(step);
  }
}

/** Alt+← / "Atrás": paso anterior no salteado. */
export function goBack(): void {
  goToStep(previousStep(model(), wizardStepSignal.value));
}

function showValidation(result: StepValidation): boolean {
  if (result.ok) {
    return true;
  }
  configErrorSignal.value = result.message;
  configErrorFieldSignal.value = result.field ?? null;
  return false;
}

/** Enter: valida el paso actual y avanza al siguiente no salteado. */
export function advance(): void {
  if (wizardAsyncSignal.value === 'confirming-wipe') {
    void confirmWipe();
    return;
  }
  if (wizardAsyncSignal.value !== 'idle') {
    return;
  }
  const step = wizardStepSignal.value;
  switch (step) {
    case 'terminal':
    case 'type':
    case 'connector':
      if (showValidation(validateStep(currentWizardInput(), step))) {
        goToStep(nextStep(model(), step));
      }
      return;
    case 'probe':
      if (model().probeValid) {
        goToStep(nextStep(model(), step));
      } else {
        void runProbe();
      }
      return;
    case 'local-data':
      if (localChoiceSignal.value === 'keep') {
        localChoiceConfirmedSignal.value = true;
        goToStep(nextStep(model(), step));
      } else {
        void prepareWipe();
      }
      return;
    case 'review':
      void applyWizard();
  }
}

/**
 * Ctrl+Enter: recorre desde el paso 1 y se frena en el primer paso donde hace
 * falta el usuario — un error de validación, Probar (lanzando la prueba si no
 * está vigente), Datos locales si corresponde, o Revisar.
 */
export function fastForward(): void {
  if (wizardAsyncSignal.value !== 'idle') {
    return;
  }
  for (const step of WIZARD_STEPS) {
    const current = model();
    if (current.steps.find((candidate) => candidate.id === step)?.status === 'skipped') {
      continue;
    }
    if (step === 'terminal' || step === 'type' || step === 'connector') {
      const validation = validateStep(currentWizardInput(), step);
      if (!validation.ok) {
        goToStep(step);
        showValidation(validation);
        return;
      }
      continue;
    }
    if (step === 'probe' && current.probeValid) {
      continue;
    }
    if (step === 'local-data' && localChoiceConfirmedSignal.value) {
      continue;
    }
    goToStep(step);
    return;
  }
}

function cancelProbe(): void {
  probeToken += 1;
  const key = model().connectionKey;
  probeOutcomeSignal.value = key === undefined ? null : { status: 'cancelled', key };
  probeProgressSignal.value = null;
  wizardAsyncSignal.value = 'idle';
}

async function runProbe(): Promise<void> {
  const current = model();
  const candidate = current.candidate;
  const key = current.connectionKey;
  if (candidate === undefined || key === undefined) {
    // No debería pasar (Probar solo es alcanzable con los pasos anteriores completos),
    // pero si pasa, se vuelve al paso que falta en vez de probar algo a medias.
    if (current.firstIncomplete !== 'probe') {
      goToStep(current.firstIncomplete);
    }
    return;
  }
  probeToken += 1;
  const token = probeToken;
  wizardAsyncSignal.value = 'probing';
  probeOutcomeSignal.value = null;
  probeProgressSignal.value = { stage: 'pulling', startedAt: Date.now() };
  const result = await probeConnection(candidate, {
    onProgress: (stage) => {
      const progress = probeProgressSignal.value;
      if (token === probeToken && progress !== null) {
        probeProgressSignal.value = { ...progress, stage };
      }
    },
  });
  if (token !== probeToken) {
    return;
  }
  probeProgressSignal.value = null;
  wizardAsyncSignal.value = 'idle';
  if (!result.ok) {
    probeOutcomeSignal.value = { status: 'failed', key, message: describeError(result) };
    return;
  }
  lastSnapshot = { key, snapshot: result.value };
  probeOutcomeSignal.value = {
    status: 'ok',
    key,
    products: result.value.products.length,
    customers: result.value.customers.length,
  };
  await refreshLocalData();
}

/** "Reintentar (Enter)" en Probar. */
export function retryProbe(): void {
  if (wizardAsyncSignal.value === 'idle') {
    void runProbe();
  }
}

/** Cambia el conector elegido — sin perder lo tipeado en el otro. Invalida la elección de datos locales. */
export function setConfigType(type: ConnectorType | null): void {
  configTypeSignal.value = type;
  localChoiceConfirmedSignal.value = false;
  clearError();
}

/** Click o Enter en una opción del paso "Tipo de conexión": elige y avanza. */
export function chooseConnectorType(type: ConnectorType): void {
  setConfigType(type);
  goToStep(nextStep(model(), 'type'));
}

/** ↑/↓ en el paso "Tipo de conexión". */
export function moveTypeChoice(direction: 1 | -1): void {
  const index = CONNECTOR_TYPES.findIndex((info) => info.type === configTypeSignal.value);
  const next =
    index === -1
      ? direction === 1
        ? 0
        : CONNECTOR_TYPES.length - 1
      : Math.min(Math.max(index + direction, 0), CONNECTOR_TYPES.length - 1);
  const chosen = CONNECTOR_TYPES[next];
  if (chosen !== undefined) {
    setConfigType(chosen.type);
  }
}

/** Edita un campo del conector activo. */
export function setConfigField(key: string, value: string): void {
  const type = configTypeSignal.value;
  if (type === null) {
    return;
  }
  const all = configFieldValuesSignal.value;
  configFieldValuesSignal.value = { ...all, [type]: { ...all[type], [key]: value } };
  localChoiceConfirmedSignal.value = false;
  clearError();
}

/** Edita un campo de terminal (sucursal, punto de venta, locale). */
export function setConfigTerminalField(key: TerminalFieldKey, value: string): void {
  configTerminalSignal.value = { ...configTerminalSignal.value, [key]: value };
  clearError();
}

export function setLocalChoice(choice: LocalChoice): void {
  localChoiceSignal.value = choice;
  localChoiceConfirmedSignal.value = false;
}

/** ↑/↓ en "Datos locales": alterna entre las dos opciones. */
export function moveLocalChoice(): void {
  setLocalChoice(localChoiceSignal.value === 'keep' ? 'wipe' : 'keep');
}

/**
 * Borrar elegido: antes de mostrar qué se pierde, un último intento de enviar
 * lo pendiente a la conexión **actual** — así el conteo de "sin enviar" es el
 * que de verdad queda.
 */
async function prepareWipe(): Promise<void> {
  wizardAsyncSignal.value = 'flushing';
  const current = savedConfigSignal.value;
  if (current !== undefined && navigator.onLine) {
    await flushPendingBeforeWipe(current);
  }
  wipeSummarySignal.value = await summarizeLocalData();
  wizardAsyncSignal.value = 'confirming-wipe';
}

/** Esc o "Volver" en la confirmación de borrado: vuelve a las opciones sin borrar. */
export function backFromWipeConfirmation(): void {
  if (wizardAsyncSignal.value !== 'confirming-wipe') {
    return;
  }
  wipeSummarySignal.value = null;
  wizardAsyncSignal.value = 'idle';
}

/** Enter en la confirmación de borrado: aplica directo (spec §3, camino 3). */
export async function confirmWipe(): Promise<void> {
  if (wizardAsyncSignal.value !== 'confirming-wipe') {
    return;
  }
  localChoiceConfirmedSignal.value = true;
  wizardAsyncSignal.value = 'idle';
  await applyWizard();
}

/** Enter en Revisar / "Aplicar": lo que diga `applyAction` del modelo. */
export async function applyWizard(): Promise<void> {
  if (wizardAsyncSignal.value !== 'idle') {
    return;
  }
  const current = model();
  const action = current.applyAction;
  if (action === null) {
    goToStep(current.firstIncomplete);
    return;
  }
  wizardAsyncSignal.value = 'applying';
  if (action.kind === 'save-terminal') {
    const result = applyTerminalSettings(configTerminalSignal.value);
    wizardAsyncSignal.value = 'idle';
    if (!result.ok) {
      configErrorSignal.value = describeError(result);
      return;
    }
    finishWizard({ wiped: false });
    return;
  }
  const candidate = current.candidate;
  if (
    candidate === undefined ||
    lastSnapshot === undefined ||
    lastSnapshot.key !== current.connectionKey
  ) {
    wizardAsyncSignal.value = 'idle';
    goToStep('probe');
    return;
  }
  const result = await applyConnection({
    candidate,
    snapshot: lastSnapshot.snapshot,
    local: action.local,
    originChanged: action.originChanged,
    now: new Date().toISOString(),
  });
  wizardAsyncSignal.value = 'idle';
  if (!result.ok) {
    wizardStepSignal.value = 'review';
    configErrorSignal.value = describeError(result);
    return;
  }
  finishWizard({ wiped: action.local === 'wipe' });
  void runPushThenPull();
}

function finishWizard(params: { wiped: boolean }): void {
  if (params.wiped) {
    // La venta en curso ya no existe en la base: se vacía también en memoria.
    cartSignal.value = { lines: [] };
    cartSelectionIndexSignal.value = null;
    resetAttachedCustomer();
  }
  identityResetSignal.value = false;
  leaveWizard();
}

/**
 * Esc según el estado: probando → cancela la prueba (queda en Probar);
 * confirmando el borrado → vuelve a las opciones; enviando o aplicando → se
 * ignora; resto → sale sin guardar, salvo en modo requerido (conexión todavía
 * no activa), donde no hay a dónde salir.
 */
export function handleWizardEscape(): void {
  switch (wizardAsyncSignal.value) {
    case 'probing':
      cancelProbe();
      return;
    case 'confirming-wipe':
      backFromWipeConfirmation();
      return;
    case 'flushing':
    case 'applying':
      return;
    case 'idle':
      if (connectionStateSignal.value === 'active') {
        leaveWizard();
      }
  }
}
