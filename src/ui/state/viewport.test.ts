import { afterEach, describe, expect, it, vi } from 'vitest';
import { startViewportTracking, viewportWidthSignal } from './viewport.ts';

/**
 * El stub global de `ResizeObserver` (`src/test/setup.ts`) es un no-op puro
 * (no invoca el callback nunca) — sirve para que montar componentes que lo
 * usan no explote, pero no alcanza para probar que este módulo reacciona a
 * un resize real. Mock local, solo para este archivo: guarda el callback
 * que le pasa `startViewportTracking` para poder dispararlo a mano.
 */
class FakeResizeObserver {
  static lastCallback: (() => void) | undefined;
  constructor(callback: () => void) {
    FakeResizeObserver.lastCallback = callback;
  }
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}

afterEach(() => {
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
});

describe('startViewportTracking', () => {
  it('observa document.documentElement y actualiza viewportWidthSignal cuando cambia de tamaño', () => {
    globalThis.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver;

    startViewportTracking();

    expect(FakeResizeObserver.lastCallback).not.toBeUndefined();

    Object.defineProperty(window, 'innerWidth', { value: 700, configurable: true });
    FakeResizeObserver.lastCallback?.();

    expect(viewportWidthSignal.value).toBe(700);
  });
});
