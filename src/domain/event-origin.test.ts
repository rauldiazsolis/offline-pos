import { describe, expect, it } from 'vitest';
import { buildEventOrigin } from './event-origin.ts';

describe('buildEventOrigin', () => {
  it('recorta y omite lo vacío', () => {
    expect(buildEventOrigin({ branch: '  Centro ', pointOfSale: '   ' })).toEqual({
      branch: 'Centro',
    });
    expect(buildEventOrigin({})).toEqual({});
    expect(buildEventOrigin({ branch: 'A', pointOfSale: 'Caja 1' })).toEqual({
      branch: 'A',
      pointOfSale: 'Caja 1',
    });
  });
});
