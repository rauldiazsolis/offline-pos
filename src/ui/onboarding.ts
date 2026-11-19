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
import { retakeCashFromSnapshot } from '../sync/cash-snapshot.ts';
import type { ClaimResponse } from '../sync/claim-schema.ts';
import { requestClaim } from '../sync/device-claim.ts';
import { getDeviceId } from '../sync/terminal-identity.ts';
import { consumeWipeKey } from '../sync/wipe-key.ts';
import { describeError } from './errors.ts';

/**
 * Onboarding de demo (#128): lo llama `bootstrap` una vez, antes del primer render. La lectura de
 * los links es pura (`sync/demo-link.ts`); acá se decide qué hacer y se orquesta. Excepción a
 * "cambiar la conexión nunca borra solo" (AGENTS.md): se borra lo local en (a) un link de demo
 * cuando no se pierde nada (sin config o ya en demo, sin datos del usuario); si no, la terminal
 * pide confirmación (`confirm`, #176) y la demo se pide recién después (`startDemo`); (b) la vuelta
 * del alta con un `wipe_key` emitido por esta terminal, o sin datos del usuario. La vuelta de una
 * planilla de Google Sheets ("Conectar el POS", #133) nunca borra: siempre precarga el wizard.
 * La vuelta con un código de vinculación (`claimToken`, 4.7.0, #230) canjea el código con
 * `POST /claim` antes de guardar nada y después sigue el mismo camino que la del alta; con
 * `cash-snapshot`, además retoma la caja (`retakeCashFromSnapshot`).
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
  /** 4.7.0 (#230): `POST /claim` con el id de este dispositivo. */
  requestClaim: (baseUrl: string, claimToken: string) => Promise<Result<ClaimResponse>>;
  /** 4.7.0 (#230): la foto de la caja después de aplicar un claim; nunca falla. */
  retakeCash: (config: SyncConfig, capabilities: readonly string[] | undefined) => Promise<unknown>;
  now: () => Date;
};

export type OnboardingContext = { config: Result<SyncConfig>; hasUserData: boolean };

export const defaultOnboardingDeps: OnboardingDeps = {
  requestDemoSession: (backend, template) =>
    withTimeout(requestDemoSession(backend, template), PROBE_TIMEOUT_MS),
  probeConnection: (config) => probeConnection(config),
  applyConnection,
  consumeWipeKey,
  requestClaim: (baseUrl, claimToken) =>
    withTimeout(requestClaim(baseUrl, claimToken, getDeviceId()), PROBE_TIMEOUT_MS),
  retakeCash: retakeCashFromSnapshot,
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

const SHEETS_CONNECT_NOTICE =
  'Conexión con la planilla precargada: completá la sucursal y el punto de venta (y el secreto compartido, si lo configuraste en Apps Script) y probá la conexión.';

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
  if (back.value.type === 'google-sheets') {
    return handleSheetsReturn(back.value, context, deps);
  }
  if (back.value.type === 'rest-claim') {
    return handleClaimReturn(back.value, context, deps);
  }
  const { wipeKey, type, ...connection } = back.value;
  const candidate: SyncConfig = { type, ...connection, ...keptLocale(context.config) };
  return applyReturnedConnection(candidate, wipeKey, context, deps, ALTA_TEXTS);
}

/** Los textos de una vuelta REST: la del alta o la de un código de vinculación. */
type ReturnTexts = { review: string; probeFailed: string };

const ALTA_TEXTS: ReturnTexts = {
  review:
    'Volviste del alta. Esta terminal tiene datos locales: revisá la conexión y elegí qué hacer con ellos.',
  probeFailed: 'No se pudo probar la conexión del alta',
};

const CLAIM_TEXTS: ReturnTexts = {
  review:
    'La caja quedó vinculada a este equipo. Esta terminal tiene datos locales: revisá la conexión y elegí qué hacer con ellos.',
  probeFailed: 'La caja quedó vinculada a este equipo, pero no se pudo probar la conexión',
};

/**
 * La vuelta REST, con la conexión ya armada (del fragmento o del claim): con el `wipe_key` o sin
 * datos del usuario, prueba y aplica borrando; si no, o si la prueba falla, el wizard precargado.
 * `retakeCash` (solo la del claim): después de aplicar, la foto de la caja.
 */
