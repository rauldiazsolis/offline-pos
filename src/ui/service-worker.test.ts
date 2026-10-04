import { beforeEach, describe, expect, it, vi } from 'vitest';
import { appUpdateSignal, serviceWorkerStateSignal } from './state/app-update.ts';
import {
  removeOwnServiceWorker,
  requestSkipWaiting,
  startServiceWorker,
  UPDATE_CHECK_INTERVAL_MS,
} from './service-worker.ts';

type Listener = () => void;

function fakeWorker(state: string) {
  const listeners: Listener[] = [];
  return {
    state,
    postMessage: vi.fn(),
    addEventListener: (_type: string, fn: Listener) => listeners.push(fn),
    become(next: string) {
      this.state = next;
      for (const fn of listeners) fn();
    },
  };
}

function fakeRegistration(init: { active?: unknown; waiting?: unknown; scope?: string }) {
  const listeners: Listener[] = [];
  return {
    scope: init.scope ?? 'https://pos.x/v4/',
    active: init.active ?? null,
    waiting: init.waiting ?? null,
    installing: null as ReturnType<typeof fakeWorker> | null,
    update: vi.fn(() => Promise.resolve()),
    unregister: vi.fn(() => Promise.resolve(true)),
    addEventListener: (_type: string, fn: Listener) => listeners.push(fn),
    found(worker: ReturnType<typeof fakeWorker>) {
      this.installing = worker;
      for (const fn of listeners) fn();
    },
  };
}

function fakeContainer(registration: ReturnType<typeof fakeRegistration>, controller: unknown) {
  return {
    controller,
    register: vi.fn(() => Promise.resolve(registration)),
    getRegistrations: vi.fn(() => Promise.resolve([registration])),
    addEventListener: vi.fn(),
  } as unknown as ServiceWorkerContainer;
}

beforeEach(() => {
  appUpdateSignal.value = 'none';
  serviceWorkerStateSignal.value = 'unsupported';
});

describe('startServiceWorker (#54)', () => {
  it('sin service worker o fuera del build no hace nada', async () => {
    await startServiceWorker({ enabled: true, container: undefined });
    await startServiceWorker({
      enabled: false,
      container: fakeContainer(fakeRegistration({}), null),
    });
    expect(serviceWorkerStateSignal.value).toBe('unsupported');
  });

  it('registra sw.js relativo, queda lista con uno activo y busca versiones cada hora', async () => {
    const registration = fakeRegistration({ active: {} });
    const register = vi.fn(() => Promise.resolve(registration));
    const container = { controller: {}, register } as unknown as ServiceWorkerContainer;
    const setInterval = vi.fn();
    await startServiceWorker({ enabled: true, container, setInterval });
    expect(register).toHaveBeenCalledWith('./sw.js');
    expect(serviceWorkerStateSignal.value).toBe('ready');
    expect(registration.update).toHaveBeenCalledTimes(1);
    expect(setInterval).toHaveBeenCalledWith(expect.any(Function), UPDATE_CHECK_INTERVAL_MS);
  });

  it('una versión que ya espera al arrancar es una versión nueva', async () => {
    const registration = fakeRegistration({ active: {}, waiting: fakeWorker('installed') });
    await startServiceWorker({
      enabled: true,
      container: fakeContainer(registration, {}),
      setInterval: vi.fn(),
    });
    expect(appUpdateSignal.value).toBe('available');
  });

  it('una que termina de instalarse con otra andando también; la primera instalación no', async () => {
    const first = fakeRegistration({});
    await startServiceWorker({
      enabled: true,
      container: fakeContainer(first, null),
      setInterval: vi.fn(),
    });
    expect(serviceWorkerStateSignal.value).toBe('installing');
    const worker = fakeWorker('installing');
    first.found(worker);
    worker.become('installed');
    expect(appUpdateSignal.value).toBe('none');
    worker.become('activated');
    expect(serviceWorkerStateSignal.value).toBe('ready');

    const second = fakeRegistration({ active: {} });
    await startServiceWorker({
      enabled: true,
      container: fakeContainer(second, {}),
      setInterval: vi.fn(),
    });
    const next = fakeWorker('installing');
    second.found(next);
    next.become('installed');
    expect(appUpdateSignal.value).toBe('available');
  });

  it('un registro que falla deja "sin service worker" y no rompe el arranque', async () => {
    const container = {
      register: vi.fn(() => Promise.reject(new Error('no'))),
    } as unknown as ServiceWorkerContainer;
    await startServiceWorker({ enabled: true, container });
    expect(serviceWorkerStateSignal.value).toBe('unsupported');
  });
});

describe('requestSkipWaiting', () => {
  it('le manda skip-waiting al que espera', async () => {
    const waiting = fakeWorker('installed');
    const registration = fakeRegistration({ active: {}, waiting });
    await startServiceWorker({
      enabled: true,
      container: fakeContainer(registration, {}),
      setInterval: vi.fn(),
    });
    expect(requestSkipWaiting()).toBe(true);
    expect(waiting.postMessage).toHaveBeenCalledWith({ type: 'skip-waiting' });
  });
});

describe('removeOwnServiceWorker (pos.reset)', () => {
  it('da de baja solo el registro de su carpeta y borra solo sus cachés', async () => {
    const own = fakeRegistration({ scope: 'https://pos.x/v4/' });
    const parent = fakeRegistration({ scope: 'https://pos.x/' });
    const container = {
      getRegistrations: vi.fn(() => Promise.resolve([parent, own])),
    } as unknown as ServiceWorkerContainer;
    const deleted: string[] = [];
    const cacheStorage = {
      keys: () =>
        Promise.resolve(['offline-pos@/v4/:sw:a', 'offline-pos:sw:b', 'offline-pos@/v5/:sw:c']),
      delete: (name: string) => {
        deleted.push(name);
        return Promise.resolve(true);
      },
    } as unknown as CacheStorage;
    await removeOwnServiceWorker({ scopeUrl: 'https://pos.x/v4/', container, cacheStorage });
    expect(own.unregister).toHaveBeenCalled();
    expect(parent.unregister).not.toHaveBeenCalled();
    expect(deleted).toEqual(['offline-pos@/v4/:sw:a']);
  });
});
