import 'fake-indexeddb/auto';
import { fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatalogSearchResult } from '../../domain/catalog-search.ts';
import type { CustomerSearchResult } from '../../domain/customer-search.ts';
import { db } from '../../storage/db.ts';
import { CommandBarInput } from './CommandBarInput.tsx';
import { cartSelectionIndexSignal, cartSignal } from '../state/cart.ts';
import {
  commandBarBufferSignal,
  commandBarErrorSignal,
  commandSelectionIndexSignal,
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

const anaConDatos: CustomerSearchResult = {
  customer: {
    id: 'c1',
    name: 'Ana García',
    document: '12345678',
    createdAt: '2026-01-01T00:00:00.000Z',
  },
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
    listRecent: () => [],
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

  // Issue #21: "@" solo (sin texto) muestra los clientes recientes, no una
  // lista vacía esperando que se tipee algo.
  it('"@" sin texto muestra los clientes recientes', () => {
    setCustomerRepository({
      search: () => [],
      listRecent: () => [anaResult],
      getCustomer: () => undefined,
      getCustomerAccount: () => Promise.resolve(undefined),
    });
    render(<CommandBarInput />);
    const input = screen.getByLabelText('Barra de comandos');

    fireEvent.input(input, { target: { value: '@' } });

    expect(screen.getByText('Ana García')).not.toBeNull();
  });

  // Ciclo 7: "Consumidor Final" siempre está, aunque no haya clientes
  // recientes — es la forma de desadjuntar, tiene que ser alcanzable
  // siempre, no solo cuando hay otros clientes en la lista.
  it('"@" sin texto y sin clientes recientes muestra "Consumidor Final" igual', () => {
    setCustomerRepository({
      search: () => [],
      listRecent: () => [],
      getCustomer: () => undefined,
      getCustomerAccount: () => Promise.resolve(undefined),
    });
    render(<CommandBarInput />);
    const input = screen.getByLabelText('Barra de comandos');

    fireEvent.input(input, { target: { value: '@' } });

    expect(screen.getByText('Consumidor Final')).not.toBeNull();
  });

  it('la fila de cliente muestra documento/teléfono cuando están presentes', () => {
    setCustomerRepository({
      search: (query) => (query.toLowerCase().includes('ana') ? [anaConDatos] : []),
      listRecent: () => [],
      getCustomer: () => undefined,
      getCustomerAccount: () => Promise.resolve(undefined),
    });
    render(<CommandBarInput />);
    const input = screen.getByLabelText('Barra de comandos');

    fireEvent.input(input, { target: { value: '@ana' } });

    expect(screen.getByText('12345678', { exact: false })).not.toBeNull();
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

  it('"@" vacío + Enter desadjunta el cliente actual (selecciona "Consumidor Final" por default)', () => {
    attachedCustomerSignal.value = { id: 'c1', name: 'Ana García', createdAt: '' };
    render(<CommandBarInput />);
    const input = screen.getByLabelText('Barra de comandos');

    fireEvent.input(input, { target: { value: '@' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(attachedCustomerSignal.value).toBeUndefined();
  });

  // Ciclo 7: este era el caso que realmente rompía en producción — con
  // clientes recientes, "@" vacío + Enter volvía a adjuntar el primero de
  // la lista en vez de desadjuntar (la lista ya no estaba vacía desde el
  // Ciclo 4). El test anterior no lo agarraba porque su mock de
  // listRecent() devuelve [] — acá se fuerza una lista no vacía.
  it('"@" vacío + Enter desadjunta incluso con clientes recientes en la lista', () => {
    setCustomerRepository({
      search: () => [],
      listRecent: () => [anaResult],
      getCustomer: () => undefined,
      getCustomerAccount: () => Promise.resolve(undefined),
    });
    attachedCustomerSignal.value = { id: 'c1', name: 'Ana García', createdAt: '' };
    render(<CommandBarInput />);
    const input = screen.getByLabelText('Barra de comandos');

    fireEvent.input(input, { target: { value: '@' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(attachedCustomerSignal.value).toBeUndefined();
  });

  it('"Consumidor Final" no aparece mezclada con una búsqueda puntual', () => {
    render(<CommandBarInput />);
    const input = screen.getByLabelText('Barra de comandos');

    fireEvent.input(input, { target: { value: '@ana' } });

    expect(screen.queryByText('Consumidor Final')).toBeNull();
  });

  it('navegar a un cliente reciente y confirmar lo sigue adjuntando bien (no rompe con "Consumidor Final" adelante)', () => {
    setCustomerRepository({
      search: () => [],
      listRecent: () => [anaResult],
      getCustomer: () => undefined,
      getCustomerAccount: () => Promise.resolve(undefined),
    });
    render(<CommandBarInput />);
    const input = screen.getByLabelText('Barra de comandos');

    fireEvent.input(input, { target: { value: '@' } });
    fireEvent.keyDown(input, { key: 'ArrowDown' }); // de "Consumidor Final" a Ana García
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(attachedCustomerSignal.value?.id).toBe('c1');
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

  // Issue #29: <unitario> solo con cantidad 1; <unitario> x <cantidad> =
  // <total> con cualquier otra cantidad.
  it('con cantidad 1, no muestra el formato "x <cantidad> ="', () => {
    render(<CommandBarInput />);
    const input = screen.getByLabelText('Barra de comandos');

    fireEvent.input(input, { target: { value: 'arroz' } });

    expect(screen.queryByText(/x 1 =/)).toBeNull();
  });

  it('con cantidad distinta de 1, usa el formato exacto "x <cantidad> = <total>"', () => {
    render(<CommandBarInput />);
    const input = screen.getByLabelText('Barra de comandos');

    fireEvent.input(input, { target: { value: '3*arroz' } });

    expect(screen.getByText(`x 3 = ${formatMoney(300)}`, { exact: false })).not.toBeNull();
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

  // Issue #15: la línea resultante de agregar/ajustar queda seleccionada
  // (y, gracias al hook de scroll, visible); el borrado explícito con Supr
  // tiene un criterio distinto a propósito (selecciona la que se corrió a
  // ese índice, o la anterior, o nada si el carrito quedó vacío).
  describe('selección tras mutaciones del carrito', () => {
    it('agregar un producto por búsqueda selecciona su línea', async () => {
      render(<CommandBarInput />);
      const input = screen.getByLabelText('Barra de comandos');

      fireEvent.input(input, { target: { value: 'arroz' } });
      fireEvent.keyDown(input, { key: 'Enter' });

      await waitFor(() => {
        expect(cartSelectionIndexSignal.value).toBe(0);
      });
    });

    it('agregar un segundo producto distinto selecciona su línea, no la primera', async () => {
      setCatalogRepository({
        search: (query) => {
          const q = query.toLowerCase();
          if (q.includes('fideos')) return [fideosResult];
          if (q.includes('arroz')) return [arrozResult];
          return [];
        },
        findByBarcodeOrSku: () => undefined,
        getProduct: () => undefined,
        getStock: () => Promise.resolve({ productId: 'p2', quantity: 10, updatedAt: '' }),
      });
      cartSignal.value = { lines: [{ kind: 'product', productId: 'p1', qty: 1, unitPrice: 100 }] };
      render(<CommandBarInput />);
      const input = screen.getByLabelText('Barra de comandos');

      fireEvent.input(input, { target: { value: 'fideos' } });
      fireEvent.keyDown(input, { key: 'Enter' });

      await waitFor(() => {
        expect(cartSelectionIndexSignal.value).toBe(1);
      });
    });

    it('agregar un producto ya presente (suma cantidad) selecciona esa misma línea', async () => {
      cartSignal.value = {
        lines: [
          { kind: 'product', productId: 'p2', qty: 1, unitPrice: 200 },
          { kind: 'product', productId: 'p1', qty: 1, unitPrice: 100 },
        ],
      };
      render(<CommandBarInput />);
      const input = screen.getByLabelText('Barra de comandos');

      fireEvent.input(input, { target: { value: 'arroz' } });
      fireEvent.keyDown(input, { key: 'Enter' });

      await waitFor(() => {
        expect(cartSelectionIndexSignal.value).toBe(1);
        expect(cartSignal.value.lines[1]?.qty).toBe(2);
      });
    });

    it('crear una línea libre selecciona la última línea', async () => {
      cartSignal.value = { lines: [{ kind: 'product', productId: 'p1', qty: 1, unitPrice: 100 }] };
      render(<CommandBarInput />);
      const input = screen.getByLabelText('Barra de comandos');

      fireEvent.input(input, { target: { value: 'regalo$50' } });
      fireEvent.keyDown(input, { key: 'Enter' });

      await waitFor(() => {
        expect(cartSelectionIndexSignal.value).toBe(1);
      });
    });

    it('ajustar una línea libre existente hasta 0 no deja ninguna selección', async () => {
      cartSignal.value = { lines: [{ kind: 'freeform', description: 'Regalo', qty: 2, unitPrice: 100 }] };
      cartSelectionIndexSignal.value = 0;
      render(<CommandBarInput />);
      const input = screen.getByLabelText('Barra de comandos');

      fireEvent.input(input, { target: { value: '-2*regalo' } });
      fireEvent.keyDown(input, { key: 'Enter' });

      await waitFor(() => {
        expect(cartSignal.value.lines).toEqual([]);
        expect(cartSelectionIndexSignal.value).toBeNull();
      });
    });

    it('ajustar una línea libre existente sin llegar a 0 la selecciona', async () => {
      cartSignal.value = {
        lines: [
          { kind: 'product', productId: 'p1', qty: 1, unitPrice: 100 },
          { kind: 'freeform', description: 'Regalo', qty: 3, unitPrice: 100 },
        ],
      };
      render(<CommandBarInput />);
      const input = screen.getByLabelText('Barra de comandos');

      fireEvent.input(input, { target: { value: '-1*regalo' } });
      fireEvent.keyDown(input, { key: 'Enter' });

      await waitFor(() => {
        expect(cartSelectionIndexSignal.value).toBe(1);
        expect(cartSignal.value.lines[1]).toEqual({
          kind: 'freeform',
          description: 'Regalo',
          qty: 2,
          unitPrice: 100,
        });
      });
    });

    it('Supr sobre una línea del medio selecciona la que se corrió a ese índice', () => {
      cartSignal.value = {
        lines: [
          { kind: 'product', productId: 'p1', qty: 1, unitPrice: 100 },
          { kind: 'product', productId: 'p2', qty: 1, unitPrice: 200 },
          { kind: 'freeform', description: 'Envío', qty: 1, unitPrice: 50 },
        ],
      };
      cartSelectionIndexSignal.value = 1;
      render(<CommandBarInput />);
      const input = screen.getByLabelText('Barra de comandos');

      fireEvent.keyDown(input, { key: 'Delete' });

      expect(cartSignal.value.lines).toHaveLength(2);
      expect(cartSelectionIndexSignal.value).toBe(1);
      expect(cartSignal.value.lines[1]).toEqual({
        kind: 'freeform',
        description: 'Envío',
        qty: 1,
        unitPrice: 50,
      });
    });

    it('Supr sobre la última línea selecciona la anterior', () => {
      cartSignal.value = {
        lines: [
          { kind: 'product', productId: 'p1', qty: 1, unitPrice: 100 },
          { kind: 'product', productId: 'p2', qty: 1, unitPrice: 200 },
        ],
      };
      cartSelectionIndexSignal.value = 1;
      render(<CommandBarInput />);
      const input = screen.getByLabelText('Barra de comandos');

      fireEvent.keyDown(input, { key: 'Delete' });

      expect(cartSignal.value.lines).toHaveLength(1);
      expect(cartSelectionIndexSignal.value).toBe(0);
    });

    it('Supr sobre la única línea no deja selección', () => {
      cartSignal.value = { lines: [{ kind: 'product', productId: 'p1', qty: 1, unitPrice: 100 }] };
      cartSelectionIndexSignal.value = 0;
      render(<CommandBarInput />);
      const input = screen.getByLabelText('Barra de comandos');

      fireEvent.keyDown(input, { key: 'Delete' });

      expect(cartSignal.value.lines).toEqual([]);
      expect(cartSelectionIndexSignal.value).toBeNull();
    });
  });

  // Issue #27: los tres overlays (comandos, clientes, artículos) también
  // necesitan scrollear hacia la fila seleccionada al navegar con flechas.
  describe('scroll hacia la fila seleccionada en los overlays', () => {
    it('menú de comandos', () => {
      render(<CommandBarInput />);
      const input = screen.getByLabelText('Barra de comandos');
      fireEvent.input(input, { target: { value: '/' } });

      const row = screen.getAllByRole('listitem')[0];
      if (row === undefined) throw new Error('setup falló');
      const scrollSpy = vi.fn();
      row.scrollIntoView = scrollSpy;

      fireEvent.keyDown(input, { key: 'ArrowDown' });

      expect(scrollSpy).toHaveBeenCalledWith({ block: 'nearest' });
    });

    it('resultados de búsqueda de artículos', () => {
      render(<CommandBarInput />);
      const input = screen.getByLabelText('Barra de comandos');
      fireEvent.input(input, { target: { value: 'multi' } });

      const secondRow = screen.getAllByRole('listitem')[1];
      if (secondRow === undefined) throw new Error('setup falló');
      const scrollSpy = vi.fn();
      secondRow.scrollIntoView = scrollSpy;

      fireEvent.keyDown(input, { key: 'ArrowDown' });

      expect(scrollSpy).toHaveBeenCalledWith({ block: 'nearest' });
    });

    it('resultados de búsqueda de clientes', () => {
      render(<CommandBarInput />);
      const input = screen.getByLabelText('Barra de comandos');
      fireEvent.input(input, { target: { value: '@multi' } });

      const secondRow = screen.getAllByRole('listitem')[1];
      if (secondRow === undefined) throw new Error('setup falló');
      const scrollSpy = vi.fn();
      secondRow.scrollIntoView = scrollSpy;

      fireEvent.keyDown(input, { key: 'ArrowDown' });

      expect(scrollSpy).toHaveBeenCalledWith({ block: 'nearest' });
    });
  });

  // Issue #14: cada tecla resetea/reindexa la selección de las tres listas
  // — comandos siempre a null, productos/clientes por identidad.
  describe('reset/reindexado de selección al cambiar el buffer', () => {
    it('el menú de comandos resetea la selección en cada tecla', () => {
      render(<CommandBarInput />);
      const input = screen.getByLabelText('Barra de comandos');

      fireEvent.input(input, { target: { value: '/' } });
      fireEvent.keyDown(input, { key: 'ArrowDown' });
      expect(commandSelectionIndexSignal.value).toBe(0);

      fireEvent.input(input, { target: { value: '/C' } });
      expect(commandSelectionIndexSignal.value).toBeNull();
    });

    it('la búsqueda de productos mantiene la selección si el producto sigue en la lista nueva', () => {
      setCatalogRepository({
        search: (query) => {
          const q = query.toLowerCase();
          if (q === 'multi') return [arrozResult, fideosResult];
          if (q.includes('fideos')) return [fideosResult];
          if (q.includes('arroz')) return [arrozResult];
          return [];
        },
        findByBarcodeOrSku: () => undefined,
        getProduct: () => undefined,
        getStock: () => Promise.resolve({ productId: 'p2', quantity: 10, updatedAt: '' }),
      });
      render(<CommandBarInput />);
      const input = screen.getByLabelText('Barra de comandos');

      fireEvent.input(input, { target: { value: 'multi' } });
      fireEvent.keyDown(input, { key: 'ArrowDown' }); // fideos, índice 1
      expect(searchSelectionIndexSignal.value).toBe(1);

      fireEvent.input(input, { target: { value: 'fideos' } }); // ahora es el único, índice 0
      expect(searchSelectionIndexSignal.value).toBe(0);
    });

    it('la búsqueda de productos pierde la selección si el producto ya no está en la lista nueva', () => {
      setCatalogRepository({
        search: (query) => {
          const q = query.toLowerCase();
          if (q === 'multi') return [arrozResult, fideosResult];
          if (q.includes('fideos')) return [fideosResult];
          if (q.includes('arroz')) return [arrozResult];
          return [];
        },
        findByBarcodeOrSku: () => undefined,
        getProduct: () => undefined,
        getStock: () => Promise.resolve({ productId: 'p2', quantity: 10, updatedAt: '' }),
      });
      render(<CommandBarInput />);
      const input = screen.getByLabelText('Barra de comandos');

      fireEvent.input(input, { target: { value: 'multi' } });
      fireEvent.keyDown(input, { key: 'ArrowDown' }); // fideos, índice 1

      fireEvent.input(input, { target: { value: 'arroz' } }); // ya no hay fideos en la lista
      expect(searchSelectionIndexSignal.value).toBeNull();
    });

    it('la búsqueda de clientes mantiene la selección si el cliente sigue en la lista nueva', () => {
      setCustomerRepository({
        search: (query) => {
          const q = query.toLowerCase();
          if (q === 'multi') return [anaResult, brunoResult];
          if (q.includes('bruno')) return [brunoResult];
          if (q.includes('ana')) return [anaResult];
          return [];
        },
        listRecent: () => [],
        getCustomer: () => undefined,
        getCustomerAccount: () => Promise.resolve(undefined),
      });
      render(<CommandBarInput />);
      const input = screen.getByLabelText('Barra de comandos');

      fireEvent.input(input, { target: { value: '@multi' } });
      fireEvent.keyDown(input, { key: 'ArrowDown' }); // bruno, índice 1
      expect(customerSelectionIndexSignal.value).toBe(1);

      fireEvent.input(input, { target: { value: '@bruno' } }); // ahora es el único, índice 0
      expect(customerSelectionIndexSignal.value).toBe(0);
    });
  });
});