async function applyReturnedConnection(
  candidate: SyncConfig,
  wipeKey: string | undefined,
  context: OnboardingContext,
  deps: OnboardingDeps,
  texts: ReturnTexts,
  options: { retakeCash?: boolean } = {},
): Promise<OnboardingOutcome> {
  // El `wipe_key` se consume siempre que venga (es de un solo uso), aunque no haga falta.
  const authorized = deps.consumeWipeKey(wipeKey, deps.now()) || !context.hasUserData;
  if (!authorized) {
    return { kind: 'review', candidate, notice: texts.review };
  }
  const applied = await probeAndWipe(candidate, deps, deps.now().toISOString());
  if (!applied.ok) {
    return {
      kind: 'review',
      candidate,
      notice: sentence(`${texts.probeFailed}: ${describeError(applied)}`),
    };
  }
  if (options.retakeCash === true) {
    await deps.retakeCash(candidate, applied.value.capabilities);
  }
  return { kind: 'applied' };
}

/**
 * La vuelta con un código de vinculación (4.7.0, #230): `POST /claim` antes de guardar nada. Si
 * falla (código inexistente, vencido o usado, backend sin claim, sin red), no se toca nada. Con la
 * key recibida, el mismo camino que la vuelta del alta; la sucursal y la caja del fragmento ganan
 * sobre las de la respuesta. Si termina en el wizard, la key ya se canjeó: va precargada en la
 * conexión (un segundo canje del mismo código desde este equipo devolvería lo mismo, pero no hace
 * falta). Con `cash-snapshot`, después de aplicar se retoma la caja.
 */
async function handleClaimReturn(
  back: Extract<ConnectReturn, { type: 'rest-claim' }>,
  context: OnboardingContext,
  deps: OnboardingDeps,
): Promise<OnboardingOutcome> {
  const claim = await deps.requestClaim(back.baseUrl, back.claimToken);
  if (!claim.ok) {
    return {
      kind: 'failed',
      notice: sentence(`No se pudo vincular la caja: ${describeError(claim)}`),
    };
  }
  const candidate: SyncConfig = {
    type: 'rest',
    baseUrl: back.baseUrl,
    apiKey: claim.value.apiKey,
    branch: back.branch ?? claim.value.branch,
    pointOfSale: back.pointOfSale ?? claim.value.pointOfSale,
    ...keptLocale(context.config),
  };
  return applyReturnedConnection(candidate, back.wipeKey, context, deps, CLAIM_TEXTS, {
    retakeCash: true,
  });
}

/**
 * La vuelta de la página del puente de Sheets (#133). Con la sucursal y la caja en el link y sin
 * datos del usuario no se pierde nada: se prueba y se aplica, como la vuelta del alta. Si no (le
 * falta la identidad, hay datos, o la prueba falla, por ejemplo porque la planilla pide un secreto
 * que el link nunca trae), el wizard con lo que vino precargado.
 */
async function handleSheetsReturn(
  back: Extract<ConnectReturn, { type: 'google-sheets' }>,
  context: OnboardingContext,
  deps: OnboardingDeps,
): Promise<OnboardingOutcome> {
  const candidate: SyncConfig = { ...back, ...keptLocale(context.config) };
  if (back.branch === undefined || back.pointOfSale === undefined) {
    return { kind: 'review', candidate, notice: SHEETS_CONNECT_NOTICE };
  }
  if (context.hasUserData) {
    return {
      kind: 'review',
      candidate,
      notice:
        'Conexión con la planilla precargada. Esta terminal tiene datos locales: revisá la conexión y elegí qué hacer con ellos.',
    };
  }
  const applied = await probeAndWipe(candidate, deps, deps.now().toISOString());
  if (!applied.ok) {
    return {
      kind: 'review',
      candidate,
      notice: `${sentence(`No se pudo probar la conexión con la planilla: ${describeError(applied)}`)} Si configuraste un secreto compartido en Apps Script, completalo y probá de nuevo.`,
    };
  }
  return { kind: 'applied' };
}

/** Prueba y aplica borrando; devuelve la foto de la prueba (sus capacidades, para la caja). */
async function probeAndWipe(
  candidate: SyncConfig,
  deps: OnboardingDeps,
  now: string,
): Promise<Result<ProbeSnapshot>> {
  const probe = await deps.probeConnection(candidate);
  if (!probe.ok) {
    return probe;
  }
  const applied = await deps.applyConnection({
    candidate,
    snapshot: probe.value,
    local: 'wipe',
    originChanged: true,
    now,
  });
  return applied.ok ? probe : applied;
}
