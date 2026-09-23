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

function pullBatch(
  call: ReturnType<typeof loadBridge>['call'],
  cursors: { products?: string; customers?: string } = {},
  pendingLotIds: string[] = [],
) {
  return call('pullBatch', { cursors, pendingLotIds });
}

describe('arnés (humo contra el puente actual)', () => {
  it('provisiona las pestañas al primer request y devuelve los productos sembrados', () => {
    const { spreadsheet, call } = loadBridge();

    const response = pullBatch(call);

    expect(response.error).toBeUndefined();
    expect(response.ok).toBe(true);
    expect(spreadsheet.sheetNames()).toContain('MovimientosCaja');
    expect(table(spreadsheet, 'Productos')).toHaveLength(5);
    expect(response.data).toEqual(
      expect.objectContaining({
        products: expect.objectContaining({
          items: expect.arrayContaining([
            expect.objectContaining({ id: 'p-001', name: 'Gaseosa cola 500ml' }),
          ]) as unknown,
        }) as unknown,
      }),
    );
  });
});

const PRODUCT_LABELS = ['Id', 'SKU', 'Códigos de barras', 'Nombre', 'Precio', 'IVA', 'Categoría'];
const PRODUCT_V3_LABELS = [...PRODUCT_LABELS, 'Alta', 'Bloqueado', 'Motivo del bloqueo'];

