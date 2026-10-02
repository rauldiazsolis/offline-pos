import { beforeEach, describe, expect, it } from 'vitest';
import { storageKey } from './storage-namespace.ts';
import { consumeTabDisplaced, markTabDisplaced } from './tab-displaced.ts';

beforeEach(() => {
  sessionStorage.clear();
});

describe('marca de pestaña desplazada (#175)', () => {
  it('sin marca, no fue desplazada', () => {
    expect(consumeTabDisplaced()).toBe(false);
  });

  it('la marca se lee una sola vez', () => {
    markTabDisplaced();
    expect(sessionStorage.getItem(storageKey('tab-displaced'))).not.toBeNull();
    expect(consumeTabDisplaced()).toBe(true);
    expect(consumeTabDisplaced()).toBe(false);
  });
});
