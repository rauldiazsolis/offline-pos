import { afterEach, beforeEach, vi } from 'vitest';
import { cleanup } from '@testing-library/preact';

// Desmonta cualquier componente renderizado entre tests — sin esto, cada
// archivo de test con componentes tendría que llamar cleanup() a mano.
afterEach(() => {
  cleanup();
});

// jsdom no implementa scrollIntoView — sin este stub, cualquier componente
// que lo llame (ver ui/hooks/use-scroll-selected-into-view.ts) explota en
// vez de no hacer nada, incluso en tests que no lo están probando a propósito.
Element.prototype.scrollIntoView = vi.fn();

// Tampoco implementa ResizeObserver (ver ui/hooks/use-scroll-indicator.ts)
// — sin este stub, cualquier componente que lo use explota al montarse en
// un test, incluso uno que no está probando el indicador de scroll.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver = ResizeObserverStub;

// Etapa 2 (#97): `getDeviceId()` ya no crea un id — lo resuelve `bootstrap()`
// una vez. Los tests que llegan al motor/conectores sin pasar por el arranque
// usan este id fijo; los de `terminal-identity.test.ts` lo pisan a propósito.
// Import dinámico: `terminal-identity.ts` arrastra `storage/db.ts`, y cargarlo
// antes que el `import 'fake-indexeddb/auto'` de cada test dejaría a Dexie sin
// IndexedDB. En un `beforeEach` ya corrieron los imports del archivo de test.
beforeEach(async () => {
  const { setDeviceIdForTests } = await import('../sync/terminal-identity.ts');
  setDeviceIdForTests('test-device-id');
});
