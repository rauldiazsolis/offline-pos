# Etapa 2d: columnas en español y acceso por encabezado en el puente de Sheets — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que la planilla del conector de Google Sheets se vea toda en español (encabezados y valores de celda), que el puente encuentre cada columna por su encabezado (no por posición) y que las pestañas nazcan con el tamaño exacto y con formato por columna.

**Architecture:** Todo el cambio vive en `src/connectors/google-sheets/` — el POS (TypeScript) y el contrato del puente no cambian. Un archivo nuevo, `columnas.gs`, concentra los textos visibles (etiquetas de columna y de valor) y se edita por separado; `bridge.gs` conserva las claves internas estables (`SCHEMA`) y resuelve cada columna leyendo la fila 1. Como el puente es JS plano de Apps Script, se prueba en Vitest cargando ambos `.gs` en un contexto `node:vm` contra una planilla falsa en memoria (`src/test/fake-spreadsheet.ts`) — por primera vez el puente tiene tests automáticos.

**Tech Stack:** Apps Script (V8, JS plano), Vitest (`node:vm`, entorno `node`), Zod (solo para validar la respuesta del puente en los tests).

**Spec:** El diseño se acordó en la conversación del 2026-09-21 (sección "Decisiones" abajo). Contexto: epic #66, `src/connectors/google-sheets/README.md`, `docs/superpowers/plans/2026-09-21-conector-google-sheets-etapa-1.md`.

## Decisiones (acordadas con el usuario)

1. **Permisos mínimos, sin excepción.** Se mantiene `@OnlyCurrentDoc` (scope `spreadsheets.currentonly`). Un spike (2026-09-21) confirmó que las **tablas nativas** de Sheets exigen el servicio avanzado de Sheets API, que la API rechaza salvo con `spreadsheets`/`drive`/`drive.file` — descartadas. Cada pestaña es un rango bien formateado que el usuario **puede** convertir en tabla a mano.
2. **Acceso por encabezado, no por posición.** El puente lee la fila 1 y arma `clave interna → nº de columna`. Columnas reordenadas o agregadas por el usuario no rompen nada. Una columna requerida ausente da un error claro (`Falta la columna 'Precio' en la pestaña Productos`); solo son opcionales `Productos.barcodes`, `Clientes.document` y `Clientes.phone`.
3. **Todo en español, mapa aislado.** `columnas.gs` tiene `COLUMN_LABELS` (etiquetas legibles con espacios y acentos: "Precio unitario") y `VALUE_LABELS` (valores de celda traducidos: `cash` → "Efectivo", `product` → "Producto", `cerrada` → "Cerrada"). Las claves internas (las que usa la lógica y el payload) no cambian. El mapa solo vive en el repo, nunca en una pestaña de la planilla.
4. **Compatibilidad hacia atrás.** Un encabezado se reconoce por su etiqueta **o** por su clave vieja (`name`, `precioUnitario`…), sin distinguir mayúsculas, acentos ni espacios. Al leer una pestaña existente, un encabezado que sea exactamente la clave vieja se reescribe con la etiqueta nueva (un encabezado que el usuario renombró a otra cosa no se toca). Los valores viejos (`cash`, `cerrada`) se siguen leyendo. **No** se redimensionan pestañas que ya existen.
5. **Tamaño exacto y formato en la fila plantilla.** Una pestaña nueva se crea con solo el encabezado y **una fila de datos vacía** (la plantilla), sin filas ni columnas sobrantes. La plantilla lleva el formato numérico y la validación de cada columna; al agregar filas, el puente copia esos dos atributos desde la fila 2 (explícito, no depende de la herencia de Sheets). La primera escritura llena la plantilla en vez de dejarla vacía.
6. **Tipos de columna:** IDs, SKU, documento, teléfono y demás → texto (`@`); importes → `#,##0.00`; IVA → porcentaje (`0.0%`, el valor guardado sigue siendo `0.21`); línea y cantidad de ventas → entero; cantidad, valor de descuento y ajuste global → `#,##0.00`; fechas visibles → **fecha real** con formato `dd/mm/yyyy hh:mm` (el puente recibe ISO 8601 y escribe un `Date`; las fechas solo se escriben, nunca se leen de vuelta). La fecha de la pestaña oculta `_Idempotency` sigue siendo texto ISO. Estado, medio, tipo y tipo de descuento llevan lista desplegable.

## Estructura de archivos

- Create: `src/connectors/google-sheets/columnas.gs` — solo datos: `COLUMN_LABELS`, `VALUE_LABELS`.
- Modify: `src/connectors/google-sheets/bridge.gs` — `SCHEMA` (reemplaza `HEADERS`/`TEXT_COLUMNS`), acceso por encabezado, traducción de valores y fechas, escritura con fila plantilla, provisión de tamaño exacto.
- Create: `src/test/fake-spreadsheet.ts` — planilla falsa en memoria (`SpreadsheetApp` mínimo).
- Create: `src/connectors/google-sheets/bridge.test.ts` — tests del puente vía `node:vm`.
- Modify: `src/connectors/google-sheets/README.md`, `CLAUDE.md`.

## Global Constraints

- El POS no cambia: ni `bridge-client.ts`, ni `google-sheets-connector.ts`, ni el contrato de acciones/payloads.
- No agregar ningún permiso: `@OnlyCurrentDoc` sigue en la primera línea de `bridge.gs`; no usar el servicio avanzado de Sheets ni `openById/openByUrl`.
- `.gs` es JS plano para V8 de Apps Script: sin TypeScript ni `import`/`export`; estilo `var` + `function` como el archivo actual; los archivos comparten el ámbito global (`columnas.gs` se pega como segundo archivo del proyecto).
- Nombres internos estables: las claves de `SCHEMA` (`saleId`, `precioUnitario`, `cash`…) no se renombran.
- Formateo: `pnpm prettier --check --end-of-line auto` solo sobre archivos `.ts`/`.md` que ya estaban formateados en `origin/main`. Usar `Edit`, no `cat >>`, sobre archivos existentes (CRLF de Windows).
- Un PR para la etapa, base `main`, merge commit (no squash). Commits en español, terminan con `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.

---

### Task 1: Planilla falsa y arnés de tests (con un humo contra el puente actual)

**Files:**
- Create: `src/test/fake-spreadsheet.ts`
- Create: `src/connectors/google-sheets/bridge.test.ts`

**Interfaces:**
- Produces: `FakeSpreadsheet` (`getSheetByName`, `insertSheet`, `addSheet(name, rows)`, `sheetNames()`, `app()`), `FakeSheet` (API de hoja + accesores de test `values()`, `formats(row)`, `validations(row)`, `frozenRows`, `hidden`), tipos `FakeOptions`, `FakeValidation`. En el test: `loadBridge(options?)` → `{ spreadsheet, call(action, payload?, idempotencyKey?) }` y `table(spreadsheet, name)`.

- [ ] **Step 1: Escribir la planilla falsa**

`src/test/fake-spreadsheet.ts` (imita solo lo que usa el puente; lanza si se accede fuera de la grilla, como Sheets):

```ts
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
  constructor(
    private readonly sheet: FakeSheet,
    private readonly row: number,
    private readonly column: number,
    private readonly numRows: number,
    private readonly numColumns: number,
  ) {
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

  private write<T>(data: T[][], apply: (cell: FakeCell, item: T) => void): FakeRange {
    if (data.length !== this.numRows || data.some((line) => line.length !== this.numColumns)) {
      throw new Error(`Las dimensiones no coinciden con el rango ${this.numRows}x${this.numColumns}`);
    }
    data.forEach((line, r) =>
      line.forEach((item, c) => {
        apply(this.sheet.cellAt(this.row + r, this.column + c), item);
      }),
    );
    return this;
  }

  getValues(): unknown[][] {
    return this.read((cell) => cell.value);
  }
  setValues(values: unknown[][]): FakeRange {
    return this.write(values, (cell, item) => {
      cell.value = item;
    });
  }
  setValue(value: unknown): FakeRange {
    return this.write(
      Array.from({ length: this.numRows }, () => Array.from({ length: this.numColumns }, () => value)),
      (cell, item) => {
        cell.value = item;
      },
    );
  }
  setFontWeight(_weight: string): FakeRange {
    return this;
  }
  getNumberFormats(): string[][] {
    return this.read((cell) => cell.format);
  }
  setNumberFormats(formats: string[][]): FakeRange {
    return this.write(formats, (cell, item) => {
      cell.format = item;
    });
  }
  getDataValidations(): (FakeValidation | null)[][] {
    return this.read((cell) => cell.validation);
  }
  setDataValidations(rules: (FakeValidation | null)[][]): FakeRange {
    return this.write(rules, (cell, item) => {
      cell.validation = item;
    });
  }
}

