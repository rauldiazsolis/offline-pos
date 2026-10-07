// @vitest-environment node
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { APPS_SCRIPT_FILES } from '../src/connectors/google-sheets/apps-script-files.ts';
import { loadAppsScriptCode, publicFunctions } from '../src/test/apps-script.ts';
import { buildSheetsBundle } from './sheets-bundle.ts';

const SOURCES = new URL('../src/connectors/google-sheets/', import.meta.url).pathname;
const read = (file: string) =>
  readFileSync(new URL(`../src/connectors/google-sheets/${file}`, import.meta.url), 'utf8');
const CONTRACT = /var CONTRACT_VERSION = '([\d.]+)'/.exec(read('bridge.gs'))?.[1] ?? '';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 7, 15, 0, 0));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('buildSheetsBundle (#219)', () => {
  const bundle = buildSheetsBundle({ sourcesDir: SOURCES, version: '0.7.0' });

  it('arranca con @OnlyCurrentDoc en el primer comentario: el permiso de solo esta planilla', () => {
    const primerComentario = bundle.slice(0, bundle.indexOf('*/'));
    expect(bundle.startsWith('/**')).toBe(true);
    expect(primerComentario).toContain('@OnlyCurrentDoc');
  });

  it('la cabecera dice la versión del POS, el contrato y cómo instalar y actualizar', () => {
    const cabecera = bundle.slice(0, bundle.indexOf('*/'));
    expect(cabecera).toContain(`pos-sheets.gs, POS 0.7.0 (contrato ${CONTRACT})`);
    expect(cabecera).toContain('Código.gs');
    expect(cabecera).toContain('Nueva implementación');
    expect(cabecera).toContain('Nueva versión');
    expect(cabecera).toContain('https://pos.contax.ar/v4/docs/google-sheets/');
  });

  it('trae cada archivo del proyecto entero, en el orden de publicación', () => {
    let desde = 0;
    for (const file of APPS_SCRIPT_FILES) {
      const posicion = bundle.indexOf(read(file).trimEnd(), desde);
      expect(posicion, file).toBeGreaterThan(desde - 1);
      desde = posicion;
    }
  });

  it('cargado en un solo archivo, prepara la planilla y solo expone lo que llama la home', () => {
    const app = loadAppsScriptCode([bundle], { defaultRows: 100, formulaLocale: 'es' });
    app.spreadsheet.insertSheet('Hoja 1');

    app.run(
      `posInicializar({ comercio: 'El Tornillo', sucursal: 'Centro', caja: 'Caja 1', modelo: 'almacen' })`,
    );

    expect(publicFunctions(app.context)).toEqual([
      'doGet',
      'doPost',
      'posAgregarTablero',
      'posInicializar',
      'posReiniciar',
    ]);
    expect(app.spreadsheet.sheetNames()[0]).toBe('Tablero');
    expect(app.call('pullBatch', { cursors: {}, pendingLotIds: [] }).ok).toBe(true);
  });
});