describe('lectura por encabezado (Etapa 2d)', () => {
  it('crea las pestañas con etiquetas legibles en español', () => {
    const { spreadsheet, call } = loadBridge();

    pullBatch(call);

    expect(spreadsheet.getSheetByName('Productos')?.values()[0]?.slice(0, 7)).toEqual(
      PRODUCT_LABELS,
    );
    expect(spreadsheet.getSheetByName('Ventas')?.values()[0]).toContain('Precio unitario');
    expect(spreadsheet.getSheetByName('Cobranzas')?.values()[0]).toContain('Medio de pago');
  });

  it('lee columnas reordenadas e ignora las que agregó el usuario', () => {
    const { spreadsheet, call } = loadBridge();
    spreadsheet.addSheet('Productos', [
      ['Notas', 'Precio', 'Nombre', 'Id', 'SKU', 'Categoría', 'IVA', 'Códigos de barras'],
      ['interno', 1500, 'Yerba 1kg', 'p-9', 'SKU-9', 'almacen', 0.21, '779, 780'],
    ]);

    const response = pullBatch(call);

    expect(response.data).toEqual(
      expect.objectContaining({
        products: {
          items: [
            {
              id: 'p-9',
              sku: 'SKU-9',
              barcodes: ['779', '780'],
              name: 'Yerba 1kg',
              price: 1500,
              taxRate: 0.21,
              category: 'almacen',
              createdAt: expect.any(String) as unknown,
            },
          ],
          nextCursor: expect.any(String) as unknown,
        },
      }),
    );
  });

  it('acepta los encabezados viejos (las claves) y los renombra a la etiqueta nueva', () => {
    const { spreadsheet, call } = loadBridge();
    const sheet = spreadsheet.addSheet('Productos', [
      ['id', 'sku', 'barcodes', 'name', 'price', 'taxRate', 'category'],
      ['p-1', 'S-1', '', 'Pan', 100, 0.21, 'panaderia'],
    ]);

    const response = pullBatch(call);

    expect(response.ok).toBe(true);
    expect(sheet.values()[0]).toEqual(PRODUCT_V3_LABELS);
  });

  it('reconoce las etiquetas sin distinguir mayúsculas, acentos ni espacios', () => {
    const { spreadsheet, call } = loadBridge();
    spreadsheet.addSheet('Productos', [
      ['ID', 'sku', 'codigos de barras', 'NOMBRE', 'precio', 'iva', 'categoria'],
      ['p-1', 'S-1', '', 'Pan', 100, 0.21, 'panaderia'],
    ]);

    const response = pullBatch(call);
    expect((response.data as { products: { items: unknown[] } }).products.items).toEqual([
      expect.objectContaining({ id: 'p-1', name: 'Pan' }) as unknown,
    ]);
  });

  it('una columna requerida ausente da un error que dice cuál falta y en qué pestaña', () => {
    const { spreadsheet, call } = loadBridge();
    spreadsheet.addSheet('Productos', [
      ['Id', 'SKU', 'Nombre', 'IVA', 'Categoría'],
      ['p-1', 'S-1', 'Pan', 0.21, 'panaderia'],
    ]);

    const response = pullBatch(call);

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

    const response = pullBatch(call);
    expect((response.data as { customers: { items: unknown[] } }).customers.items).toEqual([
      { id: 'c-1', name: 'Ana', createdAt: '2026-01-01T00:00:00.000Z' },
    ]);
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

const saleEvent = (id: string, sale: unknown = SALE) => ({
  type: 'sale',
  id,
  createdAt: NOW,
  origin: {},
  sale,
});

describe('pushBatch — un solo lote, un solo ack (#87)', () => {
  it('escribe cada línea y cada pago con valores en español y fechas reales', () => {
    const { spreadsheet, call } = loadBridge();

    const response = call('pushBatch', { deviceId: 'dev-1', events: [saleEvent('e1')] }, 'lot-1');

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
        'dev-1',
        '',
        '',
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
        'dev-1',
        '',
        '',
        '',
        '',
      ],
    ]);
    expect(table(spreadsheet, 'Pagos')).toEqual([
      ['s1', NOW, 'Efectivo', 1000, '', 'Cerrada', 'dev-1', '', ''],
      ['s1', NOW, 'Cuenta corriente', 1100, 'h-1', 'Cerrada', 'dev-1', '', ''],
    ]);
    const fecha = spreadsheet.getSheetByName('Ventas')?.values()[1]?.[1];
    expect(Object.prototype.toString.call(fecha)).toBe('[object Date]');
  });

  it('escribe en la columna que indica el encabezado aunque el usuario la haya movido', () => {
    const { spreadsheet, call } = loadBridge();
    spreadsheet.addSheet('Pagos', [
      ['Estado', 'Monto', 'Id de venta', 'Fecha', 'Medio de pago', 'Referencia'],
    ]);

    call('pushBatch', { deviceId: 'dev-1', events: [saleEvent('e1')] }, 'lot-1');

    // La pestaña vieja ganó al final las columnas de identidad (ensureColumns, contrato v3).
    expect(table(spreadsheet, 'Pagos')).toEqual([
      ['Cerrada', 1000, 's1', NOW, 'Efectivo', '', 'dev-1', '', ''],
      ['Cerrada', 1100, 's1', NOW, 'Cuenta corriente', 'h-1', 'dev-1', '', ''],
    ]);
  });

  it('es idempotente por lote: repetir el mismo idempotencyKey no reprocesa', () => {
    const { spreadsheet, call } = loadBridge();

    call('pushBatch', { deviceId: 'dev-1', events: [saleEvent('e1')] }, 'lot-1');
    const again = call('pushBatch', { deviceId: 'dev-1', events: [saleEvent('e1')] }, 'lot-1');

    expect(again.ok).toBe(true);
    expect(table(spreadsheet, 'Ventas')).toHaveLength(2);
    expect(table(spreadsheet, 'Pagos')).toHaveLength(2);
    expect(table(spreadsheet, '_PushLots')).toHaveLength(1);
  });

  it('varios tipos de evento en el mismo lote se aplican todos', () => {
    const { spreadsheet, call } = loadBridge();

    const response = call(
      'pushBatch',
      {
        deviceId: 'dev-1',
        events: [
          saleEvent('e1'),
          { type: 'customer', id: 'e2', customer: { id: 'c-9', name: 'Zoe', createdAt: NOW } },
          {
            type: 'cash-movement',
            id: 'e3',
            movement: {
              id: 'm1',
              direction: 'in',
              amount: 500,
              concept: 'Cambio',
              source: 'manual',
              createdAt: NOW,
            },
          },
          { type: 'account-hold-confirm', id: 'e4', holdId: 'h-1', saleId: 's1' },
          { type: 'stock-movement', id: 'e5', movement: {} },
          { type: 'account-hold-release', id: 'e6', holdId: 'h-1' },
        ],
      },
      'lot-1',
    );

    expect(response.ok).toBe(true);
    expect(table(spreadsheet, 'Ventas')).toHaveLength(2);
    expect(table(spreadsheet, 'Clientes')).toHaveLength(4);
    expect(table(spreadsheet, 'MovimientosCaja')).toHaveLength(1);
    expect(table(spreadsheet, 'CuentaCorriente')).toHaveLength(1);
  });

  it('un evento que falla queda como issue del lote — el ack sigue siendo ok y el resto del lote se aplica', () => {
    const { spreadsheet, call } = loadBridge();

    const response = call(
      'pushBatch',
      {
        deviceId: 'dev-1',
        events: [
          { type: 'customer', id: 'e1', customer: { id: 'c-9', name: 'Zoe', createdAt: NOW } },
          { type: 'sale-void', id: 'e2', saleId: 'nope', voidedAt: NOW },
          { type: 'account-hold-confirm', id: 'e3', holdId: 'h-2', saleId: 'tampoco' },
        ],
      },
      'lot-1',
    );

    expect(response.ok).toBe(true);
    expect(table(spreadsheet, 'Clientes')).toHaveLength(4); // el evento que sí pudo, se aplicó

    const pull = pullBatch(call, {}, ['lot-1']);
    const lots = (
      pull.data as {
        lots: Record<string, { status: string; issues?: { message: string; eventId?: string }[] }>;
      }
    ).lots;
    expect(lots['lot-1']?.status).toBe('issues');
    expect(lots['lot-1']?.issues).toEqual([
      { message: expect.stringContaining('Venta no encontrada: nope') as unknown, eventId: 'e2' },
      {
        message: expect.stringContaining('Venta a cuenta no encontrada: tampoco') as unknown,
        eventId: 'e3',
      },
    ]);
  });

  it('un lote sin problemas queda ok', () => {
    const { call } = loadBridge();

    call('pushBatch', { deviceId: 'dev-1', events: [saleEvent('e1')] }, 'lot-1');

    const pull = pullBatch(call, {}, ['lot-1']);
    expect((pull.data as { lots: Record<string, unknown> }).lots).toEqual({
      'lot-1': { status: 'ok' },
    });
  });

  it('un id de lote desconocido no aparece en la respuesta (el POS lo trata como processing)', () => {
    const { call } = loadBridge();

    const pull = pullBatch(call, {}, ['nunca-existio']);

    expect((pull.data as { lots: Record<string, unknown> }).lots).toEqual({});
  });

  it('pushSaleVoid marca (no borra) las filas de la venta con estado, fecha y motivo', () => {
    const { spreadsheet, call } = loadBridge();
    call('pushBatch', { deviceId: 'dev-1', events: [saleEvent('e1')] }, 'lot-1');

    const response = call(
      'pushBatch',
      {
        deviceId: 'dev-1',
        events: [
          {
            type: 'sale-void',
            id: 'e2',
            saleId: 's1',
            voidedAt: '2026-01-03T09:00:00.000Z',
            voidReason: 'error de carga',
          },
        ],
      },
      'lot-2',
    );

    expect(response.ok).toBe(true);
    for (const line of table(spreadsheet, 'Ventas')) {
      expect(line.slice(13, 16)).toEqual(['Anulada', '2026-01-03T09:00:00.000Z', 'error de carga']);
    }
    for (const line of table(spreadsheet, 'Pagos')) {
      expect(line[5]).toBe('Anulada');
    }
  });

  it('pushAccountHoldConfirm deriva cliente y monto de Ventas y Pagos', () => {
    const { spreadsheet, call } = loadBridge();
    call('pushBatch', { deviceId: 'dev-1', events: [saleEvent('e1')] }, 'lot-1');

    call(
      'pushBatch',
      {
        deviceId: 'dev-1',
        events: [{ type: 'account-hold-confirm', id: 'e2', holdId: 'h-1', saleId: 's1' }],
      },
      'lot-2',
    );

    expect(table(spreadsheet, 'CuentaCorriente')).toEqual([
      [expect.any(String) as unknown, 'h-1', 's1', 'c-001', 1100, '', 'dev-1', '', ''],
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

    const response = call(
      'pushBatch',
      {
        deviceId: 'dev-1',
        events: [{ type: 'account-hold-confirm', id: 'e1', holdId: 'h-1', saleId: 's1' }],
      },
      'lot-1',
    );

    expect(response.ok).toBe(true);
    expect(table(spreadsheet, 'CuentaCorriente')).toEqual([
      [expect.any(String) as unknown, 'h-1', 's1', 'c-001', 1100, '', 'dev-1', '', ''],
    ]);
    expect(pagos.values()[0]).toContain('Medio de pago');
    expect(ventas.values()[0]).toContain('Id de venta');
  });
});

describe('cursor de pull (#87)', () => {
  it('el primer pull sin cursor trae todo y devuelve nextCursor', () => {
    const { call } = loadBridge();

    const response = pullBatch(call);
    const products = (response.data as { products: { items: unknown[]; nextCursor?: string } })
      .products;

    expect(products.items).toHaveLength(5);
    expect(typeof products.nextCursor).toBe('string');
  });

  it('un segundo pull con ese cursor y sin cambios no trae nada', () => {
    const { call } = loadBridge();

    const first = pullBatch(call);
    const cursor = (first.data as { products: { nextCursor: string } }).products.nextCursor;
    const second = pullBatch(call, { products: cursor });

    expect((second.data as { products: { items: unknown[] } }).products.items).toEqual([]);
  });

  it('modificar una fila a mano entre dos pulls la vuelve a traer en el delta', () => {
    const { spreadsheet, call } = loadBridge();

    const first = pullBatch(call);
    const cursor = (first.data as { products: { nextCursor: string } }).products.nextCursor;
    const productos = spreadsheet.getSheetByName('Productos');
    productos?.getRange(2, 5).setValue(9999); // fila de p-001, columna Precio

    const second = pullBatch(call, { products: cursor });
    const items = (second.data as { products: { items: { id: string; price: number }[] } }).products
      .items;

    expect(items).toEqual([expect.objectContaining({ id: 'p-001', price: 9999 })]);
  });

  it('un cliente nuevo agregado por pushBatch aparece en el delta de clientes', () => {
    const { call } = loadBridge();

    const first = pullBatch(call);
    const cursor = (first.data as { customers: { nextCursor: string } }).customers.nextCursor;

    call(
      'pushBatch',
      {
        deviceId: 'dev-1',
        events: [
          { type: 'customer', id: 'e1', customer: { id: 'c-9', name: 'Zoe', createdAt: NOW } },
        ],
      },
      'lot-1',
    );

    const second = pullBatch(call, { customers: cursor });
    expect((second.data as { customers: { items: unknown[] } }).customers.items).toEqual([
      expect.objectContaining({ id: 'c-9' }),
    ]);
  });

  it('sin filas en el recurso, no hay nextCursor', () => {
    const { spreadsheet, call } = loadBridge();
    spreadsheet.addSheet('Clientes', [['Id', 'Nombre', 'Alta']]);

    const response = pullBatch(call);

    expect((response.data as { customers: { nextCursor?: string } }).customers.nextCursor).toBe(
      undefined,
    );
  });
});

describe('pestañas nuevas (Etapa 2d/2)', () => {
  it('nacen con el tamaño exacto: encabezado y una fila plantilla, sin columnas de sobra', () => {
    const { spreadsheet, call } = loadBridge();

    pullBatch(call);

    const movimientos = spreadsheet.getSheetByName('MovimientosCaja');
    expect([movimientos?.getMaxRows(), movimientos?.getMaxColumns()]).toEqual([2, 12]);
    const productos = spreadsheet.getSheetByName('Productos');
    expect([productos?.getMaxRows(), productos?.getMaxColumns()]).toEqual([6, 10]); // 5 sembrados
  });

  it('el encabezado va congelado y las pestañas internas ocultas', () => {
    const { spreadsheet, call } = loadBridge();

    pullBatch(call);

    expect(spreadsheet.getSheetByName('Pagos')?.frozenRows).toBe(1);
    expect(spreadsheet.getSheetByName('_PushLots')?.hidden).toBe(true);
    expect(spreadsheet.getSheetByName('_Snapshot')?.hidden).toBe(true);
    expect(spreadsheet.getSheetByName('Productos')?.hidden).toBe(false);
  });

  it('la fila plantilla lleva formato y validación por columna', () => {
    const { spreadsheet, call } = loadBridge();

    pullBatch(call);

    const pagos = spreadsheet.getSheetByName('Pagos');
    expect(pagos?.formats(2)).toEqual([
      '@',
      'dd/mm/yyyy hh:mm',
      '@',
      '#,##0.00',
      '@',
      '@',
      '@',
      '@',
      '@',
    ]);
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
      'dd/mm/yyyy hh:mm',
      '@',
      '@',
    ]);
    const bloqueado = spreadsheet.getSheetByName('Productos')?.validations(2)[8];
    expect(bloqueado).toEqual({ list: ['Sí', 'No'], allowInvalid: false });
  });

  it.each([false, true])(
    'la primera venta llena la fila plantilla y las siguientes copian su formato (validación cuenta como contenido: %s)',
    (validationCountsAsContent) => {
      const { spreadsheet, call } = loadBridge({ validationCountsAsContent });

      call('pushBatch', { deviceId: 'dev-1', events: [saleEvent('e1')] }, 'lot-1');

      const ventas = spreadsheet.getSheetByName('Ventas');
      expect(ventas?.values()[1]?.[0]).toBe('s1'); // la fila 2 se llenó
      expect(ventas?.getMaxRows()).toBe(3); // encabezado + 2 líneas, sin fila vacía
      expect(ventas?.formats(3)).toEqual(ventas?.formats(2));
      expect(ventas?.validations(3)).toEqual(ventas?.validations(2));

      call(
        'pushBatch',
        { deviceId: 'dev-1', events: [saleEvent('e2', { ...SALE, id: 's2' })] },
        'lot-2',
      );

      expect(ventas?.getMaxRows()).toBe(5);
      expect(ventas?.formats(5)).toEqual(ventas?.formats(2));
      expect(ventas?.validations(5)).toEqual(ventas?.validations(2));
      expect(spreadsheet.getSheetByName('Pagos')?.getMaxRows()).toBe(5);
    },
  );

  it('en una pestaña que ya existía solo agrega las columnas que faltan, no filas', () => {
    const { spreadsheet, call } = loadBridge();
    const productos = spreadsheet.addSheet('Productos', [
      ['Id', 'SKU', 'Códigos de barras', 'Nombre', 'Precio', 'IVA', 'Categoría'],
      ...Array.from({ length: 12 }, () => ['', '', '', '', '', '', '']),
    ]);

    pullBatch(call);

    expect([productos.getMaxRows(), productos.getMaxColumns()]).toEqual([13, 10]);
  });
});

describe('contrato v3 (#96)', () => {
  const v3SaleEvent = (overrides: { origin?: unknown; sale?: Record<string, unknown> } = {}) => ({
    type: 'sale',
    id: 'e-sale',
    createdAt: NOW,
    origin: overrides.origin ?? {},
    sale: { ...SALE, ...overrides.sale },
  });

  it('crea MovimientosCaja y Cobranzas, y ya no crea Turnos', () => {
    const { spreadsheet, call } = loadBridge();
    pullBatch(call);
    expect(spreadsheet.sheetNames()).toEqual(
      expect.arrayContaining(['MovimientosCaja', 'Cobranzas']),
    );
    expect(spreadsheet.sheetNames()).not.toContain('Turnos');
    expect(spreadsheet.getSheetByName('MovimientosCaja')?.values()[0]).toContain('Esperado');
  });

  it('ensureColumns agrega al final las columnas que le faltan a una pestaña vieja, sin tocar datos', () => {
    const { spreadsheet, call } = loadBridge();
    spreadsheet.addSheet('Productos', [
      ['Id', 'SKU', 'Códigos de barras', 'Nombre', 'Precio', 'IVA', 'Categoría'],
      ['p-1', 'S1', '', 'Yerba', 100, 0.21, 'almacen'],
    ]);

    pullBatch(call);

    const sheet = spreadsheet.getSheetByName('Productos');
    expect(sheet?.values()[0]?.slice(0, 10)).toEqual(PRODUCT_V3_LABELS);
    expect(sheet?.values()[1]?.slice(0, 4)).toEqual(['p-1', 'S1', '', 'Yerba']);
    expect(sheet?.formats(2).slice(7)).toEqual(['dd/mm/yyyy hh:mm', '@', '@']);
  });

  it('una pestaña vieja con solo el encabezado gana también su fila plantilla', () => {
    const { spreadsheet, call } = loadBridge();
    const sheet = spreadsheet.addSheet('Pagos', [
      ['Id de venta', 'Fecha', 'Medio de pago', 'Monto', 'Referencia', 'Estado'],
    ]);

    pullBatch(call);

    expect(sheet.values()[0]?.slice(6)).toEqual(['Dispositivo', 'Sucursal', 'Punto de venta']);
    expect(sheet.formats(2).slice(6)).toEqual(['@', '@', '@']);
  });

  it('completa la Alta que falta la primera vez que lee la fila, y después queda fija', () => {
    const { call } = loadBridge();
    const dates = (response: ReturnType<typeof pullBatch>) =>
      (response.data as { products: { items: { id: string; createdAt: string }[] } }).products.items
        .map((item) => `${item.id}=${item.createdAt}`)
        .sort();

    const first = dates(pullBatch(call));
    const second = dates(pullBatch(call));

    expect(first.every((entry) => /=\d{4}-\d{2}-\d{2}T/.test(entry))).toBe(true);
    expect(second).toEqual(first);
  });

  it('informa el bloqueo con su motivo', () => {
    const { spreadsheet, call } = loadBridge();
    pullBatch(call);
    const sheet = spreadsheet.getSheetByName('Productos');
    const header = sheet?.values()[0] ?? [];
    // fila 2 = primer producto sembrado (p-001); columnas por encabezado
    sheet?.getRange(2, header.indexOf('Bloqueado') + 1).setValue('Sí');
    sheet?.getRange(2, header.indexOf('Motivo del bloqueo') + 1).setValue('Vencido');

    const response = pullBatch(call);

    const items = (
      response.data as { products: { items: { id: string; blocked?: { reason: string } }[] } }
    ).products.items;
    expect(items.find((item) => item.id === 'p-001')?.blocked).toEqual({ reason: 'Vencido' });
    expect(items.find((item) => item.id === 'p-002')).not.toHaveProperty('blocked');
  });

  it('estampa dispositivo, sucursal y punto de venta en lo que escribe', () => {
    const { spreadsheet, call } = loadBridge();

    call(
      'pushBatch',
      {
        deviceId: 'dev-1',
        events: [v3SaleEvent({ origin: { branch: 'Centro', pointOfSale: 'Caja 1' } })],
      },
      'lot-1',
    );

    expect(table(spreadsheet, 'Ventas')[0]).toEqual(
      expect.arrayContaining(['dev-1', 'Centro', 'Caja 1']),
    );
    expect(table(spreadsheet, 'Pagos')[0]).toEqual(
      expect.arrayContaining(['dev-1', 'Centro', 'Caja 1']),
    );
    const lots = table(spreadsheet, '_PushLots');
    expect(lots[0]).toEqual(expect.arrayContaining(['lot-1', 'dev-1']));
  });

  it('la anulación deja su propia sucursal y punto de venta', () => {
    const { spreadsheet, call } = loadBridge();
    call('pushBatch', { deviceId: 'dev-1', events: [v3SaleEvent()] }, 'lot-1');

    call(
      'pushBatch',
      {
        deviceId: 'dev-2',
        events: [
          {
            type: 'sale-void',
            id: 'v1',
            createdAt: NOW,
            origin: { branch: 'Norte', pointOfSale: 'Caja 2' },
            saleId: 's1',
            voidedAt: NOW,
          },
        ],
      },
      'lot-2',
    );

    expect(table(spreadsheet, 'Ventas')[0]?.slice(-2)).toEqual(['Norte', 'Caja 2']);
  });

  it('cash-movement escribe una fila en MovimientosCaja con valores en español', () => {
    const { spreadsheet, call } = loadBridge();

    call(
      'pushBatch',
      {
        deviceId: 'dev-1',
        events: [
          {
            type: 'cash-movement',
            id: 'm1',
            createdAt: NOW,
            origin: {},
            movement: {
              id: 'm1',
              direction: 'out',
              amount: 250,
              concept: 'Ajuste por arqueo',
              source: 'count-adjustment',
              count: { expected: 1000, counted: 750 },
              createdAt: NOW,
            },
          },
        ],
      },
      'lot-1',
    );

    expect(table(spreadsheet, 'MovimientosCaja')[0]).toEqual([
      'm1',
      NOW,
      'Egreso',
      250,
      'Ajuste por arqueo',
      '',
      'Ajuste por arqueo',
      1000,
      750,
      'dev-1',
      '',
      '',
    ]);
  });

  it('customer-payment escribe una fila por medio en Cobranzas y una negativa en CuentaCorriente', () => {
    const { spreadsheet, call } = loadBridge();

    call(
      'pushBatch',
      {
        deviceId: 'dev-1',
        events: [
          {
            type: 'customer-payment',
            id: 'cp1',
            createdAt: NOW,
            origin: {},
            payment: {
              id: 'cp1',
              customerId: 'c-1',
              payments: [
                { method: 'cash', amount: 300 },
                { method: 'qr', amount: 200 },
              ],
              total: 500,
              createdAt: NOW,
            },
          },
        ],
      },
      'lot-1',
    );

    expect(table(spreadsheet, 'Cobranzas')).toEqual([
      ['cp1', NOW, 'c-1', 'Efectivo', 300, 500, 'dev-1', '', ''],
      ['cp1', NOW, 'c-1', 'Código QR', 200, 500, 'dev-1', '', ''],
    ]);
    expect(table(spreadsheet, 'CuentaCorriente')[0]).toEqual(
      expect.arrayContaining(['c-1', -500, 'cp1']),
    );
  });

  it('un pago a cuenta sin hold (fiado offline o acreditación) va al libro de CuentaCorriente con su signo', () => {
    const { spreadsheet, call } = loadBridge();

    call(
      'pushBatch',
      {
        deviceId: 'dev-1',
        events: [
          v3SaleEvent({
            sale: {
              customerId: 'c-1',
              payments: [{ method: 'account', amount: -120 }],
              total: -120,
            },
          }),
        ],
      },
      'lot-1',
    );

    expect(table(spreadsheet, 'CuentaCorriente')).toEqual([
      [NOW, '', 's1', 'c-1', -120, '', 'dev-1', '', ''],
    ]);
  });

  it('un tipo desconocido (cash-session viejo) queda como issue con su eventId, sin tumbar el lote', () => {
    const { spreadsheet, call } = loadBridge();

    const response = call(
      'pushBatch',
      {
        deviceId: 'dev-1',
        events: [
          { type: 'cash-session', id: 'cs1', createdAt: NOW, origin: {}, session: {} },
          {
            type: 'customer',
            id: 'c-9',
            createdAt: NOW,
            origin: {},
            customer: { id: 'c-9', name: 'Zoe', createdAt: NOW },
          },
        ],
      },
      'lot-1',
    );
    const pull = pullBatch(call, {}, ['lot-1']);

    expect(response.ok).toBe(true);
    expect(table(spreadsheet, 'Clientes')).toHaveLength(4);
    expect((pull.data as { lots: unknown }).lots).toEqual({
      'lot-1': {
        status: 'issues',
        issues: [{ message: expect.stringContaining('cash-session') as unknown, eventId: 'cs1' }],
      },
    });
  });

  it('un lote registrado antes de v3 (avisos como texto) se informa con objetos', () => {
    const { spreadsheet, call } = loadBridge();
    pullBatch(call); // crea _PushLots
    spreadsheet
      .getSheetByName('_PushLots')
      ?.getRange(2, 1, 1, 4)
      .setValues([['viejo', 'issues', JSON.stringify(['algo falló']), NOW]]);

    const pull = pullBatch(call, {}, ['viejo']);

    expect((pull.data as { lots: unknown }).lots).toEqual({
      viejo: { status: 'issues', issues: [{ message: 'algo falló' }] },
    });
  });
});

describe('instalación', () => {
  it('si falta columnas.gs en el proyecto de Apps Script, el error lo dice en claro', () => {
    const { call } = loadBridge({}, ['bridge.gs']);

    expect(pullBatch(call)).toEqual({
      ok: false,
      error: 'Falta el archivo columnas.gs en el proyecto de Apps Script',
    });
  });
});
