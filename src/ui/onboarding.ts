import type { Result } from '../domain/result.ts';
import { applyConnection, type ApplyConnectionParams } from '../sync/apply-connection.ts';
import type { SyncConfig } from '../sync/config.ts';
import {
  PROBE_TIMEOUT_MS,
  probeConnection,
  withTimeout,
  type ProbeSnapshot,
} from '../sync/connection.ts';
import {
  readConnectReturn,
  readDemoEntry,
  type ConnectReturn,
  type DemoEntry,
} from '../sync/demo-link.ts';
import { requestDemoSession, type DemoSession } from '../sync/demo-session.ts';
import { consumeWipeKey } from '../sync/wipe-key.ts';
import { describeError } from './errors.ts';

/**
 * Onboarding de demo (#128): lo llama `bootstrap` una vez, antes del primer render. La lectura de
 * los links es pura (`sync/demo-link.ts`); acá se decide qué hacer y se orquesta. Excepción a
 * "cambiar la conexión nunca borra solo" (AGENTS.md): se borra lo local en (a) un link de demo
 * cuando no se pierde nada (sin config o ya en demo, sin datos del usuario); si no, la terminal
 * pide confirmación (`confirm`, #176) y la demo se pide recién después (`startDemo`); (b) la vuelta
 * del alta con un `wipe_key` emitido por esta terminal, o sin datos del usuario.
 */

export type OnboardingOutcome =
  | { kind: 'none' }
  | { kind: 'applied'; notice?: string }
  | { kind: 'failed'; notice: string }
  | { kind: 'review'; candidate: SyncConfig; notice: string }
  | { kind: 'confirm'; entry: DemoEntry };

/** Cómo terminó pedir, probar y aplicar una demo (#176). */
export type DemoStartOutcome =
  { kind: 'applied'; notice?: string } | { kind: 'failed'; notice: string };

export type OnboardingDeps = {
  requestDemoSession: (backend: string, template?: string) => Promise<Result<DemoSession>>;
  probeConnection: (config: SyncConfig) => Promise<Result<ProbeSnapshot>>;
  applyConnection: (params: ApplyConnectionParams) => Promise<Result<void>>;
  consumeWipeKey: (key: string | undefined, now: Date) => boolean;
  now: () => Date;
};

export type OnboardingContext = { config: Result<SyncConfig>; hasUserData: boolean };

export const defaultOnboardingDeps: OnboardingDeps = {
  requestDemoSession: (backend, template) =>
    withTimeout(requestDemoSession(backend, template), PROBE_TIMEOUT_MS),
  probeConnection: (config) => probeConnection(config),
  applyConnection,
  consumeWipeKey,
  now: () => new Date(),
};

/** Agrega el punto final si falta: los textos de `errors.ts` a veces lo traen y a veces no. */
function sentence(text: string): string {
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

export async function runOnboardingFromUrl(
  href: string,
  context: OnboardingContext,
  deps: OnboardingDeps = defaultOnboardingDeps,
): Promise<OnboardingOutcome> {
  const back = readConnectReturn(href);
  if (back !== undefined) {
    return handleReturn(back, context, deps);
  }
  const entry = readDemoEntry(href);
  if (entry !== undefined) {
    return handleEntry(entry, context, deps);
  }
  return { kind: 'none' };
}

function keptLocale(config: Result<SyncConfig>): { locale?: string } {
  return config.ok && config.value.locale !== undefined ? { locale: config.value.locale } : {};
}

/** No se pierde nada (#176): sin config, o ya en demo, y en los dos casos sin datos del usuario. */
function nothingToLose(context: OnboardingContext): boolean {
  const config = context.config;
  const noConfig = !config.ok && config.error === 'sync/config-missing';
  const inDemo = config.ok && config.value.demo !== undefined;
  return (noConfig || inDemo) && !context.hasUserData;
}

async function handleEntry(
  entry: Result<DemoEntry>,
  context: OnboardingContext,
  deps: OnboardingDeps,
): Promise<OnboardingOutcome> {
  if (!entry.ok) {
    return {
      kind: 'failed',
      notice: sentence(`No se pudo iniciar la demo: ${describeError(entry)}`),
    };
  }
  if (!nothingToLose(context)) {
    return { kind: 'confirm', entry: entry.value };
  }
  return startDemo(entry.value, context.config, deps);
}

/**
 * Pide la demo (reintenta sin template si no existe), la prueba y la aplica borrando lo local. La
 * usan el arranque, cuando no se pierde nada, y la pantalla "Abrir una demo" después de confirmar
 * (#176). Si algo falla no se borró nada.
 */
export async function startDemo(
  entry: DemoEntry,
  config: Result<SyncConfig>,
  deps: OnboardingDeps = defaultOnboardingDeps,
): Promise<DemoStartOutcome> {
  let notice: string | undefined;
  let session = await deps.requestDemoSession(entry.backend, entry.template);
  if (!session.ok && session.error === 'demo/unknown-template' && entry.template !== undefined) {
    session = await deps.requestDemoSession(entry.backend);
    if (session.ok) {
      notice = `La plantilla ${entry.template} no existe; se usó ${session.value.template}.`;
    }
  }
  if (!session.ok) {
    return {
      kind: 'failed',
      notice: sentence(`No se pudo iniciar la demo: ${describeError(session)}`),
    };
  }

  const now = deps.now().toISOString();
  const candidate: SyncConfig = {
    type: 'rest',
    baseUrl: session.value.baseUrl ?? entry.backend,
    apiKey: session.value.apiKey,
    branch: session.value.branch,
    pointOfSale: session.value.pointOfSale,
    ...keptLocale(config),
    demo: {
      template: session.value.template,
      onboarding: session.value.onboarding,
      startedAt: now,
      backend: entry.backend,
    },
  };
  const applied = await probeAndWipe(candidate, deps, now);
  if (!applied.ok) {
    return {
      kind: 'failed',
      notice: sentence(`No se pudo iniciar la demo: ${describeError(applied)}`),
    };
  }
  return notice !== undefined ? { kind: 'applied', notice } : { kind: 'applied' };
}

async function handleReturn(
  back: Result<ConnectReturn>,
  context: OnboardingContext,
  deps: OnboardingDeps,
): Promise<OnboardingOutcome> {
  if (!back.ok) {
    return {
      kind: 'failed',
      notice: sentence(`No se pudo completar el alta: ${describeError(back)}`),
    };
  }
  const { wipeKey, ...connection } = back.value;
  const candidate: SyncConfig = { type: 'rest', ...connection, ...keptLocale(context.config) };
  // El `wipe_key` se consume siempre que venga (es de un solo uso), aunque no haga falta.
  const authorized = deps.consumeWipeKey(wipeKey, deps.now()) || !context.hasUserData;
  if (!authorized) {
    return {
      kind: 'review',
      candidate,
      notice:
        'Volviste del alta. Esta terminal tiene datos locales: revisá la conexión y elegí qué hacer con ellos.',
    };
  }
  const applied = await probeAndWipe(candidate, deps, deps.now().toISOString());
  if (!applied.ok) {
    return {
      kind: 'review',
      candidate,
      notice: sentence(`No se pudo probar la conexión del alta: ${describeError(applied)}`),
    };
  }
  return { kind: 'applied' };
}

async function probeAndWipe(
  candidate: SyncConfig,
  deps: OnboardingDeps,
  now: string,
): Promise<Result<void>> {
  const probe = await deps.probeConnection(candidate);
  if (!probe.ok) {
    return probe;
  }
  return deps.applyConnection({
    candidate,
    snapshot: probe.value,
    local: 'wipe',
    originChanged: true,
    now,
  });
}
