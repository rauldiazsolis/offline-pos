/// <reference types="node" />
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { FakeSpreadsheet, type FakeOptions } from '../../test/fake-spreadsheet.ts';

const SOURCE_FILES = ['columnas.gs', 'bridge.gs'];

const outputSchema = z.object({ content: z.string() });
const responseSchema = z.object({
  ok: z.boolean(),
  data: z.unknown().optional(),
  error: z.string().optional(),
});

function loadBridge(options: FakeOptions = {}, files: string[] = SOURCE_FILES) {
  const spreadsheet = new FakeSpreadsheet(options);
  const context = vm.createContext({
    SpreadsheetApp: spreadsheet.app(),
    ContentService: {
      MimeType: { JSON: 'JSON' },
      createTextOutput: (content: string) => {
        const output = { content, setMimeType: () => output };
        return output;
      },
    },
    LockService: {
      getScriptLock: () => ({ waitLock: () => undefined, releaseLock: () => undefined }),
    },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => null }) },
  });
  for (const file of files) {
    vm.runInContext(readFileSync(new URL(file, import.meta.url), 'utf8'), context);
  }

  function call(action: string, payload: unknown = {}, idempotencyKey?: string) {
    const body = JSON.stringify({ action, payload, idempotencyKey });
    const output: unknown = vm.runInContext(
      `doPost({ postData: { contents: ${JSON.stringify(body)} } })`,
      context,
    );
    return responseSchema.parse(JSON.parse(outputSchema.parse(output).content));
  }

  return { spreadsheet, call };
}

/** Filas de datos no vacías de una pestaña, con las fechas como ISO para poder comparar. */
function table(spreadsheet: FakeSpreadsheet, name: string): unknown[][] {
  const sheet = spreadsheet.getSheetByName(name);
  if (sheet === null) {
    throw new Error(`No existe la pestaña ${name}`);
  }
  const values = sheet.values();
  // Ancho real de la tabla: hasta la última columna con encabezado (las de sobra de una hoja sin
  // recortar no cuentan).
  const width = (values[0] ?? []).reduce<number>(
    (last, cell, index) => (cell === '' ? last : index + 1),
    0,
  );
  return values
    .slice(1)
    .filter((line) => line.some((cell) => cell !== ''))
    .map((line) =>
      line
        .slice(0, width)
        .map((cell) =>
          Object.prototype.toString.call(cell) === '[object Date]'
            ? (cell as Date).toISOString()
            : cell,
        ),
    );
}

describe('arnés (humo contra el puente actual)', () => {
  it('provisiona las pestañas al primer request y devuelve los productos sembrados', () => {
    const { spreadsheet, call } = loadBridge();

    const response = call('pullProducts');

    expect(response.error).toBeUndefined();
    expect(response.ok).toBe(true);
    expect(spreadsheet.sheetNames()).toContain('Turnos');
    expect(table(spreadsheet, 'Productos')).toHaveLength(5);
    expect(response.data).toEqual({
      items: expect.arrayContaining([
        expect.objectContaining({ id: 'p-001', name: 'Gaseosa cola 500ml' }),
      ]) as unknown,
    });
  });
});

const PRODUCT_LABELS = ['Id', 'SKU', 'Códigos de barras', 'Nombre', 'Precio', 'IVA', 'Categoría'];

