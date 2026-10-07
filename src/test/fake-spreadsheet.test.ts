import { describe, expect, it } from 'vitest';
import { FakeSpreadsheet } from './fake-spreadsheet.ts';

describe('FakeSpreadsheet: pestañas', () => {
  it('insertSheet sin índice va al final; con índice, a esa posición (desde 0)', () => {
    const spreadsheet = new FakeSpreadsheet();
    spreadsheet.insertSheet('B');
    spreadsheet.insertSheet('C');
    spreadsheet.insertSheet('A', 0);

    expect(spreadsheet.sheetNames()).toEqual(['A', 'B', 'C']);
    expect(spreadsheet.getSheets().map((sheet) => sheet.getName())).toEqual(['A', 'B', 'C']);
  });

  it('setName renombra y getSheetByName la encuentra por el nombre nuevo', () => {
    const spreadsheet = new FakeSpreadsheet();
    const sheet = spreadsheet.insertSheet('Hoja 1');

    sheet.setName('Tablero');

    expect(spreadsheet.getSheetByName('Hoja 1')).toBeNull();
    expect(spreadsheet.getSheetByName('Tablero')).toBe(sheet);
  });

  it('deleteSheet la saca, pero nunca la última', () => {
    const spreadsheet = new FakeSpreadsheet();
    const a = spreadsheet.insertSheet('A');
    const b = spreadsheet.insertSheet('B');

    spreadsheet.deleteSheet(a);

    expect(spreadsheet.sheetNames()).toEqual(['B']);
    expect(() => {
      spreadsheet.deleteSheet(b);
    }).toThrow();
  });

  it('moveActiveSheet mueve la activa a esa posición (desde 1)', () => {
    const spreadsheet = new FakeSpreadsheet();
    spreadsheet.insertSheet('A');
    spreadsheet.insertSheet('B');
    const c = spreadsheet.insertSheet('C');

    spreadsheet.setActiveSheet(c);
    spreadsheet.moveActiveSheet(1);

    expect(spreadsheet.sheetNames()).toEqual(['C', 'A', 'B']);
    expect(spreadsheet.getActiveSheet()).toBe(c);
  });

  it('cada pestaña tiene un id propio que no cambia al renombrarla', () => {
    const spreadsheet = new FakeSpreadsheet();
    const a = spreadsheet.insertSheet('A');
    const b = spreadsheet.addSheet('B', [['x']]);
    const id = a.getSheetId();

    a.setName('Otra');

    expect(a.getSheetId()).toBe(id);
    expect(b.getSheetId()).not.toBe(id);
  });

  it('rename cambia el nombre de la planilla', () => {
    const spreadsheet = new FakeSpreadsheet({ name: 'Sin título' });

    spreadsheet.rename('Kiosco Pepe');

    expect(spreadsheet.getName()).toBe('Kiosco Pepe');
  });
});

describe('FakeSpreadsheet: rangos', () => {
  it('getRange acepta notación A1, de una celda o de un rango', () => {
    const sheet = new FakeSpreadsheet().insertSheet('A');

    sheet.getRange('B2:C3').setValues([
      [1, 2],
      [3, 4],
    ]);

    expect(sheet.getRange('C3').getValue()).toBe(4);
    expect(sheet.getRange(2, 2, 2, 2).getValues()).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  it('setFormula guarda la fórmula y cuenta como contenido', () => {
    const sheet = new FakeSpreadsheet().insertSheet('A');

    sheet.getRange('A3').setFormula('=TODAY()');

    expect(sheet.getRange('A3').getFormula()).toBe('=TODAY()');
    expect(sheet.getLastRow()).toBe(3);
  });

  it('clear borra valor, fórmula, formato y validación', () => {
    const sheet = new FakeSpreadsheet().insertSheet('A');
    const cell = sheet.getRange('A1');
    cell.setFormula('=1').setNumberFormat('0');

    cell.clear();

    expect(cell.getFormula()).toBe('');
    expect(cell.getNumberFormats()).toEqual([['']]);
    expect(sheet.getLastRow()).toBe(0);
  });

  it('getValue de =SUM con números: el resultado si el separador es el del idioma, si no #ERROR!', () => {
    const english = new FakeSpreadsheet({ formulaLocale: 'en' }).insertSheet('A');
    const spanish = new FakeSpreadsheet({ formulaLocale: 'es' }).insertSheet('A');

    english.getRange('A1').setFormula('=SUM(1,2)');
    spanish.getRange('A1').setFormula('=SUM(1,2)');
    spanish.getRange('A2').setFormula('=SUM(1;2)');

    expect(english.getRange('A1').getValue()).toBe(3);
    expect(spanish.getRange('A1').getValue()).toBe('#ERROR!');
    expect(spanish.getRange('A2').getValue()).toBe(3);
  });

  it('newChart/insertChart guarda los gráficos con sus opciones', () => {
    const sheet = new FakeSpreadsheet().insertSheet('A');

    sheet.insertChart(
      sheet
        .newChart()
        .setChartType('COLUMN')
        .addRange(sheet.getRange('A9:B12'))
        .setPosition(24, 1, 0, 0)
        .setOption('title', 'Vendido por día')
        .build(),
    );

    expect(sheet.charts()).toEqual([
      { type: 'COLUMN', ranges: 1, position: [24, 1], options: { title: 'Vendido por día' } },
    ]);
  });
});