export class FakeSheet {
  frozenRows = 0;
  hidden = false;
  private readonly grid: FakeCell[][];

  constructor(
    readonly name: string,
    rows: number,
    columns: number,
    private readonly validationCountsAsContent: boolean,
  ) {
    this.grid = Array.from({ length: rows }, () => Array.from({ length: columns }, blank));
  }

  cellAt(row: number, column: number): FakeCell {
    const cell = this.grid[row - 1]?.[column - 1];
    if (cell === undefined) {
      throw new Error(
        `Fuera de la hoja ${this.name}: fila ${row}, columna ${column} (tamaño ${this.getMaxRows()}x${this.getMaxColumns()})`,
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
    this.grid.forEach((line) =>
      line.forEach((cell, index) => {
        if (this.hasContent(cell)) {
          last = Math.max(last, index + 1);
        }
      }),
    );
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
      throw new Error(`insertRowsAfter: la fila ${after} no existe`);
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

  constructor(private readonly options: FakeOptions = {}) {}

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
    const sheet = new FakeSheet(name, rows.length, width, this.options.validationCountsAsContent ?? false);
    rows.forEach((line, r) => sheet.getRange(r + 1, 1, 1, line.length).setValues([line]));
    this.sheets.set(name, sheet);
    return sheet;
  }
  sheetNames(): string[] {
    return [...this.sheets.keys()];
  }
  /** Lo que el script ve como `SpreadsheetApp`. */
  app(): { getActiveSpreadsheet: () => FakeSpreadsheet; newDataValidation: () => ValidationBuilder } {
    return { getActiveSpreadsheet: () => this, newDataValidation: validationBuilder };
  }
}
```

- [ ] **Step 2: Escribir el arnés y un test de humo contra el puente actual**

`src/connectors/google-sheets/bridge.test.ts`:

```ts
// @vitest-environment node
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

function loadBridge(options: FakeOptions = {}) {
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
    LockService: { getScriptLock: () => ({ waitLock: () => undefined, releaseLock: () => undefined }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => null }) },
  });
  for (const file of SOURCE_FILES) {
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
        Object.prototype.toString.call(cell) === '[object Date]' ? (cell as Date).toISOString() : cell,
      ),
    );
}

describe('arnés (humo contra el puente actual)', () => {
  it('provisiona las pestañas al primer request y devuelve los productos sembrados', () => {
    const { spreadsheet, call } = loadBridge();

    const response = call('pullProducts');

    expect(response.ok).toBe(true);
    expect(spreadsheet.sheetNames()).toContain('Turnos');
    expect(table(spreadsheet, 'Productos')).toHaveLength(5);
    expect(response.data).toMatchObject({ items: [{ id: 'p-001', name: 'Gaseosa cola 500ml' }] });
  });
});
```

- [ ] **Step 3: Correr el test**

Run: `pnpm vitest run src/connectors/google-sheets/bridge.test.ts`
Expected: PASS (1 test). Si falla por la planilla falsa (no por el puente), corregir `fake-spreadsheet.ts` — el puente actual es la referencia de comportamiento.

- [ ] **Step 4: Typecheck, lint y formato**

Run: `pnpm typecheck; pnpm lint; pnpm prettier --check --end-of-line auto src/test/fake-spreadsheet.ts src/connectors/google-sheets/bridge.test.ts`
Expected: sin errores (si prettier reclama, `pnpm prettier --write --end-of-line auto` sobre esos dos archivos nuevos).

- [ ] **Step 5: Commit**

```bash
git add src/test/fake-spreadsheet.ts src/connectors/google-sheets/bridge.test.ts
git commit -m "test: arnés del puente de Sheets (planilla falsa y node:vm) con un test de humo"
```

---

### Task 2: `columnas.gs` y lectura por encabezado

**Files:**
- Create: `src/connectors/google-sheets/columnas.gs`
- Modify: `src/connectors/google-sheets/bridge.gs` (`HEADERS`/`TEXT_COLUMNS` → `SCHEMA`; `ensureSheetsExist`, `readRows`, `setCells`, `doPost`)
- Modify: `src/test/fake-spreadsheet.ts` (`setNumberFormat`), `src/connectors/google-sheets/bridge.test.ts`

**Interfaces:**
- Consumes: `loadBridge`, `table` de la Task 1.
- Produces (globales de Apps Script): `COLUMN_LABELS[hoja][clave] → etiqueta`, `VALUE_LABELS[clave][valorInterno] → etiqueta`; en `bridge.gs`: `SCHEMA[hoja] → [{ key, type, optional }]`, `normalize(text)`, `headerMap(sheet, name) → { map: clave → nº de columna, width }`, `fromCell(key, cell)`; `readRows(name)` devuelve objetos con las **claves internas** (+ `_row`) y valores ya decodificados.

- [ ] **Step 1: Tests que fallan**

En `bridge.test.ts`: cambiar `SOURCE_FILES` a `['columnas.gs', 'bridge.gs']` y agregar al final:

```ts
const PRODUCT_LABELS = ['Id', 'SKU', 'Códigos de barras', 'Nombre', 'Precio', 'IVA', 'Categoría'];

