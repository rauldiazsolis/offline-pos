import { beforeEach, describe, expect, it, vi } from 'vitest';
import { err, ok, type Result } from '../domain/result.ts';
import type { ApplyConnectionParams } from '../sync/apply-connection.ts';
import type { SyncConfig } from '../sync/config.ts';
import type { ProbeSnapshot } from '../sync/connection.ts';
import type { DemoSession } from '../sync/demo-session.ts';
import { runOnboardingFromUrl, startDemo, type OnboardingDeps } from './onboarding.ts';

const NOW = new Date('2026-09-28T12:00:00.000Z');

const encode = (value: object) =>
  btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const session: DemoSession = {
  apiKey: 'k',
  branch: 'CENTRAL',
  pointOfSale: 'Caja 1',
  template: 'kiosco',
  onboarding: { url: 'https://b.x/alta', label: 'Crear mi comercio' },
};

const snapshot: ProbeSnapshot = { products: [], stock: [], customers: [], cursors: {} };

const NO_CONFIG: Result<SyncConfig> = err('sync/config-missing', undefined);
const DEMO_CONFIG: Result<SyncConfig> = ok({
  type: 'rest',
  baseUrl: 'https://b.x',
  apiKey: 'k',
  branch: 'CENTRAL',
  pointOfSale: 'Caja 1',
  verifiedAt: 'x',
  demo: { template: 'kiosco', onboarding: session.onboarding, startedAt: 'x' },
});
const INVALID_CONFIG: Result<SyncConfig> = err('sync/config-invalid', { issues: [] });
const REAL_CONFIG: Result<SyncConfig> = ok({
  type: 'rest',
  baseUrl: 'https://erp.x',
  branch: 'A',
  pointOfSale: 'B',
  verifiedAt: 'x',
});

const entry = 'https://pos.x/?demo=true&backend=https://b.x';

function makeDeps() {
  return {
    requestDemoSession: vi.fn<OnboardingDeps['requestDemoSession']>(() =>
      Promise.resolve(ok(session)),
    ),
    probeConnection: vi.fn<OnboardingDeps['probeConnection']>(() => Promise.resolve(ok(snapshot))),
    applyConnection: vi.fn<OnboardingDeps['applyConnection']>(() => Promise.resolve(ok(undefined))),
    consumeWipeKey: vi.fn<OnboardingDeps['consumeWipeKey']>(() => false),
    now: () => NOW,
  };
}

let deps: ReturnType<typeof makeDeps>;

beforeEach(() => {
  deps = makeDeps();
});

function applied(): ApplyConnectionParams | undefined {
  return deps.applyConnection.mock.calls[0]?.[0];
}

