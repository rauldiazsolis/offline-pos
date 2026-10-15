import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadCatalogRepository } from '../../storage/catalog-repository.ts';
import { db } from '../../storage/db.ts';
import { DEFAULT_PRINTER_CONFIG } from '../../storage/printer-config.ts';
import { setTrainingModeForTests } from '../../storage/training-mode.ts';
import { cartSelectionIndexSignal, cartSignal } from '../state/cart.ts';
import { getCatalogRepository, setCatalogRepository } from '../state/catalog.ts';
import { resetCheckout } from '../state/checkout.ts';
import { commandBarBufferSignal } from '../state/command-bar.ts';
import { setCustomerRepository } from '../state/customer-repository.ts';
import { attachedCustomerSignal } from '../state/customer.ts';
import { guideLessonsSignal, guideRunningSignal, guideSignal } from '../state/guide.ts';
import { printerConfigSignal } from '../state/printer.ts';
import { receiptSignal } from '../state/receipt.ts';
import { activeScreenSignal } from '../state/screen.ts';
import { uiModeSignal } from '../state/ui-mode.ts';
import { pressCommandBarEnter, updateCommandBarBuffer } from './command-bar-controller.ts';
import {
  closeGuide,
  doIt,
  GUIDE_UNAVAILABLE_REASON,
  guidePrimaryAction,
  nextLesson,
  openGuide,
  type GuideDeps,
} from './guide-controller.ts';

type Listeners = { key?: (event: KeyboardEvent) => void; pointer?: () => void };

function fakeDeps(listeners: Listeners, overrides: Partial<GuideDeps> = {}): GuideDeps {
  return {
    loadProducts: () => db.products.toArray(),
    firstSearchResult: (query) => getCatalogRepository().search(query, 1)[0]?.product.id,
    productByCode: (code) => getCatalogRepository().findByBarcodeOrSku(code)?.id,
    wait: () => Promise.resolve(),
    reducedMotion: () => false,
    focusPaymentField: () => undefined,
    listen: (onKey, onPointer) => {
      listeners.key = onKey;
      listeners.pointer = onPointer;
      return () => {
        delete listeners.key;
        delete listeners.pointer;
      };
    },
    ...overrides,
  };
}

/** Las promesas encadenadas de la barra (`pendingBarOperation`) y de Dexie. */
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

beforeEach(async () => {
  await db.open();
  await db.products.bulkAdd([
    {
      id: 'p1',
      sku: 'SKU-1',
      barcodes: ['7790001'],
      name: 'Arroz largo fino',
      price: 100,
      taxRate: 0.21,
      category: 'almacen',
      tracksStock: false,
    },
    {
      id: 'p2',
      sku: 'SKU-2',
      barcodes: ['7790002'],
      name: 'Yerba mate',
      price: 250,
      taxRate: 0.21,
      category: 'almacen',
      tracksStock: false,
    },
  ]);
  setCatalogRepository(await loadCatalogRepository());
  setCustomerRepository({
    search: () => [],
    listRecent: () => [],
    getCustomer: () => undefined,
    getCustomerAccount: () => Promise.resolve(undefined),
    getCustomerBalance: () => Promise.resolve(undefined),
  });
  setTrainingModeForTests({ startedAt: '2026-10-15T12:00:00.000Z' });
  printerConfigSignal.value = DEFAULT_PRINTER_CONFIG;
  activeScreenSignal.value = 'sale';
  cartSignal.value = { lines: [] };
  cartSelectionIndexSignal.value = null;
  attachedCustomerSignal.value = undefined;
  receiptSignal.value = null;
  resetCheckout();
  updateCommandBarBuffer('');
});

afterEach(async () => {
  closeGuide();
  setTrainingModeForTests(null);
  db.close();
  await db.delete();
  localStorage.clear();
});