describe('lectura por encabezado (Etapa 2d)', () => {
  it('crea las pestañas con etiquetas legibles en español', () => {
    const { spreadsheet, call } = loadBridge();

    call('pullProducts');

    expect(spreadsheet.getSheetByName('Productos')?.values()[0]).toEqual(PRODUCT_LABELS);
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

    expect(call('pullProducts').data).toMatchObject({ items: [{ id: 'p-1', name: 'Pan' }] });
  });

  it('una columna requerida ausente da un error que dice cuál falta y en qué pestaña', () => {
    const { spreadsheet, call } = loadBridge();
    spreadsheet.addSheet('Productos', [
      ['Id', 'SKU', 'Nombre', 'IVA', 'Categoría'],
      ['p-1', 'S-1', 'Pan', 0.21, 'panaderia'],
    ]);

    const response = call('pullProducts');

    expect(response).toEqual({ ok: false, error: "Falta la columna 'Precio' en la pestaña Productos" });
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
```

- [ ] **Step 2: Correr y ver que fallan**

Run: `pnpm vitest run src/connectors/google-sheets/bridge.test.ts`
Expected: FAIL — `columnas.gs` no existe (`ENOENT`).

- [ ] **Step 3: Crear `columnas.gs` (solo datos)**

```js
/**
 * Textos que ve el usuario de la planilla. Es lo ÚNICO que hace falta editar para renombrar una
 * columna o un valor: la lógica del puente (bridge.gs) trabaja con las claves internas de la izquierda,
 * que no se tocan. Se pega como segundo archivo del proyecto de Apps Script (los archivos de un
 * proyecto comparten el ámbito global).
 *
 * Al leer, una columna se reconoce por su etiqueta o por su clave interna, sin distinguir mayúsculas,
 * acentos ni espacios — así una planilla creada con nombres anteriores sigue funcionando.
 */

// Etiqueta de cada columna, por pestaña. Dentro de una pestaña no puede haber dos iguales.
var COLUMN_LABELS = {
  Productos: {
    id: 'Id',
    sku: 'SKU',
    barcodes: 'Códigos de barras',
    name: 'Nombre',
    price: 'Precio',
    taxRate: 'IVA',
    category: 'Categoría',
  },
  Clientes: {
    id: 'Id',
    name: 'Nombre',
    document: 'Documento',
    phone: 'Teléfono',
    createdAt: 'Alta',
  },
  Ventas: {
    saleId: 'Id de venta',
    fecha: 'Fecha',
    customerId: 'Id de cliente',
    linea: 'Línea',
    tipo: 'Tipo',
    productId: 'Id de producto',
    descripcion: 'Descripción',
    cantidad: 'Cantidad',
    precioUnitario: 'Precio unitario',
    descuentoTipo: 'Tipo de descuento',
    descuentoValor: 'Valor del descuento',
    totalVenta: 'Total de la venta',
    ajusteGlobalPct: 'Ajuste global %',
    estado: 'Estado',
    anuladaEn: 'Anulada el',
    motivoAnulacion: 'Motivo de anulación',
  },
  Pagos: {
    saleId: 'Id de venta',
    fecha: 'Fecha',
    medio: 'Medio de pago',
    monto: 'Monto',
    referencia: 'Referencia',
    estado: 'Estado',
  },
  CuentaCorriente: {
    fecha: 'Fecha',
    holdId: 'Id de reserva',
    saleId: 'Id de venta',
    customerId: 'Id de cliente',
    monto: 'Monto',
  },
  Turnos: {
    sessionId: 'Id de turno',
    abiertoEn: 'Abierto el',
    cerradoEn: 'Cerrado el',
    aperturaEfectivo: 'Efectivo de apertura',
    contadoEfectivo: 'Efectivo contado',
    ventas: 'Cantidad de ventas',
    cash: 'Efectivo',
    debit: 'Tarjeta de débito',
    credit: 'Tarjeta de crédito',
    transfer: 'Transferencia',
    qr: 'Código QR',
    account: 'Cuenta corriente',
    efectivoEsperado: 'Efectivo esperado',
    diferencia: 'Diferencia',
  },
  _Idempotency: {
    key: 'Clave',
    at: 'Registrada el',
  },
};

// Etiqueta de cada valor de celda, por clave de columna: valor interno → texto visible.
var VALUE_LABELS = {
  tipo: { product: 'Producto', freeform: 'Libre' },
  descuentoTipo: { amount: 'Monto', percentage: 'Porcentaje' },
  medio: {
    cash: 'Efectivo',
    debit: 'Tarjeta de débito',
    credit: 'Tarjeta de crédito',
    transfer: 'Transferencia',
    qr: 'Código QR',
    account: 'Cuenta corriente',
  },
  estado: { cerrada: 'Cerrada', anulada: 'Anulada' },
};
```

- [ ] **Step 4: `bridge.gs` — `SCHEMA` en lugar de `HEADERS` y `TEXT_COLUMNS`**

Con `Edit`, reemplazar el bloque `var HEADERS = {…};` (líneas 31–71) **y** el bloque `TEXT_COLUMNS` (73–83) por:

```js
/**
 * Estructura de cada pestaña: las CLAVES internas (estables: las usa la lógica y el payload), en el
 * orden con que se crea la pestaña, y el tipo de cada columna. Lo que ve el usuario (etiquetas de
 * columna y de valor) vive en columnas.gs. Cada entrada: [clave, tipo, opcional?].
 * Tipos: text | integer | number | percent | datetime.
 */
var SCHEMA = {
  Productos: columns([
    ['id', 'text'],
    ['sku', 'text'],
    ['barcodes', 'text', true],
    ['name', 'text'],
    ['price', 'number'],
    ['taxRate', 'percent'],
    ['category', 'text'],
  ]),
  Clientes: columns([
    ['id', 'text'],
    ['name', 'text'],
    ['document', 'text', true],
    ['phone', 'text', true],
    ['createdAt', 'datetime'],
  ]),
  Ventas: columns([
    ['saleId', 'text'],
    ['fecha', 'datetime'],
    ['customerId', 'text'],
    ['linea', 'integer'],
    ['tipo', 'text'],
    ['productId', 'text'],
    ['descripcion', 'text'],
    ['cantidad', 'number'],
    ['precioUnitario', 'number'],
    ['descuentoTipo', 'text'],
    ['descuentoValor', 'number'],
    ['totalVenta', 'number'],
    ['ajusteGlobalPct', 'number'],
    ['estado', 'text'],
    ['anuladaEn', 'datetime'],
    ['motivoAnulacion', 'text'],
  ]),
  Pagos: columns([
    ['saleId', 'text'],
    ['fecha', 'datetime'],
    ['medio', 'text'],
    ['monto', 'number'],
    ['referencia', 'text'],
    ['estado', 'text'],
  ]),
  CuentaCorriente: columns([
    ['fecha', 'datetime'],
    ['holdId', 'text'],
    ['saleId', 'text'],
    ['customerId', 'text'],
    ['monto', 'number'],
  ]),
  Turnos: columns([
    ['sessionId', 'text'],
    ['abiertoEn', 'datetime'],
    ['cerradoEn', 'datetime'],
    ['aperturaEfectivo', 'number'],
    ['contadoEfectivo', 'number'],
    ['ventas', 'integer'],
    ['cash', 'number'],
    ['debit', 'number'],
    ['credit', 'number'],
    ['transfer', 'number'],
    ['qr', 'number'],
    ['account', 'number'],
    ['efectivoEsperado', 'number'],
    ['diferencia', 'number'],
  ]),
  // Pestaña oculta: la fecha queda como texto ISO a propósito (no la ve nadie).
  _Idempotency: columns([
    ['key', 'text'],
    ['at', 'text'],
  ]),
};

function columns(defs) {
  return defs.map(function (def) {
    return { key: def[0], type: def[1], optional: def[2] === true };
  });
}
```

(`SEED` queda igual por ahora: filas posicionales, mismo orden que `SCHEMA`.)

- [ ] **Step 5: `bridge.gs` — provisión, lectura y escritura de celdas por encabezado**

Reemplazar `ensureSheetsExist` (por ahora con las mismas hojas de tamaño por defecto; el tamaño exacto es la Task 4):

```js
function ensureSheetsExist() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(SCHEMA).forEach(function (name) {
    if (spreadsheet.getSheetByName(name)) {
      return;
    }
    var defs = SCHEMA[name];
    var labels = defs.map(function (column) {
      return COLUMN_LABELS[name][column.key];
    });
    var sheet = spreadsheet.insertSheet(name);
    sheet.getRange(1, 1, 1, labels.length).setValues([labels]).setFontWeight('bold');
    sheet.setFrozenRows(1);
    defs.forEach(function (column, index) {
      if (column.type === 'text') {
        sheet.getRange(1, index + 1, sheet.getMaxRows(), 1).setNumberFormat('@');
      }
    });
    if (SEED[name]) {
      appendRows(name, SEED[name]);
    }
    if (name === '_Idempotency') {
      sheet.hideSheet();
    }
  });
}
```

Reemplazar `readRows` y `setCells` (y agregar `normalize`, `headerMap`, `fromCell` justo antes):

```js
// ---------------------------------------------------- acceso por encabezado

// Se rearma en cada request (doPost): dentro de uno, la fila 1 no cambia.
var headerCache = {};

/** Minúsculas, sin acentos ni signos: "Códigos de barras" y "codigosdebarras" son la misma columna. */
function normalize(text) {
  return String(text)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Lee la fila 1 de la pestaña y devuelve { map: clave interna → nº de columna (base 1), width }.
 * Una columna se reconoce por su etiqueta o por su clave interna (compatibilidad con planillas
 * anteriores). Un encabezado que es EXACTAMENTE la clave interna se reescribe con la etiqueta; uno
 * que el usuario renombró a otra cosa no se toca. Las columnas que no conocemos se ignoran.
 * Falta una columna requerida → error que dice cuál.
 */
function headerMap(sheet, name) {
  if (headerCache[name]) {
    return headerCache[name];
  }
  var width = Math.max(sheet.getLastColumn(), 1);
  var cells = sheet.getRange(1, 1, 1, width).getValues()[0];
  var lookup = Object.create(null);
  SCHEMA[name].forEach(function (column) {
    lookup[normalize(column.key)] = column;
    lookup[normalize(COLUMN_LABELS[name][column.key])] = column;
  });
  var map = Object.create(null);
  cells.forEach(function (cell, index) {
    var column = lookup[normalize(cell)];
    if (column === undefined || map[column.key] !== undefined) {
      return;
    }
    map[column.key] = index + 1;
    var label = COLUMN_LABELS[name][column.key];
    if (cell === column.key && cell !== label) {
      sheet.getRange(1, index + 1).setValue(label);
    }
  });
  SCHEMA[name].forEach(function (column) {
    if (map[column.key] === undefined && !column.optional) {
      throw new Error(
        "Falta la columna '" + COLUMN_LABELS[name][column.key] + "' en la pestaña " + name,
      );
    }
  });
  headerCache[name] = { map: map, width: width };
  return headerCache[name];
}

/** Valor de celda → valor interno: "Efectivo" (o el viejo "cash") → "cash". Lo desconocido pasa igual. */
function fromCell(key, cell) {
  var labels = VALUE_LABELS[key];
  if (!labels || typeof cell !== 'string') {
    return cell;
  }
  var wanted = normalize(cell);
  var internal = Object.keys(labels).filter(function (candidate) {
    return normalize(labels[candidate]) === wanted || normalize(candidate) === wanted;
  })[0];
  return internal === undefined ? cell : internal;
}

/** Filas de datos como objetos { clave interna: valor, _row: nº de fila en la hoja }. */
function readRows(name) {
  var sheet = getSheet(name);
  var header = headerMap(sheet, name);
  var last = sheet.getLastRow();
  if (last < 2) {
    return [];
  }
  return sheet
    .getRange(2, 1, last - 1, header.width)
    .getValues()
    .map(function (cells, index) {
      var row = { _row: index + 2 };
      SCHEMA[name].forEach(function (column) {
        var position = header.map[column.key];
        row[column.key] = position === undefined ? '' : fromCell(column.key, cells[position - 1]);
      });
      return row;
    });
}

function setCells(name, rowNumber, values) {
  var sheet = getSheet(name);
  var header = headerMap(sheet, name);
  Object.keys(values).forEach(function (key) {
    var position = header.map[key];
    if (position !== undefined) {
      sheet.getRange(rowNumber, position).setValue(values[key]);
    }
  });
}
```

En `doPost`, justo antes de `ensureSheetsExist();` (dentro del `try` tras tomar el lock), agregar `headerCache = {};`.

- [ ] **Step 6: `setNumberFormat` en la planilla falsa**

En `FakeRange` (`fake-spreadsheet.ts`), junto a `setNumberFormats`:

```ts
  setNumberFormat(format: string): FakeRange {
    return this.write(
      Array.from({ length: this.numRows }, () => Array.from({ length: this.numColumns }, () => format)),
      (cell, item) => {
        cell.format = item;
      },
    );
  }
```

- [ ] **Step 7: Correr los tests**

Run: `pnpm vitest run src/connectors/google-sheets/bridge.test.ts`
Expected: PASS (7 tests: el de humo + 6 nuevos). Si el de humo falla porque `Productos` ya no se siembra con los mismos datos, no debería: `SEED` y el orden de columnas no cambiaron.

- [ ] **Step 8: Verificación y commit**

Run: `pnpm test; pnpm typecheck; pnpm lint; pnpm prettier --check --end-of-line auto src/test/fake-spreadsheet.ts src/connectors/google-sheets/bridge.test.ts`
Expected: todo en verde.

```bash
git add src/connectors/google-sheets/columnas.gs src/connectors/google-sheets/bridge.gs src/connectors/google-sheets/bridge.test.ts src/test/fake-spreadsheet.ts
git commit -m "feat: el puente de Sheets lee por encabezado y las etiquetas viven en columnas.gs"
```

---

### Task 3: Escritura por encabezado, valores en español y fechas reales

**Files:**
- Modify: `src/connectors/google-sheets/bridge.gs` (`SEED`, `ensureSheetsExist`, helpers de escritura, todos los `push*`, `idempotent`; se eliminan `appendRows` y `orEmpty`)
- Modify: `src/connectors/google-sheets/bridge.test.ts`

**Interfaces:**
- Consumes: `SCHEMA`, `COLUMN_LABELS`, `VALUE_LABELS`, `headerMap`, `readRows`, `fromCell` de la Task 2.
- Produces: `toCell(column, value)` (valor interno → valor de celda: traduce, convierte ISO a `Date` en columnas `datetime`, `undefined`/`null` → `''`), `firstFreeRow(sheet, width)`, `appendObjects(name, objects)` (cada objeto usa **claves internas**; escribe cada valor en la columna que el encabezado indica), `setCells(name, rowNumber, values)` con traducción.

- [ ] **Step 1: Tests que fallan**

Agregar a `bridge.test.ts`:

```ts
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
      ['s1', NOW, 'c-001', 1, 'Producto', 'p-001', '', 1, 1200, '', '', 2100, '', 'Cerrada', '', ''],
      ['s1', NOW, 'c-001', 2, 'Libre', '', 'Regalo', 1, 900, 'Porcentaje', 10, 2100, '', 'Cerrada', '', ''],
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
    spreadsheet.addSheet('Pagos', [['Estado', 'Monto', 'Id de venta', 'Fecha', 'Medio de pago', 'Referencia']]);

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
    expect(table(spreadsheet, 'CuentaCorriente')).toEqual([[expect.any(String), 'h-1', 's1', 'c-001', 1100]]);
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
      ['saleId', 'fecha', 'customerId', 'linea', 'tipo', 'productId', 'descripcion', 'cantidad', 'precioUnitario', 'descuentoTipo', 'descuentoValor', 'totalVenta', 'ajusteGlobalPct', 'estado', 'anuladaEn', 'motivoAnulacion'],
      ['s1', NOW, 'c-001', 1, 'product', 'p-001', '', 1, 1200, '', '', 2100, '', 'cerrada', '', ''],
    ]);
    const pagos = spreadsheet.addSheet('Pagos', [
      ['saleId', 'fecha', 'medio', 'monto', 'referencia', 'estado'],
      ['s1', NOW, 'account', 1100, 'h-1', 'cerrada'],
    ]);

    const response = call('pushAccountHoldConfirm', { holdId: 'h-1', saleId: 's1' }, 'k1');

    expect(response.ok).toBe(true);
    expect(table(spreadsheet, 'CuentaCorriente')).toEqual([[expect.any(String), 'h-1', 's1', 'c-001', 1100]]);
    expect(pagos.values()[0]).toContain('Medio de pago');
    expect(ventas.values()[0]).toContain('Id de venta');
  });
});
```

- [ ] **Step 2: Correr y ver que fallan**

Run: `pnpm vitest run src/connectors/google-sheets/bridge.test.ts`
Expected: FAIL — los `push*` siguen escribiendo por posición y valores en inglés.

- [ ] **Step 3: `bridge.gs` — `SEED` con claves internas**

Reemplazar el bloque `SEED` por:

```js
// Datos de prueba: solo se siembran cuando esta llamada CREA la pestaña. Claves internas.
var SEED = {
  Productos: [
    { id: 'p-001', sku: 'SKU-001', barcodes: '7790001000011', name: 'Gaseosa cola 500ml', price: 1200, taxRate: 0.21, category: 'bebidas' },
    { id: 'p-002', sku: 'SKU-002', barcodes: '7790001000028,7790001000035', name: 'Alfajor triple', price: 900, taxRate: 0.21, category: 'golosinas' },
    { id: 'p-003', sku: 'SKU-003', barcodes: '7790001000042', name: 'Yerba 1kg', price: 4500, taxRate: 0.21, category: 'almacen' },
    { id: 'p-004', sku: 'SKU-004', barcodes: '', name: 'Pan (kg)', price: 2200, taxRate: 0.105, category: 'panaderia' },
    { id: 'p-005', sku: 'SKU-005', barcodes: '7790001000059', name: 'Agua mineral 1.5L', price: 1100, taxRate: 0.21, category: 'bebidas' },
  ],
  Clientes: [
    { id: 'c-001', name: 'Ana Gómez', document: '30111222', phone: '1155501234', createdAt: '2026-01-01T00:00:00.000Z' },
    { id: 'c-002', name: 'Carlos Ruiz', document: '', phone: '', createdAt: '2026-01-01T00:00:00.000Z' },
    { id: 'c-003', name: 'Lucía Fernández', document: '27333444', phone: '1155505678', createdAt: '2026-01-01T00:00:00.000Z' },
  ],
};
```

- [ ] **Step 4: `bridge.gs` — helpers de escritura**

Reemplazar `appendRows` y `orEmpty` (se eliminan) por estos, ubicados junto a `readRows`; reemplazar `setCells` por la versión con traducción:

```js
/** Valor interno → valor de celda: traduce, convierte ISO 8601 a Date en columnas datetime, vacío → ''. */
function toCell(column, value) {
  if (value === undefined || value === null) {
    return '';
  }
  var labels = VALUE_LABELS[column.key];
  if (labels && labels[value] !== undefined) {
    return labels[value];
  }
  if (column.type === 'datetime' && typeof value === 'string' && value !== '') {
    var date = new Date(value);
    return isNaN(date.getTime()) ? value : date;
  }
  return value;
}

