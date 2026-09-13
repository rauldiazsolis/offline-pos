import { afterEach, describe, expect, it } from 'vitest';
import { getProductsCursor, setProductsCursor } from './cursor.ts';

afterEach(() => {
  localStorage.clear();
});

describe('getProductsCursor / setProductsCursor', () => {
  it('undefined si nunca se guardó nada', () => {
    expect(getProductsCursor()).toBeUndefined();
  });

  it('guarda y relee el cursor', () => {
    setProductsCursor('cursor-abc');
    expect(getProductsCursor()).toBe('cursor-abc');
  });
});
