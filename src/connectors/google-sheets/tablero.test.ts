import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadAppsScript } from '../../test/apps-script.ts';
import type { FakeSheet } from '../../test/fake-spreadsheet.ts';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 7, 15, 0, 0));
});

afterEach(() => {
  vi.useRealTimers();
});

/** Una planilla nueva con su "Hoja 1" (100 filas: el tablero llega a la 60; en Sheets son 1000). */
function planillaNueva(formulaLocale: 'en' | 'es' = 'en') {
  const app = loadAppsScript({ useTestClock: true, defaultRows: 100, formulaLocale });
  app.spreadsheet.insertSheet('Hoja 1');
  return app;
}

function preparada(formulaLocale: 'en' | 'es' = 'en') {
  const app = planillaNueva(formulaLocale);
  app.run(
    `posInicializar(${JSON.stringify({ comercio: 'El Tornillo', sucursal: 'Centro', caja: 'Caja 1', modelo: 'ferreteria' })})`,
  );
  const tablero = app.spreadsheet.getSheetByName('Tablero');
  if (tablero === null) {
    throw new Error('No se creó el Tablero');
  }
  return { ...app, tablero };
}

const formula = (hoja: FakeSheet, celda: string) => hoja.getRange(celda).getFormula();
const valor = (hoja: FakeSheet, celda: string) => hoja.getRange(celda).getValue();

describe('el Tablero al preparar la planilla', () => {
  it('se arma en la "Hoja 1", con el comercio de título', () => {
    const { tablero, spreadsheet } = preparada();

    expect(spreadsheet.sheetNames()[0]).toBe('Tablero');
    expect(valor(tablero, 'A1')).toBe('El Tornillo');
    expect(valor(tablero, 'A2')).toBe(
      'Se actualiza solo con cada venta que llega del POS. Los montos ya descuentan las anulaciones.',
    );
  });

  it('los indicadores en A, C, E y el fiado pendiente en L, arriba de "Fiado por cliente"', () => {
    const { tablero } = preparada();

    expect(['A4', 'C4', 'E4', 'L4'].map((celda) => valor(tablero, celda))).toEqual([
      'Vendido hoy',
      'Tickets hoy',
      'Vendido en 7 días',
      'Fiado pendiente',
    ]);
    expect(formula(tablero, 'A5')).toBe(
      '=SUMIFS(Pagos!$D$2:$D,Pagos!$B$2:$B,">="&TODAY(),Pagos!$B$2:$B,"<"&(TODAY()+1))',
    );
    expect(formula(tablero, 'C5')).toBe(
      '=COUNTUNIQUEIFS(Ventas!$A$2:$A,Ventas!$B$2:$B,">="&TODAY(),Ventas!$B$2:$B,"<"&(TODAY()+1))',
    );
    expect(formula(tablero, 'E5')).toBe('=SUMIFS(Pagos!$D$2:$D,Pagos!$B$2:$B,">="&(TODAY()-6))');
    expect(formula(tablero, 'L5')).toBe('=SUM(CuentaCorriente!$E$2:$E)');
    expect(formula(tablero, 'G5')).toBe('');
    expect(valor(tablero, 'L7')).toBe('Fiado por cliente');
  });

  it('ventas por día: de hace 13 días a hoy, con lo vendido y los tickets de cada uno', () => {
    const { tablero } = preparada();

    expect(formula(tablero, 'A9')).toBe('=TODAY()-13');
    expect(formula(tablero, 'A22')).toBe('=TODAY()-0');
    expect(formula(tablero, 'B9')).toBe(
      '=SUMIFS(Pagos!$D$2:$D,Pagos!$B$2:$B,">="&A9,Pagos!$B$2:$B,"<"&(A9+1))',
    );
    expect(formula(tablero, 'C22')).toBe(
      '=COUNTUNIQUEIFS(Ventas!$A$2:$A,Ventas!$B$2:$B,">="&A22,Ventas!$B$2:$B,"<"&(A22+1))',
    );
  });

  it('medios de pago de 7 días, con los nombres de la planilla', () => {
    const { tablero } = preparada();

    expect(['E9', 'E10', 'E11', 'E12', 'E13', 'E14'].map((celda) => valor(tablero, celda))).toEqual(
      [
        'Efectivo',
        'Tarjeta de débito',
        'Tarjeta de crédito',
        'Transferencia',
        'Código QR',
        'Cuenta corriente',
      ],
    );
    expect(formula(tablero, 'F9')).toBe(
      '=SUMIFS(Pagos!$D$2:$D,Pagos!$C$2:$C,E9,Pagos!$B$2:$B,">="&(TODAY()-6))',
    );
  });

  it('los más vendidos y el fiado por cliente, con QUERY', () => {
    const { tablero } = preparada();

    expect(formula(tablero, 'H8')).toContain(
      'QUERY({Ventas!$G$2:$G,Ventas!$H$2:$H,Ventas!$H$2:$H*Ventas!$I$2:$I,Ventas!$B$2:$B>=TODAY()-6},',
    );
    expect(formula(tablero, 'H8')).toContain('"Todavía no hay ventas"');
    expect(formula(tablero, 'L8')).toContain(
      'VLOOKUP(CuentaCorriente!$D$2:$D,{Clientes!$A$2:$A,Clientes!$B$2:$B},2,FALSE)',
    );
    expect(formula(tablero, 'L8')).toContain('"select * where Col2 <> 0"');
  });

  it('en L1, un link a la página de la planilla, para abrir el POS en una caja', () => {
    const { tablero } = preparada();

    expect(formula(tablero, 'L1')).toBe(
      '=HYPERLINK("https://script.google.com/macros/s/fake/exec","Abrir el POS en una caja →")',
    );
  });

  it('en español, el link también con ";"', () => {
    const { tablero } = preparada('es');

    expect(formula(tablero, 'L1')).toBe(
      '=HYPERLINK("https://script.google.com/macros/s/fake/exec";"Abrir el POS en una caja →")',
    );
  });

  it('un gráfico de columnas con lo vendido por día, debajo de la tabla', () => {
    const { tablero } = preparada();

    expect(tablero.charts()).toEqual([
      {
        type: 'COLUMN',
        ranges: 1,
        position: [24, 1],
        options: {
          title: 'Vendido por día',
          legend: { position: 'none' },
          width: 720,
          height: 300,
        },
      },
    ]);
  });

  it('la celda de la prueba del separador queda vacía', () => {
    const { tablero } = preparada();

    expect(formula(tablero, 'Z1')).toBe('');
    expect(valor(tablero, 'Z1')).toBe('');
  });
});