/** Primera fila donde escribir: la plantilla (fila 2) si está vacía, si no, la que sigue a la última con datos. */
function firstFreeRow(sheet, width) {
  var last = sheet.getLastRow();
  if (last < 2) {
    return 2;
  }
  var isBlank = sheet
    .getRange(last, 1, 1, width)
    .getValues()[0]
    .every(function (cell) {
      return cell === '';
    });
  return isBlank ? last : last + 1;
}

/**
 * Agrega filas a una pestaña. Cada objeto usa claves internas; cada valor va a la columna que indica
 * el encabezado (una columna ausente se omite; las columnas del usuario quedan vacías).
 */
function appendObjects(name, objects) {
  if (objects.length === 0) {
    return;
  }
  var sheet = getSheet(name);
  var header = headerMap(sheet, name);
  var rows = objects.map(function (object) {
    var cells = [];
    for (var i = 0; i < header.width; i++) {
      cells.push('');
    }
    SCHEMA[name].forEach(function (column) {
      var position = header.map[column.key];
      if (position !== undefined && object[column.key] !== undefined) {
        cells[position - 1] = toCell(column, object[column.key]);
      }
    });
    return cells;
  });
  var first = firstFreeRow(sheet, header.width);
  var needed = first + rows.length - 1 - sheet.getMaxRows();
  if (needed > 0) {
    sheet.insertRowsAfter(sheet.getMaxRows(), needed);
  }
  sheet.getRange(first, 1, rows.length, header.width).setValues(rows);
}

