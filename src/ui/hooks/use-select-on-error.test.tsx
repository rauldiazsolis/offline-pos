import { signal, type Signal } from '@preact/signals';
import { render } from '@testing-library/preact';
import { useRef } from 'preact/hooks';
import { describe, expect, it, vi } from 'vitest';
import { useSelectOnErrorSignal } from './use-select-on-error.ts';

function TestInput({ errorSignal }: { errorSignal: Signal<string | null> }) {
  const ref = useRef<HTMLInputElement>(null);
  useSelectOnErrorSignal(ref, errorSignal);
  return <input ref={ref} aria-label="test-input" defaultValue="algo" />;
}

describe('useSelectOnErrorSignal', () => {
  // useSignalEffect no corre sincrónico: agenda su primer disparo vía rAF
  // (ver implementación de @preact/signals), así que el assert necesita
  // esperar un tick — mismo motivo por el que otros tests async de esta app
  // usan vi.waitFor en vez de un assert directo.
  it('selecciona el contenido del input cuando el error pasa a no-null', async () => {
    const errorSignal = signal<string | null>(null);
    const { container } = render(<TestInput errorSignal={errorSignal} />);
    const input = container.querySelector('input');
    if (input === null) throw new Error('setup falló');
    const selectSpy = vi.spyOn(input, 'select');

    errorSignal.value = 'algo salió mal';

    await vi.waitFor(() => {
      expect(selectSpy).toHaveBeenCalled();
    });
  });

  it('no llama select() mientras el error sigue null', async () => {
    const errorSignal = signal<string | null>(null);
    const { container } = render(<TestInput errorSignal={errorSignal} />);
    const input = container.querySelector('input');
    if (input === null) throw new Error('setup falló');
    const selectSpy = vi.spyOn(input, 'select');

    // Deja pasar el mismo tick que el otro test espera, para confirmar que
    // acá no dispara nada.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(selectSpy).not.toHaveBeenCalled();
  });
});
