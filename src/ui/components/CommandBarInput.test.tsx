import 'fake-indexeddb/auto';
import { fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CatalogSearchResult } from '../../domain/catalog-search.ts';
import type { CustomerSearchResult } from '../../domain/customer-search.ts';
import { db } from '../../storage/db.ts';
import { CommandBarInput } from './CommandBarInput.tsx';
import { cartSelectionIndexSignal, cartSignal } from '../state/cart.ts';
import {
  commandBarBufferSignal,
  commandBarErrorSignal,
  customerSelectionIndexSignal,
  searchSelectionIndexSignal,
} from '../state/command-bar.ts';
import { setCatalogRepository } from '../state/catalog.ts';
import { setCustomerRepository } from '../state/customer-repository.ts';
import { attachedCustomerSignal } from '../state/customer.ts';
import { activeScreenSignal } from '../state/screen.ts';
import { formatMoney } from '../format.ts';

const arrozResult: CatalogSearchResult = {
  product: {
    id: 'p1',
    sku: 'SKU-1',
    barcodes: ['111'],
    name: 'Arroz 1kg',
    price: 100,
    taxRate: 0.21,
    category: 'almacen',
    tracksStock: true,
  },
  score: 1,
};

const anaResult: CustomerSearchResult = {
  customer: { id: 'c1', name: 'Ana García', createdAt: '2026-01-01T00:00:00.000Z' },
  score: 1,
};

const fideosResult: CatalogSearchResult = {
  product: {
    id: 'p2',
    sku: 'SKU-2',
    barcodes: ['222'],
    name: 'Fideos 500g',
    price: 200,
    taxRate: 0.21,
    category: 'almacen',
    tracksStock: true,
  },
  score: 0.5,
};

const brunoResult: CustomerSearchResult = {
  customer: { id: 'c2', name: 'Bruno Díaz', createdAt: '2026-01-01T00:00:00.000Z' },
  score: 0.5,
};

beforeEach(async () => {
  await db.open();
  commandBarBufferSignal.value = '';
  commandBarErrorSignal.value = null;
  searchSelectionIndexSignal.value = null;
  customerSelectionIndexSignal.value = null;
  cartSelectionIndexSignal.value = null;
  cartSignal.value = { lines: [] };
  attachedCustomerSignal.value = undefined;
  activeScreenSignal.value = 'sale';
  setCatalogRepository({
    search: (query) => {
      if (query === 'multi') return [arrozResult, fideosResult];
      return query.toLowerCase().includes('arroz') ? [arrozResult] : [];
    },
    findByBarcodeOrSku: () => undefined,
    getProduct: () => undefined,
    getStock: () => Promise.resolve({ productId: 'p1', quantity: 10, updatedAt: '' }),
  });
  setCustomerRepository({
    search: (query) => {
      if (query === 'multi') return [anaResult, brunoResult];
      return query.toLowerCase().includes('ana') ? [anaResult] : [];
    },
    getCustomer: () => undefined,
    getCustomerAccount: () => Promise.resolve(undefined),
  });
});

afterEach(async () => {
  db.close();
  await db.delete();
});