describe('lectura por encabezado (Etapa 2d)', () => {
  it('crea las pestañas con etiquetas legibles en español', () => {
    const { spreadsheet, call } = loadBridge();

    call('pullProducts');

    expect(spreadsheet.getSheetByName('Productos')?.values()[0]?.slice(0, 7)).toEqual(
      PRODUCT_LABELS,
    );
    expect(spreadsheet.getSheetByName('Ventas')?.values()[0]).toContain('Precio unitario');
    expect(spreadsheet.getSheetByName('Turnos')?.values()[0]).toContain('Tarjeta de débito');
  });

  it('lee columnas reordenadas e ignora las que agregó el usuario', () => {
    const { spreadsheet, call } = loadBridge();
    spreadsheet.addSheet('Productos', [
      ['Notas', 'Precio', 'Nombre', 'Id', 'SKU', 'Categoría', 'IVA', 'Códigos de barras'],
      ['interno', 1500, 'Yerba 1kg', 'p-9', 'SKU-9', 'almacen', 0.21, '779, 780'],
    ]);

    const response = call('pullProducts');

    expect(response.data).toEqual({
      items: [
        {
          id: 'p-9',
          sku: 'SKU-9',
          barcodes: ['779', '780'],
          name: 'Yerba 1kg',
          price: 1500,
          taxRate: 0.21,
          category: 'almacen',
        },
      ],
    });
  });

  it('acepta los encabezados viejos (las claves) y los renombra a la etiqueta nueva', () => {
    const { spreadsheet, call } = loadBridge();
    const sheet = spreadsheet.addSheet('Productos', [
      ['id', 'sku', 'barcodes', 'name', 'price', 'taxRate', 'category'],
      ['p-1', 'S-1', '', 'Pan', 100, 0.21, 'panaderia'],
    ]);

    const response = call('pullProducts');

    expect(response.ok).toBe(true);
    expect(sheet.values()[0]).toEqual(PRODUCT_LABELS);
  });

  it('reconoce las etiquetas sin distinguir mayúsculas, acentos ni espacios', () => {
    const { spreadsheet, call } = loadBridge();
    spreadsheet.addSheet('Productos', [
      ['ID', 'sku', 'codigos de barras', 'NOMBRE', 'precio', 'iva', 'categoria'],
      ['p-1', 'S-1', '', 'Pan', 100, 0.21, 'panaderia'],
    ]);

    expect(call('pullProducts').data).toEqual({
      items: [expect.objectContaining({ id: 'p-1', name: 'Pan' }) as unknown],
    });
  });

  it('una columna requerida ausente da un error que dice cuál falta y en qué pestaña', () => {
    const { spreadsheet, call } = loadBridge();
    spreadsheet.addSheet('Productos', [
      ['Id', 'SKU', 'Nombre', 'IVA', 'Categoría'],
      ['p-1', 'S-1', 'Pan', 0.21, 'panaderia'],
    ]);

    const response = call('pullProducts');

    expect(response).toEqual({
      ok: false,
      error: "Falta la columna 'Precio' en la pestaña Productos",
    });
  });

  it('una columna opcional ausente se lee como vacía', () => {
    const { spreadsheet, call } = loadBridge();
    spreadsheet.addSheet('Clientes', [
      ['Id', 'Nombre', 'Alta'],
      ['c-1', 'Ana', '2026-01-01T00:00:00.000Z'],
    ]);

    expect(call('pullCustomers').data).toEqual({ items: [{ id: 'c-1', name: 'Ana' }] });
  });
});

const NOW = '2026-01-02T10:00:00.000Z';
const SALE = {
  id: 's1',
  createdAt: NOW,
  customerId: 'c-001',
  total: 2100,
  lines: [
    { kind: 'product', productId: 'p-001', qty: 1, unitPrice: 1200 },
    {
      kind: 'freeform',
      description: 'Regalo',
      qty: 1,
      unitPrice: 900,
      discount: { type: 'percentage', value: 10 },
    },
  ],
  payments: [
    { method: 'cash', amount: 1000 },
    { method: 'account', amount: 1100, reference: 'h-1' },
  ],
};