describe('guía de entrenamiento (#226)', () => {
  it('fuera del entrenamiento no se abre', async () => {
    setTrainingModeForTests(null);

    await openGuide(fakeDeps({}));

    expect(guideSignal.value).toBeNull();
  });

  it('sin productos que sirvan, lo dice; F2 la cierra', async () => {
    await db.products.clear();
    const listeners: Listeners = {};

    await openGuide(fakeDeps(listeners));

    expect(guideSignal.value).toEqual({ phase: 'unavailable', reason: GUIDE_UNAVAILABLE_REASON });
    listeners.key?.(new KeyboardEvent('keydown', { key: 'F2' }));
    expect(guideSignal.value).toBeNull();
    expect(listeners.key).toBeUndefined();
  });

  it('en la venta arranca la primera lección descartando la venta de práctica a medias', async () => {
    cartSignal.value = { lines: [{ kind: 'freeform', description: 'x', qty: 1, unitPrice: 5 }] };

    await openGuide(fakeDeps({}));

    expect(guideSignal.value).toMatchObject({ phase: 'step', lesson: 0, step: 0 });
    expect(cartSignal.value.lines).toEqual([]);
    expect(guideLessonsSignal.value.map((lesson) => lesson.title)).toEqual([
      'Tu primera venta',
      'Cantidades y códigos',
      'Línea libre y descuento',
      'Cobrar con dos medios',
    ]);
  });

  it('fuera de la venta espera a que se vuelva para empezar', async () => {
    activeScreenSignal.value = 'cash-summary';

    await openGuide(fakeDeps({}));
    expect(guideSignal.value).toEqual({ phase: 'waiting', lesson: 0 });

    activeScreenSignal.value = 'sale';
    expect(guideSignal.value).toMatchObject({ phase: 'step', lesson: 0, step: 0 });
  });

  it('un paso se cumple por el estado, aunque se haga a mano', async () => {
    await openGuide(fakeDeps({}));

    updateCommandBarBuffer('arroz');
    pressCommandBarEnter();

    expect(cartSignal.value.lines).toHaveLength(1);
    expect(guideSignal.value).toMatchObject({ phase: 'step', lesson: 0, step: 1 });
  });

  it('"Hacelo" recorre las cuatro lecciones hasta el final', async () => {
    const deps = fakeDeps({});
    await openGuide(deps);

    for (let lesson = 0; lesson < 4; lesson += 1) {
      for (let guard = 0; guard < 12 && guideSignal.value?.phase === 'step'; guard += 1) {
        await doIt(deps);
        await settle();
      }
      const expected = lesson < 3 ? { phase: 'lesson-done', lesson } : { phase: 'finished' };
      expect(guideSignal.value).toEqual(expected);
      if (lesson < 3) {
        await guidePrimaryAction(deps);
      }
    }

    // Tres ventas de práctica (la primera, la de línea libre y la de dos medios).
    expect(await db.sales.count()).toBe(3);
    const methods = (await db.sales.toArray()).map((sale) =>
      sale.payments.map((payment) => payment.method).sort(),
    );
    expect(methods).toContainEqual(['cash', 'debit']);
    // Al final se queda en el entrenamiento, en la venta; F2 cierra la guía.
    expect(activeScreenSignal.value).toBe('sale');
    await guidePrimaryAction(deps);
    expect(guideSignal.value).toBeNull();
  });

  it('cualquier tecla frena "Hacelo" y deja lo escrito', async () => {
    const listeners: Listeners = {};
    let release: () => void = () => undefined;
    const deps = fakeDeps(listeners, {
      wait: () =>
        new Promise((resolve) => {
          release = () => {
            resolve();
          };
        }),
    });
    await openGuide(deps);

    const running = doIt(deps);
    release();
    await settle();
    expect(guideRunningSignal.value).toBe(true);
    expect(commandBarBufferSignal.value).toBe('a');

    listeners.key?.(new KeyboardEvent('keydown', { key: 'x' }));
    release();
    await running;

    expect(guideRunningSignal.value).toBe(false);
    expect(commandBarBufferSignal.value).toBe('a');
    expect(cartSignal.value.lines).toEqual([]);
  });

  it('"Saltar lección" pasa a la siguiente, y después de la última termina', async () => {
    await openGuide(fakeDeps({}));

    nextLesson();
    expect(guideSignal.value).toMatchObject({ phase: 'step', lesson: 1, step: 0 });
    nextLesson();
    nextLesson();
    nextLesson();
    expect(guideSignal.value).toEqual({ phase: 'finished' });
  });

  it('se cierra sola al pasar a la vista de celular', async () => {
    await openGuide(fakeDeps({}));

    uiModeSignal.value = 'mobile';
    await settle();

    expect(guideSignal.value).toBeNull();
    uiModeSignal.value = 'desktop';
  });
});