describe('runOnboardingFromUrl — entrada con link de demo (#128)', () => {
  it('sin link no hace nada', async () => {
    const outcome = await runOnboardingFromUrl(
      'https://pos.x/',
      { config: NO_CONFIG, hasUserData: false },
      deps,
    );
    expect(outcome).toEqual({ kind: 'none' });
    expect(deps.requestDemoSession).not.toHaveBeenCalled();
    expect(deps.probeConnection).not.toHaveBeenCalled();
    expect(deps.applyConnection).not.toHaveBeenCalled();
  });

  it('entrada sin config: pide la demo, prueba y aplica con wipe', async () => {
    const outcome = await runOnboardingFromUrl(
      entry,
      { config: NO_CONFIG, hasUserData: false },
      deps,
    );

    expect(outcome).toEqual({ kind: 'applied' });
    expect(deps.requestDemoSession).toHaveBeenCalledWith('https://b.x', undefined);
    expect(applied()?.local).toBe('wipe');
    expect(applied()?.candidate).toEqual({
      type: 'rest',
      baseUrl: 'https://b.x',
      apiKey: 'k',
      branch: 'CENTRAL',
      pointOfSale: 'Caja 1',
      demo: {
        template: 'kiosco',
        onboarding: session.onboarding,
        startedAt: NOW.toISOString(),
        backend: 'https://b.x',
      },
    });
    expect(deps.probeConnection).toHaveBeenCalledWith(applied()?.candidate);
  });

  it('ya en demo y sin datos: aplica directo', async () => {
    const outcome = await runOnboardingFromUrl(
      entry,
      { config: DEMO_CONFIG, hasUserData: false },
      deps,
    );
    expect(outcome).toEqual({ kind: 'applied' });
    expect(applied()?.local).toBe('wipe');
  });

  it.each([
    ['ya en demo con datos', DEMO_CONFIG, true],
    ['sin config con datos', NO_CONFIG, true],
    ['conexión real sin datos', REAL_CONFIG, false],
    ['conexión real con datos', REAL_CONFIG, true],
    ['config ilegible', INVALID_CONFIG, false],
  ])('%s: pide confirmación sin llamar al backend (#176)', async (_name, config, hasUserData) => {
    const outcome = await runOnboardingFromUrl(entry, { config, hasUserData }, deps);
    expect(outcome).toEqual({ kind: 'confirm', entry: { backend: 'https://b.x' } });
    expect(deps.requestDemoSession).not.toHaveBeenCalled();
    expect(deps.probeConnection).not.toHaveBeenCalled();
    expect(deps.applyConnection).not.toHaveBeenCalled();
  });

  it('la confirmación lleva el template del link', async () => {
    const outcome = await runOnboardingFromUrl(
      `${entry}&template=almacen`,
      { config: REAL_CONFIG, hasUserData: false },
      deps,
    );
    expect(outcome).toEqual({
      kind: 'confirm',
      entry: { backend: 'https://b.x', template: 'almacen' },
    });
  });

  it('template desconocido: reintenta sin template y avisa', async () => {
    deps.requestDemoSession
      .mockResolvedValueOnce(
        err('demo/unknown-template', { template: 'nope', templates: ['kiosco'] }),
      )
      .mockResolvedValueOnce(ok(session));

    const outcome = await runOnboardingFromUrl(
      `${entry}&template=nope`,
      { config: NO_CONFIG, hasUserData: false },
      deps,
    );

    expect(outcome).toEqual({
      kind: 'applied',
      notice: 'La plantilla nope no existe; se usó kiosco.',
    });
    expect(deps.requestDemoSession).toHaveBeenNthCalledWith(1, 'https://b.x', 'nope');
    expect(deps.requestDemoSession).toHaveBeenNthCalledWith(2, 'https://b.x');
  });

  it('backend sin demos (404) → failed con el motivo', async () => {
    deps.requestDemoSession.mockResolvedValue(err('demo/not-offered', undefined));
    const outcome = await runOnboardingFromUrl(
      entry,
      { config: NO_CONFIG, hasUserData: false },
      deps,
    );
    expect(outcome).toEqual({
      kind: 'failed',
      notice: 'No se pudo iniciar la demo: este backend no ofrece demos.',
    });
    expect(deps.applyConnection).not.toHaveBeenCalled();
  });

  it('backend con el tope de demos (503) → failed con el motivo, sin reintentar', async () => {
    deps.requestDemoSession.mockResolvedValue(err('demo/capacity', undefined));
    const outcome = await runOnboardingFromUrl(
      entry,
      { config: NO_CONFIG, hasUserData: false },
      deps,
    );
    expect(outcome).toEqual({
      kind: 'failed',
      notice:
        'No se pudo iniciar la demo: hay demasiadas demos abiertas en este momento; probá de nuevo en unos minutos.',
    });
    expect(deps.requestDemoSession).toHaveBeenCalledTimes(1);
    expect(deps.applyConnection).not.toHaveBeenCalled();
  });

  it('link inválido → failed', async () => {
    const outcome = await runOnboardingFromUrl(
      'https://pos.x/?demo=true&backend=http://b.x',
      { config: NO_CONFIG, hasUserData: false },
      deps,
    );
    expect(outcome).toEqual({
      kind: 'failed',
      notice: 'No se pudo iniciar la demo: el backend tiene que ser https (o http a localhost).',
    });
    expect(deps.requestDemoSession).not.toHaveBeenCalled();
  });

  it('la prueba falla → failed, sin aplicar', async () => {
    deps.probeConnection.mockResolvedValue(err('sync/timeout', { seconds: 20 }));
    const outcome = await runOnboardingFromUrl(
      entry,
      { config: NO_CONFIG, hasUserData: false },
      deps,
    );
    expect(outcome).toEqual({
      kind: 'failed',
      notice: 'No se pudo iniciar la demo: El servidor no respondió en 20 segundos.',
    });
    expect(deps.applyConnection).not.toHaveBeenCalled();
  });

  it('usa baseUrl de la sesión si viene', async () => {
    deps.requestDemoSession.mockResolvedValue(ok({ ...session, baseUrl: 'https://api.b.x' }));
    await runOnboardingFromUrl(entry, { config: NO_CONFIG, hasUserData: false }, deps);
    expect(applied()?.candidate).toMatchObject({ baseUrl: 'https://api.b.x' });
  });

  it('conserva el locale de la config actual', async () => {
    const withLocale: Result<SyncConfig> = DEMO_CONFIG.ok
      ? ok({ ...DEMO_CONFIG.value, locale: 'es-AR' })
      : DEMO_CONFIG;
    await runOnboardingFromUrl(entry, { config: withLocale, hasUserData: false }, deps);
    expect(applied()?.candidate).toMatchObject({ locale: 'es-AR' });
  });
});

