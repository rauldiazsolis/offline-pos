export type FakeValidation = { list: string[]; allowInvalid: boolean };

export type FakeOptions = {
  /** Tamaño de una pestaña recién insertada (Sheets real: 1000 x 26; acá 20 x 26 para ir rápido). */
  defaultRows?: number;
  defaultColumns?: number;
  /** Si `true`, una celda con solo validación cuenta como contenido en `getLastRow`/`getLastColumn`. */
  validationCountsAsContent?: boolean;
  /** Nombre y URL de la planilla (`getName()`, `getUrl()`). */
  name?: string;
  url?: string;
  /**
   * Idioma de las fórmulas: `en` separa los argumentos con `,`; `es` (coma decimal), con `;`. Solo
   * importa para `getValue` de una fórmula `=SUM(n, n…)`, lo único que la planilla falsa calcula.
   */
  formulaLocale?: 'en' | 'es';
};

type FakeCell = {
  value: unknown;
  formula: string;
  format: string;
  validation: FakeValidation | null;
};

const blank = (): FakeCell => ({ value: '', formula: '', format: '', validation: null });

/** `A1` o `A1:C3` → fila, columna, filas y columnas. */
function parseA1(a1: string): [number, number, number, number] {
  const match = /^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/.exec(a1);
  if (match === null) {
    throw new Error(`Notación A1 no soportada: ${a1}`);
  }
  // Solo letras A-Z (lo garantiza la expresión regular).
  const column = (letters: string) => {
    let total = 0;
    for (let index = 0; index < letters.length; index++) {
      total = total * 26 + letters.charCodeAt(index) - 64;
    }
    return total;
  };
  const row = Number(match[2]);
  const first = column(match[1] ?? '');
  const lastRow = match[4] === undefined ? row : Number(match[4]);
  const last = match[3] === undefined ? first : column(match[3]);
  return [row, first, lastRow - row + 1, last - first + 1];
}

/** Lo único que se calcula: `=SUM` de números, con el separador del idioma; si no, `#ERROR!`. */
function evaluate(formula: string, locale: 'en' | 'es'): unknown {
  const match = /^=SUM\(([^)]*)\)$/.exec(formula);
  if (match === null) {
    return '';
  }
  const separator = locale === 'en' ? ',' : ';';
  const parts = (match[1] ?? '').split(separator).map((part) => part.trim());
  return parts.every((part) => /^-?\d+(\.\d+)?$/.test(part))
    ? parts.reduce((total, part) => total + Number(part), 0)
    : '#ERROR!';
}

export type FakeChart = {
  type: string;
  ranges: number;
  position: [number, number];
  options: Record<string, unknown>;
};

type ChartBuilder = {
  setChartType: (type: string) => ChartBuilder;
  addRange: (range: unknown) => ChartBuilder;
  setPosition: (row: number, column: number, offsetX: number, offsetY: number) => ChartBuilder;
  setOption: (key: string, value: unknown) => ChartBuilder;
  build: () => FakeChart;
};

class FakeRange {
  private readonly sheet: FakeSheet;
  private readonly row: number;
  private readonly column: number;
  private readonly numRows: number;
  private readonly numColumns: number;

  constructor(sheet: FakeSheet, row: number, column: number, numRows: number, numColumns: number) {
    this.sheet = sheet;
    this.row = row;
    this.column = column;
    this.numRows = numRows;
    this.numColumns = numColumns;
    if (numRows < 1 || numColumns < 1) {
      throw new Error('El rango debe tener al menos 1 fila y 1 columna');
    }
    sheet.cellAt(row, column);
    sheet.cellAt(row + numRows - 1, column + numColumns - 1);
  }

  private read<T>(pick: (cell: FakeCell) => T): T[][] {
    return Array.from({ length: this.numRows }, (_, r) =>
      Array.from({ length: this.numColumns }, (_, c) =>
        pick(this.sheet.cellAt(this.row + r, this.column + c)),
      ),
    );
  }