describe('CommandBarInput', () => {
  it('un código de barras en progreso no dispara ningún resultado de búsqueda', () => {
    render(<CommandBarInput />);
    const input = screen.getByLabelText('Barra de comandos');

    fireEvent.input(input, { target: { value: '7798787667' } });

    expect(screen.queryByRole('listitem')).toBeNull();
  });

  it('un texto no numérico muestra los resultados de búsqueda en vivo', () => {
    render(<CommandBarInput />);
    const input = screen.getByLabelText('Barra de comandos');

    fireEvent.input(input, { target: { value: 'arroz' } });

    expect(screen.getByText('Arroz 1kg')).not.toBeNull();
  });

  it('agrega el producto al confirmar una búsqueda con Enter', async () => {
    render(<CommandBarInput />);
    const input = screen.getByLabelText('Barra de comandos');

    fireEvent.input(input, { target: { value: 'arroz' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(cartSignal.value.lines).toHaveLength(1);
    });
  });

  it('muestra un error cuando el parseo falla', () => {
    render(<CommandBarInput />);
    const input = screen.getByLabelText('Barra de comandos');

    fireEvent.input(input, { target: { value: '$100' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(screen.getByRole('alert')).not.toBeNull();
  });

  it('el error se limpia al editar el input', () => {
    render(<CommandBarInput />);
    const input = screen.getByLabelText('Barra de comandos');

    fireEvent.input(input, { target: { value: '$100' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByRole('alert')).not.toBeNull();

    fireEvent.input(input, { target: { value: '$1000' } });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('"@" con match muestra resultados de cliente en vivo', () => {
    render(<CommandBarInput />);
    const input = screen.getByLabelText('Barra de comandos');

    fireEvent.input(input, { target: { value: '@ana' } });

    expect(screen.getByText('Ana García')).not.toBeNull();
  });

  it('"@" con match adjunta el cliente existente al confirmar con Enter', () => {
    render(<CommandBarInput />);
    const input = screen.getByLabelText('Barra de comandos');

    fireEvent.input(input, { target: { value: '@ana' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(attachedCustomerSignal.value?.id).toBe('c1');
  });

  it('"@" sin match ofrece crear un cliente nuevo, y Enter lo crea y adjunta', async () => {
    render(<CommandBarInput />);
    const input = screen.getByLabelText('Barra de comandos');

    fireEvent.input(input, { target: { value: '@Nuevo Cliente' } });
    expect(screen.getByText('+ Crear cliente "Nuevo Cliente"', { exact: false })).not.toBeNull();

    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(attachedCustomerSignal.value?.name).toBe('Nuevo Cliente');
    });
  });

  it('"@" vacío + Enter desadjunta el cliente actual', () => {
    attachedCustomerSignal.value = { id: 'c1', name: 'Ana García', createdAt: '' };
    render(<CommandBarInput />);
    const input = screen.getByLabelText('Barra de comandos');

    fireEvent.input(input, { target: { value: '@' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(attachedCustomerSignal.value).toBeUndefined();
  });

  it('recupera el foco al remontarse (volver de un popup con Esc)', () => {
    // Regresión del bug reportado: la barra de comandos usaba `autoFocus`
    // nativo en vez del mismo patrón imperativo que el resto de las
    // pantallas — al desmontarse y volver a montarse (exactamente lo que
    // pasa al volver de /COBRAR, /ANULAR, /CONFIG o el comprobante con Esc),
    // el foco no se recuperaba de forma confiable.
    const first = render(<CommandBarInput />);
    first.unmount();

    render(<CommandBarInput />);

    expect(document.activeElement).toBe(screen.getByLabelText('Barra de comandos'));
  });

  it('con solo "/" muestra la lista completa de comandos disponibles', () => {
    render(<CommandBarInput />);
    const input = screen.getByLabelText('Barra de comandos');

    fireEvent.input(input, { target: { value: '/' } });

    expect(screen.getByText('/COBRAR', { exact: false })).not.toBeNull();
    expect(screen.getByText('/ANULAR', { exact: false })).not.toBeNull();
  });

  // Issue #4: la fila 0 ya se muestra resaltada por default — el primer ↓
  // tiene que moverse a la fila 1 de una, no "reconfirmar" la 0.
  it('con dos resultados de producto, la primera flecha abajo mueve a la fila 1', () => {
    render(<CommandBarInput />);
    const input = screen.getByLabelText('Barra de comandos');

    fireEvent.input(input, { target: { value: 'multi' } });
    fireEvent.keyDown(input, { key: 'ArrowDown' });

    expect(searchSelectionIndexSignal.value).toBe(1);
  });

  it('con dos resultados de cliente, la primera flecha abajo mueve a la fila 1', () => {
    render(<CommandBarInput />);
    const input = screen.getByLabelText('Barra de comandos');

    fireEvent.input(input, { target: { value: '@multi' } });
    fireEvent.keyDown(input, { key: 'ArrowDown' });

    expect(customerSelectionIndexSignal.value).toBe(1);
  });

  // Issue #3: filtrar el menú de "/" por prefijo, ejecutar sin ambigüedad,
  // navegar con flechas cuando sí la hay.
  it('"/CO" filtra a COBRAR y CONFIG, sin mostrar ANULAR ni SINCRONIZAR', () => {
    render(<CommandBarInput />);
    const input = screen.getByLabelText('Barra de comandos');

    fireEvent.input(input, { target: { value: '/CO' } });

    expect(screen.getByText('/COBRAR', { exact: false })).not.toBeNull();
    expect(screen.getByText('/CONFIG', { exact: false })).not.toBeNull();
    expect(screen.queryByText('/ANULAR', { exact: false })).toBeNull();
    expect(screen.queryByText('/SINCRONIZAR', { exact: false })).toBeNull();
  });

  it('"/COB" (sin ambigüedad) + Enter ejecuta el comando directo, sin tocar flechas', async () => {
    render(<CommandBarInput />);
    const input = screen.getByLabelText('Barra de comandos');

    fireEvent.input(input, { target: { value: '/COB' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    // triggerCheckout es async (espera pendingBarOperation) — mismo motivo
    // por el que el resto de los tests de /COBRAR de este archivo usan waitFor.
    await waitFor(() => {
      expect(activeScreenSignal.value).toBe('checkout');
    });
  });

  it('"/CO" (ambiguo) + Enter sin navegar no hace nada', () => {
    render(<CommandBarInput />);
    const input = screen.getByLabelText('Barra de comandos');

    fireEvent.input(input, { target: { value: '/CO' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(activeScreenSignal.value).toBe('sale');
  });

  it('"/CO" (ambiguo) + navegar con flechas + Enter ejecuta el elegido', () => {
    render(<CommandBarInput />);
    const input = screen.getByLabelText('Barra de comandos');

    fireEvent.input(input, { target: { value: '/CO' } });
    fireEvent.keyDown(input, { key: 'ArrowDown' }); // COBRAR
    fireEvent.keyDown(input, { key: 'ArrowDown' }); // CONFIG
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(activeScreenSignal.value).toBe('config');
  });

  it('un comando que no matchea nada muestra "Comando desconocido" al confirmar', () => {
    render(<CommandBarInput />);
    const input = screen.getByLabelText('Barra de comandos');

    fireEvent.input(input, { target: { value: '/XYZ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(screen.getByRole('alert')).not.toBeNull();
  });

  // Issue #6: recargo/descuento global sobre el total (RF-03).
  it('"+10%" + Enter aplica un recargo del 10% sobre el total', () => {
    cartSignal.value = { lines: [{ kind: 'product', productId: 'p1', qty: 1, unitPrice: 100 }] };
    render(<CommandBarInput />);
    const input = screen.getByLabelText('Barra de comandos');

    fireEvent.input(input, { target: { value: '+10%' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(cartSignal.value.globalAdjustmentPercentage).toBe(10);
  });

  it('"-150%" + Enter muestra error y no cambia el carrito', () => {
    cartSignal.value = { lines: [{ kind: 'product', productId: 'p1', qty: 1, unitPrice: 100 }] };
    render(<CommandBarInput />);
    const input = screen.getByLabelText('Barra de comandos');

    fireEvent.input(input, { target: { value: '-150%' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(screen.getByRole('alert')).not.toBeNull();
    expect(cartSignal.value.globalAdjustmentPercentage).toBeUndefined();
  });

  // Issue #21: la fila de producto muestra SKU/precio, y el total para la
  // cantidad tipeada con el prefijo <n>*.
  it('la fila de producto muestra SKU y precio unitario', () => {
    render(<CommandBarInput />);
    const input = screen.getByLabelText('Barra de comandos');

    fireEvent.input(input, { target: { value: 'arroz' } });

    expect(screen.getByText('SKU-1', { exact: false })).not.toBeNull();
    expect(screen.getByText(formatMoney(100), { exact: false })).not.toBeNull();
  });

  it('con prefijo de cantidad, la fila de producto también muestra el total para esa cantidad', () => {
    render(<CommandBarInput />);
    const input = screen.getByLabelText('Barra de comandos');

    fireEvent.input(input, { target: { value: '3*arroz' } });

    expect(screen.getByText(formatMoney(300), { exact: false })).not.toBeNull();
  });

  // Issues #20/#21: una línea libre ya en el carrito aparece en la búsqueda
  // de artículos (antes que el catálogo) para poder ajustarla, no crear una
  // línea nueva.
  it('una línea libre ya en el carrito aparece en la búsqueda con su cantidad y precio actuales', () => {
    cartSignal.value = { lines: [{ kind: 'freeform', description: 'Regalo', qty: 2, unitPrice: 100 }] };
    render(<CommandBarInput />);
    const input = screen.getByLabelText('Barra de comandos');

    fireEvent.input(input, { target: { value: 'regalo' } });

    expect(screen.getByText('Regalo', { exact: false })).not.toBeNull();
    expect(screen.getByText(formatMoney(100), { exact: false })).not.toBeNull();
  });

  it('"<n>*descripción" (sin $) sobre una línea libre existente aumenta su cantidad, no crea una nueva', async () => {
    cartSignal.value = { lines: [{ kind: 'freeform', description: 'Regalo', qty: 2, unitPrice: 100 }] };
    render(<CommandBarInput />);
    const input = screen.getByLabelText('Barra de comandos');

    fireEvent.input(input, { target: { value: '3*regalo' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(cartSignal.value.lines).toEqual([
        { kind: 'freeform', description: 'Regalo', qty: 5, unitPrice: 100 },
      ]);
    });
  });

  it('"-<n>*descripción" (sin $) sobre una línea libre existente la reduce, y la borra si llega a 0', async () => {
    cartSignal.value = { lines: [{ kind: 'freeform', description: 'Regalo', qty: 2, unitPrice: 100 }] };
    render(<CommandBarInput />);
    const input = screen.getByLabelText('Barra de comandos');

    fireEvent.input(input, { target: { value: '-2*regalo' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(cartSignal.value.lines).toEqual([]);
    });
  });

  it('"0%" quita un recargo/descuento ya aplicado', () => {
    cartSignal.value = {
      lines: [{ kind: 'product', productId: 'p1', qty: 1, unitPrice: 100 }],
      globalAdjustmentPercentage: 10,
    };
    render(<CommandBarInput />);
    const input = screen.getByLabelText('Barra de comandos');

    fireEvent.input(input, { target: { value: '0%' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(cartSignal.value.globalAdjustmentPercentage).toBeUndefined();
  });
});