describe('startDemo (#176)', () => {
  it('pide la demo, prueba y aplica con wipe, aunque la terminal tenga una conexión real', async () => {
    const outcome = await startDemo({ backend: 'https://b.x' }, REAL_CONFIG, deps);
    expect(outcome).toEqual({ kind: 'applied' });
    expect(applied()?.local).toBe('wipe');
    expect(applied()?.candidate.demo?.backend).toBe('https://b.x');
  });

  it('si el backend no ofrece demos: failed y no aplica nada', async () => {
    deps.requestDemoSession.mockResolvedValue(err('demo/not-offered', undefined));
    const outcome = await startDemo({ backend: 'https://b.x' }, REAL_CONFIG, deps);
    expect(outcome).toEqual({
      kind: 'failed',
      notice: 'No se pudo iniciar la demo: este backend no ofrece demos.',
    });
    expect(deps.applyConnection).not.toHaveBeenCalled();
  });

  it('template desconocido: reintenta sin template y avisa', async () => {
    deps.requestDemoSession
      .mockResolvedValueOnce(
        err('demo/unknown-template', { template: 'nope', templates: ['kiosco'] }),
      )
      .mockResolvedValueOnce(ok(session));
    const outcome = await startDemo({ backend: 'https://b.x', template: 'nope' }, NO_CONFIG, deps);
    expect(outcome).toEqual({
      kind: 'applied',
      notice: 'La plantilla nope no existe; se usó kiosco.',
    });
  });
});

