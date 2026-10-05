import type { TabChannel, TabLockOptions, TabLocks, TabMessage } from '../ui/tab-leadership.ts';

type Entry = {
  callback: (lock: object | null) => Promise<void>;
  resolve: () => void;
  reject: (reason: DOMException) => void;
};

/**
 * `navigator.locks` de mentira para un solo cerrojo (#175), con la semántica que usa el POS:
 * `ifAvailable` (recibe `null` si está tomado), espera en cola, `signal` (abortar un pedido en espera)
 * y `steal` (a quien lo tenía se le rechaza su `request` con `AbortError`).
 */
export class FakeTabLocks implements TabLocks {
  private holder: Entry | undefined;
  private readonly queue: Entry[] = [];

  request(
    _name: string,
    options: TabLockOptions,
    callback: (lock: object | null) => Promise<void>,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const entry: Entry = { callback, resolve, reject };
      if (options.steal === true) {
        const previous = this.holder;
        this.holder = undefined;
        previous?.reject(new DOMException('Se lo quitaron', 'AbortError'));
        this.grant(entry);
        return;
      }
      if (this.holder === undefined) {
        this.grant(entry);
        return;
      }
      if (options.ifAvailable === true) {
        void callback(null).then(() => {
          resolve();
        });
        return;
      }
      this.queue.push(entry);
      options.signal?.addEventListener('abort', () => {
        const index = this.queue.indexOf(entry);
        if (index !== -1) {
          this.queue.splice(index, 1);
          reject(new DOMException('Abortado', 'AbortError'));
        }
      });
    });
  }

  /** Simula que se cierra la pestaña que tiene el cerrojo: lo suelta y lo recibe la próxima en espera. */
  closeHolder(): void {
    this.holder = undefined;
    this.grantNext();
  }

  private grant(entry: Entry): void {
    this.holder = entry;
    void entry.callback({}).then(() => {
      if (this.holder === entry) {
        this.holder = undefined;
        entry.resolve();
        this.grantNext();
      }
    });
  }

  private grantNext(): void {
    const next = this.queue.shift();
    if (next !== undefined) {
      this.grant(next);
    }
  }
}

/**
 * `BroadcastChannel` de mentira: un mensaje llega a todos los canales abiertos menos al que lo manda.
 * `close` simula que se cerró la pestaña de ese canal: deja de recibir.
 */
export function createFakeTabBus(): {
  open: () => TabChannel;
  close: (channel: TabChannel) => void;
} {
  const handlers = new Map<TabChannel, ((message: TabMessage) => void)[]>();
  return {
    close: (channel) => {
      handlers.delete(channel);
    },
    open: () => {
      const own: ((message: TabMessage) => void)[] = [];
      const channel: TabChannel = {
        post: (message) => {
          for (const [other, otherHandlers] of handlers) {
            if (other !== channel) {
              for (const handler of otherHandlers) {
                queueMicrotask(() => {
                  handler(message);
                });
              }
            }
          }
        },
        onMessage: (handler) => {
          own.push(handler);
        },
      };
      handlers.set(channel, own);
      return channel;
    },
  };
}
