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
 * "cambiar la conexión nunca borra solo" (AGENTS.md): se borra lo local en (a) un link de demo con
 * la terminal sin config y sin datos, o ya en demo; (b) la vuelta del alta con un `wipe_key`
 * emitido por esta terminal, o sin datos del usuario.
 */

export type OnboardingOutcome =
  | { kind: 'none' }
  | { kind: 'applied'; notice?: string }
  | { kind: 'ignored'; notice: string }
  | { kind: 'failed'; notice: string }
  | { kind: 'review'; candidate: SyncConfig; notice: string };

export type OnboardingDeps = {
  requestDemoSession: (backend: string, template?: string) => Promise<Result<DemoSession>>;
  probeConnection: (config: SyncConfig) => Promise<Result<ProbeSnapshot>>;
  applyConnection: (params: ApplyConnectionParams) => Promise<Result<void>>;
  consumeWipeKey: (key: string | undefined, now: Date) => boolean;
  now: () => Date;
};

export type OnboardingContext = { config: Result<SyncConfig>; hasUserData: boolean };

const defaultDeps: OnboardingDeps = {
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
  deps: OnboardingDeps = defaultDeps,
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
  const inDemo = context.config.ok && context.config.value.demo !== undefined;
  const hasConfig = context.config.ok || context.config.error !== 'sync/config-missing';
  if (!inDemo && hasConfig) {
    return {
      kind: 'ignored',
      notice: 'Esta terminal ya está conectada: se ignoró el link de demo.',
    };
  }
  if (!inDemo && context.hasUserData) {
    return {
      kind: 'ignored',
      notice: 'Esta terminal tiene datos locales: se ignoró el link de demo.',
    };
  }

  let notice: string | undefined;
  let session = await deps.requestDemoSession(entry.value.backend, entry.value.template);
  if (
    !session.ok &&
    session.error === 'demo/unknown-template' &&
    entry.value.template !== undefined
  ) {
    session = await deps.requestDemoSession(entry.value.backend);
    if (session.ok) {
      notice = `La plantilla ${entry.value.template} no existe; se usó ${session.value.template}.`;
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
    baseUrl: session.value.baseUrl ?? entry.value.backend,
    apiKey: session.value.apiKey,
    branch: session.value.branch,
    pointOfSale: session.value.pointOfSale,
    ...keptLocale(context.config),
    demo: {
      template: session.value.template,
      onboarding: session.value.onboarding,
      startedAt: now,
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
