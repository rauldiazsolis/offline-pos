import type Dexie from 'dexie';

/**
 * Escrituras de IndexedDB abiertas en esta pestaña (#175): antes de soltar el control, la pestaña que
 * manda espera a que lleguen a 0, así un cobro o un movimiento de caja que se está guardando nunca se
 * corta a medias. Un middleware de Dexie (capa `dbcore`) cuenta todas las transacciones `readwrite`,
 * así una tabla o un repositorio futuro queda cubierto sin acordarse. Las lecturas no cuentan: cortar
 * una no deja nada a medias.
 */
let openWrites = 0;
const idleWaiters = new Set<() => void>();

function finishWrite(): void {
  openWrites -= 1;
  if (openWrites === 0) {
    for (const notify of idleWaiters) {
      notify();
    }
    idleWaiters.clear();
  }
}

export function trackWriteTransactions(database: Dexie): void {
  database.use({
    stack: 'dbcore',
    name: 'write-transaction-tracker',
    create: (down) => ({
      ...down,
      transaction: (stores, mode, options) => {
        const transaction = down.transaction(stores, mode, options);
        // Sobre IndexedDB, la transacción de `dbcore` es la `IDBTransaction` misma.
        if (mode === 'readwrite' && transaction instanceof IDBTransaction) {
          openWrites += 1;
          let finished = false;
          const finish = (): void => {
            if (!finished) {
              finished = true;
              finishWrite();
            }
          };
          transaction.addEventListener('complete', finish);
          transaction.addEventListener('abort', finish);
        }
        return transaction;
      },
    }),
  });
}

export function openWriteTransactionCount(): number {
  return openWrites;
}

/** `true` cuando no queda ninguna escritura abierta; `false` si pasaron `timeoutMs` antes. */
export function waitForIdleWriteTransactions(timeoutMs: number): Promise<boolean> {
  if (openWrites === 0) {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    const onIdle = (): void => {
      clearTimeout(timer);
      resolve(true);
    };
    const timer = setTimeout(() => {
      idleWaiters.delete(onIdle);
      resolve(false);
    }, timeoutMs);
    idleWaiters.add(onIdle);
  });
}