describe('escritura por encabezado (Etapa 2d)', () => {
  it('pushSale escribe cada línea y cada pago con valores en español y fechas reales', () => {
    const { spreadsheet, call } = loadBridge();

    const response = call('pushSale', { sale: SALE }, 'k1');

    expect(response.ok).toBe(true);
    expect(table(spreadsheet, 'Ventas')).toEqual([
      [
        's1',
        NOW,
        'c-001',
        1,
        'Producto',
        'p-001',
        '',
        1,
        1200,
        '',
        '',
        2100,
        '',
        'Cerrada',
        '',
        '',
      ],
      [
        's1',
        NOW,
        'c-001',
        2,
        'Libre',
        '',
        'Regalo',
        1,
        900,
        'Porcentaje',
        10,
        2100,
        '',
        'Cerrada',
        '',
        '',
      ],
    ]);
    expect(table(spreadsheet, 'Pagos')).toEqual([
      ['s1', NOW, 'Efectivo', 1000, '', 'Cerrada'],
      ['s1', NOW, 'Cuenta corriente', 1100, 'h-1', 'Cerrada'],
    ]);
    const fecha = spreadsheet.getSheetByName('Ventas')?.values()[1]?.[1];
    expect(Object.prototype.toString.call(fecha)).toBe('[object Date]');
  });

  it('escribe en la columna que indica el encabezado aunque el usuario la haya movido', () => {
    const { spreadsheet, call } = loadBridge();
    spreadsheet.addSheet('Pagos', [
      ['Estado', 'Monto', 'Id de venta', 'Fecha', 'Medio de pago', 'Referencia'],
    ]);

    call('pushSale', { sale: SALE }, 'k1');

    expect(table(spreadsheet, 'Pagos')).toEqual([
      ['Cerrada', 1000, 's1', NOW, 'Efectivo', ''],
      ['Cerrada', 1100, 's1', NOW, 'Cuenta corriente', 'h-1'],
    ]);
  });

  it('es idempotente: repetir la misma key no agrega filas', () => {
    const { spreadsheet, call } = loadBridge();

    call('pushSale', { sale: SALE }, 'k1');
    const again = call('pushSale', { sale: SALE }, 'k1');

    expect(again.ok).toBe(true);
    expect(table(spreadsheet, 'Ventas')).toHaveLength(2);
    expect(table(spreadsheet, 'Pagos')).toHaveLength(2);
    expect(table(spreadsheet, '_Idempotency')).toHaveLength(1);
  });

  it('pushSaleVoid marca (no borra) las filas de la venta con estado, fecha y motivo', () => {
    const { spreadsheet, call } = loadBridge();
    call('pushSale', { sale: SALE }, 'k1');

    const response = call(
      'pushSaleVoid',
      { saleId: 's1', voidedAt: '2026-01-03T09:00:00.000Z', voidReason: 'error de carga' },
      'k2',
    );

    expect(response.ok).toBe(true);
    for (const line of table(spreadsheet, 'Ventas')) {
      expect(line.slice(13)).toEqual(['Anulada', '2026-01-03T09:00:00.000Z', 'error de carga']);
    }
    for (const line of table(spreadsheet, 'Pagos')) {
      expect(line[5]).toBe('Anulada');
    }
  });

  it('pushSaleVoid de una venta que no llegó falla para que el motor reintente', () => {
    const { call } = loadBridge();

    expect(call('pushSaleVoid', { saleId: 'nope', voidedAt: NOW }, 'k2')).toEqual({
      ok: false,
      error: 'Venta no encontrada: nope',
    });
  });

  it('pushCustomer agrega el cliente con su fecha de alta real', () => {
    const { spreadsheet, call } = loadBridge();

    call('pushCustomer', { customer: { id: 'c-9', name: 'Zoe', createdAt: NOW } }, 'k1');

    expect(table(spreadsheet, 'Clientes')).toHaveLength(4);
    expect(table(spreadsheet, 'Clientes')[3]).toEqual(['c-9', 'Zoe', '', '', NOW]);
  });

  it('pushAccountHoldConfirm deriva cliente y monto de Ventas y Pagos', () => {
    const { spreadsheet, call } = loadBridge();
    call('pushSale', { sale: SALE }, 'k1');

    const response = call('pushAccountHoldConfirm', { holdId: 'h-1', saleId: 's1' }, 'k2');

    expect(response.ok).toBe(true);
    expect(table(spreadsheet, 'CuentaCorriente')).toEqual([
      [expect.any(String) as unknown, 'h-1', 's1', 'c-001', 1100],
    ]);
    expect(call('pushAccountHoldConfirm', { holdId: 'h-2', saleId: 'zzz' }, 'k3')).toEqual({
      ok: false,
      error: 'Venta a cuenta no encontrada: zzz',
    });
  });

  it('pushCashSession suma por medio de pago solo las ventas cerradas del turno', () => {
    const { spreadsheet, call } = loadBridge();
    call('pushSale', { sale: SALE }, 'k1');

    call(
      'pushCashSession',
      {
        session: {
          id: 't1',
          openedAt: NOW,
          closedAt: '2026-01-02T18:00:00.000Z',
          openingAmount: 500,
          closingAmount: 1450,
          sales: ['s1'],
        },
      },
      'k2',
    );

    expect(table(spreadsheet, 'Turnos')).toEqual([
      ['t1', NOW, '2026-01-02T18:00:00.000Z', 500, 1450, 1, 1000, 0, 0, 0, 0, 1100, 1500, -50],
    ]);
  });

  it('lee planillas anteriores: encabezados y valores viejos (cash, cerrada) se entienden y se renombran', () => {
    const { spreadsheet, call } = loadBridge();
    const ventas = spreadsheet.addSheet('Ventas', [
      [
        'saleId',
        'fecha',
        'customerId',
        'linea',
        'tipo',
        'productId',
        'descripcion',
        'cantidad',
        'precioUnitario',
        'descuentoTipo',
        'descuentoValor',
        'totalVenta',
        'ajusteGlobalPct',
        'estado',
        'anuladaEn',
        'motivoAnulacion',
      ],
      ['s1', NOW, 'c-001', 1, 'product', 'p-001', '', 1, 1200, '', '', 2100, '', 'cerrada', '', ''],
    ]);
    const pagos = spreadsheet.addSheet('Pagos', [
      ['saleId', 'fecha', 'medio', 'monto', 'referencia', 'estado'],
      ['s1', NOW, 'account', 1100, 'h-1', 'cerrada'],
    ]);

    const response = call('pushAccountHoldConfirm', { holdId: 'h-1', saleId: 's1' }, 'k1');

    expect(response.ok).toBe(true);
    expect(table(spreadsheet, 'CuentaCorriente')).toEqual([
      [expect.any(String) as unknown, 'h-1', 's1', 'c-001', 1100],
    ]);
    expect(pagos.values()[0]).toContain('Medio de pago');
    expect(ventas.values()[0]).toContain('Id de venta');
  });
});

