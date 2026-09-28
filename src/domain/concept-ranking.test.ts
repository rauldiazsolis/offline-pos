import { describe, expect, it } from 'vitest';
import { conceptKey, conceptScore, rankConcepts, recordConceptUse } from './concept-ranking.ts';

const now = '2026-09-24T12:00:00.000Z';
const daysAgo = (days: number): string =>
  new Date(Date.parse(now) - days * 86_400_000).toISOString();
const c = (concept: string, uses: number, days: number) => ({
  direction: 'in' as const,
  concept,
  uses,
  lastUsedAt: daysAgo(days),
});

describe('concept-ranking', () => {
  it('conceptKey ignora mayúsculas y espacios de más', () => {
    expect(conceptKey('  Cambio   Inicial ')).toBe('cambio inicial');
  });

  it('el puntaje se reduce a la mitad cada 14 días', () => {
    expect(conceptScore(c('a', 8, 0), now)).toBe(8);
    expect(conceptScore(c('a', 8, 14), now)).toBeCloseTo(4);
    expect(conceptScore(c('a', 8, 28), now)).toBeCloseTo(2);
  });

  it('ordena por puntaje: uno reciente le gana a uno más usado pero viejo', () => {
    // reciente = 3, medio = 4 × 0,5^0,5 ≈ 2,83, viejo = 10 × 0,5^(60/14) ≈ 0,51
    const ranked = rankConcepts([c('viejo', 10, 60), c('reciente', 3, 0), c('medio', 4, 7)], now);
    expect(ranked.map((x) => x.concept)).toEqual(['reciente', 'medio', 'viejo']);
  });

  it('tope de 8 por defecto', () => {
    const many = Array.from({ length: 12 }, (_, i) => c(`c${String(i)}`, i + 1, 0));
    expect(rankConcepts(many, now)).toHaveLength(8);
  });

  it('recordConceptUse suma un uso y conserva la grafía original', () => {
    expect(
      recordConceptUse(c('Cambio inicial', 2, 3), {
        direction: 'in',
        concept: 'cambio INICIAL',
        now,
      }),
    ).toEqual({ direction: 'in', concept: 'Cambio inicial', uses: 3, lastUsedAt: now });
    expect(recordConceptUse(undefined, { direction: 'out', concept: '  Flete ', now })).toEqual({
      direction: 'out',
      concept: 'Flete',
      uses: 1,
      lastUsedAt: now,
    });
  });
});