function setCells(name, rowNumber, values) {
  var sheet = getSheet(name);
  var header = headerMap(sheet, name);
  SCHEMA[name].forEach(function (column) {
    var position = header.map[column.key];
    if (position !== undefined && Object.prototype.hasOwnProperty.call(values, column.key)) {
      sheet.getRange(rowNumber, position).setValue(toCell(column, values[column.key]));
    }
  });
}
```

En `ensureSheetsExist`, reemplazar `appendRows(name, SEED[name]);` por `appendObjects(name, SEED[name]);`. En `idempotent`, reemplazar `appendRows('_Idempotency', [[key, new Date().toISOString()]]);` por `appendObjects('_Idempotency', [{ key: key, at: new Date().toISOString() }]);`.

- [ ] **Step 5: `bridge.gs` — los `push*` con claves internas**

Reemplazar `pushSale`, `pushSaleVoid`, `pushCustomer`, `pushAccountHoldConfirm` y `pushCashSession` (el resto de `pushSaleVoid`/`markSaleRows` no cambia salvo lo indicado):

```js
function pushSale(payload) {
  var sale = payload.sale;
  if (!sale || !sale.id) {
    throw new Error('Falta sale');
  }
  var lines = sale.lines.map(function (line, index) {
    var discount = line.discount || {};
    return {
      saleId: sale.id,
      fecha: sale.createdAt,
      customerId: sale.customerId,
      linea: index + 1,
      tipo: line.kind,
      productId: line.productId,
      descripcion: line.description,
      cantidad: line.qty,
      precioUnitario: line.unitPrice,
      descuentoTipo: discount.type,
      descuentoValor: discount.value,
      totalVenta: sale.total,
      ajusteGlobalPct: sale.globalAdjustmentPercentage,
      estado: 'cerrada',
    };
  });
  var payments = sale.payments.map(function (payment) {
    return {
      saleId: sale.id,
      fecha: sale.createdAt,
      medio: payment.method,
      monto: payment.amount,
      referencia: payment.reference,
      estado: 'cerrada',
    };
  });
  appendObjects('Ventas', lines);
  appendObjects('Pagos', payments);
}
```

En `pushSaleVoid`, el primer `markSaleRows` pasa a:

```js
  var found = markSaleRows('Ventas', payload.saleId, {
    estado: 'anulada',
    anuladaEn: payload.voidedAt,
    motivoAnulacion: payload.voidReason,
  });