describe('runOnboardingFromUrl — vuelta del alta (#128)', () => {
  const back = (payload: object) => `https://pos.x/#connect=${encode(payload)}`;
  const ret = {
    baseUrl: 'https://b.x',
    apiKey: 'real',
    branch: 'CENTRAL',
    pointOfSale: 'Caja 1',
    wipeKey: 'w',
  };

  it('con wipe_key válido: aplica con wipe y sin demo', async () => {
    deps.consumeWipeKey.mockReturnValue(true);

    const outcome = await runOnboardingFromUrl(
      back(ret),
      { config: DEMO_CONFIG, hasUserData: true },
      deps,
    );

    expect(outcome).toEqual({ kind: 'applied' });
    expect(deps.consumeWipeKey).toHaveBeenCalledWith('w', NOW);
    expect(applied()?.local).toBe('wipe');
    expect(applied()?.candidate).not.toHaveProperty('demo');
    expect(applied()?.candidate).toEqual({
      type: 'rest',
      baseUrl: 'https://b.x',
      apiKey: 'real',
      branch: 'CENTRAL',
      pointOfSale: 'Caja 1',
    });
  });

  it('sin wipe_key válido y sin datos: aplica igual', async () => {
    const outcome = await runOnboardingFromUrl(
      back(ret),
      { config: DEMO_CONFIG, hasUserData: false },
      deps,
    );
    expect(outcome).toEqual({ kind: 'applied' });
    expect(applied()?.local).toBe('wipe');
  });

  it('sin wipe_key válido y con datos: review sin borrar', async () => {
    const outcome = await runOnboardingFromUrl(
      back(ret),
      { config: DEMO_CONFIG, hasUserData: true },
      deps,
    );
    expect(outcome).toEqual({
      kind: 'review',
      candidate: {
        type: 'rest',
        baseUrl: 'https://b.x',
        apiKey: 'real',
        branch: 'CENTRAL',
        pointOfSale: 'Caja 1',
      },
      notice:
        'Volviste del alta. Esta terminal tiene datos locales: revisá la conexión y elegí qué hacer con ellos.',
    });
    expect(deps.probeConnection).not.toHaveBeenCalled();
    expect(deps.applyConnection).not.toHaveBeenCalled();
  });

  it('con la prueba fallida: review con el motivo', async () => {
    deps.consumeWipeKey.mockReturnValue(true);
    deps.probeConnection.mockResolvedValue(err('sync/timeout', { seconds: 20 }));

    const outcome = await runOnboardingFromUrl(
      back(ret),
      { config: DEMO_CONFIG, hasUserData: true },
      deps,
    );

    expect(outcome).toMatchObject({
      kind: 'review',
      notice: 'No se pudo probar la conexión del alta: El servidor no respondió en 20 segundos.',
    });
    expect(deps.applyConnection).not.toHaveBeenCalled();
  });

  it('vuelta inválida → failed', async () => {
    const outcome = await runOnboardingFromUrl(
      back({ apiKey: 'k' }),
      { config: DEMO_CONFIG, hasUserData: false },
      deps,
    );
    expect(outcome).toEqual({
      kind: 'failed',
      notice:
        'No se pudo completar el alta: los datos de conexión que devolvió el alta no son válidos.',
    });
    expect(deps.applyConnection).not.toHaveBeenCalled();
  });
});

describe('runOnboardingFromUrl — Conectar el POS desde una planilla (#133)', () => {
  const webAppUrl = 'https://script.google.com/macros/s/abc/exec';
  const sheetsLink = `https://pos.x/#connect=${encode({ type: 'google-sheets', webAppUrl })}`;
  const notice =
    'Conexión con la planilla precargada: completá la sucursal y el punto de venta (y el secreto compartido, si lo configuraste en Apps Script) y probá la conexión.';

  it.each([
    ['sin config', NO_CONFIG, false],
    ['en demo y sin datos', DEMO_CONFIG, false],
    ['con una conexión real y datos', REAL_CONFIG, true],
  ])(
    '%s: siempre review, sin probar, aplicar ni consumir un wipe_key',
    async (_, config, hasUserData) => {
      const outcome = await runOnboardingFromUrl(sheetsLink, { config, hasUserData }, deps);

      expect(outcome).toEqual({
        kind: 'review',
        candidate: { type: 'google-sheets', webAppUrl },
        notice,
      });
      expect(deps.probeConnection).not.toHaveBeenCalled();
      expect(deps.applyConnection).not.toHaveBeenCalled();
      expect(deps.consumeWipeKey).not.toHaveBeenCalled();
    },
  );

  it('conserva el locale de la config actual', async () => {
    const config: Result<SyncConfig> = ok({
      type: 'rest',
      baseUrl: 'https://erp.x',
      locale: 'es-AR',
    });
    const outcome = await runOnboardingFromUrl(sheetsLink, { config, hasUserData: false }, deps);
    expect(outcome).toMatchObject({ candidate: { locale: 'es-AR' } });
  });
});
