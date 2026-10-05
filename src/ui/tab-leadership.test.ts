import { describe, expect, it } from 'vitest';
import { createFakeTabBus, FakeTabLocks } from '../test/fake-tab-locks.ts';
import { claimTab, parseTabMessage, type TabLeadershipDeps } from './tab-leadership.ts';

const NAME = 'offline-pos:tab';

type Tab = {
  deps: TabLeadershipDeps;
  calls: { prepared: number[]; displaced: number; reloads: number };
};

/**
 * Una pestaña de mentira. `reload` simula lo que hace el navegador al recargar: suelta el cerrojo
 * (salvo `hung`, una pestaña colgada que nunca llega a recargarse).
 */
function openTab(
  locks: FakeTabLocks,
  bus: ReturnType<typeof createFakeTabBus>,
  options: { prepareRelease?: (ms: number) => Promise<void>; hung?: boolean } = {},
): Tab {
  const calls = { prepared: [] as number[], displaced: 0, reloads: 0 };
  const deps: TabLeadershipDeps = {
    locks,
    channel: bus.open(),
    prepareRelease: async (ms) => {
      calls.prepared.push(ms);
      await options.prepareRelease?.(ms);
    },
    markDisplaced: () => {
      calls.displaced += 1;
    },
    reload: () => {
      calls.reloads += 1;
      if (options.hung !== true) {
        locks.closeHolder();
      }
    },
    stealAfterMs: 80,
    releaseWaitMs: 40,
  };
  return { deps, calls };
}

const never = (): Promise<void> => new Promise(() => undefined);

describe('claimTab (#175)', () => {
  it('sin otra pestaña, esta manda', async () => {
    const locks = new FakeTabLocks();
    const bus = createFakeTabBus();
    expect((await claimTab(NAME, openTab(locks, bus).deps)).kind).toBe('leader');
  });

  it('con otra que manda, queda como segunda', async () => {
    const locks = new FakeTabLocks();
    const bus = createFakeTabBus();
    await claimTab(NAME, openTab(locks, bus).deps);
    expect((await claimTab(NAME, openTab(locks, bus).deps)).kind).toBe('secondary');
  });

  it('sin navigator.locks manda siempre (la app arranca como antes)', async () => {
    const bus = createFakeTabBus();
    const tab = openTab(new FakeTabLocks(), bus);
    expect((await claimTab(NAME, { ...tab.deps, locks: undefined })).kind).toBe('leader');
    expect((await claimTab(NAME, { ...tab.deps, locks: undefined })).kind).toBe('leader');
  });
});

describe('Usar esta pestaña (#175)', () => {
  it('la original prepara, se marca desplazada y se recarga; la segunda pasa a mandar', async () => {
    const locks = new FakeTabLocks();
    const bus = createFakeTabBus();
    const original = openTab(locks, bus);
    await claimTab(NAME, original.deps);
    const second = await claimTab(NAME, openTab(locks, bus).deps);
    if (second.kind !== 'secondary') throw new Error('se esperaba una segunda pestaña');

    await second.takeOver();

    expect(original.calls).toEqual({ prepared: [40], displaced: 1, reloads: 1 });
    expect((await claimTab(NAME, openTab(locks, bus).deps)).kind).toBe('secondary');
  });

  it('un pedido repetido mientras suelta no la prepara dos veces', async () => {
    const locks = new FakeTabLocks();
    const bus = createFakeTabBus();
    const original = openTab(locks, bus, { prepareRelease: never });
    await claimTab(NAME, original.deps);
    const other = bus.open();
    other.post({ type: 'release-request' });
    other.post({ type: 'release-request' });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(original.calls.prepared).toEqual([40]);
  });

  it('si la original no contesta, la segunda le quita el cerrojo y la original se recarga', async () => {
    const locks = new FakeTabLocks();
    const bus = createFakeTabBus();
    const original = openTab(locks, bus, { prepareRelease: never, hung: true });
    await claimTab(NAME, original.deps);
    const second = await claimTab(NAME, openTab(locks, bus).deps);
    if (second.kind !== 'secondary') throw new Error('se esperaba una segunda pestaña');

    await second.takeOver();

    expect(original.calls.displaced).toBe(1);
    expect(original.calls.reloads).toBe(1);
    expect((await claimTab(NAME, openTab(locks, bus).deps)).kind).toBe('secondary');
  });

  it('con la original cerrada, toma el control enseguida (sin esperar el tope)', async () => {
    const locks = new FakeTabLocks();
    const bus = createFakeTabBus();
    const original = openTab(locks, bus);
    await claimTab(NAME, original.deps);
    const second = await claimTab(NAME, openTab(locks, bus).deps);
    if (second.kind !== 'secondary') throw new Error('se esperaba una segunda pestaña');
    // Cerrar la pestaña: deja de escuchar el canal y suelta el cerrojo.
    bus.close(original.deps.channel);
    locks.closeHolder();

    const started = Date.now();
    await second.takeOver();

    expect(Date.now() - started).toBeLessThan(80);
    expect(original.calls.displaced).toBe(0);
  });

  it('la que tomó el control también suelta cuando se lo piden', async () => {
    const locks = new FakeTabLocks();
    const bus = createFakeTabBus();
    await claimTab(NAME, openTab(locks, bus).deps);
    const middle = openTab(locks, bus);
    const middleClaim = await claimTab(NAME, middle.deps);
    if (middleClaim.kind !== 'secondary') throw new Error('se esperaba una segunda pestaña');
    await middleClaim.takeOver();
    const last = await claimTab(NAME, openTab(locks, bus).deps);
    if (last.kind !== 'secondary') throw new Error('se esperaba una segunda pestaña');

    await last.takeOver();

    expect(middle.calls).toEqual({ prepared: [40], displaced: 1, reloads: 1 });
  });
});

describe('parseTabMessage', () => {
  it('acepta el pedido de traspaso e ignora cualquier otra cosa', () => {
    expect(parseTabMessage({ type: 'release-request' })).toEqual({ type: 'release-request' });
    expect(parseTabMessage({ type: 'otra-cosa' })).toBeUndefined();
    expect(parseTabMessage('release-request')).toBeUndefined();
  });
});
