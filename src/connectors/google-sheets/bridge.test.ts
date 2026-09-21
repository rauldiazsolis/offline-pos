/// <reference types="node" />
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { FakeSpreadsheet, type FakeOptions } from '../../test/fake-spreadsheet.ts';

const SOURCE_FILES = ['bridge.gs'];

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