```

```js
function pushCustomer(payload) {
  var customer = payload.customer;
  if (!customer || !customer.id) {
    throw new Error('Falta customer');
  }
  appendObjects('Clientes', [
    {
      id: customer.id,
      name: customer.name,
      document: customer.document,
      phone: customer.phone,
      createdAt: customer.createdAt,
    },
  ]);
}
```

En `pushAccountHoldConfirm`, reemplazar el `appendRows('CuentaCorriente', …)` final por:

```js
  appendObjects('CuentaCorriente', [
    {
      fecha: new Date().toISOString(),
      holdId: payload.holdId,
      saleId: saleId,
      customerId: String(saleRow.customerId),
      monto: Number(paymentRow.monto),
    },
  ]);
```

En `pushCashSession`, reemplazar el `appendRows('Turnos', …)` final por:

```js
  appendObjects('Turnos', [
    {
      sessionId: session.id,
      abiertoEn: session.openedAt,
      cerradoEn: session.closedAt,
      aperturaEfectivo: session.openingAmount,
      contadoEfectivo: counted,
      ventas: Object.keys(countedSales).length,
      cash: totals.cash,
      debit: totals.debit,
      credit: totals.credit,
      transfer: totals.transfer,
      qr: totals.qr,
      account: totals.account,
      efectivoEsperado: expectedCash,
      diferencia: counted === undefined ? undefined : counted - expectedCash,
    },
  ]);
```

(`pullProducts`, `pullCustomers`, `markSaleRows`, `readRows`-based lookups y `compact` no cambian: ya trabajan con claves internas y valores decodificados.)

- [ ] **Step 6: Correr los tests**

Run: `pnpm vitest run src/connectors/google-sheets/bridge.test.ts`
Expected: PASS (todos). Si `toEqual` falla por una fecha, revisar que `table()` la convierta a ISO; si falla el "reordenado", revisar `needed` en `appendObjects` (la pestaña de un solo renglón necesita filas nuevas).

- [ ] **Step 7: Verificación y commit**

Run: `pnpm test; pnpm typecheck; pnpm lint; pnpm prettier --check --end-of-line auto src/connectors/google-sheets/bridge.test.ts`
Expected: verde.

```bash
git add src/connectors/google-sheets/bridge.gs src/connectors/google-sheets/bridge.test.ts
git commit -m "feat: el puente de Sheets escribe por encabezado, con valores en español y fechas reales"
```

---

### Task 4: Pestañas de tamaño exacto, formato por columna y fila plantilla

**Files:**
- Modify: `src/connectors/google-sheets/bridge.gs` (`ensureSheetsExist` → `createSheet`, `NUMBER_FORMATS`, `validationFor`, `appendObjects`)
- Modify: `src/connectors/google-sheets/bridge.test.ts`

**Interfaces:**
- Consumes: `SCHEMA`, `VALUE_LABELS`, `appendObjects`, `firstFreeRow` de las tareas anteriores.
- Produces: `NUMBER_FORMATS[tipo]`, `validationFor(column)`, `createSheet(spreadsheet, name)`. Invariante: en una pestaña creada por el puente, la fila 2 tiene el formato numérico y la validación de cada columna, y toda fila agregada los hereda de ahí.

- [ ] **Step 1: Tests que fallan**

Agregar a `bridge.test.ts`:

```ts
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
      list: ['Efectivo', 'Tarjeta de débito', 'Tarjeta de crédito', 'Transferencia', 'Código QR', 'Cuenta corriente'],
      allowInvalid: false,
    });
    expect(pagos?.validations(2)[5]).toEqual({ list: ['Cerrada', 'Anulada'], allowInvalid: false });
    expect(pagos?.validations(2)[0]).toBeNull();
    expect(spreadsheet.getSheetByName('Productos')?.formats(2)).toEqual(['@', '@', '@', '@', '#,##0.00', '0.0%', '@']);
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
    const productos = spreadsheet.addSheet(
      'Productos',
      [['Id', 'SKU', 'Códigos de barras', 'Nombre', 'Precio', 'IVA', 'Categoría'], ...Array.from({ length: 12 }, () => ['', '', '', '', '', '', ''])],
    );

    call('pullProducts');

    expect([productos.getMaxRows(), productos.getMaxColumns()]).toEqual([13, 7]);
  });
});
```

- [ ] **Step 2: Correr y ver que fallan**

Run: `pnpm vitest run src/connectors/google-sheets/bridge.test.ts`
Expected: FAIL — las pestañas se crean con el tamaño por defecto y sin plantilla.

- [ ] **Step 3: `bridge.gs` — provisión de tamaño exacto, formato y validación**

Reemplazar `ensureSheetsExist` por estas tres funciones y la constante:

```js
// Formato numérico de la fila plantilla, por tipo de columna. `text` (@) evita que Sheets convierta
// un código de barras o un id en número (y un texto que empiece con "=" en fórmula).
var NUMBER_FORMATS = {
  text: '@',
  integer: '0',
  number: '#,##0.00',
  percent: '0.0%',
  datetime: 'dd/mm/yyyy hh:mm',
};

/** Lista desplegable para las columnas cuyos valores están en VALUE_LABELS; `null` si no aplica. */
function validationFor(column) {
  var labels = VALUE_LABELS[column.key];
  if (!labels) {
    return null;
  }
  var list = Object.keys(labels).map(function (internal) {
    return labels[internal];
  });
  return SpreadsheetApp.newDataValidation().requireValueInList(list, true).setAllowInvalid(false).build();
}

function ensureSheetsExist() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(SCHEMA).forEach(function (name) {
    if (!spreadsheet.getSheetByName(name)) {
      createSheet(spreadsheet, name);
    }
  });
}

/**
 * Crea una pestaña con el tamaño exacto: el encabezado y UNA fila de datos vacía — la plantilla — que
 * lleva el formato y la validación de cada columna. Las filas que se agreguen después los copian de
 * ahí (appendObjects). No se toca ninguna pestaña que ya existe.
 */
