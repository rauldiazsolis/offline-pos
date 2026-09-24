import { render, screen, within } from '@testing-library/preact';
import { beforeEach, describe, expect, it } from 'vitest';
import { CartView } from './CartView.tsx';
import { formatMoney } from '../format.ts';
import { cartSelectionIndexSignal, cartSignal } from '../state/cart.ts';
import { setCatalogRepository } from '../state/catalog.ts';
import { attachedCustomerSignal } from '../state/customer.ts';
import { stockSnapshotSignal } from '../state/stock.ts';

beforeEach(() => {
  cartSignal.value = { lines: [] };
  cartSelectionIndexSignal.value = null;
  attachedCustomerSignal.value = undefined;
  setCatalogRepository({
    search: () => [],
    findByBarcodeOrSku: () => undefined,
    getProduct: (id) =>
      id === 'p1'
        ? {
            id: 'p1',
            sku: 'SKU-1',
            barcodes: [],
            name: 'Arroz 1kg',
            price: 100,
            taxRate: 0.21,
            category: 'almacen',
            tracksStock: true,
          }
        : undefined,
    getStock: () => Promise.resolve(undefined),
  });
});

describe('CartView', () => {
  it('muestra "carrito vacío" cuando no hay líneas', () => {
    render(<CartView />);
    expect(screen.getByText('El carrito está vacío.')).not.toBeNull();
  });

  // Ciclo 8, punto 5: Total siempre visible, mismo criterio que ya tenía
  // Cliente — antes desaparecía por completo con el carrito vacío.
  it('con carrito vacío, igual muestra "Resumen de venta" con $0,00 (Ciclo 8)', () => {
    const { container } = render(<CartView />);
    const totalsCard = container.querySelector<HTMLElement>('.cart-view__totals');
    if (totalsCard === null) throw new Error('setup falló');

    expect(within(totalsCard).getByText('Resumen de venta')).not.toBeNull();
    // Subtotal, Descuento y Total — las tres filas en $0,00 con carrito vacío.
    expect(within(totalsCard).getAllByText(formatMoney(0))).toHaveLength(3);
  });

  // La tarjeta de cliente siempre se muestra, con o sin cliente adjunto —
  // "Consumidor Final" es el default (antes no se mostraba nada).
  it('sin cliente adjunto, muestra "Consumidor Final"', () => {
    render(<CartView />);
    expect(screen.getByText('Consumidor Final')).not.toBeNull();
  });

  it('con cliente adjunto, muestra su nombre y, si están presentes, documento y teléfono', () => {
    attachedCustomerSignal.value = {
      id: 'c1',
      name: 'Ana García',
      document: '12345678',
      phone: '555-1234',
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    render(<CartView />);
    expect(screen.getByText('Ana García')).not.toBeNull();
    expect(screen.getByText('Doc: 12345678')).not.toBeNull();
    expect(screen.getByText('Tel: 555-1234')).not.toBeNull();
  });

  it('con cliente adjunto sin documento/teléfono, no muestra esas líneas', () => {
    attachedCustomerSignal.value = {
      id: 'c1',
      name: 'Ana García',
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    render(<CartView />);
    expect(screen.getByText('Ana García')).not.toBeNull();
    expect(screen.queryByText(/^Doc:/)).toBeNull();
    expect(screen.queryByText(/^Tel:/)).toBeNull();
  });

  // Ciclo 7: la posición de cada dato no se mueve — siempre 4 filas
  // (label, nombre, documento, teléfono), con o sin cliente, con o sin
  // esos datos. Documento/teléfono quedan en blanco, no se ocultan.
  it('la tarjeta de cliente siempre tiene la misma cantidad de filas', () => {
    const { container: withoutCustomer } = render(<CartView />);
    const cardWithout = withoutCustomer.querySelector('.cart-view__customer');

    attachedCustomerSignal.value = {
      id: 'c1',
      name: 'Ana García',
      document: '12345678',
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    const { container: withCustomer } = render(<CartView />);
    const cardWith = withCustomer.querySelector('.cart-view__customer');

    expect(cardWithout?.children.length).toBe(4);
    expect(cardWith?.children.length).toBe(cardWithout?.children.length);
  });

  it('muestra los labels "Cliente" y "Resumen de venta"', () => {
    cartSignal.value = { lines: [{ kind: 'product', productId: 'p1', qty: 1, unitPrice: 100 }] };
    render(<CartView />);
    expect(screen.getByText('Cliente')).not.toBeNull();
    expect(screen.getByText('Resumen de venta')).not.toBeNull();
  });

  it('resuelve el nombre del producto para una línea de tipo product', () => {
    cartSignal.value = { lines: [{ kind: 'product', productId: 'p1', qty: 2, unitPrice: 100 }] };
    render(<CartView />);
    expect(screen.getByText(/Arroz 1kg/)).not.toBeNull();
  });

  it('muestra la descripción para una línea libre', () => {
    cartSignal.value = {
      lines: [{ kind: 'freeform', description: 'Envío', qty: 1, unitPrice: 500 }],
    };
    render(<CartView />);
    expect(screen.getByText(/Envío/)).not.toBeNull();
  });

  it('muestra el total del carrito', () => {
    cartSignal.value = { lines: [{ kind: 'product', productId: 'p1', qty: 2, unitPrice: 100 }] };
    render(<CartView />);
    expect(screen.getByText('Total')).not.toBeNull();
  });

  // Issue #31: Subtotal/Descuento/Total siempre, no solo el Total con una
  // fila condicional.
  it('sin ajuste global, muestra Subtotal/Descuento ($0)/Total', () => {
    cartSignal.value = { lines: [{ kind: 'product', productId: 'p1', qty: 1, unitPrice: 100 }] };
    const { container } = render(<CartView />);
    const totalsCard = container.querySelector<HTMLElement>('.cart-view__totals');
    if (totalsCard === null) throw new Error('setup falló');
    expect(within(totalsCard).getByText('Subtotal')).not.toBeNull();
    expect(within(totalsCard).getByText('Descuento')).not.toBeNull();
    expect(within(totalsCard).getByText('Total')).not.toBeNull();
  });

  it('con recargo, la fila muestra "Recargo (+10%)"', () => {
    cartSignal.value = {
      lines: [{ kind: 'product', productId: 'p1', qty: 1, unitPrice: 100 }],
      globalAdjustmentPercentage: 10,
    };
    render(<CartView />);
    expect(screen.getByText(/Recargo \(\+10%\)/)).not.toBeNull();
  });

  it('con descuento, la fila muestra "Descuento (-10%)"', () => {
    cartSignal.value = {
      lines: [{ kind: 'product', productId: 'p1', qty: 1, unitPrice: 100 }],
      globalAdjustmentPercentage: -10,
    };
    render(<CartView />);
    expect(screen.getByText(/Descuento \(-10%\)/)).not.toBeNull();
  });
});

describe('CartView — advertencias (#99)', () => {
  it('una línea sobre el stock muestra "⚠ Stock disponible: N"', () => {
    stockSnapshotSignal.value = new Map([['p1', 3]]);
    cartSignal.value = { lines: [{ kind: 'product', productId: 'p1', qty: 5, unitPrice: 100 }] };
    render(<CartView />);

    expect(screen.getByText('⚠ Stock disponible: 3')).not.toBeNull();
  });

  it('una línea negativa nunca advierte por stock', () => {
    stockSnapshotSignal.value = new Map();
    cartSignal.value = { lines: [{ kind: 'product', productId: 'p1', qty: -5, unitPrice: 100 }] };
    render(<CartView />);

    expect(screen.queryByText(/Stock disponible/)).toBeNull();
  });

  it('la tarjeta de cliente muestra el bloqueo', () => {
    attachedCustomerSignal.value = {
      id: 'c1',
      name: 'Ana',
      createdAt: '2026-01-01T00:00:00.000Z',
      blocked: { reason: 'Deuda' },
    };
    render(<CartView />);

    expect(screen.getByText('⚠ Bloqueado: Deuda')).not.toBeNull();
  });
});

describe('CartView — devolución destacada (prueba manual de la Etapa 4)', () => {
  it('una línea negativa se resalta y el total negativo va en rojo', () => {
    cartSignal.value = {
      lines: [{ kind: 'freeform', description: 'regalo', qty: -1, unitPrice: 100 }],
    };
    const { container } = render(<CartView />);

    expect(container.querySelector('.cart-view__refund-line')).not.toBeNull();
    const totalsCard = container.querySelector<HTMLElement>('.cart-view__totals');
    if (totalsCard === null) throw new Error('setup falló');
    expect(within(totalsCard).getAllByText(formatMoney(-100)).at(-1)?.style.color).toBe(
      'var(--color-danger)',
    );
  });
});
