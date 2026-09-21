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
  return sheet
    .values()
    .slice(1)
    .filter((line) => line.some((cell) => cell !== ''))
    .map((line) =>
      line.map((cell) =>
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