  private write<T>(data: T[][], apply: (cell: FakeCell, item: T) => void): this {
    if (data.length !== this.numRows || data.some((line) => line.length !== this.numColumns)) {
      throw new Error(
        `Las dimensiones no coinciden con el rango ${String(this.numRows)}x${String(this.numColumns)}`,
      );
    }
    data.forEach((line, r) => {
      line.forEach((item, c) => {
        apply(this.sheet.cellAt(this.row + r, this.column + c), item);
      });
    });
    return this;
  }

  getValues(): unknown[][] {
    return this.read((cell) => this.sheet.valueOf(cell));
  }
  /** La celda de arriba a la izquierda. */
  getValue(): unknown {
    return this.sheet.valueOf(this.sheet.cellAt(this.row, this.column));
  }
  setFormula(formula: string): this {
    return this.write(
      Array.from({ length: this.numRows }, () =>
        Array.from({ length: this.numColumns }, () => formula),
      ),
      (cell, item) => {
        cell.formula = item;
        cell.value = '';
      },
    );
  }
  getFormula(): string {
    return this.sheet.cellAt(this.row, this.column).formula;
  }
  clear(): this {
    return this.write(
      Array.from({ length: this.numRows }, () => Array.from({ length: this.numColumns }, blank)),
      (cell, item) => {
        Object.assign(cell, item);
      },
    );
  }
  setFontSize(_size: number): this {
    return this;
  }
  setFontColor(_color: string): this {
    return this;
  }
  setValues(values: unknown[][]): this {
    return this.write(values, (cell, item) => {
      cell.value = item;
      cell.formula = '';
    });
  }
  setValue(value: unknown): this {
    return this.write(
      Array.from({ length: this.numRows }, () =>
        Array.from({ length: this.numColumns }, () => value),
      ),
      (cell, item) => {
        cell.value = item;
        cell.formula = '';
      },
    );
  }
  setFontWeight(_weight: string): this {
    return this;
  }
  getNumberFormats(): string[][] {
    return this.read((cell) => cell.format);
  }
  setNumberFormat(format: string): this {
    return this.write(
      Array.from({ length: this.numRows }, () =>
        Array.from({ length: this.numColumns }, () => format),
      ),
      (cell, item) => {
        cell.format = item;
      },
    );
  }
  setNumberFormats(formats: string[][]): this {
    return this.write(formats, (cell, item) => {
      cell.format = item;
    });
  }
  getDataValidations(): (FakeValidation | null)[][] {
    return this.read((cell) => cell.validation);
  }
  setDataValidations(rules: (FakeValidation | null)[][]): this {
    return this.write(rules, (cell, item) => {
      cell.validation = item;
    });
  }
}

export class FakeSheet {
  frozenRows = 0;
  hidden = false;
  private sheetName: string;
  private readonly id: number;
  private readonly validationCountsAsContent: boolean;
  private readonly formulaLocale: 'en' | 'es';
  private readonly grid: FakeCell[][];
  private readonly chartList: FakeChart[] = [];

  constructor(
    name: string,
    rows: number,
    columns: number,
    options: { id: number; validationCountsAsContent: boolean; formulaLocale: 'en' | 'es' },
  ) {
    this.sheetName = name;
    this.id = options.id;
    this.validationCountsAsContent = options.validationCountsAsContent;
    this.formulaLocale = options.formulaLocale;
    this.grid = Array.from({ length: rows }, () => Array.from({ length: columns }, blank));
  }

  get name(): string {
    return this.sheetName;
  }
  getName(): string {
    return this.sheetName;
  }
  setName(name: string): this {
    this.sheetName = name;
    return this;
  }
  getSheetId(): number {
    return this.id;
  }

  /** El valor que ve el script: el de la celda, o el de su fórmula. */
  valueOf(cell: FakeCell): unknown {
    return cell.formula === '' ? cell.value : evaluate(cell.formula, this.formulaLocale);
  }

  cellAt(row: number, column: number): FakeCell {
    const cell = this.grid[row - 1]?.[column - 1];
    if (cell === undefined) {
      throw new Error(
        `Fuera de la hoja ${this.name}: fila ${String(row)}, columna ${String(column)} (tamaño ${String(this.getMaxRows())}x${String(this.getMaxColumns())})`,
      );
    }
    return cell;
  }

