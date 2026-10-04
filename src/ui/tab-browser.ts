import { TAB_LOCK_NAME } from '../storage/storage-namespace.ts';
import { markTabDisplaced } from '../storage/tab-displaced.ts';
import {
  parseTabMessage,
  RELEASE_WAIT_MS,
  STEAL_AFTER_MS,
  type TabChannel,
  type TabLeadershipDeps,
  type TabLocks,
} from './tab-leadership.ts';
import { prepareTabRelease } from './tab-release.ts';

/** `navigator.locks` existe solo en un contexto seguro (`https:` o `localhost`). */
function browserLocks(): TabLocks | undefined {
  if (!('locks' in navigator)) {
    return undefined;
  }
  return {
    request: (name, options, callback) =>
      navigator.locks.request(name, options, callback).then(() => undefined),
  };
}

function browserChannel(): TabChannel {
  const broadcast = new BroadcastChannel(TAB_LOCK_NAME);
  return {
    post: (message) => {
      broadcast.postMessage(message);
    },
    onMessage: (handler) => {
      broadcast.addEventListener('message', (event: MessageEvent<unknown>) => {
        const message = parseTabMessage(event.data);
        if (message !== undefined) {
          handler(message);
        }
      });
    },
  };
}

/** Los adaptadores reales de `ui/tab-leadership.ts` (#175). */
export function browserTabLeadershipDeps(): TabLeadershipDeps {
  return {
    locks: browserLocks(),
    channel: browserChannel(),
    // El traspaso nunca deshace la suelta: después se recarga (#175).
    prepareRelease: async (timeoutMs) => {
      await prepareTabRelease(timeoutMs);
    },
    markDisplaced: markTabDisplaced,
    reload: () => {
      window.location.reload();
    },
    stealAfterMs: STEAL_AFTER_MS,
    releaseWaitMs: RELEASE_WAIT_MS,
  };
}
