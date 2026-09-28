import { describe, expect, it } from 'vitest';
import { FlexSearchConceptSearch } from './flexsearch-concept-search.ts';

const concept = (text: string) => ({
  direction: 'in' as const,
  concept: text,
  uses: 1,
  lastUsedAt: '2026-09-24T00:00:00.000Z',
});

describe('FlexSearchConceptSearch', () => {
  it('encuentra por prefijo de cualquier palabra y devuelve las claves', () => {
    const search = new FlexSearchConceptSearch([
      concept('Cambio inicial'),
      concept('Pago a proveedor'),
    ]);
    expect(search.search('prov')).toEqual(['pago a proveedor']);
    expect(search.search('cam')).toEqual(['cambio inicial']);
  });
});