  private hasContent(cell: FakeCell): boolean {
    return (
      cell.value !== '' ||
      cell.formula !== '' ||
      (this.validationCountsAsContent && cell.validation !== null)
    );
  }

  getMaxRows(): number {
    return this.grid.length;
  }
  getMaxColumns(): number {
    return this.grid[0]?.length ?? 0;
  }
  getLastRow(): number {
    for (let index = this.grid.length - 1; index >= 0; index--) {
      if (this.grid[index]?.some((cell) => this.hasContent(cell)) === true) {
        return index + 1;
      }
    }
    return 0;
  }
  getLastColumn(): number {
    let last = 0;
    this.grid.forEach((line) => {
      line.forEach((cell, index) => {
        if (this.hasContent(cell)) {
          last = Math.max(last, index + 1);
        }
      });
    });
    return last;
  }
  getRange(row: number | string, column = 1, numRows = 1, numColumns = 1): FakeRange {
    if (typeof row === 'string') {
      return new FakeRange(this, ...parseA1(row));
    }
    return new FakeRange(this, row, column, numRows, numColumns);
  }
  deleteRows(position: number, howMany: number): void {
    this.cellAt(position, 1);
    if (howMany >= this.grid.length) {
      throw new Error('No se pueden borrar todas las filas');
    }
    this.grid.splice(position - 1, howMany);
  }
  deleteColumns(position: number, howMany: number): void {
    this.cellAt(1, position);
    this.grid.forEach((line) => line.splice(position - 1, howMany));
  }
  /** Como Sheets: las filas nuevas heredan formato y validación de la fila de arriba. */
  insertRowsAfter(after: number, howMany: number): void {
    const source = this.grid[after - 1];
    if (source === undefined) {
      throw new Error(`insertRowsAfter: la fila ${String(after)} no existe`);
    }
    const created = Array.from({ length: howMany }, () =>
      source.map((cell) => ({
        value: '',
        formula: '',
        format: cell.format,
        validation: cell.validation,
      })),
    );
    this.grid.splice(after, 0, ...created);
  }
  /** Como Sheets: las columnas nuevas heredan formato y validación de la columna de la izquierda. */
  insertColumnsAfter(after: number, howMany: number): void {
    this.grid.forEach((line) => {
      const source = line[after - 1];
      if (source === undefined) {
        throw new Error(`insertColumnsAfter: la columna ${String(after)} no existe`);
      }
      const created = Array.from({ length: howMany }, () => ({
        value: '',
        formula: '',
        format: source.format,
        validation: source.validation,
      }));
      line.splice(after, 0, ...created);
    });
  }
  setFrozenRows(count: number): void {
    this.frozenRows = count;
  }
  hideSheet(): void {
    this.hidden = true;
  }
  setColumnWidth(_column: number, _width: number): void {
    // El ancho no se guarda.
  }
  newChart(): ChartBuilder {
    const chart: FakeChart = { type: '', ranges: 0, position: [0, 0], options: {} };
    const builder: ChartBuilder = {
      setChartType: (type) => {
        chart.type = type;
        return builder;
      },
      addRange: () => {
        chart.ranges++;
        return builder;
      },
      setPosition: (row, column) => {
        chart.position = [row, column];
        return builder;
      },
      setOption: (key, value) => {
        chart.options[key] = value;
        return builder;
      },
      build: () => chart,
    };
    return builder;
  }
  insertChart(chart: FakeChart): void {
    this.chartList.push(chart);
  }
  charts(): FakeChart[] {
    return this.chartList;
  }

  // Accesores solo para los tests.
  values(): unknown[][] {
    return this.grid.map((line) => line.map((cell) => cell.value));
  }
  formats(row: number): string[] {
    return (this.grid[row - 1] ?? []).map((cell) => cell.format);
  }
  validations(row: number): (FakeValidation | null)[] {
    return (this.grid[row - 1] ?? []).map((cell) => cell.validation);
  }
}

type ValidationBuilder = {
  requireValueInList: (list: string[], showDropdown?: boolean) => ValidationBuilder;
  setAllowInvalid: (allow: boolean) => ValidationBuilder;
  build: () => FakeValidation;
};

