import 'fake-indexeddb/auto';
import Dexie, { type EntityTable } from 'dexie';
import { describe, expect, it, vi } from 'vitest';
import {
  openWriteTransactionCount,
  trackWriteTransactions,
  waitForIdleWriteTransactions,
} from './transaction-tracker.ts';

class TrackedDb extends Dexie {
  items!: EntityTable<{ id: string }, 'id'>;

  constructor() {
    super('transaction-tracker-test');
    this.version(1).stores({ items: 'id' });
  }
}

const trackedDb = new TrackedDb();
trackWriteTransactions(trackedDb);

/** Una escritura que queda abierta hasta llamar a `finish` (`Dexie.waitFor` la mantiene viva). */
function openWrite(id: string): { finish: () => void; done: Promise<void> } {
  let finish: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const done = trackedDb.transaction('rw', trackedDb.items, async () => {
    await trackedDb.items.put({ id });
    await Dexie.waitFor(gate);
  });
  return { finish, done };
}

describe('contador de escrituras (#175)', () => {
  it('cuenta una escritura abierta y vuelve a 0 al terminar', async () => {
    const write = openWrite('a');
    await vi.waitFor(() => {
      expect(openWriteTransactionCount()).toBe(1);
    });
    write.finish();
    await write.done;
    await vi.waitFor(() => {
      expect(openWriteTransactionCount()).toBe(0);
    });
  });

  it('una lectura no cuenta', async () => {
    let inside = -1;
    await trackedDb.transaction('r', trackedDb.items, async () => {
      inside = openWriteTransactionCount();
      await trackedDb.items.get('a');
    });
    expect(inside).toBe(0);
  });

  it('una escritura abortada también descuenta', async () => {
    await expect(
      trackedDb.transaction('rw', trackedDb.items, async () => {
        await trackedDb.items.put({ id: 'b' });
        throw new Error('falla a propósito');
      }),
    ).rejects.toThrow('falla a propósito');
    await vi.waitFor(() => {
      expect(openWriteTransactionCount()).toBe(0);
    });
  });

  it('waitForIdleWriteTransactions resuelve true cuando termina la escritura en curso', async () => {
    const write = openWrite('c');
    await vi.waitFor(() => {
      expect(openWriteTransactionCount()).toBe(1);
    });
    const idle = waitForIdleWriteTransactions(2000);
    write.finish();
    await write.done;
    await expect(idle).resolves.toBe(true);
  });

  it('waitForIdleWriteTransactions vence con false si la escritura no termina', async () => {
    const write = openWrite('d');
    await vi.waitFor(() => {
      expect(openWriteTransactionCount()).toBe(1);
    });
    await expect(waitForIdleWriteTransactions(30)).resolves.toBe(false);
    write.finish();
    await write.done;
  });

  it('sin escrituras abiertas resuelve true enseguida', async () => {
    await vi.waitFor(() => {
      expect(openWriteTransactionCount()).toBe(0);
    });
    await expect(waitForIdleWriteTransactions(0)).resolves.toBe(true);
  });
});
