import { describe, expect, it } from 'vitest';
import { scaledPx } from './text-scale.ts';

describe('scaledPx', () => {
  it('multiplica la medida por el factor de compensación del texto', () => {
    expect(scaledPx(240)).toBe('calc(240px * var(--text-zoom-compensation))');
  });
});