function createSheet(spreadsheet, name) {
  var defs = SCHEMA[name];
  var labels = defs.map(function (column) {
    return COLUMN_LABELS[name][column.key];
  });
  var sheet = spreadsheet.insertSheet(name);
  if (sheet.getMaxColumns() > defs.length) {
    sheet.deleteColumns(defs.length + 1, sheet.getMaxColumns() - defs.length);
  }
  if (sheet.getMaxRows() > 2) {
    sheet.deleteRows(3, sheet.getMaxRows() - 2);
  }
  sheet.getRange(1, 1, 1, defs.length).setValues([labels]).setFontWeight('bold');
  sheet.setFrozenRows(1);
  var template = sheet.getRange(2, 1, 1, defs.length);
  template.setNumberFormats([
    defs.map(function (column) {
      return NUMBER_FORMATS[column.type];
    }),
  ]);
  template.setDataValidations([defs.map(validationFor)]);
  if (name === '_Idempotency') {
    sheet.hideSheet();
  }
  if (SEED[name]) {
    appendObjects(name, SEED[name]);
  }
}
```

En `appendObjects`, reemplazar la última línea (`sheet.getRange(first, 1, rows.length, header.width).setValues(rows);`) por:

```js
  // Formato y validación salen de la fila plantilla (2), no de la herencia de Sheets: así no depende
  // de cómo se inserten las filas. Primero el formato, después los valores (un '@' evita conversiones).
  var template = sheet.getRange(2, 1, 1, header.width);
  var formats = template.getNumberFormats()[0];
  var rules = template.getDataValidations()[0];
  var block = sheet.getRange(first, 1, rows.length, header.width);
  block.setNumberFormats(
    rows.map(function () {
      return formats;
    }),
  );
  block.setDataValidations(
    rows.map(function () {
      return rules;
    }),
  );
  block.setValues(rows);
```

- [ ] **Step 4: Correr los tests**

Run: `pnpm vitest run src/connectors/google-sheets/bridge.test.ts`
Expected: PASS (todos, incluidos los dos casos de `validationCountsAsContent`).

- [ ] **Step 5: Verificación y commit**

Run: `pnpm test; pnpm typecheck; pnpm lint; pnpm prettier --check --end-of-line auto src/connectors/google-sheets/bridge.test.ts`
Expected: verde.

```bash
git add src/connectors/google-sheets/bridge.gs src/connectors/google-sheets/bridge.test.ts
git commit -m "feat: pestañas de Sheets con tamaño exacto, fila plantilla y formato por columna"
```

---

### Task 5: Guarda por `columnas.gs` ausente, documentación, verificación y PR

**Files:**
- Modify: `src/connectors/google-sheets/bridge.gs` (guarda en `doPost`), `src/connectors/google-sheets/bridge.test.ts`
- Modify: `src/connectors/google-sheets/README.md`, `CLAUDE.md`

- [ ] **Step 1: Test de la guarda (falla primero)**

En `bridge.test.ts`, cambiar la firma de `loadBridge` a `loadBridge(options: FakeOptions = {}, files: string[] = SOURCE_FILES)` (y usar `files` en el `for`), y agregar:

```ts
describe('instalación', () => {
  it('si falta columnas.gs en el proyecto de Apps Script, el error lo dice en claro', () => {
    const { call } = loadBridge({}, ['bridge.gs']);

    expect(call('pullProducts')).toEqual({
      ok: false,
      error: 'Falta el archivo columnas.gs en el proyecto de Apps Script',
    });
  });
});
```

Run: `pnpm vitest run src/connectors/google-sheets/bridge.test.ts` → FAIL (`ReferenceError: COLUMN_LABELS is not defined` dentro del `try`, con otro mensaje).

- [ ] **Step 2: Guarda en `bridge.gs`**

En `doPost`, justo después de validar `request.action` (antes del secreto compartido):

```js
  if (typeof COLUMN_LABELS === 'undefined' || typeof VALUE_LABELS === 'undefined') {
    return respond({ ok: false, error: 'Falta el archivo columnas.gs en el proyecto de Apps Script' });
  }
```

Run: `pnpm vitest run src/connectors/google-sheets/bridge.test.ts` → PASS.

- [ ] **Step 3: README del conector**

Con `Edit` sobre `src/connectors/google-sheets/README.md`:

1. Setup, paso 1: reemplazar "(viene con `bridge.gs` ya incrustado y datos de prueba)" por "(viene con `bridge.gs` y `columnas.gs` ya incrustados, y datos de prueba)". Agregar a continuación un párrafo: "Si armás el proyecto a mano: Extensiones > Apps Script, y pegá **los dos archivos** (`bridge.gs` y `columnas.gs`) como archivos del mismo proyecto. Sin `columnas.gs` el puente responde `Falta el archivo columnas.gs…`."
2. Después de "Si la planilla no tiene las pestañas…", agregar la sección:

```markdown
## Cómo se ve y cómo se edita la planilla

Todo está en español: pestañas (`Productos`, `Clientes`, `Ventas`, `Pagos`, `CuentaCorriente`,
`Turnos`), encabezados ("Precio unitario", "Medio de pago") y valores ("Efectivo", "Cerrada",
"Producto"). Los nombres los define `columnas.gs` — es el único archivo que hay que tocar para
cambiarlos; `bridge.gs` trabaja con claves internas que no se renombran.

El puente encuentra cada columna por su **encabezado**, no por su posición. Podés:

- reordenar columnas y agregar las tuyas ("Notas", cálculos…): se ignoran;
- convertir un rango en una tabla de Google Sheets desde el menú (Formato > Convertir en tabla);
- borrar `Documento`, `Teléfono` o `Códigos de barras` (son opcionales).

No podés borrar ni renombrar las demás columnas: el puente responde con un error que dice cuál falta
(`Falta la columna 'Precio' en la pestaña Productos`) y el POS lo muestra en la barra de estado.
Reconocer un encabezado no distingue mayúsculas, acentos ni espacios, y también entiende los nombres
de versiones anteriores (`name`, `precioUnitario`…): al leer una pestaña vieja, los pasa a la etiqueta
nueva; los datos y los valores viejos (`cash`, `cerrada`) se siguen leyendo.

Cada pestaña nueva nace con el tamaño exacto (encabezado y una fila de datos vacía) y con formato por
columna: texto para ids y códigos, importes con miles y decimales, IVA en porcentaje, fechas reales
(`dd/mm/aaaa hh:mm`) y listas desplegables en Estado, Medio de pago, Tipo y Tipo de descuento. Las
filas nuevas copian ese formato de la fila 2. Las pestañas que ya existían no se redimensionan.
```

3. Tabla "Qué hace cada operación": en `pushSaleVoid` cambiar "`estado = anulada`" por "Estado = Anulada"; en la limitación del fiado cambiar "`medio = account`" por "Medio de pago = Cuenta corriente"; en `pushCashSession` cambiar "(solo ventas `cerrada` del turno)" por "(solo ventas Cerradas del turno)".
4. Sección "Desarrollo": reemplazar el párrafo que dice que `bridge.gs` "no pasa por TypeScript/Vitest/ESLint" por: "`bridge.gs` y `columnas.gs` son JS plano para el motor V8 de Google — no pasan por TypeScript ni ESLint. Sí tienen tests automáticos (`bridge.test.ts`): se cargan en un contexto `node:vm` contra una planilla falsa en memoria (`src/test/fake-spreadsheet.ts`). Lo que la planilla falsa no puede probar (CORS, formatos y fechas reales, permisos) se valida con este checklist contra un despliegue real:"
5. En el checklist, ajustar textos al español (4: "con `Estado = Cerrada`"; 7: "pasan a `Estado = Anulada`"; 10: "se recrea con sus encabezados en español") y agregar al final, antes de "Registrar el resultado…":

```markdown
12. Provisión (Etapa 2d): borrar todas las pestañas del puente y llamar `pullProducts` → pestañas con
    encabezados en español, congeladas y en negrita, **sin filas ni columnas de sobra** (`Turnos`: 2
    filas × 14 columnas; `Productos`: 6 filas con los 5 productos de prueba).
