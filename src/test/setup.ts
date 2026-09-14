import { afterEach, vi } from 'vitest';
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