describe('el separador de las fórmulas, según el idioma de la planilla', () => {
  it('en español: ";" entre argumentos y "\\" entre las columnas de un arreglo', () => {
    const { tablero } = preparada('es');

    expect(formula(tablero, 'B9')).toBe(
      '=SUMIFS(Pagos!$D$2:$D;Pagos!$B$2:$B;">="&A9;Pagos!$B$2:$B;"<"&(A9+1))',
    );
    expect(formula(tablero, 'H8')).toContain(
      'QUERY({Ventas!$G$2:$G\\Ventas!$H$2:$H\\Ventas!$H$2:$H*Ventas!$I$2:$I\\Ventas!$B$2:$B>=TODAY()-6};',
    );
    expect(formula(tablero, 'L8')).toContain('{Clientes!$A$2:$A\\Clientes!$B$2:$B};2;FALSE)');
  });

  it('el texto de las consultas no cambia: sigue con sus comas', () => {
    const { tablero } = preparada('es');

    expect(formula(tablero, 'H8')).toContain('"select Col1, sum(Col2), sum(Col3) where');
  });
});

describe('posAgregarTablero', () => {
  /** Una planilla preparada antes de que existiera el tablero. */
  function sinTablero() {
    const app = preparada();
    app.spreadsheet.deleteSheet(app.tablero);
    return app;
  }

  it('lo agrega primero, sin tocar las demás pestañas', () => {
    const app = sinTablero();
    const antes = app.spreadsheet.sheetNames();
    const ventas = app.spreadsheet.getSheetByName('Ventas')?.values();

    app.run('posAgregarTablero()');

    expect(app.spreadsheet.sheetNames()).toEqual(['Tablero', ...antes]);
    expect(app.spreadsheet.getSheetByName('Ventas')?.values()).toEqual(ventas);
    expect(valor(app.spreadsheet.getSheetByName('Tablero') as FakeSheet, 'A1')).toBe('El Tornillo');
  });

  it('usa las columnas donde están hoy, aunque el comercio las haya movido', () => {
    const app = planillaNueva();
    // Una planilla de antes, con Pagos reordenada: Monto en la B y Fecha en la D.
    app.call('pullBatch', { cursors: {}, pendingLotIds: [] });
    const pagos = app.spreadsheet.getSheetByName('Pagos') as FakeSheet;
    pagos.getRange(1, 1, 1, 4).setValues([['Id de venta', 'Monto', 'Medio de pago', 'Fecha']]);

    app.run('posAgregarTablero()');

    const tablero = app.spreadsheet.getSheetByName('Tablero') as FakeSheet;
    expect(formula(tablero, 'E5')).toBe('=SUMIFS(Pagos!$B$2:$B,Pagos!$D$2:$D,">="&(TODAY()-6))');
  });

  it('se niega si ya hay tablero o si la planilla no está preparada', () => {
    expect(() => preparada().run('posAgregarTablero()')).toThrow('Esta planilla ya tiene tablero.');
    expect(() => planillaNueva().run('posAgregarTablero()')).toThrow(
      'Primero hay que preparar la planilla.',
    );
  });
});
