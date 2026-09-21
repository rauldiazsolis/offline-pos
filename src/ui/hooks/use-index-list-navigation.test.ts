import { signal } from '@preact/signals';
import { describe, expect, it, vi } from 'vitest';
import { useIndexListNavigation } from './use-index-list-navigation.ts';

function keyEvent(key: string): KeyboardEvent {
  return { key, preventDefault: vi.fn() } as unknown as KeyboardEvent;
}

describe('useIndexListNavigation', () => {
  it('ArrowDown desde null selecciona la fila 0', () => {
    const selected = signal<number | null>(null);
    const nav = useIndexListNavigation(selected, 5);

    nav.handleKeyDown(keyEvent('ArrowDown'));

    expect(selected.value).toBe(0);
  });

  it('ArrowDown/ArrowUp mueven de a 1, clampeado a los límites', () => {
    const selected = signal<number | null>(4);
    const nav = useIndexListNavigation(selected, 5);

    nav.handleKeyDown(keyEvent('ArrowDown'));
    expect(selected.value).toBe(4); // ya en el último, no se pasa

    selected.value = 0;
    nav.handleKeyDown(keyEvent('ArrowUp'));
    expect(selected.value).toBe(0); // ya en el primero, no baja de 0
  });

  it('PageDown/PageUp mueven de a 10, clampeado', () => {
    const selected = signal<number | null>(0);
    const nav = useIndexListNavigation(selected, 25);

    nav.handleKeyDown(keyEvent('PageDown'));
    expect(selected.value).toBe(10);

    nav.handleKeyDown(keyEvent('PageUp'));
    expect(selected.value).toBe(0);
  });

  it('con la lista vacía, no hace nada', () => {
    const selected = signal<number | null>(null);
    const nav = useIndexListNavigation(selected, 0);

    nav.handleKeyDown(keyEvent('ArrowDown'));

    expect(selected.value).toBeNull();
  });

  it('ignora teclas que no le corresponden', () => {
    const selected = signal<number | null>(2);
    const nav = useIndexListNavigation(selected, 5);

    const handled = nav.handleKeyDown(keyEvent('a'));

    expect(handled).toBe(false);
    expect(selected.value).toBe(2);
  });
});
