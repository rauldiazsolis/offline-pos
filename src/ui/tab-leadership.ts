import { z } from 'zod';

/**
 * Una sola pestaña del POS por almacenamiento (#175, spec
 * `docs/superpowers/specs/2026-10-02-una-sola-pestana-design.md`). `navigator.locks` decide qué
 * pestaña manda: la que tiene el cerrojo lo retiene mientras viva la página. `BroadcastChannel` solo
 * lleva el pedido de traspaso ("Usar esta pestaña"). Todo llega inyectado (`TabLeadershipDeps`): los
 * adaptadores reales están en `ui/tab-browser.ts`, los de mentira en `test/fake-tab-locks.ts`.
 */

export type TabLockOptions = { ifAvailable?: boolean; steal?: boolean; signal?: AbortSignal };

/** Lo que el POS usa de `navigator.locks`. */
export type TabLocks = {
  request(
    name: string,
    options: TabLockOptions,
    callback: (lock: object | null) => Promise<void>,
  ): Promise<void>;
};

const tabMessageSchema = z.object({ type: z.literal('release-request') });
export type TabMessage = z.infer<typeof tabMessageSchema>;

/** Valida lo que llega por el canal (otra pestaña, quizás de otra versión del POS). */
export function parseTabMessage(data: unknown): TabMessage | undefined {
  const parsed = tabMessageSchema.safeParse(data);
  return parsed.success ? parsed.data : undefined;
}

export type TabChannel = {
  post(message: TabMessage): void;
  onMessage(handler: (message: TabMessage) => void): void;
};

export type TabLeadershipDeps = {
  /** `undefined` sin `navigator.locks` (contexto no seguro): la pestaña manda siempre. */
  locks: TabLocks | undefined;
  channel: TabChannel;
  /** Deja de operar sin cortar nada a medias, con tope (`ui/tab-release.ts`). */
  prepareRelease: (timeoutMs: number) => Promise<void>;
  markDisplaced: () => void;
  reload: () => void;
  stealAfterMs: number;
  releaseWaitMs: number;
};

export type TabClaim = { kind: 'leader' } | { kind: 'secondary'; takeOver: () => Promise<void> };

/** La segunda espera esto a que la original suelte; después le quita el cerrojo. */
export const STEAL_AFTER_MS = 5000;
/** Tope de la original para terminar lo que no se puede cortar (menor que `STEAL_AFTER_MS`). */
export const RELEASE_WAIT_MS = 4000;

type Hold = { granted: Promise<boolean>; isHeld: () => boolean };

/**
 * Pide el cerrojo y, si lo recibe, lo retiene mientras viva la página. `granted` resuelve `true` al
 * recibirlo, o `false` si `ifAvailable` lo encontró tomado o si el pedido se abortó antes. Si después
 * de tenerlo se lo quitan (`steal` desde otra pestaña), se marca desplazada y se recarga.
 */
function requestHold(
  locks: TabLocks,
  name: string,
  options: TabLockOptions,
  deps: TabLeadershipDeps,
): Hold {
  let held = false;
  const granted = new Promise<boolean>((resolve) => {
    locks
      .request(name, options, (lock) => {
        if (lock === null) {
          resolve(false);
          return Promise.resolve();
        }
        held = true;
        resolve(true);
        return new Promise<void>(() => undefined);
      })
      .catch(() => {
        if (held) {
          deps.markDisplaced();
          deps.reload();
        } else {
          resolve(false);
        }
      });
  });
  return { granted, isHeld: () => held };
}

/** La pestaña que manda atiende un pedido de traspaso (uno solo: los repetidos se ignoran). */
function listenForReleaseRequests(deps: TabLeadershipDeps): void {
  let releasing = false;
  // El único mensaje del canal es el pedido de traspaso (`parseTabMessage` descarta cualquier otro).
  deps.channel.onMessage(() => {
    if (releasing) {
      return;
    }
    releasing = true;
    void deps
      .prepareRelease(deps.releaseWaitMs)
      .catch(() => undefined)
      .then(() => {
        deps.markDisplaced();
        deps.reload();
      });
  });
}

/** "Usar esta pestaña": pide el traspaso, espera el cerrojo y, si la original no contesta, se lo quita. */
async function takeOver(locks: TabLocks, name: string, deps: TabLeadershipDeps): Promise<void> {
  const waiting = new AbortController();
  const hold = requestHold(locks, name, { signal: waiting.signal }, deps);
  deps.channel.post({ type: 'release-request' });
  await Promise.race([
    hold.granted,
    new Promise<void>((resolve) => setTimeout(resolve, deps.stealAfterMs)),
  ]);
  // `isHeld` se lee sincrónicamente: si el cerrojo todavía no llegó, abortar saca el pedido de la
  // cola antes de que pueda llegar, y nunca se le quita el cerrojo a esta misma pestaña.
  if (!hold.isHeld()) {
    waiting.abort();
    await requestHold(locks, name, { steal: true }, deps).granted;
  }
  listenForReleaseRequests(deps);
}

/** Se llama una vez al cargar, antes de `bootstrap()`. */
export async function claimTab(name: string, deps: TabLeadershipDeps): Promise<TabClaim> {
  const { locks } = deps;
  if (locks === undefined) {
    return { kind: 'leader' };
  }
  if (await requestHold(locks, name, { ifAvailable: true }, deps).granted) {
    listenForReleaseRequests(deps);
    return { kind: 'leader' };
  }
  return { kind: 'secondary', takeOver: () => takeOver(locks, name, deps) };
}
