import { render, screen } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from './app.tsx';
import { setCatalogRepository } from './state/catalog.ts';
import { cartSignal } from './state/cart.ts';
import { setCustomerRepository } from './state/customer-repository.ts';
import { activeScreenSignal } from './state/screen.ts';
import { viewportWidthSignal } from './state/viewport.ts';

beforeEach(() => {
  activeScreenSignal.value = 'sale';
  viewportWidthSignal.value = 1024;
  cartSignal.value = { lines: [] };
  setCatalogRepository({
    search: () => [],
    findByBarcodeOrSku: () => undefined,
    getProduct: () => undefined,
    getStock: () => Promise.resolve(undefined),
  });
  setCustomerRepository({
    search: () => [],
    listRecent: () => [],
    getCustomer: () => undefined,
    getCustomerAccount: () => Promise.resolve(undefined),
  });
});

afterEach(() => {
  viewportWidthSignal.value = 1024;
});

describe('App (Ciclo 8: ancho mínimo soportado)', () => {
  it('con ancho suficiente, renderiza la pantalla activa dentro de ".app-zoom-wrapper"', () => {
    const { container } = render(<App />);

    expect(container.querySelector('.app-zoom-wrapper')).not.toBeNull();
    expect(screen.queryByText('Pantalla no compatible')).toBeNull();
  });

  it('por debajo del ancho mínimo, muestra la pantalla de "no compatible" en vez de la app', () => {
    viewportWidthSignal.value = 500;

    const { container } = render(<App />);

    expect(screen.getByText('Pantalla no compatible')).not.toBeNull();
    expect(container.querySelector('.app-zoom-wrapper')).toBeNull();
  });
});
