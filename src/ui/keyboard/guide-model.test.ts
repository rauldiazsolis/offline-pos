import { describe, expect, it } from 'vitest';
import type { Product } from '../../domain/product.ts';
import {
  advanceStep,
  chooseActors,
  typedProgress,
  type ActorLookup,
  type GuideLesson,
  type GuideSnapshot,
} from './guide-model.ts';

function product(overrides: Partial<Product> & { id: string; name: string }): Product {
  return {
    sku: `SKU-${overrides.id}`,
    barcodes: [],
    price: 100,
    taxRate: 0.21,
    category: 'almacen',
    tracksStock: true,
    ...overrides,
  };
}

/** Una búsqueda falsa: el primer producto cuyo nombre contiene la palabra. */
function lookupFor(products: Product[]): ActorLookup {
  return {
    firstSearchResult: (query) =>
      products.find((candidate) => candidate.name.toLowerCase().includes(query))?.id,
    productByCode: (code) =>
      products.find((candidate) => candidate.sku === code || candidate.barcodes.includes(code))?.id,
  };
}

describe('chooseActors (#226)', () => {
  it('elige un producto con precio que se encuentre primero por una palabra de su nombre', () => {
    const products = [
      product({ id: 'p1', name: 'Arroz largo fino 1kg' }),
      product({ id: 'p2', name: 'Yerba mate', barcodes: ['7790001'] }),
    ];

    expect(chooseActors(products, lookupFor(products))).toEqual({
      main: { id: 'p1', name: 'Arroz largo fino 1kg', word: 'arroz' },
      code: { id: 'p2', name: 'Yerba mate', code: '7790001' },
    });
  });

  it('saltea los productos sin precio, bloqueados o que la palabra no encuentra primero', () => {
    const products = [
      product({ id: 'p0', name: 'Agua gratis', price: 0 }),
      product({ id: 'p1', name: 'Alfajor', blocked: { reason: 'sin stock' } }),
      product({ id: 'p2', name: 'Galletitas de agua' }),
      product({ id: 'p3', name: 'Galletitas dulces' }),
    ];
    // "galletitas" encuentra primero a p2; p3 recién con su nombre completo.
    const lookup: ActorLookup = {
      firstSearchResult: (query) =>
        products.find(
          (candidate) => candidate.price > 0 && candidate.name.toLowerCase().includes(query),
        )?.id,
      productByCode: () => undefined,
    };

    expect(chooseActors(products, lookup)?.main).toEqual({
      id: 'p2',
      name: 'Galletitas de agua',
      word: 'galletitas',
    });
  });

  it('el del código usa el principal si no hay otro, y nunca un código con letras o corto', () => {
    const products = [
      product({ id: 'p1', name: 'Arroz', sku: '12345' }),
      product({ id: 'p2', name: 'Yerba', sku: 'YER-1', barcodes: ['123'] }),
    ];

    expect(chooseActors(products, lookupFor(products))?.code).toEqual({
      id: 'p1',
      name: 'Arroz',
      code: '12345',
    });
  });

  it('sin ningún producto que sirva, undefined', () => {
    expect(chooseActors([], lookupFor([]))).toBeUndefined();
    const free = [product({ id: 'p1', name: 'Bolsa', price: 0 })];
    expect(chooseActors(free, lookupFor(free))).toBeUndefined();
  });
});

describe('typedProgress', () => {
  it('cuenta lo que coincide, sin distinguir mayúsculas', () => {
    expect(typedProgress('3*arroz', '')).toEqual({ matched: 0, wrongAt: null });
    expect(typedProgress('3*arroz', '3*AR')).toEqual({ matched: 4, wrongAt: null });
    expect(typedProgress('3*arroz', '3*arroz')).toEqual({ matched: 7, wrongAt: null });
  });

  it('marca el primer carácter distinto, o el que sobra', () => {
    expect(typedProgress('3*arroz', '3+ar')).toEqual({ matched: 1, wrongAt: 1 });
    expect(typedProgress('arroz', 'arroz2')).toEqual({ matched: 5, wrongAt: 5 });
  });
});

describe('advanceStep', () => {
  const snapshot: GuideSnapshot = {
    screen: 'sale',
    cart: { lines: [] },
    total: 0,
    buffer: '',
    selectedLine: null,
    checkout: { cash: '', debit: '', credit: '', transfer: '', qr: '', account: '' },
    salesClosed: 0,
  };
  const step = (done: (s: GuideSnapshot) => boolean) => ({
    say: () => ({ before: '' }),
    done,
    demo: () => [],
  });
  const lesson: GuideLesson = {
    title: 'x',
    steps: [
      step((s) => s.buffer === 'a'),
      step((s) => s.screen === 'sale'),
      step((s) => s.salesClosed > 0),
    ],
  };

  it('se queda en el paso que no se cumplió', () => {
    expect(advanceStep(lesson, 0, snapshot)).toBe(0);
  });

  it('pasa de largo los que ya se cumplieron', () => {
    expect(advanceStep(lesson, 0, { ...snapshot, buffer: 'a' })).toBe(2);
  });

  it('devuelve el largo cuando termina la lección', () => {
    expect(advanceStep(lesson, 2, { ...snapshot, salesClosed: 1 })).toBe(3);
  });
});