function validationBuilder(): ValidationBuilder {
  const rule: FakeValidation = { list: [], allowInvalid: true };
  const builder: ValidationBuilder = {
    requireValueInList: (list) => {
      rule.list = list;
      return builder;
    },
    setAllowInvalid: (allow) => {
      rule.allowInvalid = allow;
      return builder;
    },
    build: () => ({ ...rule }),
  };
  return builder;
}

export class FakeSpreadsheet {
  /** En el orden de las pestañas. */
  private readonly sheets: FakeSheet[] = [];
  private readonly options: FakeOptions;
  private name: string;
  private active: FakeSheet | null = null;
  private nextId = 1;

  constructor(options: FakeOptions = {}) {
    this.options = options;
    this.name = options.name ?? 'Kiosco de prueba';
  }

  private newSheet(name: string, rows: number, columns: number): FakeSheet {
    if (this.getSheetByName(name) !== null) {
      throw new Error(`Ya existe una pestaña llamada ${name}`);
    }
    return new FakeSheet(name, rows, columns, {
      id: this.nextId++,
      validationCountsAsContent: this.options.validationCountsAsContent ?? false,
      formulaLocale: this.options.formulaLocale ?? 'en',
    });
  }

  getSheetByName(name: string): FakeSheet | null {
    return this.sheets.find((sheet) => sheet.getName() === name) ?? null;
  }
  getSheets(): FakeSheet[] {
    return [...this.sheets];
  }
  /**
   * Con índice (desde 0), en esa posición. Sin índice, al final: el Sheets real la pone al lado de
   * la activa, y el puente siempre pasa el índice cuando el lugar importa.
   */
  insertSheet(name: string, index?: number): FakeSheet {
    const sheet = this.newSheet(
      name,
      this.options.defaultRows ?? 20,
      this.options.defaultColumns ?? 26,
    );
    this.sheets.splice(index ?? this.sheets.length, 0, sheet);
    this.active = sheet;
    return sheet;
  }
  /** Solo tests: una pestaña "ya existente" con exactamente estas filas. */
  addSheet(name: string, rows: unknown[][]): FakeSheet {
    const width = Math.max(...rows.map((line) => line.length));
    const sheet = this.newSheet(name, rows.length, width);
    rows.forEach((line, r) => {
      sheet.getRange(r + 1, 1, 1, line.length).setValues([line]);
    });
    this.sheets.push(sheet);
    return sheet;
  }
  /** Como Sheets: nunca la última. */
  deleteSheet(sheet: FakeSheet): void {
    const index = this.sheets.indexOf(sheet);
    if (index === -1) {
      throw new Error(`La pestaña ${sheet.getName()} no es de esta planilla`);
    }
    if (this.sheets.length === 1) {
      throw new Error('No se puede borrar la única pestaña de la planilla');
    }
    this.sheets.splice(index, 1);
    if (this.active === sheet) {
      this.active = this.sheets[0] ?? null;
    }
  }
  setActiveSheet(sheet: FakeSheet): FakeSheet {
    this.active = sheet;
    return sheet;
  }
  getActiveSheet(): FakeSheet | null {
    return this.active;
  }
  /** Mueve la pestaña activa a esa posición (desde 1). */
  moveActiveSheet(position: number): void {
    const sheet = this.active;
    if (sheet === null) {
      throw new Error('No hay una pestaña activa');
    }
    this.sheets.splice(this.sheets.indexOf(sheet), 1);
    this.sheets.splice(position - 1, 0, sheet);
  }
  getNumSheets(): number {
    return this.sheets.length;
  }
  sheetNames(): string[] {
    return this.sheets.map((sheet) => sheet.getName());
  }
  getName(): string {
    return this.name;
  }
  rename(name: string): void {
    this.name = name;
  }
  getUrl(): string {
    return this.options.url ?? 'https://docs.google.com/spreadsheets/d/fake/edit';
  }
  /** Lo que el script ve como `SpreadsheetApp`. */
  app(): {
    getActiveSpreadsheet: () => FakeSpreadsheet;
    newDataValidation: () => ValidationBuilder;
    flush: () => void;
  } {
    return {
      getActiveSpreadsheet: () => this,
      newDataValidation: validationBuilder,
      flush: () => undefined,
    };
  }
}
