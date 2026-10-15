import { describe, expect, it } from 'vitest';
import { buildLessons, splitTotal, type LessonFormat } from './guide-lessons.ts';
import type { GuideActors } from './guide-model.ts';

const format: LessonFormat = {
  amountInput: (value) => String(value).replace('.', ','),
  parseAmount: (raw) => (raw === '' ? undefined : Number(raw.replace(',', '.'))),
  methodLabel: (method) => method,
};

describe('splitTotal (#226)', () => {
  it('la mitad entera para el efectivo y el resto para el otro medio', () => {
    expect(splitTotal(100)).toEqual({ first: 50, second: 50 });
    expect(splitTotal(251.5)).toEqual({ first: 125, second: 126.5 });
  });

  it('con un total chico, en centavos', () => {
    expect(splitTotal(1.5)).toEqual({ first: 0.75, second: 0.75 });
  });
});

describe('buildLessons (#226)', () => {
  const actors: GuideActors = { main: { id: 'p1', name: 'Bolsa de residuos', word: 'bolsa' } };

  it('sin producto con código, la lección de cantidades arranca con el 3*', () => {
    const quantities = buildLessons(actors, format)[1];
    expect(quantities?.steps).toHaveLength(3);
  });

  it('la línea libre no se confunde con la palabra del producto', () => {
    const freeform = buildLessons(actors, format)[2];
    const say = freeform?.steps[0]?.say({
      screen: 'sale',
      cart: { lines: [] },
      total: 0,
      buffer: '',
      selectedLine: null,
      checkout: { cash: '', debit: '', credit: '', transfer: '', qr: '', account: '' },
      salesClosed: 0,
    });
    expect(say?.text).toBe('regalo$500');
  });
});
