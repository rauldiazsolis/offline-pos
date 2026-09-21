export type FakeValidation = { list: string[]; allowInvalid: boolean };

export type FakeOptions = {
  /** Tamaño de una pestaña recién insertada (Sheets real: 1000 x 26; acá 20 x 26 para ir rápido). */
  defaultRows?: number;
  defaultColumns?: number;
  /** Si `true`, una celda con solo validación cuenta como contenido en `getLastRow`/`getLastColumn`. */
  validationCountsAsContent?: boolean;
};

type FakeCell = { value: unknown; format: string; validation: FakeValidation | null };

const blank = (): FakeCell => ({ value: '', format: '', validation: null });

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
    return this.read((cell) => cell.value);
  }
  setValues(values: unknown[][]): this {
    return this.write(values, (cell, item) => {
      cell.value = item;
    });
  }
  setValue(value: unknown): this {
    return this.write(
      Array.from({ length: this.numRows }, () =>
        Array.from({ length: this.numColumns }, () => value),
      ),
      (cell, item) => {
        cell.value = item;
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
  readonly name: string;
  private readonly validationCountsAsContent: boolean;
  private readonly grid: FakeCell[][];

  constructor(name: string, rows: number, columns: number, validationCountsAsContent: boolean) {
    this.name = name;
    this.validationCountsAsContent = validationCountsAsContent;
    this.grid = Array.from({ length: rows }, () => Array.from({ length: columns }, blank));
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
    return cell.value !== '' || (this.validationCountsAsContent && cell.validation !== null);
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
  getRange(row: number, column: number, numRows = 1, numColumns = 1): FakeRange {
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
      source.map((cell) => ({ value: '', format: cell.format, validation: cell.validation })),
    );
    this.grid.splice(after, 0, ...created);
  }
  setFrozenRows(count: number): void {
    this.frozenRows = count;
  }
  hideSheet(): void {
    this.hidden = true;
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
  private readonly sheets = new Map<string, FakeSheet>();
  private readonly options: FakeOptions;

  constructor(options: FakeOptions = {}) {
    this.options = options;
  }

  getSheetByName(name: string): FakeSheet | null {
    return this.sheets.get(name) ?? null;
  }
  insertSheet(name: string): FakeSheet {
    const sheet = new FakeSheet(
      name,
      this.options.defaultRows ?? 20,
      this.options.defaultColumns ?? 26,
      this.options.validationCountsAsContent ?? false,
    );
    this.sheets.set(name, sheet);
    return sheet;
  }
  /** Solo tests: una pestaña "ya existente" con exactamente estas filas. */
  addSheet(name: string, rows: unknown[][]): FakeSheet {
    const width = Math.max(...rows.map((line) => line.length));
    const sheet = new FakeSheet(
      name,
      rows.length,
      width,
      this.options.validationCountsAsContent ?? false,
    );
    rows.forEach((line, r) => {
      sheet.getRange(r + 1, 1, 1, line.length).setValues([line]);
    });
    this.sheets.set(name, sheet);
    return sheet;
  }
  sheetNames(): string[] {
    return [...this.sheets.keys()];
  }
  /** Lo que el script ve como `SpreadsheetApp`. */
  app(): {
    getActiveSpreadsheet: () => FakeSpreadsheet;
    newDataValidation: () => ValidationBuilder;
  } {
    return { getActiveSpreadsheet: () => this, newDataValidation: validationBuilder };
  }
}
