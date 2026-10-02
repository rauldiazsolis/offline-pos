import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// El cerrojo de sync es estado del módulo y `prepareTabRelease` lo deja tomado a propósito: cada
// test importa módulos frescos.
beforeEach(() => {
  vi.resetModules();
});

async function load() {
  const engine = await import('../sync/engine.ts');
  const syncState = await import('./state/sync.ts');
  const { db } = await import('../storage/db.ts');
  const { prepareTabRelease } = await import('./tab-release.ts');
  return { engine, syncState, db, prepareTabRelease };
}

describe('prepareTabRelease (#175)', () => {
  it('pausa el sync, espera a que termine el ciclo en curso y se queda con el cerrojo', async () => {
    const { engine, syncState, prepareTabRelease } = await load();
    const releaseCycle = engine.tryAcquireSyncLock();
    if (releaseCycle === undefined) throw new Error('el cerrojo debería estar libre');
    let done = false;
    const release = prepareTabRelease(2000).then(() => {
      done = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(syncState.syncPausedSignal.value).toBe(true);
    expect(done).toBe(false);

    releaseCycle();
    await release;
    expect(engine.isSyncLockHeld()).toBe(true);
  });

  it('espera a que termine una escritura en IndexedDB', async () => {
    const { db, prepareTabRelease } = await load();
    const { default: Dexie } = await import('dexie');
    let finish: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    let written = false;
    const write = db.transaction('rw', db.draftCart, async () => {
      await db.draftCart.put({ id: 'current', cart: { lines: [] } });
      await Dexie.waitFor(gate);
      written = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    let done = false;
    const release = prepareTabRelease(2000).then(() => {
      done = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(done).toBe(false);

    finish();
    await write;
    await release;
    expect(written).toBe(true);
  });

  it('nunca espera más que el tope', async () => {
    const { engine, prepareTabRelease } = await load();
    engine.tryAcquireSyncLock();
    const started = Date.now();
    await prepareTabRelease(80);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
