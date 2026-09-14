import { signal, type Signal } from '@preact/signals';
import { render } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import { useScrollSelectedIntoView } from './use-scroll-selected-into-view.ts';

// El stub global de scrollIntoView (src/test/setup.ts) evita que el efecto
// explote al tocar una fila que este archivo no espía individualmente (ej.
// el disparo inicial con el índice con el que arrancó el signal) — cada
// test de acá sobrescribe la fila puntual que le interesa para poder
// asertar la llamada.

function TestList({ selectedIndex }: { selectedIndex: Signal<number | null> }) {
  const rowRef = useScrollSelectedIntoView(selectedIndex);
  return (
    <ul>
      {[0, 1, 2].map((index) => (
        <li key={index} ref={rowRef(index)} data-testid={`row-${String(index)}`}>
          fila {index}
        </li>
      ))}
    </ul>
  );
}

describe('useScrollSelectedIntoView', () => {
  it('llama scrollIntoView sobre la fila correspondiente al índice seleccionado', async () => {
    const selectedIndex = signal<number | null>(null);
    const { container } = render(<TestList selectedIndex={selectedIndex} />);
    const row1 = container.querySelector('[data-testid="row-1"]');
    if (row1 === null) throw new Error('setup falló');
    const scrollSpy = vi.fn();
    row1.scrollIntoView = scrollSpy;

    selectedIndex.value = 1;

    await vi.waitFor(() => {
      expect(scrollSpy).toHaveBeenCalledWith({ block: 'nearest' });
    });
  });

  it('no llama scrollIntoView mientras el índice es null', async () => {
    const selectedIndex = signal<number | null>(null);
    const { container } = render(<TestList selectedIndex={selectedIndex} />);
    const rows = container.querySelectorAll('li');
    const spies = Array.from(rows).map((row) => {
      const spy = vi.fn();
      row.scrollIntoView = spy;
      return spy;
    });

    // Mismo tick que el otro test espera, para confirmar que acá no dispara nada.
    await new Promise((resolve) => setTimeout(resolve, 50));
    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
    }
  });

  it('sigue apuntando a la fila correcta si el índice cambia otra vez', async () => {
    const selectedIndex = signal<number | null>(0);
    const { container } = render(<TestList selectedIndex={selectedIndex} />);
    const row2 = container.querySelector('[data-testid="row-2"]');
    if (row2 === null) throw new Error('setup falló');
    const scrollSpy = vi.fn();
    row2.scrollIntoView = scrollSpy;

    selectedIndex.value = 2;

    await vi.waitFor(() => {
      expect(scrollSpy).toHaveBeenCalledWith({ block: 'nearest' });
    });
  });
});