describe('pestañas nuevas (Etapa 2d)', () => {
  it('nacen con el tamaño exacto: encabezado y una fila plantilla, sin columnas de sobra', () => {
    const { spreadsheet, call } = loadBridge();

    call('pullProducts');

    const turnos = spreadsheet.getSheetByName('Turnos');
    expect([turnos?.getMaxRows(), turnos?.getMaxColumns()]).toEqual([2, 14]);
    const productos = spreadsheet.getSheetByName('Productos');
    expect([productos?.getMaxRows(), productos?.getMaxColumns()]).toEqual([6, 7]); // 5 sembrados
  });

  it('el encabezado va congelado y la pestaña de idempotencia oculta', () => {
    const { spreadsheet, call } = loadBridge();

    call('pullProducts');

    expect(spreadsheet.getSheetByName('Pagos')?.frozenRows).toBe(1);
    expect(spreadsheet.getSheetByName('_Idempotency')?.hidden).toBe(true);
    expect(spreadsheet.getSheetByName('Productos')?.hidden).toBe(false);
  });

  it('la fila plantilla lleva formato y validación por columna', () => {
    const { spreadsheet, call } = loadBridge();

    call('pullProducts');

    const pagos = spreadsheet.getSheetByName('Pagos');
    expect(pagos?.formats(2)).toEqual(['@', 'dd/mm/yyyy hh:mm', '@', '#,##0.00', '@', '@']);
    expect(pagos?.validations(2)[2]).toEqual({
      list: [
        'Efectivo',
        'Tarjeta de débito',
        'Tarjeta de crédito',
        'Transferencia',
        'Código QR',
        'Cuenta corriente',
      ],
      allowInvalid: false,
    });
    expect(pagos?.validations(2)[5]).toEqual({ list: ['Cerrada', 'Anulada'], allowInvalid: false });
    expect(pagos?.validations(2)[0]).toBeNull();
    expect(spreadsheet.getSheetByName('Productos')?.formats(2)).toEqual([
      '@',
      '@',
      '@',
      '@',
      '#,##0.00',
      '0.0%',
      '@',
    ]);
  });

  it.each([false, true])(
    'la primera venta llena la fila plantilla y las siguientes copian su formato (validación cuenta como contenido: %s)',
    (validationCountsAsContent) => {
      const { spreadsheet, call } = loadBridge({ validationCountsAsContent });

      call('pushSale', { sale: SALE }, 'k1');

      const ventas = spreadsheet.getSheetByName('Ventas');
      expect(ventas?.values()[1]?.[0]).toBe('s1'); // la fila 2 se llenó
      expect(ventas?.getMaxRows()).toBe(3); // encabezado + 2 líneas, sin fila vacía
      expect(ventas?.formats(3)).toEqual(ventas?.formats(2));
      expect(ventas?.validations(3)).toEqual(ventas?.validations(2));

      call('pushSale', { sale: { ...SALE, id: 's2' } }, 'k2');

      expect(ventas?.getMaxRows()).toBe(5);
      expect(ventas?.formats(5)).toEqual(ventas?.formats(2));
      expect(ventas?.validations(5)).toEqual(ventas?.validations(2));
      expect(spreadsheet.getSheetByName('Pagos')?.getMaxRows()).toBe(5);
    },
  );

  it('no redimensiona una pestaña que ya existía', () => {
    const { spreadsheet, call } = loadBridge();
    const productos = spreadsheet.addSheet('Productos', [
      ['Id', 'SKU', 'Códigos de barras', 'Nombre', 'Precio', 'IVA', 'Categoría'],
      ...Array.from({ length: 12 }, () => ['', '', '', '', '', '', '']),
    ]);

    call('pullProducts');

    expect([productos.getMaxRows(), productos.getMaxColumns()]).toEqual([13, 7]);
  });
});

describe('instalación', () => {
  it('si falta columnas.gs en el proyecto de Apps Script, el error lo dice en claro', () => {
    const { call } = loadBridge({}, ['bridge.gs']);

    expect(call('pullProducts')).toEqual({
      ok: false,
      error: 'Falta el archivo columnas.gs en el proyecto de Apps Script',
    });
  });
});
