/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { z } from 'zod';
import { FakeSpreadsheet, type FakeOptions } from './fake-spreadsheet.ts';

/**
 * Arnés de los tests del puente de Google Sheets: corre los `.gs` del conector en un contexto `vm`
 * con la planilla falsa y lo mínimo de los servicios de Apps Script que usan.
 */

const SOURCES_DIR = join(process.cwd(), 'src/connectors/google-sheets');

/** Todos los archivos del proyecto de Apps Script, en el orden en que se publican. */
export const ALL_SOURCE_FILES = [
  'bridge.gs',
  'columnas.gs',
  'inicio.gs',
  'datos-ferreteria.gs',
  'datos-kiosco.gs',
  'datos-almacen.gs',
];

const outputSchema = z.object({ content: z.string() });
const pageSchema = z.object({ html: z.string(), title: z.string() });
const responseSchema = z.object({
  ok: z.boolean(),
  data: z.unknown().optional(),
  error: z.string().optional(),
  code: z.string().optional(),
  contractVersion: z.string().optional(),
});

export type AppsScriptOptions = FakeOptions & {
  sharedSecret?: string;
  webAppUrl?: string;
  /** El `Date` del contexto: el de los tests (con `vi.setSystemTime`) en vez del propio de `vm`. */
  useTestClock?: boolean;
};

export function loadAppsScript(options: AppsScriptOptions = {}, files = ALL_SOURCE_FILES) {
  const {
    sharedSecret,
    webAppUrl = 'https://script.google.com/macros/s/fake/exec',
    useTestClock = false,
    ...spreadsheetOptions
  } = options;
  const spreadsheet = new FakeSpreadsheet(spreadsheetOptions);
  const context: Record<string, unknown> = vm.createContext({
    ...(useTestClock ? { Date } : {}),
    SpreadsheetApp: spreadsheet.app(),
    ScriptApp: { getService: () => ({ getUrl: () => webAppUrl }) },
    HtmlService: {
      createHtmlOutput: (html: string) => {
        const output = {
          html,
          title: '',
          setTitle: (title: string) => {
            output.title = title;
            return output;
          },
          addMetaTag: () => output,
        };
        return output;
      },
    },
    Utilities: {
      Charset: { UTF_8: 'UTF-8' },
      // Como el real: base64 "web safe" CON el relleno `=`.
      base64EncodeWebSafe: (text: string) =>
        Buffer.from(text, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
    },
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
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (key: string) => (key === 'SHARED_SECRET' ? (sharedSecret ?? null) : null),
      }),
    },
    Charts: { ChartType: { COLUMN: 'COLUMN' } },
  });
  for (const file of files) {
    // Desde la raíz del repo, donde corre vitest (`import.meta.url` no sirve en un módulo de apoyo).
    vm.runInContext(readFileSync(join(SOURCES_DIR, file), 'utf8'), context);
  }

  /** Evalúa una expresión en el contexto (para llamar a una función del proyecto). */
  function run(code: string): unknown {
    return vm.runInContext(code, context);
  }

  function raw(request: Record<string, unknown>) {
    const body = JSON.stringify(request);
    const output = run(`doPost({ postData: { contents: ${JSON.stringify(body)} } })`);
    return responseSchema.parse(JSON.parse(outputSchema.parse(output).content));
  }

  function call(action: string, payload: unknown = {}, idempotencyKey?: string) {
    return raw({ action, payload, idempotencyKey });
  }

  function page() {
    return pageSchema.parse(run('doGet()'));
  }

  return { spreadsheet, context, run, raw, call, page };
}

/**
 * Las funciones que se pueden llamar desde afuera: desde una página de HtmlService,
 * `google.script.run` llama a cualquier función del proyecto cuyo nombre no termine en `_`, con los
 * permisos del dueño y sin el secreto compartido.
 */
export function publicFunctions(context: Record<string, unknown>): string[] {
  return Object.keys(context)
    .filter((name) => typeof context[name] === 'function' && !name.endsWith('_'))
    .filter((name) => name !== 'Date')
    .sort();
}
