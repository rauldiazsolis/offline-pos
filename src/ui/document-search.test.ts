import { describe, expect, it } from 'vitest';
import { filterByText } from './document-search.ts';

describe('filterByText', () => {
  const items = ['12 Ana arroz', '3 recibo cobranza Beto'];

  it('sin texto devuelve todo; con "#" lo ignora', () => {
    expect(filterByText(items, '  ', (x) => x)).toEqual(items);
    expect(filterByText(items, '#12', (x) => x)).toEqual(['12 Ana arroz']);
  });

  it('busca por prefijo de palabra', () => {
    expect(filterByText(items, 'bet', (x) => x)).toEqual(['3 recibo cobranza Beto']);
  });
});
