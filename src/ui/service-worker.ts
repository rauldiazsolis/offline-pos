import { swCachePrefix } from '../workers/sw-logic.ts';
import { appUpdateSignal, serviceWorkerStateSignal } from './state/app-update.ts';

/** Cada cuánto la pestaña le pregunta al servidor si hay un `sw.js` nuevo (#54). */
export const UPDATE_CHECK_INTERVAL_MS = 3_600_000;

let registration: ServiceWorkerRegistration | undefined;

function browserContainer(): ServiceWorkerContainer | undefined {
  return 'serviceWorker' in navigator ? navigator.serviceWorker : undefined;
}

function watchInstalling(container: ServiceWorkerContainer, worker: ServiceWorker): void {
  worker.addEventListener('statechange', () => {
    if (worker.state === 'installed' && container.controller !== null) {
      appUpdateSignal.value = 'available';
    }
    if (worker.state === 'activated') {
      serviceWorkerStateSignal.value = 'ready';
    }
  });
}

/**
 * Adaptador del service worker (#54): lo registra con el `scope` de su carpeta, busca versiones al
 * arrancar y cada hora (el navegador solo busca al navegar, y una pestaña de POS queda abierta días),
 * y avisa cuando una nueva quedó esperando. Solo en el build y en la pestaña que manda (lo llama
 * `startApp`). Sin service worker (contexto no seguro) no hace nada; un registro que falla no rompe
 * el arranque.
 */
export async function startServiceWorker({
  enabled = import.meta.env.PROD,
  container = browserContainer(),
  setInterval: every = (fn: () => void, ms: number) => window.setInterval(fn, ms),
}: {
  enabled?: boolean;
  container?: ServiceWorkerContainer | undefined;
  setInterval?: (fn: () => void, ms: number) => unknown;
} = {}): Promise<void> {
  if (!enabled || container === undefined) {
    return;
  }
  try {
    const current = await container.register('./sw.js');
    registration = current;
    serviceWorkerStateSignal.value = current.active !== null ? 'ready' : 'installing';
    if (current.waiting !== null && container.controller !== null) {
      appUpdateSignal.value = 'available';
    }
    current.addEventListener('updatefound', () => {
      if (current.installing !== null) {
        watchInstalling(container, current.installing);
      }
    });
    const check = () => {
      current.update().catch(() => {
        // Sin red: se vuelve a probar en la próxima hora.
      });
    };
    check();
    every(check, UPDATE_CHECK_INTERVAL_MS);
  } catch {
    serviceWorkerStateSignal.value = 'unsupported';
  }
}

/** `/ACTUALIZAR`: le pide al service worker en espera que se active. */
export function requestSkipWaiting(): boolean {
  const waiting = registration?.waiting ?? null;
  if (waiting === null) {
    return false;
  }
  waiting.postMessage({ type: 'skip-waiting' });
  return true;
}

/** `true` si la página pasó a estar controlada por otro service worker antes del tope. */
export function waitForControllerChange(
  timeoutMs: number,
  container: ServiceWorkerContainer | undefined = browserContainer(),
): Promise<boolean> {
  if (container === undefined) {
    return Promise.resolve(false);
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve(false);
    }, timeoutMs);
    container.addEventListener(
      'controllerchange',
      () => {
        clearTimeout(timer);
        resolve(true);
      },
      { once: true },
    );
  });
}

/**
 * `pos.reset()`: da de baja el registro cuyo `scope` es exactamente esta carpeta (el de una carpeta
 * de arriba también la controlaría, y nunca se toca) y borra las cachés con su prefijo.
 */
export async function removeOwnServiceWorker({
  scopeUrl = new URL('./', window.location.href).href,
  container = browserContainer(),
  cacheStorage = 'caches' in window ? window.caches : undefined,
}: {
  scopeUrl?: string;
  container?: ServiceWorkerContainer | undefined;
  cacheStorage?: CacheStorage | undefined;
} = {}): Promise<void> {
  if (container !== undefined) {
    const registrations = await container.getRegistrations();
    await Promise.all(
      registrations.filter((r) => r.scope === scopeUrl).map((r) => r.unregister()),
    );
  }
  if (cacheStorage !== undefined) {
    const prefix = swCachePrefix(scopeUrl);
    const names = await cacheStorage.keys();
    await Promise.all(names.filter((n) => n.startsWith(prefix)).map((n) => cacheStorage.delete(n)));
  }
}