13. Formato: Precio con miles y decimales, IVA como `21,0%`, Fecha como `dd/mm/aaaa hh:mm`, un código de
    barras con ceros a la izquierda no los pierde. Desplegables en Estado, Medio de pago y Tipo.
14. `pushSale` de 2 líneas y 2 pagos → la primera fila de `Ventas` y `Pagos` es la plantilla (no queda
    una fila vacía arriba) y las filas siguientes mantienen formato y desplegables.
15. Fechas: la hora que muestra `Fecha` coincide con la hora local de la venta en el POS. Si difiere,
    revisar la zona horaria del proyecto de Apps Script contra la de la planilla (riesgo conocido:
    el puente escribe un `Date`).
16. Reordenar columnas de `Productos` y agregar una propia ("Notas") → `pullProducts` devuelve lo mismo y
    un `pushCustomer`/`pushSale` escribe en las columnas correctas.
17. Borrar o renombrar `Precio` → `pullProducts` responde `ok: false` con "Falta la columna 'Precio' en la
    pestaña Productos". Borrar `Teléfono` → sigue funcionando.
18. Convertir `Clientes` en tabla nativa (Formato > Convertir en tabla) y hacer un `pushCustomer` → anotar
    si la tabla se expande sola con la fila nueva. Si no, dejarlo como limitación en este README.
19. Planilla de la Etapa 1 o 2 (encabezados viejos): llamar cualquier acción → los encabezados pasan a
    español, los datos y valores viejos (`cash`, `cerrada`) se leen y `pushSaleVoid` de una venta vieja
    funciona.
```

- [ ] **Step 4: `CLAUDE.md`**

Con `Edit`:
1. En "Connector API", después de la frase "…(`bridge.gs`, ver su README)." agregar: "Sus dos archivos (`bridge.gs` y `columnas.gs`) se pegan en el mismo proyecto de Apps Script: `columnas.gs` solo tiene los textos visibles (etiquetas de columna y de valor, en español), `bridge.gs` trabaja con claves internas y encuentra cada columna por su encabezado, no por posición (Etapa 2d, #NNN). Se prueban en Vitest con una planilla falsa (`src/test/fake-spreadsheet.ts`)."
2. En "Estado del proyecto", en el bullet de "Conectores plugin", agregar antes de "Pendiente: Etapa 3": "Etapa 2d (#NNN): planilla de Sheets toda en español con acceso por encabezado, pestañas de tamaño exacto y formato por columna; permisos mínimos (`@OnlyCurrentDoc`) a propósito — un spike mostró que las tablas nativas exigen un scope más amplio y se descartaron."

(`#NNN` = el número del issue de la Step 6.)

- [ ] **Step 5: Verificación completa**

Run: `pnpm test; pnpm typecheck; pnpm typecheck:backend; pnpm lint; pnpm test:backend`
Expected: todo en verde. Los e2e no cambian (el POS no cambió), pero correr `pnpm test:e2e` con los puertos 4000/4173 libres (no tocar procesos del usuario) para confirmar.

Formato: `pnpm prettier --check --end-of-line auto src/connectors/google-sheets/README.md CLAUDE.md src/connectors/google-sheets/bridge.test.ts src/test/fake-spreadsheet.ts` — para los `.md`, solo formatear si ya estaban formateados en `origin/main` (comparar con `git show origin/main:<ruta> | pnpm prettier --check --stdin-filepath <ruta>`); los `.ts` son archivos nuevos: `pnpm prettier --write --end-of-line auto` sobre ambos.

- [ ] **Step 6: Issue, commit, push y PR**

Crear el issue (con la API REST: `gh issue create` falla por la deprecación de Projects classic):

```bash
gh api repos/rauldiazsolis/offline-pos/issues -f title="Etapa 2d: columnas en español y acceso por encabezado en el puente de Sheets" -f body="Parte de #66. Planilla toda en español (mapa aislado en columnas.gs), acceso por encabezado en vez de por posición, pestañas de tamaño exacto con formato por columna. Plan: docs/superpowers/plans/2026-09-21-bridge-columnas-etapa-2d.md" --jq .number
```

```bash
git add -A
git commit -m "docs: columnas en español y acceso por encabezado en el conector de Sheets (#NNN)"
git push -u origin claude/bridge-columnas-2d
gh pr create --base main --head claude/bridge-columnas-2d --title "Etapa 2d: planilla de Sheets en español y acceso por encabezado (#NNN)"
```

Cuerpo del PR: qué cambia (`columnas.gs`, `SCHEMA`, acceso por encabezado, tamaño exacto y plantilla, fechas reales), qué **no** cambia (POS, contrato, permisos), aviso de despliegue ("hay que pegar `columnas.gs` como segundo archivo y reemplazar `bridge.gs`"), y el checklist 12–19 del README como pasos de prueba manual que quedan de su lado; `Closes #NNN`, parte de #66; terminar con la línea de atribución de Claude Code. Enlazar el PR a la sesión (`mcp__ccd_pr__bind_pr`) y avisar con PushNotification.

---

## Self-review del plan

**Cobertura de las decisiones:** (1) permisos — Global Constraints + nada usa el servicio avanzado; (2) acceso por encabezado — Task 2 (lectura, `setCells`) y Task 3 (`appendObjects`); columnas requeridas/opcionales y error claro — Task 2; (3) español y mapa aislado — Task 2 (`columnas.gs`), valores — Tasks 2–3 (`fromCell`/`toCell`); (4) compatibilidad — Task 2 (claves viejas, renombrado exacto) y Task 3 (valores viejos), sin redimensionar — Task 4; (5) tamaño exacto y plantilla — Task 4, con los dos comportamientos posibles de `getLastRow` (`validationCountsAsContent`); (6) tipos y fechas reales — `NUMBER_FORMATS` y `toCell` (Tasks 3–4), `_Idempotency` en texto.

**Riesgos que solo el despliegue real puede confirmar** (por eso están en el checklist manual 12–19 y no se afirman como resueltos): zona horaria de las fechas escritas como `Date` (15), si una tabla nativa se expande con las filas que agrega el puente (18), y que `insertRowsAfter`/`setDataValidations` se comporten en Sheets como en la planilla falsa (13–14).

**Consistencia de nombres:** `SCHEMA`, `COLUMN_LABELS`, `VALUE_LABELS`, `NUMBER_FORMATS`, `headerMap`, `fromCell`, `toCell`, `firstFreeRow`, `appendObjects`, `setCells`, `createSheet`, `validationFor`, `headerCache` se usan igual en todas las tareas. `appendRows` y `orEmpty` desaparecen en la Task 3 (y la Task 2, que aún los usa, queda verde antes de eso). Los tests de una tarea no dependen de código de una posterior.

## Ejecución

Plan para ejecutar **inline** (`superpowers:executing-plans`) en la rama `claude/bridge-columnas-2d`, ya creada desde `origin/main`. Tasks 1–4 son código con TDD; la 5 cierra con documentación y el PR.
