# Impresión de tickets (#174) — plan de implementación

> **Para quien ejecute:** este repo ejecuta los planes **inline** con `superpowers:executing-plans`,
> tarea por tarea con checkpoints (ver "Cómo trabajamos" en `AGENTS.md`), no con un subagente por
> tarea. Los pasos usan checkboxes (`- [ ]`).

**Objetivo:** imprimir el comprobante en 58 mm, 80 mm y A6 con `window.print()`, configurado por
terminal con `/IMPRESORA` (formato, "Al cobrar", encabezado y pie), y reimprimir desde `/RESUMEN`.

**Arquitectura:** el origen del comprobante (`ReceiptSource`: una venta o una cobranza) se convierte
en un modelo puro (`ReceiptDocument`) que dibuja un solo componente (`ReceiptView`) en la pantalla y
en un iframe aparte para imprimir. La impresión va detrás de un puerto (`ReceiptPrinter`), así
ESC/POS (#188) es otra implementación. La config vive en `localStorage`, aparte de la conexión.

**Stack:** Preact + `@preact/signals`, Zod 4, Vite 8 (`?inline` para el CSS del iframe), Vitest +
Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-02-impresion-de-tickets-design.md` (leerla antes de
arrancar; manda ante cualquier duda).

## Restricciones globales

- Todo en español: textos de UI, comentarios, commits.
- TypeScript estricto: sin `any`; `exactOptionalPropertyTypes` y `noUncheckedIndexedAccess` activos
  (un campo opcional se arma con spread condicional, nunca con `campo: undefined`).
- `try/catch` solo en el borde con `localStorage` (`storage/printer-config.ts`); lo de negocio
  devuelve `Result`.
- Teclado y mouse: todo botón con su atajo en la etiqueta y la misma función del controller;
  `keepFocusOnMouseDown` en el contenedor; un botón enfocado con Tab + Enter no repite el atajo.
- Los grupos tipo radio usan `.wizard-option` + `aria-pressed` + `.wizard-radio` (`tokens.css`,
  #112), con el foco en la opción elegida y ↑/↓ para moverla.
- Sin config guardada rige `{ format: 'a6', onCheckout: 'show', header: '', footer: '' }`: los e2e
  existentes (que esperan el heading "Comprobante") no cambian.
- Verificación de cada commit: `pnpm lint && pnpm typecheck && pnpm test` (y `pnpm build` en las
  tareas que tocan el iframe o el CSS); `pnpm test:e2e` en la Tarea 9.
- Commits chicos, con `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` al final.

## Tarea 0: preparar el worktree

- [ ] **Paso 1:** en el worktree, `pnpm install` (no tiene `node_modules`).
- [ ] **Paso 2:** `pnpm lint && pnpm typecheck && pnpm test` en verde antes de tocar nada. Si algo
  falla en `main`, avisar antes de seguir.

---

### Tarea 1: la config de la impresora

**Archivos:**
- Crear: `src/storage/printer-config.ts`, `src/storage/printer-config.test.ts`
- Modificar: `src/domain/result.ts` (código nuevo), `src/ui/errors.ts` (traducción)

**Interfaces:**
- Produce: `PrintFormat`, `PaperFormat`, `CheckoutAction`, `PrinterConfig`,
  `DEFAULT_PRINTER_CONFIG`, `paperFormat(format)`, `effectiveCheckoutAction(config)`,
  `loadPrinterConfig(): PrinterConfig`, `savePrinterConfig(config): Result<void>`.

- [ ] **Paso 1: tests que fallan** — `src/storage/printer-config.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { storageKey } from './storage-namespace.ts';
import {
  DEFAULT_PRINTER_CONFIG,
  effectiveCheckoutAction,
  loadPrinterConfig,
  paperFormat,
  savePrinterConfig,
} from './printer-config.ts';

afterEach(() => {
  localStorage.clear();
});

describe('loadPrinterConfig', () => {
  it('sin nada guardado devuelve el default (A6 y mostrar el comprobante)', () => {
    expect(loadPrinterConfig()).toEqual({
      format: 'a6',
      onCheckout: 'show',
      header: '',
      footer: '',
    });
  });

  it('un JSON roto cae al default', () => {
    localStorage.setItem(storageKey('printer'), '{no es json');
    expect(loadPrinterConfig()).toEqual(DEFAULT_PRINTER_CONFIG);
  });

  it('un formato desconocido cae al default', () => {
    localStorage.setItem(
      storageKey('printer'),
      JSON.stringify({ format: '110mm', onCheckout: 'print', header: '', footer: '' }),
    );
    expect(loadPrinterConfig()).toEqual(DEFAULT_PRINTER_CONFIG);
  });

  it('lee lo que se guardó', () => {
    const config = {
      format: '58mm',
      onCheckout: 'print',
      header: 'Kiosco\nAv. Siempreviva 742',
      footer: 'Gracias',
    } as const;
    expect(savePrinterConfig(config)).toEqual({ ok: true, value: undefined });
    expect(loadPrinterConfig()).toEqual(config);
  });
});

describe('effectiveCheckoutAction', () => {
  it('"No imprimir" con "Imprimir" se lee como mostrar el comprobante', () => {
    expect(effectiveCheckoutAction({ ...DEFAULT_PRINTER_CONFIG, format: 'none', onCheckout: 'print' })).toBe('show');
  });

  it('con papel respeta lo elegido', () => {
    expect(effectiveCheckoutAction({ ...DEFAULT_PRINTER_CONFIG, format: '80mm', onCheckout: 'print' })).toBe('print');
    expect(effectiveCheckoutAction({ ...DEFAULT_PRINTER_CONFIG, format: 'none', onCheckout: 'skip' })).toBe('skip');
  });
});

describe('paperFormat', () => {
  it('"No imprimir" se dibuja como A6; el resto, tal cual', () => {
    expect(paperFormat('none')).toBe('a6');
    expect(paperFormat('58mm')).toBe('58mm');
  });
});
```

- [ ] **Paso 2:** `pnpm vitest run src/storage/printer-config.test.ts` → FALLA (no existe el módulo).

- [ ] **Paso 3: el código de error** — en `src/domain/result.ts`, dentro de `ErrorMeta`, antes del
  bloque de `sync/terminal-data.ts`:

```ts
  // storage/printer-config.ts (impresión, #174)
  'printer/save-failed': { message: string };
```

  y en `src/ui/errors.ts`, en el `switch`, junto a `storage/cleanup-failed`:

```ts
    case 'printer/save-failed':
      return `No se pudo guardar la impresora: ${failure.meta.message}`;
```

- [ ] **Paso 4: implementación** — `src/storage/printer-config.ts`:

```ts
import { z } from 'zod';
import { err, ok, type Result } from '../domain/result.ts';
import { storageKey } from './storage-namespace.ts';

/**
 * Config de impresión de esta terminal (#174): es del equipo físico, no de la conexión — vive
 * aparte de `SyncConfig`, no la toca `/CONFIG` ni "Borrar y cambiar" del wizard (que limpia solo
 * IndexedDB), y no viaja en `#connect`. `pos.reset()` sí la borra, como todo el prefijo.
 */
export const PRINT_FORMATS = ['none', '58mm', '80mm', 'a6'] as const;
export type PrintFormat = (typeof PRINT_FORMATS)[number];
/** Un formato con papel: lo que recibe la impresora y lo que dibuja `ReceiptView`. */
export type PaperFormat = Exclude<PrintFormat, 'none'>;

/** Al cobrar: Imprimir · Mostrar el comprobante · Nada (volver a la venta). */
export const CHECKOUT_ACTIONS = ['print', 'show', 'skip'] as const;
export type CheckoutAction = (typeof CHECKOUT_ACTIONS)[number];

const printerConfigSchema = z.object({
  format: z.enum(PRINT_FORMATS),
  onCheckout: z.enum(CHECKOUT_ACTIONS),
  header: z.string(),
  footer: z.string(),
});

export type PrinterConfig = z.infer<typeof printerConfigSchema>;

/** Sin config guardada, como antes de #174: comprobante en pantalla y Enter imprime. */
export const DEFAULT_PRINTER_CONFIG: PrinterConfig = {
  format: 'a6',
  onCheckout: 'show',
  header: '',
  footer: '',
};

const STORAGE_KEY = storageKey('printer');

/** "No imprimir" no tiene papel: se dibuja (en pantalla) como A6. */
export function paperFormat(format: PrintFormat): PaperFormat {
  return format === 'none' ? 'a6' : format;
}

/** Sin papel no se puede imprimir al cobrar: se muestra el comprobante. */
export function effectiveCheckoutAction(config: PrinterConfig): CheckoutAction {
  return config.format === 'none' && config.onCheckout === 'print' ? 'show' : config.onCheckout;
}

/**
 * Nunca falla: algo ausente, roto o de otra versión cae al default. `localStorage`/`JSON.parse` son
 * el borde real — único try/catch de este módulo junto con `savePrinterConfig`.
 */
export function loadPrinterConfig(): PrinterConfig {
  let parsedJson: unknown;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    parsedJson = raw === null ? null : (JSON.parse(raw) as unknown);
  } catch {
    return DEFAULT_PRINTER_CONFIG;
  }
  const parsed = printerConfigSchema.safeParse(parsedJson);
  return parsed.success ? parsed.data : DEFAULT_PRINTER_CONFIG;
}

export function savePrinterConfig(config: PrinterConfig): Result<void> {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch (error) {
    return err('printer/save-failed', {
      message: error instanceof Error ? error.message : String(error),
    });
  }
  return ok(undefined);
}
```

- [ ] **Paso 5:** `pnpm vitest run src/storage/printer-config.test.ts` → PASA. `pnpm typecheck`
  (el `switch` de `errors.ts` exige el `case` nuevo).
- [ ] **Paso 6: commit** — `feat(impresion): config de la impresora en localStorage (#174)`.

---

### Tarea 2: el modelo del comprobante (`ReceiptDocument`)

**Archivos:**
- Crear: `src/ui/print/receipt-document.ts`, `src/ui/print/receipt-document.test.ts`

**Interfaces:**
- Consume: `Sale`, `CustomerPayment`, `calculateTotals`, `ticketLabel`, `receiptLabel`,
  `PAYMENT_METHOD_LABELS`.
- Produce:
  - `ReceiptBlock`, `ReceiptDocument`, `ReceiptText = { header: string; footer: string }`
  - `ReceiptFormatters = { money(n): string; quantity(n): string; dateTime(iso): string; balance(n: number | undefined): string }`
  - `textLines(text): string[]`
  - `saleReceiptDocument(params): ReceiptDocument`
  - `collectionReceiptDocument(params): ReceiptDocument`
  - `sampleReceiptDocument(text, format): ReceiptDocument`

- [ ] **Paso 1: tests que fallan** — `src/ui/print/receipt-document.test.ts` (formateadores
  triviales, para no depender del locale):

```ts
import { describe, expect, it } from 'vitest';
import type { CustomerPayment } from '../../domain/customer-payment.ts';
import type { Sale } from '../../domain/sale.ts';
import {
  collectionReceiptDocument,
  saleReceiptDocument,
  sampleReceiptDocument,
  textLines,
  type ReceiptFormatters,
} from './receipt-document.ts';

const format: ReceiptFormatters = {
  money: (amount) => amount.toFixed(2),
  quantity: (qty) => String(qty),
  dateTime: (iso) => `F(${iso})`,
  balance: (balance) => (balance === undefined ? 'Sin saldo' : `S(${String(balance)})`),
};
const noText = { header: '', footer: '' };

const sale: Sale = {
  id: 'sale-1',
  lines: [
    { kind: 'product', productId: 'p1', qty: 2, unitPrice: 100 },
    { kind: 'freeform', description: 'Bolsa', qty: 1, unitPrice: 50 },
  ],
  payments: [
    { method: 'cash', amount: 200 },
    { method: 'debit', amount: 50 },
  ],
  total: 250,
  status: 'closed',
  createdAt: '2026-10-02T12:00:00.000Z',
  ticket: { date: '2026-10-02', number: 12 },
};

describe('textLines', () => {
  it('parte en renglones y saca los vacíos del principio y del final', () => {
    expect(textLines('\n Kiosco \n\nAv. 742\n\n')).toEqual(['Kiosco', '', 'Av. 742']);
    expect(textLines('   ')).toEqual([]);
  });
});

describe('saleReceiptDocument', () => {
  it('arma el comprobante de una venta como el de hoy', () => {
    const doc = saleReceiptDocument({
      sale,
      lineNames: ['Arroz 1kg', 'Bolsa'],
      copy: false,
      text: { header: 'Kiosco\nAv. 742', footer: 'Gracias' },
      format,
    });
    expect(doc.header).toEqual(['Kiosco', 'Av. 742']);
    expect(doc.title).toBe('Comprobante');
    expect(doc.marks).toEqual([]);
    expect(doc.meta).toEqual(['Ticket #12', 'F(2026-10-02T12:00:00.000Z)']);
    expect(doc.blocks).toEqual([
      { kind: 'divider' },
      { kind: 'row', left: '2 × Arroz 1kg', right: '200.00' },
      { kind: 'row', left: '1 × Bolsa', right: '50.00' },
      { kind: 'divider' },
      { kind: 'row', left: 'Total', right: '250.00', bold: true },
      { kind: 'row', left: 'Efectivo', right: '200.00' },
      { kind: 'row', left: 'Tarjeta de Débito', right: '50.00' },
    ]);
    expect(doc.footer).toEqual(['Gracias']);
  });

  it('con recargo global suma su fila antes del total', () => {
    const doc = saleReceiptDocument({
      sale: { ...sale, globalAdjustmentPercentage: 10, total: 275 },
      lineNames: ['Arroz 1kg', 'Bolsa'],
      copy: false,
      text: noText,
      format,
    });
    expect(doc.blocks).toContainEqual({ kind: 'row', left: 'Recargo global (+10%)', right: '25.00' });
  });

  it('con descuento global dice "Descuento"', () => {
    const doc = saleReceiptDocument({
      sale: { ...sale, globalAdjustmentPercentage: -10, total: 225 },
      lineNames: ['Arroz 1kg', 'Bolsa'],
      copy: false,
      text: noText,
      format,
    });
    expect(doc.blocks).toContainEqual({ kind: 'row', left: 'Descuento global (-10%)', right: '-25.00' });
  });

  it('una copia lleva la marca COPIA', () => {
    const doc = saleReceiptDocument({ sale, lineNames: ['Arroz 1kg', 'Bolsa'], copy: true, text: noText, format });
    expect(doc.marks).toEqual(['COPIA']);
  });

  it('una venta sin número dice "Ticket" a secas', () => {
    const { ticket: _ticket, ...unnumbered } = sale;
    const doc = saleReceiptDocument({ sale: unnumbered, lineNames: ['Arroz 1kg', 'Bolsa'], copy: false, text: noText, format });
    expect(doc.meta[0]).toBe('Ticket');
  });
});

describe('collectionReceiptDocument', () => {
  const payment: CustomerPayment = {
    id: 'pay-1',
    customerId: 'c1',
    payments: [{ method: 'cash', amount: 500 }],
    total: 500,
    createdAt: '2026-10-02T13:00:00.000Z',
    receipt: { date: '2026-10-02', number: 3 },
  };

  it('arma el recibo con los saldos de ese momento', () => {
    const doc = collectionReceiptDocument({
      payment,
      customerName: 'Ana',
      balances: { before: 0, after: -500 },
      copy: false,
      text: noText,
      format,
    });
    expect(doc.title).toBe('Recibo de cobranza');
    expect(doc.meta).toEqual(['Recibo #3', 'F(2026-10-02T13:00:00.000Z)', 'Ana']);
    expect(doc.blocks).toEqual([
      { kind: 'divider' },
      { kind: 'row', left: 'Efectivo', right: '500.00' },
      { kind: 'divider' },
      { kind: 'row', left: 'Total', right: '500.00', bold: true },
      { kind: 'text', text: 'Saldo anterior: S(0)' },
      { kind: 'text', text: 'Saldo nuevo: S(-500)', bold: true },
    ]);
  });

  it('una copia no lleva saldos (no están guardados)', () => {
    const doc = collectionReceiptDocument({ payment, customerName: 'Ana', copy: true, text: noText, format });
    expect(doc.marks).toEqual(['COPIA']);
    expect(doc.blocks.some((block) => block.kind === 'text')).toBe(false);
  });
});

describe('sampleReceiptDocument', () => {
  it('es un ticket de ejemplo con el encabezado y el pie dados', () => {
    const doc = sampleReceiptDocument({ header: 'Mi kiosco', footer: 'Chau' }, format);
    expect(doc.header).toEqual(['Mi kiosco']);
    expect(doc.footer).toEqual(['Chau']);
    expect(doc.marks).toEqual(['PRUEBA']);
  });
});
```

  > Antes de correrlo, confirmar en `src/domain/customer-payment.ts` los campos obligatorios de
  > `CustomerPayment` y ajustar el literal del test si falta alguno (por ejemplo `syncedAt` es
  > opcional; si hay otro obligatorio, agregarlo).

- [ ] **Paso 2:** `pnpm vitest run src/ui/print/receipt-document.test.ts` → FALLA.

- [ ] **Paso 3: implementación** — `src/ui/print/receipt-document.ts`:

```ts
import type { CustomerPayment } from '../../domain/customer-payment.ts';
import type { Payment, Sale } from '../../domain/sale.ts';
import { calculateLineTotal, calculateTotals } from '../../domain/totals.ts';
import { receiptLabel, ticketLabel } from '../format-ticket.ts';
import { PAYMENT_METHOD_LABELS } from '../payment-labels.ts';

/**
 * Modelo del comprobante (#174), independiente de cómo se imprime: lo dibuja `ReceiptView` en la
 * pantalla y en el iframe de `window.print()`, y ESC/POS (#188) lo va a convertir en bytes. Puro:
 * recibe los nombres ya resueltos y los formateadores, así se testea sin catálogo ni locale.
 */
export type ReceiptBlock =
  | { kind: 'row'; left: string; right: string; bold?: boolean }
  | { kind: 'text'; text: string; bold?: boolean }
  | { kind: 'divider' };

export type ReceiptDocument = {
  header: string[];
  title: string;
  /** "COPIA" al reimprimir, "PRUEBA" en la prueba de impresión (y "ENTRENAMIENTO" con #177). */
  marks: string[];
  meta: string[];
  blocks: ReceiptBlock[];
  footer: string[];
};

/** Encabezado y pie libres de `/IMPRESORA`. */
export type ReceiptText = { header: string; footer: string };

export type ReceiptFormatters = {
  money: (amount: number) => string;
  quantity: (qty: number) => string;
  dateTime: (isoDate: string) => string;
  balance: (balance: number | undefined) => string;
};

/** Renglones de un texto libre, sin espacios sobrantes ni renglones vacíos en las puntas. */
export function textLines(text: string): string[] {
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start] === '') start++;
  while (end > start && lines[end - 1] === '') end--;
  return lines.slice(start, end);
}

function paymentRows(payments: readonly Payment[], format: ReceiptFormatters): ReceiptBlock[] {
  return payments.map((payment) => ({
    kind: 'row',
    left: PAYMENT_METHOD_LABELS[payment.method],
    right: format.money(payment.amount),
  }));
}

function copyMarks(copy: boolean): string[] {
  return copy ? ['COPIA'] : [];
}

export function saleReceiptDocument(params: {
  sale: Sale;
  /** El nombre de cada línea, en el mismo orden que `sale.lines`. */
  lineNames: readonly string[];
  copy: boolean;
  text: ReceiptText;
  format: ReceiptFormatters;
}): ReceiptDocument {
  const { sale, lineNames, format } = params;
  // Mismo cálculo que el carrito, sobre los datos ya cerrados de la venta.
  const totals = calculateTotals({
    lines: sale.lines,
    ...(sale.globalAdjustmentPercentage !== undefined
      ? { globalAdjustmentPercentage: sale.globalAdjustmentPercentage }
      : {}),
  });
  const adjustment = sale.globalAdjustmentPercentage ?? 0;
  const adjustmentRows: ReceiptBlock[] =
    adjustment === 0
      ? []
      : [
          {
            kind: 'row',
            left: `${adjustment > 0 ? 'Recargo' : 'Descuento'} global (${adjustment > 0 ? '+' : ''}${String(adjustment)}%)`,
            right: format.money(totals.globalAdjustmentAmount),
          },
        ];
  return {
    header: textLines(params.text.header),
    title: 'Comprobante',
    marks: copyMarks(params.copy),
    meta: [ticketLabel(sale), format.dateTime(sale.createdAt)],
    blocks: [
      { kind: 'divider' },
      ...sale.lines.map(
        (line, index): ReceiptBlock => ({
          kind: 'row',
          left: `${format.quantity(line.qty)} × ${lineNames[index] ?? ''}`,
          right: format.money(calculateLineTotal(line)),
        }),
      ),
      { kind: 'divider' },
      ...adjustmentRows,
      { kind: 'row', left: 'Total', right: format.money(sale.total), bold: true },
      ...paymentRows(sale.payments, format),
    ],
    footer: textLines(params.text.footer),
  };
}

export function collectionReceiptDocument(params: {
  payment: CustomerPayment;
  customerName: string;
  /** Los saldos de cuando se cobró: solo en el comprobante original, nunca en una copia. */
  balances?: { before: number | undefined; after: number };
  copy: boolean;
  text: ReceiptText;
  format: ReceiptFormatters;
}): ReceiptDocument {
  const { payment, balances, format } = params;
  const balanceBlocks: ReceiptBlock[] =
    balances === undefined
      ? []
      : [
          { kind: 'text', text: `Saldo anterior: ${format.balance(balances.before)}` },
          { kind: 'text', text: `Saldo nuevo: ${format.balance(balances.after)}`, bold: true },
        ];
  return {
    header: textLines(params.text.header),
    title: 'Recibo de cobranza',
    marks: copyMarks(params.copy),
    meta: [receiptLabel(payment), format.dateTime(payment.createdAt), params.customerName],
    blocks: [
      { kind: 'divider' },
      ...paymentRows(payment.payments, format),
      { kind: 'divider' },
      { kind: 'row', left: 'Total', right: format.money(payment.total), bold: true },
      ...balanceBlocks,
    ],
    footer: textLines(params.text.footer),
  };
}

/** El ticket de ejemplo de `/IMPRESORA`: la vista previa y la prueba de impresión. */
export function sampleReceiptDocument(text: ReceiptText, format: ReceiptFormatters): ReceiptDocument {
  const sample = saleReceiptDocument({
    sale: {
      id: 'muestra',
      lines: [
        { kind: 'freeform', description: 'Artículo de ejemplo', qty: 2, unitPrice: 1250 },
        { kind: 'freeform', description: 'Otro artículo', qty: 1, unitPrice: 800 },
      ],
      payments: [{ method: 'cash', amount: 3300 }],
      total: 3300,
      status: 'closed',
      createdAt: new Date().toISOString(),
      ticket: { date: '', number: 1 },
    },
    lineNames: ['Artículo de ejemplo', 'Otro artículo'],
    copy: false,
    text,
    format,
  });
  return { ...sample, marks: ['PRUEBA'] };
}
```

  > Confirmar que `calculateLineTotal` y el tipo `Payment` se exportan con esos nombres
  > (`domain/totals.ts`, `domain/sale.ts`; `receipt-screen.tsx` ya importa `calculateLineTotal`).
  > Si `TicketNumber` exige una fecha válida, usar `localDateKey(new Date().toISOString())`.

- [ ] **Paso 4:** `pnpm vitest run src/ui/print/receipt-document.test.ts` → PASA.
- [ ] **Paso 5: commit** — `feat(impresion): modelo del comprobante, ReceiptDocument (#174)`.

---

### Tarea 3: `ReceiptView` y sus estilos por formato

**Archivos:**
- Crear: `src/ui/print/ReceiptView.tsx`, `src/ui/print/receipt.css`,
  `src/ui/print/ReceiptView.test.tsx`

**Interfaces:**
- Consume: `ReceiptDocument` (Tarea 2), `PaperFormat` (Tarea 1).
- Produce: `ReceiptView({ document, format })`; `RECEIPT_CSS` (texto del CSS, para el iframe) y
  `pageCss(format)` exportados desde `src/ui/print/receipt-styles.ts`.

- [ ] **Paso 1: tests que fallan** — `src/ui/print/ReceiptView.test.tsx`:

```tsx
import { render, screen } from '@testing-library/preact';
import { describe, expect, it } from 'vitest';
import type { ReceiptDocument } from './receipt-document.ts';
import { ReceiptView } from './ReceiptView.tsx';
import { pageCss } from './receipt-styles.ts';

const doc: ReceiptDocument = {
  header: ['Kiosco'],
  title: 'Comprobante',
  marks: ['COPIA'],
  meta: ['Ticket #12'],
  blocks: [
    { kind: 'divider' },
    { kind: 'row', left: 'Total', right: '250,00', bold: true },
    { kind: 'text', text: 'Saldo nuevo: Sin saldo' },
  ],
  footer: ['Gracias'],
};

describe('ReceiptView', () => {
  it('dibuja el encabezado, el título, la marca, las filas y el pie', () => {
    render(<ReceiptView document={doc} format="58mm" />);
    expect(screen.getByRole('heading', { name: 'Comprobante' })).not.toBeNull();
    expect(screen.getByText('Kiosco')).not.toBeNull();
    expect(screen.getByText('COPIA')).not.toBeNull();
    expect(screen.getByText('Ticket #12')).not.toBeNull();
    expect(screen.getByText('250,00')).not.toBeNull();
    expect(screen.getByText('Saldo nuevo: Sin saldo')).not.toBeNull();
    expect(screen.getByText('Gracias')).not.toBeNull();
  });

  it('lleva la clase de su formato', () => {
    const { container } = render(<ReceiptView document={doc} format="80mm" />);
    expect(container.querySelector('.receipt.receipt--80mm')).not.toBeNull();
  });

  it('una fila en negrita lleva su modificador', () => {
    const { container } = render(<ReceiptView document={doc} format="a6" />);
    expect(container.querySelector('.receipt__row--bold')?.textContent).toContain('Total');
  });
});

describe('pageCss', () => {
  it('A6 fija el tamaño; las térmicas solo sacan el margen', () => {
    expect(pageCss('a6')).toContain('size: A6');
    expect(pageCss('58mm')).not.toContain('size');
    expect(pageCss('58mm')).toContain('margin: 0');
  });
});
```

- [ ] **Paso 2:** `pnpm vitest run src/ui/print/ReceiptView.test.tsx` → FALLA.

- [ ] **Paso 3: los estilos** — `src/ui/print/receipt.css` (papel blanco y tinta negra siempre, también
  en el tema oscuro; sin variables de `tokens.css`, porque el iframe no las tiene):

```css
/* El comprobante (#174): mismo dibujo en la pantalla y en el iframe de impresión. */
.receipt {
  box-sizing: border-box;
  background: #fff;
  color: #000;
  font-family: ui-monospace, 'Cascadia Mono', Consolas, 'Courier New', monospace;
  font-variant-numeric: tabular-nums;
  line-height: 1.3;
  display: flex;
  flex-direction: column;
  gap: 1mm;
}
.receipt p,
.receipt h1 {
  margin: 0;
}
.receipt--58mm {
  width: 58mm;
  padding: 3mm 5mm;
  font-size: 9pt;
}
.receipt--80mm {
  width: 80mm;
  padding: 3mm 4mm;
  font-size: 10pt;
}
.receipt--a6 {
  width: 89mm; /* 105 mm menos 8 mm de margen de página por lado */
  padding: 0;
  font-size: 10pt;
}
.receipt__header,
.receipt__footer,
.receipt__mark {
  text-align: center;
}
.receipt__header p:first-child {
  font-weight: bold;
}
.receipt__title {
  font-size: 1.15em;
}
.receipt__mark {
  font-weight: bold;
  letter-spacing: 0.2em;
}
.receipt__divider {
  border: none;
  border-top: 1px dashed #000;
  margin: 1mm 0;
  width: 100%;
}
.receipt__row {
  display: flex;
  justify-content: space-between;
  gap: 2mm;
}
.receipt__row span:last-child {
  white-space: nowrap;
}
.receipt__row--bold,
.receipt__text--bold {
  font-weight: bold;
}
```

  `src/ui/print/receipt-styles.ts`:

```ts
import type { PaperFormat } from '../../storage/printer-config.ts';
import receiptCss from './receipt.css?inline';

/** El CSS del comprobante como texto: el iframe de impresión no ve las hojas de la app. */
export const RECEIPT_CSS: string = receiptCss;

/**
 * La página de cada formato. En las térmicas no se fija `size`: CSS no tiene "ancho fijo y largo
 * libre" (`58mm auto` es inválido y se ignora entero); el papel lo da el driver del rollo y el
 * ticket ya se dibuja en el ancho exacto.
 */
export function pageCss(format: PaperFormat): string {
  return format === 'a6'
    ? '@page { size: A6; margin: 8mm; } body { margin: 0; }'
    : '@page { margin: 0; } body { margin: 0; }';
}
```

- [ ] **Paso 4: el componente** — `src/ui/print/ReceiptView.tsx`:

```tsx
import type { PaperFormat } from '../../storage/printer-config.ts';
import type { ReceiptBlock, ReceiptDocument } from './receipt-document.ts';
import './receipt.css';

function Block({ block }: { block: ReceiptBlock }) {
  switch (block.kind) {
    case 'divider':
      return <hr class="receipt__divider" />;
    case 'row':
      return (
        <div class={block.bold === true ? 'receipt__row receipt__row--bold' : 'receipt__row'}>
          <span>{block.left}</span>
          <span>{block.right}</span>
        </div>
      );
    case 'text':
      return (
        <p class={block.bold === true ? 'receipt__text receipt__text--bold' : 'receipt__text'}>
          {block.text}
        </p>
      );
  }
}

/**
 * Dibuja un `ReceiptDocument` (#174) en el ancho de su formato. Es el mismo componente en la
 * pantalla del comprobante, en la vista previa de `/IMPRESORA` y en el iframe de impresión.
 */
export function ReceiptView({ document, format }: { document: ReceiptDocument; format: PaperFormat }) {
  return (
    <div class={`receipt receipt--${format}`}>
      {document.header.length > 0 && (
        <div class="receipt__header">
          {document.header.map((line, index) => (
            <p key={index}>{line === '' ? ' ' : line}</p>
          ))}
        </div>
      )}
      <h1 class="receipt__title">{document.title}</h1>
      {document.marks.map((mark) => (
        <p key={mark} class="receipt__mark">
          {mark}
        </p>
      ))}
      {document.meta.map((line, index) => (
        <p key={index} class="receipt__meta">
          {line}
        </p>
      ))}
      {document.blocks.map((block, index) => (
        <Block key={index} block={block} />
      ))}
      {document.footer.length > 0 && (
        <div class="receipt__footer">
          {document.footer.map((line, index) => (
            <p key={index}>{line === '' ? ' ' : line}</p>
          ))}
        </div>
      )}
    </div>
  );
}
```

  > Si Vitest no resuelve `?inline` (debería: usa el pipeline de Vite), configurar `css: true` no
  > hace falta; revisar el error antes de cambiar nada en `vite.config.ts`.

- [ ] **Paso 5:** `pnpm vitest run src/ui/print/ReceiptView.test.tsx` → PASA; `pnpm typecheck`
  (el `?inline` lo tipa `vite/client`) y `pnpm build`.
- [ ] **Paso 6: commit** — `feat(impresion): ReceiptView con los formatos 58, 80 y A6 (#174)`.

---

### Tarea 4: el puerto `ReceiptPrinter` y la impresión con el navegador

**Archivos:**
- Crear: `src/ui/print/receipt-printer.ts`, `src/ui/print/browser-printer.tsx`,
  `src/ui/print/browser-printer.test.tsx`, `src/ui/state/printer.ts`

**Interfaces:**
- Consume: `ReceiptView`, `RECEIPT_CSS`, `pageCss` (Tarea 3); `loadPrinterConfig`, `PrinterConfig`
  (Tarea 1).
- Produce:
  - `interface ReceiptPrinter { print(document: ReceiptDocument, format: PaperFormat): Promise<void> }`
  - `createBrowserPrinter(options?: { printWindow?: (frameWindow: Window) => void; timeoutMs?: number }): ReceiptPrinter`
  - `src/ui/state/printer.ts`: `printerConfigSignal`, `getReceiptPrinter()`, `setReceiptPrinter(printer)`
    (para los tests)

- [ ] **Paso 1: tests que fallan** — `src/ui/print/browser-printer.test.tsx`:

```tsx
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReceiptDocument } from './receipt-document.ts';
import { createBrowserPrinter } from './browser-printer.tsx';

const doc: ReceiptDocument = {
  header: ['Kiosco'],
  title: 'Comprobante',
  marks: [],
  meta: ['Ticket #1'],
  blocks: [],
  footer: [],
};

afterEach(() => {
  vi.useRealTimers();
});

describe('createBrowserPrinter', () => {
  it('imprime el comprobante en un iframe aparte y lo saca con afterprint', async () => {
    const printed: string[] = [];
    const printer = createBrowserPrinter({
      printWindow: (frameWindow) => {
        printed.push(frameWindow.document.body.textContent ?? '');
        expect(frameWindow.document.head.querySelector('style')?.textContent).toContain('@page');
        frameWindow.dispatchEvent(new Event('afterprint'));
      },
    });

    await printer.print(doc, '58mm');

    expect(printed).toHaveLength(1);
    expect(printed[0]).toContain('Kiosco');
    expect(printed[0]).toContain('Ticket #1');
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('si el navegador no dispara afterprint, saca el iframe igual al vencer el tope', async () => {
    vi.useFakeTimers();
    const printer = createBrowserPrinter({ printWindow: () => undefined, timeoutMs: 1000 });

    const done = printer.print(doc, 'a6');
    expect(document.querySelector('iframe')).not.toBeNull();
    await vi.advanceTimersByTimeAsync(1000);
    await done;

    expect(document.querySelector('iframe')).toBeNull();
  });
});
```

- [ ] **Paso 2:** `pnpm vitest run src/ui/print/browser-printer.test.tsx` → FALLA.

- [ ] **Paso 3: el puerto** — `src/ui/print/receipt-printer.ts`:

```ts
import type { PaperFormat } from '../../storage/printer-config.ts';
import type { ReceiptDocument } from './receipt-document.ts';

/**
 * Puerto de impresión (#174). La primera implementación es `window.print()` en un iframe
 * (`browser-printer.tsx`); ESC/POS directo (#188) va a ser otra. Vive en `ui/` y no en `domain/`
 * porque el documento ya es presentación (textos formateados).
 */
export interface ReceiptPrinter {
  /** Se resuelve cuando el navegador terminó (imprimió o se canceló el diálogo). */
  print(document: ReceiptDocument, format: PaperFormat): Promise<void>;
}
```

- [ ] **Paso 4: la impresión con el navegador** — `src/ui/print/browser-printer.tsx`:

```tsx
import { render } from 'preact';
import type { PaperFormat } from '../../storage/printer-config.ts';
import type { ReceiptDocument } from './receipt-document.ts';
import type { ReceiptPrinter } from './receipt-printer.ts';
import { pageCss, RECEIPT_CSS } from './receipt-styles.ts';
import { ReceiptView } from './ReceiptView.tsx';

/** Red por si un navegador no dispara `afterprint`: el iframe no queda colgado para siempre. */
const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * `window.print()` sobre un iframe oculto (#174): un documento aparte que solo tiene el
 * comprobante y su `@page`, así el papel no hereda la escala de texto, el tema ni ningún estilo de
 * la app, y se puede imprimir sin pasar por la pantalla del comprobante. `printWindow` se inyecta
 * en los tests (jsdom no implementa `print`).
 */
export function createBrowserPrinter(
  options: { printWindow?: (frameWindow: Window) => void; timeoutMs?: number } = {},
): ReceiptPrinter {
  const printWindow = options.printWindow ?? ((frameWindow: Window) => frameWindow.print());
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    print(document: ReceiptDocument, format: PaperFormat): Promise<void> {
      const iframe = window.document.createElement('iframe');
      iframe.setAttribute('aria-hidden', 'true');
      iframe.tabIndex = -1;
      Object.assign(iframe.style, {
        position: 'fixed',
        right: '0',
        bottom: '0',
        width: '0',
        height: '0',
        border: '0',
      });
      window.document.body.appendChild(iframe);

      const frameWindow = iframe.contentWindow;
      const frameDocument = iframe.contentDocument;
      if (frameWindow === null || frameDocument === null) {
        // Invariante del navegador: un iframe recién insertado siempre tiene su documento.
        iframe.remove();
        throw new Error('El iframe de impresión no tiene documento');
      }
      frameDocument.title = document.title;
      const style = frameDocument.createElement('style');
      style.textContent = `${RECEIPT_CSS}\n${pageCss(format)}`;
      frameDocument.head.appendChild(style);
      render(<ReceiptView document={document} format={format} />, frameDocument.body);

      return new Promise((resolve) => {
        let finished = false;
        const finish = () => {
          if (finished) return;
          finished = true;
          clearTimeout(timer);
          render(null, frameDocument.body);
          iframe.remove();
          resolve();
        };
        const timer = setTimeout(finish, timeoutMs);
        frameWindow.addEventListener('afterprint', finish);
        printWindow(frameWindow);
      });
    },
  };
}
```

  > El parámetro `document` tapa al global: por eso el código usa `window.document` para el DOM de
  > la app. Si el lint lo marca (`no-shadow`), renombrar el parámetro a `receipt`.

- [ ] **Paso 5: el estado** — `src/ui/state/printer.ts`:

```ts
import { signal } from '@preact/signals';
import { loadPrinterConfig, type PrinterConfig } from '../../storage/printer-config.ts';
import { createBrowserPrinter } from '../print/browser-printer.tsx';
import type { ReceiptPrinter } from '../print/receipt-printer.ts';

/** La config de impresión en memoria (#174): se lee al cargar y se actualiza al guardar en `/IMPRESORA`. */
export const printerConfigSignal = signal<PrinterConfig>(loadPrinterConfig());

let receiptPrinter: ReceiptPrinter = createBrowserPrinter();

export function getReceiptPrinter(): ReceiptPrinter {
  return receiptPrinter;
}

/** Para los tests: una impresora falsa que registra lo que se imprime. */
export function setReceiptPrinter(printer: ReceiptPrinter): void {
  receiptPrinter = printer;
}
```

- [ ] **Paso 6:** `pnpm vitest run src/ui/print/browser-printer.test.tsx` → PASA; `pnpm lint &&
  pnpm typecheck`.
- [ ] **Paso 7: commit** — `feat(impresion): puerto ReceiptPrinter e impresión en un iframe (#174)`.

---

### Tarea 5: el origen del comprobante (`ReceiptSource`)

**Archivos:**
- Crear: `src/ui/print/resolve-receipt.ts`, `src/ui/print/resolve-receipt.test.ts`

**Interfaces:**
- Consume: `saleReceiptDocument`, `collectionReceiptDocument`, `sampleReceiptDocument`,
  `ReceiptFormatters` (Tarea 2); `PrinterConfig` (Tarea 1); `lineLabel`
  (`ui/components/document-rows.tsx`); `formatMoney`, `formatQuantity`, `resolveLocale`
  (`ui/format.ts`); `formatBalance` (`ui/format-balance.ts`).
- Produce:
  - `type ReceiptSource = { kind: 'sale'; sale: Sale; copy: boolean } | { kind: 'collection'; payment: CustomerPayment; customerName: string; balances?: { before: number | undefined; after: number }; copy: boolean }`
  - `receiptDocumentFor(source, config): ReceiptDocument`
  - `sampleDocumentFor(config): ReceiptDocument`

- [ ] **Paso 1: tests que fallan** — `src/ui/print/resolve-receipt.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_PRINTER_CONFIG } from '../../storage/printer-config.ts';
import { setCatalogRepository } from '../state/catalog.ts';
import { receiptDocumentFor } from './resolve-receipt.ts';

beforeEach(() => {
  setCatalogRepository({
    search: () => [],
    findByBarcodeOrSku: () => undefined,
    searchByCode: () => [],
    getProduct: () => ({
      id: 'p1',
      sku: 'SKU-1',
      barcodes: [],
      name: 'Arroz 1kg',
      price: 100,
      taxRate: 0.21,
      category: 'almacen',
      tracksStock: true,
    }),
    getStock: () => Promise.resolve(undefined),
  });
});

describe('receiptDocumentFor', () => {
  it('resuelve el nombre del producto y usa el encabezado de la config', () => {
    const doc = receiptDocumentFor(
      {
        kind: 'sale',
        copy: false,
        sale: {
          id: 's1',
          lines: [{ kind: 'product', productId: 'p1', qty: 2, unitPrice: 100 }],
          payments: [{ method: 'cash', amount: 200 }],
          total: 200,
          status: 'closed',
          createdAt: '2026-10-02T12:00:00.000Z',
        },
      },
      { ...DEFAULT_PRINTER_CONFIG, header: 'Kiosco' },
    );
    expect(doc.header).toEqual(['Kiosco']);
    expect(doc.blocks.some((b) => b.kind === 'row' && b.left.endsWith('Arroz 1kg'))).toBe(true);
  });

  it('una cobranza copia no lleva saldos aunque vengan', () => {
    const doc = receiptDocumentFor(
      {
        kind: 'collection',
        copy: true,
        customerName: 'Ana',
        balances: { before: 0, after: -500 },
        payment: {
          id: 'pay-1',
          customerId: 'c1',
          payments: [{ method: 'cash', amount: 500 }],
          total: 500,
          createdAt: '2026-10-02T13:00:00.000Z',
        },
      },
      DEFAULT_PRINTER_CONFIG,
    );
    expect(doc.marks).toEqual(['COPIA']);
    expect(doc.blocks.some((b) => b.kind === 'text')).toBe(false);
  });
});
```

- [ ] **Paso 2:** `pnpm vitest run src/ui/print/resolve-receipt.test.ts` → FALLA.

- [ ] **Paso 3: implementación** — `src/ui/print/resolve-receipt.ts`:

```ts
import type { CustomerPayment } from '../../domain/customer-payment.ts';
import type { Sale } from '../../domain/sale.ts';
import type { PrinterConfig } from '../../storage/printer-config.ts';
import { lineLabel } from '../components/document-rows.tsx';
import { formatBalance } from '../format-balance.ts';
import { formatMoney, formatQuantity, resolveLocale } from '../format.ts';
import {
  collectionReceiptDocument,
  saleReceiptDocument,
  sampleReceiptDocument,
  type ReceiptDocument,
  type ReceiptFormatters,
} from './receipt-document.ts';

/**
 * De qué es un comprobante (#174): lo que se guarda al cerrar y al elegir una fila de `/RESUMEN`.
 * El documento se arma recién al mostrarlo o imprimirlo; los saldos de una cobranza viajan acá
 * porque después no se pueden recalcular.
 */
export type ReceiptSource =
  | { kind: 'sale'; sale: Sale; copy: boolean }
  | {
      kind: 'collection';
      payment: CustomerPayment;
      customerName: string;
      balances?: { before: number | undefined; after: number };
      copy: boolean;
    };

const formatters: ReceiptFormatters = {
  money: formatMoney,
  quantity: formatQuantity,
  dateTime: (isoDate) => new Date(isoDate).toLocaleString(resolveLocale()),
  balance: formatBalance,
};

export function receiptDocumentFor(source: ReceiptSource, config: PrinterConfig): ReceiptDocument {
  const text = { header: config.header, footer: config.footer };
  if (source.kind === 'sale') {
    return saleReceiptDocument({
      sale: source.sale,
      lineNames: source.sale.lines.map(lineLabel),
      copy: source.copy,
      text,
      format: formatters,
    });
  }
  return collectionReceiptDocument({
    payment: source.payment,
    customerName: source.customerName,
    // Una copia nunca muestra saldos: los de ese momento no están guardados.
    ...(source.balances !== undefined && !source.copy ? { balances: source.balances } : {}),
    copy: source.copy,
    text,
    format: formatters,
  });
}

/** El ticket de ejemplo con el encabezado y el pie de una config (la del formulario, sin guardar). */
export function sampleDocumentFor(config: PrinterConfig): ReceiptDocument {
  return sampleReceiptDocument({ header: config.header, footer: config.footer }, formatters);
}
```

  > `lineLabel` vive en un `.tsx` de componentes pero es una función pura sobre el catálogo; si el
  > lint marca la importación cruzada, moverlo a `ui/line-label.ts` y reexportarlo desde
  > `document-rows.tsx` en el mismo commit.

- [ ] **Paso 4:** `pnpm vitest run src/ui/print/resolve-receipt.test.ts` → PASA.
- [ ] **Paso 5: commit** — `feat(impresion): ReceiptSource y receiptDocumentFor (#174)`.

---

### Tarea 6: al cobrar y la pantalla del comprobante

**Archivos:**
- Crear: `src/ui/print/after-close.ts`, `src/ui/print/after-close.test.ts`
- Modificar: `src/ui/state/receipt.ts`, `src/ui/screens/receipt-screen.tsx`,
  `src/ui/screens/receipt-screen.test.tsx`, `src/ui/keyboard/checkout-controller.ts:245-254`,
  `src/ui/keyboard/checkout-controller.test.ts`, `src/ui/keyboard/collection-controller.ts:109-113`,
  `src/ui/keyboard/collection-controller.test.ts`
- Borrar: `src/ui/screens/receipt-screen.css`

**Interfaces:**
- Consume: `ReceiptSource`, `receiptDocumentFor` (Tarea 5); `printerConfigSignal`,
  `getReceiptPrinter`, `setReceiptPrinter` (Tarea 4); `effectiveCheckoutAction`, `paperFormat`
  (Tarea 1); `ReceiptView` (Tarea 3).
- Produce:
  - `src/ui/state/receipt.ts`: `type ReceiptReturn = 'sale' | 'cash-summary'`,
    `receiptSignal: Signal<{ source: ReceiptSource; returnTo: ReceiptReturn } | null>`
  - `src/ui/print/after-close.ts`: `showOrPrintReceipt(source)`, `printReceipt(source)`,
    `reprintReceipt(source)`

- [ ] **Paso 1: tests que fallan** — `src/ui/print/after-close.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_PRINTER_CONFIG, type PrinterConfig } from '../../storage/printer-config.ts';
import { printerConfigSignal, setReceiptPrinter } from '../state/printer.ts';
import { receiptSignal } from '../state/receipt.ts';
import { activeScreenSignal } from '../state/screen.ts';
import { reprintReceipt, showOrPrintReceipt } from './after-close.ts';
import type { ReceiptDocument } from './receipt-document.ts';
import type { ReceiptSource } from './resolve-receipt.ts';

const printed: { document: ReceiptDocument; format: string }[] = [];
const source: ReceiptSource = {
  kind: 'sale',
  copy: false,
  sale: {
    id: 's1',
    lines: [{ kind: 'freeform', description: 'Bolsa', qty: 1, unitPrice: 50 }],
    payments: [{ method: 'cash', amount: 50 }],
    total: 50,
    status: 'closed',
    createdAt: '2026-10-02T12:00:00.000Z',
  },
};

function useConfig(config: Partial<PrinterConfig>): void {
  printerConfigSignal.value = { ...DEFAULT_PRINTER_CONFIG, ...config };
}

beforeEach(() => {
  printed.length = 0;
  setReceiptPrinter({
    print: (document, format) => {
      printed.push({ document, format });
      return Promise.resolve();
    },
  });
  receiptSignal.value = null;
  activeScreenSignal.value = 'checkout';
});

afterEach(() => {
  printerConfigSignal.value = DEFAULT_PRINTER_CONFIG;
});

describe('showOrPrintReceipt', () => {
  it('Imprimir: vuelve a la venta e imprime en el formato', () => {
    useConfig({ format: '58mm', onCheckout: 'print' });
    showOrPrintReceipt(source);
    expect(activeScreenSignal.value).toBe('sale');
    expect(receiptSignal.value).toBeNull();
    expect(printed.map((p) => p.format)).toEqual(['58mm']);
  });

  it('Mostrar: va al comprobante sin imprimir', () => {
    useConfig({ format: '80mm', onCheckout: 'show' });
    showOrPrintReceipt(source);
    expect(activeScreenSignal.value).toBe('receipt');
    expect(receiptSignal.value).toEqual({ source, returnTo: 'sale' });
    expect(printed).toEqual([]);
  });

  it('Nada: vuelve directo a la venta', () => {
    useConfig({ format: '80mm', onCheckout: 'skip' });
    showOrPrintReceipt(source);
    expect(activeScreenSignal.value).toBe('sale');
    expect(receiptSignal.value).toBeNull();
    expect(printed).toEqual([]);
  });

  it('"No imprimir" con "Imprimir" muestra el comprobante', () => {
    useConfig({ format: 'none', onCheckout: 'print' });
    showOrPrintReceipt(source);
    expect(activeScreenSignal.value).toBe('receipt');
  });
});

describe('reprintReceipt', () => {
  it('con papel imprime la copia y no cambia de pantalla', () => {
    useConfig({ format: 'a6' });
    activeScreenSignal.value = 'cash-summary';
    reprintReceipt({ ...source, copy: true });
    expect(activeScreenSignal.value).toBe('cash-summary');
    expect(printed[0]?.document.marks).toEqual(['COPIA']);
  });

  it('con "No imprimir" abre el comprobante y vuelve a /RESUMEN', () => {
    useConfig({ format: 'none' });
    activeScreenSignal.value = 'cash-summary';
    reprintReceipt({ ...source, copy: true });
    expect(activeScreenSignal.value).toBe('receipt');
    expect(receiptSignal.value?.returnTo).toBe('cash-summary');
    expect(printed).toEqual([]);
  });
});
```

- [ ] **Paso 2:** `pnpm vitest run src/ui/print/after-close.test.ts` → FALLA.

- [ ] **Paso 3: el estado** — reemplazar `src/ui/state/receipt.ts` entero:

```ts
import { signal } from '@preact/signals';
import type { ReceiptSource } from '../print/resolve-receipt.ts';

/** A dónde vuelve Esc desde el comprobante: la venta, o `/RESUMEN` al ver una copia (#174). */
export type ReceiptReturn = 'sale' | 'cash-summary';

/** El comprobante en pantalla: de qué es y a dónde se vuelve. Un solo signal desde #174. */
export const receiptSignal = signal<{ source: ReceiptSource; returnTo: ReceiptReturn } | null>(
  null,
);
```

- [ ] **Paso 4: al cobrar** — `src/ui/print/after-close.ts`:

```ts
import { effectiveCheckoutAction, paperFormat } from '../../storage/printer-config.ts';
import { getReceiptPrinter, printerConfigSignal } from '../state/printer.ts';
import { receiptSignal } from '../state/receipt.ts';
import { activeScreenSignal } from '../state/screen.ts';
import { receiptDocumentFor, type ReceiptSource } from './resolve-receipt.ts';

/** Manda a imprimir sin esperar: la venta ya está registrada y se sigue operando. */
export function printReceipt(source: ReceiptSource): void {
  const config = printerConfigSignal.value;
  void getReceiptPrinter().print(receiptDocumentFor(source, config), paperFormat(config.format));
}

/**
 * Lo que pasa después de registrar una venta o una cobranza (#174), según "Al cobrar" de
 * `/IMPRESORA`: imprimir y seguir, mostrar el comprobante, o volver directo a la venta.
 */
export function showOrPrintReceipt(source: ReceiptSource): void {
  switch (effectiveCheckoutAction(printerConfigSignal.value)) {
    case 'print':
      receiptSignal.value = null;
      activeScreenSignal.value = 'sale';
      printReceipt(source);
      return;
    case 'show':
      receiptSignal.value = { source, returnTo: 'sale' };
      activeScreenSignal.value = 'receipt';
      return;
    case 'skip':
      receiptSignal.value = null;
      activeScreenSignal.value = 'sale';
      return;
  }
}

/** Reimprimir desde `/RESUMEN`: con papel imprime ahí mismo; sin papel, muestra la copia. */
export function reprintReceipt(source: ReceiptSource): void {
  if (printerConfigSignal.value.format === 'none') {
    receiptSignal.value = { source, returnTo: 'cash-summary' };
    activeScreenSignal.value = 'receipt';
    return;
  }
  printReceipt(source);
}
```

- [ ] **Paso 5:** `pnpm vitest run src/ui/print/after-close.test.ts` → PASA.

- [ ] **Paso 6: la pantalla** — reemplazar `src/ui/screens/receipt-screen.tsx` entero y borrar
  `src/ui/screens/receipt-screen.css`:

```tsx
import type { TargetedKeyboardEvent } from 'preact';
import { paperFormat } from '../../storage/printer-config.ts';
import { useFocusOnMount } from '../hooks/use-focus-on-mount.ts';
import { keepFocusOnMouseDown } from '../hooks/use-mouse-keeps-focus.ts';
import { printReceipt } from '../print/after-close.ts';
import { ReceiptView } from '../print/ReceiptView.tsx';
import { receiptDocumentFor } from '../print/resolve-receipt.ts';
import { printerConfigSignal } from '../state/printer.ts';
import { receiptSignal } from '../state/receipt.ts';
import { activeScreenSignal } from '../state/screen.ts';

function closeReceipt(): void {
  const returnTo = receiptSignal.value?.returnTo ?? 'sale';
  receiptSignal.value = null;
  activeScreenSignal.value = returnTo;
}

/**
 * El comprobante de la venta recién cerrada, de la cobranza recién registrada (#101) o de una copia
 * pedida desde `/RESUMEN` (#174), dibujado en el formato de `/IMPRESORA`. Enter imprime si hay
 * papel; Esc vuelve a la venta o a `/RESUMEN`.
 */
export function ReceiptScreen() {
  const containerRef = useFocusOnMount<HTMLDivElement>();
  const current = receiptSignal.value;
  const config = printerConfigSignal.value;
  const canPrint = config.format !== 'none';

  if (current === null) {
    // Invariante: no se llega acá sin un comprobante; si pasa, se vuelve a la venta.
    activeScreenSignal.value = 'sale';
    return null;
  }

  const print = () => {
    printReceipt(current.source);
  };

  const handleKeyDown = (event: TargetedKeyboardEvent<HTMLDivElement>) => {
    // Un botón enfocado con Tab se activa solo con Enter (nativo): no duplicar el atajo.
    if (event.key === 'Enter' && event.target instanceof HTMLButtonElement) {
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (canPrint) print();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      closeReceipt();
    }
  };

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      // Teclado + mouse (Etapa 2 de #94): ver ui/hooks/use-mouse-keeps-focus.ts.
      onMouseDown={keepFocusOnMouseDown}
      style={{
        height: 'var(--app-height)',
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: 'var(--space-4)',
        gap: 'var(--space-4)',
        background: 'var(--color-bg)',
        color: 'var(--color-text)',
        fontFamily: 'var(--font-sans)',
      }}
    >
      <div style={{ boxShadow: 'var(--shadow-card)', border: '1px solid var(--color-border)' }}>
        <ReceiptView
          document={receiptDocumentFor(current.source, config)}
          format={paperFormat(config.format)}
        />
      </div>
      <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
        {canPrint && (
          <button type="button" class="btn btn-primary" onClick={print}>
            Imprimir (Enter)
          </button>
        )}
        <button type="button" class="btn" onClick={closeReceipt}>
          Continuar (Esc)
        </button>
      </div>
    </div>
  );
}
```

  > La tarjeta de pantalla tenía `padding` propio y el ancho `scaledPx(360)`; ahora el ancho es el
  > del papel (mm) y el `padding` lo pone `.receipt--*`. Con A6 en una pantalla chica (600 px de
  > ancho mínimo) entra: 89 mm ≈ 336 px.

- [ ] **Paso 7: los tests de la pantalla** — reescribir `src/ui/screens/receipt-screen.test.tsx`
  sobre `receiptSignal`. Mantener los casos que ya existen (número de ticket, líneas/total/medio
  sin "Pago" ni "Vuelto", Enter imprime, Esc vuelve, el recibo de cobranza con sus saldos) y sumar:

```tsx
// En el beforeEach, en lugar de receiptSaleSignal/receiptCollectionSignal:
receiptSignal.value = { source: { kind: 'sale', sale: SALE, copy: false }, returnTo: 'sale' };
printerConfigSignal.value = DEFAULT_PRINTER_CONFIG;
setReceiptPrinter({ print: (document, format) => { printed.push({ document, format }); return Promise.resolve(); } });

it('Enter imprime con la impresora configurada, en su formato', () => {
  printerConfigSignal.value = { ...DEFAULT_PRINTER_CONFIG, format: '80mm' };
  render(<ReceiptScreen />);
  fireEvent.keyDown(screen.getByRole('heading', { name: 'Comprobante' }), { key: 'Enter' });
  expect(printed.map((p) => p.format)).toEqual(['80mm']);
});

it('con "No imprimir" no hay botón Imprimir y Enter no hace nada', () => {
  printerConfigSignal.value = { ...DEFAULT_PRINTER_CONFIG, format: 'none' };
  render(<ReceiptScreen />);
  expect(screen.queryByText('Imprimir (Enter)')).toBeNull();
  fireEvent.keyDown(screen.getByRole('heading', { name: 'Comprobante' }), { key: 'Enter' });
  expect(printed).toEqual([]);
});

it('Esc vuelve a /RESUMEN si se abrió desde ahí', () => {
  receiptSignal.value = { source: { kind: 'sale', sale: SALE, copy: true }, returnTo: 'cash-summary' };
  render(<ReceiptScreen />);
  fireEvent.keyDown(screen.getByRole('heading', { name: 'Comprobante' }), { key: 'Escape' });
  expect(activeScreenSignal.value).toBe('cash-summary');
  expect(receiptSignal.value).toBeNull();
});
```

  (`SALE` es la venta que hoy arma el `beforeEach`, sacada a una constante; el caso de "Enter
  dispara window.print()" se reemplaza por el de la impresora falsa. Los `keyDown` burbujean del
  heading al contenedor.)

- [ ] **Paso 8: Cobro y cobranza** — en `checkout-controller.ts`, el final de la confirmación pasa a:

```ts
  await refreshStockSnapshot();
  await refreshCustomerBalances();
  cartSignal.value = { lines: [] };
  // Sin esto la selección seguía apuntando a una línea que ya no existe, y el
  // próximo código de barras (todo dígitos) se tomaba como su cantidad.
  cartSelectionIndexSignal.value = null;
  resetAttachedCustomer();
  resetCheckout();
  showOrPrintReceipt({ kind: 'sale', sale: result.value, copy: false });
}
```

  y en `collection-controller.ts`:

```ts
  await refreshCustomerBalances();
  const record = result.value;
  resetAttachedCustomer();
  resetCollection();
  showOrPrintReceipt({
    kind: 'collection',
    payment: record.payment,
    customerName: customer.name,
    balances: { before: record.balanceBefore, after: record.balanceAfter },
    copy: false,
  });
}
```

  (imports: sacar `receiptSaleSignal`/`receiptCollectionSignal` y `activeScreenSignal` si queda sin
  uso; sumar `showOrPrintReceipt` de `../print/after-close.ts`).

- [ ] **Paso 9: migrar sus tests** — en `checkout-controller.test.ts` y
  `collection-controller.test.ts`, cambiar `receiptSaleSignal`/`receiptCollectionSignal` por
  `receiptSignal` (en el `beforeEach`, `receiptSignal.value = null`) y leer el origen con un helper:

```ts
function receiptSale() {
  const source = receiptSignal.value?.source;
  return source?.kind === 'sale' ? source.sale : null;
}
// receiptSaleSignal.value?.payments  →  receiptSale()?.payments
// receiptSaleSignal.value  (toBeNull) →  receiptSale()  (toBeNull)
```

```ts
function receiptCollection() {
  const source = receiptSignal.value?.source;
  return source?.kind === 'collection' ? source : null;
}
// receipt?.payment.receipt.number → receiptCollection()?.payment.receipt?.number
// receipt?.customerName           → receiptCollection()?.customerName
// receipt?.balanceAfter           → receiptCollection()?.balances?.after
```

  Sumar en `checkout-controller.test.ts` un caso con "Al cobrar: Imprimir":

```ts
it('con "Al cobrar: Imprimir", registra, vuelve a la venta e imprime', async () => {
  const printed: string[] = [];
  setReceiptPrinter({ print: (_document, format) => { printed.push(format); return Promise.resolve(); } });
  printerConfigSignal.value = { ...DEFAULT_PRINTER_CONFIG, format: '58mm', onCheckout: 'print' };
  checkoutBuffersSignal.value = { ...emptyBuffers(), cash: '200' };

  await submitCheckout();

  expect(activeScreenSignal.value).toBe('sale');
  expect(printed).toEqual(['58mm']);
  expect(await db.sales.count()).toBe(1);
  printerConfigSignal.value = DEFAULT_PRINTER_CONFIG;
});
```

  > Usar la misma forma de disparar la confirmación que los casos vecinos del archivo (si confirman
  > con `submitCheckout()` sin argumentos, así; si no, copiar la de ellos).

- [ ] **Paso 10:** `pnpm lint && pnpm typecheck && pnpm test && pnpm build` → todo verde.
- [ ] **Paso 11: commit** — `feat(impresion): "Al cobrar" y el comprobante en el formato elegido (#174)`.

---

### Tarea 7: `/IMPRESORA`

**Archivos:**
- Crear: `src/ui/keyboard/printer-form-model.ts`, `src/ui/keyboard/printer-form-model.test.ts`,
  `src/ui/keyboard/printer-controller.ts`, `src/ui/keyboard/printer-controller.test.ts`,
  `src/ui/screens/printer-screen.tsx`, `src/ui/screens/printer-screen.test.tsx`
- Modificar: `src/ui/state/printer.ts` (estado del formulario), `src/ui/state/screen.ts`
  (`'printer'`), `src/ui/app.tsx` (ruta), `src/ui/keyboard/commands.ts` (`CORE_COMMANDS`),
  `src/ui/keyboard/command-bar-controller.ts` (`runCommand`)

**Interfaces:**
- Consume: `PrinterConfig`, `savePrinterConfig`, `paperFormat` (Tarea 1); `sampleDocumentFor`
  (Tarea 5); `getReceiptPrinter`, `printerConfigSignal` (Tarea 4); `ReceiptView` (Tarea 3).
- Produce: `enterPrinterScreen()`, `cancelPrinterScreen()`, `savePrinterForm()`,
  `printTestReceipt()`, `choosePrinterFormat(format)`, `choosePrinterCheckout(action)`,
  `setPrinterHeader(text)`, `setPrinterFooter(text)`; `printerFormSignal`, `printerErrorSignal`.

- [ ] **Paso 1: tests del modelo** — `src/ui/keyboard/printer-form-model.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_PRINTER_CONFIG } from '../../storage/printer-config.ts';
import { checkoutOptions, stepOption, withFormat } from './printer-form-model.ts';

describe('printer-form-model', () => {
  it('sin papel no se ofrece "Imprimir"', () => {
    expect(checkoutOptions('none')).toEqual(['show', 'skip']);
    expect(checkoutOptions('58mm')).toEqual(['print', 'show', 'skip']);
  });

  it('pasar a "No imprimir" con "Imprimir" elegido cambia a mostrar el comprobante', () => {
    const form = { ...DEFAULT_PRINTER_CONFIG, format: '80mm', onCheckout: 'print' } as const;
    expect(withFormat(form, 'none')).toEqual({ ...form, format: 'none', onCheckout: 'show' });
    expect(withFormat(form, '58mm')).toEqual({ ...form, format: '58mm' });
  });

  it('↑/↓ se mueven dentro de las opciones sin dar la vuelta', () => {
    expect(stepOption(['a', 'b', 'c'], 'b', 1)).toBe('c');
    expect(stepOption(['a', 'b', 'c'], 'c', 1)).toBe('c');
    expect(stepOption(['a', 'b', 'c'], 'a', -1)).toBe('a');
  });
});
```

- [ ] **Paso 2:** `pnpm vitest run src/ui/keyboard/printer-form-model.test.ts` → FALLA.

- [ ] **Paso 3: el modelo** — `src/ui/keyboard/printer-form-model.ts`:

```ts
import {
  PRINT_FORMATS,
  type CheckoutAction,
  type PrintFormat,
  type PrinterConfig,
} from '../../storage/printer-config.ts';

/** Modelo puro del formulario de `/IMPRESORA` (#174). */
export const FORMAT_OPTIONS: readonly PrintFormat[] = PRINT_FORMATS;

export const FORMAT_LABELS: Record<PrintFormat, string> = {
  none: 'No imprimir',
  '58mm': '58 mm',
  '80mm': '80 mm',
  a6: 'A6',
};

export const CHECKOUT_LABELS: Record<CheckoutAction, string> = {
  print: 'Imprimir',
  show: 'Mostrar el comprobante',
  skip: 'Nada',
};

/** Sin papel no hay "Imprimir". */
export function checkoutOptions(format: PrintFormat): CheckoutAction[] {
  return format === 'none' ? ['show', 'skip'] : ['print', 'show', 'skip'];
}

export function withFormat(form: PrinterConfig, format: PrintFormat): PrinterConfig {
  const onCheckout = format === 'none' && form.onCheckout === 'print' ? 'show' : form.onCheckout;
  return { ...form, format, onCheckout };
}

/** La opción vecina en un grupo tipo radio, sin dar la vuelta. */
export function stepOption<T>(options: readonly T[], current: T, direction: 1 | -1): T {
  const index = options.indexOf(current) + direction;
  return options[Math.max(0, Math.min(index, options.length - 1))] ?? current;
}
```

- [ ] **Paso 4:** el test del modelo → PASA.

- [ ] **Paso 5: tests del controller** — `src/ui/keyboard/printer-controller.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_PRINTER_CONFIG, loadPrinterConfig } from '../../storage/printer-config.ts';
import {
  printerConfigSignal,
  printerErrorSignal,
  printerFormSignal,
  setReceiptPrinter,
} from '../state/printer.ts';
import { activeScreenSignal } from '../state/screen.ts';
import {
  cancelPrinterScreen,
  choosePrinterFormat,
  enterPrinterScreen,
  printTestReceipt,
  savePrinterForm,
  setPrinterHeader,
} from './printer-controller.ts';

const printed: string[] = [];

beforeEach(() => {
  printed.length = 0;
  setReceiptPrinter({
    print: (document, format) => {
      printed.push(`${format}:${document.marks.join(',')}`);
      return Promise.resolve();
    },
  });
  printerConfigSignal.value = DEFAULT_PRINTER_CONFIG;
  activeScreenSignal.value = 'sale';
});

afterEach(() => {
  localStorage.clear();
  printerConfigSignal.value = DEFAULT_PRINTER_CONFIG;
});

describe('printer-controller', () => {
  it('entra con la config actual en el formulario', () => {
    printerConfigSignal.value = { ...DEFAULT_PRINTER_CONFIG, format: '80mm' };
    enterPrinterScreen();
    expect(activeScreenSignal.value).toBe('printer');
    expect(printerFormSignal.value.format).toBe('80mm');
    expect(printerErrorSignal.value).toBeNull();
  });

  it('guardar persiste, actualiza la config en memoria y vuelve a la venta', () => {
    enterPrinterScreen();
    choosePrinterFormat('58mm');
    setPrinterHeader('Kiosco');
    savePrinterForm();
    expect(loadPrinterConfig()).toMatchObject({ format: '58mm', header: 'Kiosco' });
    expect(printerConfigSignal.value.format).toBe('58mm');
    expect(activeScreenSignal.value).toBe('sale');
  });

  it('cancelar no guarda nada', () => {
    enterPrinterScreen();
    choosePrinterFormat('58mm');
    cancelPrinterScreen();
    expect(loadPrinterConfig()).toEqual(DEFAULT_PRINTER_CONFIG);
    expect(printerConfigSignal.value).toEqual(DEFAULT_PRINTER_CONFIG);
    expect(activeScreenSignal.value).toBe('sale');
  });

  it('la prueba imprime el ejemplo con lo que está en pantalla, sin guardar', async () => {
    enterPrinterScreen();
    choosePrinterFormat('80mm');
    await printTestReceipt();
    expect(printed).toEqual(['80mm:PRUEBA']);
    expect(loadPrinterConfig()).toEqual(DEFAULT_PRINTER_CONFIG);
  });

  it('con "No imprimir" la prueba no hace nada', async () => {
    enterPrinterScreen();
    choosePrinterFormat('none');
    await printTestReceipt();
    expect(printed).toEqual([]);
  });
});
```

- [ ] **Paso 6:** → FALLA.

- [ ] **Paso 7: estado y controller** — sumar a `src/ui/state/printer.ts`:

```ts
/** El formulario de `/IMPRESORA`: una copia de la config que se edita sin guardar. */
export const printerFormSignal = signal<PrinterConfig>(printerConfigSignal.value);
export const printerErrorSignal = signal<string | null>(null);
```

  `src/ui/keyboard/printer-controller.ts`:

```ts
import {
  savePrinterConfig,
  type CheckoutAction,
  type PrintFormat,
} from '../../storage/printer-config.ts';
import { describeError } from '../errors.ts';
import { sampleDocumentFor } from '../print/resolve-receipt.ts';
import {
  getReceiptPrinter,
  printerConfigSignal,
  printerErrorSignal,
  printerFormSignal,
} from '../state/printer.ts';
import { activeScreenSignal } from '../state/screen.ts';
import { withFormat } from './printer-form-model.ts';

/** `/IMPRESORA` (#174): edita una copia de la config; solo Guardar la persiste. */
export function enterPrinterScreen(): void {
  printerFormSignal.value = printerConfigSignal.value;
  printerErrorSignal.value = null;
  activeScreenSignal.value = 'printer';
}

export function cancelPrinterScreen(): void {
  printerErrorSignal.value = null;
  activeScreenSignal.value = 'sale';
}

export function choosePrinterFormat(format: PrintFormat): void {
  printerFormSignal.value = withFormat(printerFormSignal.value, format);
}

export function choosePrinterCheckout(onCheckout: CheckoutAction): void {
  printerFormSignal.value = { ...printerFormSignal.value, onCheckout };
}

export function setPrinterHeader(header: string): void {
  printerFormSignal.value = { ...printerFormSignal.value, header };
}

export function setPrinterFooter(footer: string): void {
  printerFormSignal.value = { ...printerFormSignal.value, footer };
}

export function savePrinterForm(): void {
  const form = printerFormSignal.value;
  const saved = savePrinterConfig(form);
  if (!saved.ok) {
    printerErrorSignal.value = describeError(saved);
    return;
  }
  printerConfigSignal.value = form;
  printerErrorSignal.value = null;
  activeScreenSignal.value = 'sale';
}

/** La prueba de impresión: el ejemplo con lo que está en pantalla, sin guardar. */
export async function printTestReceipt(): Promise<void> {
  const form = printerFormSignal.value;
  if (form.format === 'none') {
    return;
  }
  await getReceiptPrinter().print(sampleDocumentFor(form), form.format);
}
```

- [ ] **Paso 8:** el test del controller → PASA.

- [ ] **Paso 9: la pantalla, su ruta y el comando.** `src/ui/state/screen.ts`: sumar `| 'printer'` a
  `ActiveScreen` (y "`/IMPRESORA`" al comentario). `src/ui/app.tsx`: importar `PrinterScreen` y
  sumar `case 'printer': return <PrinterScreen />;`. `src/ui/keyboard/commands.ts`, en
  `CORE_COMMANDS` después de `CONFIG`:

```ts
  { name: 'IMPRESORA', description: 'Configurar la impresión de tickets' },
```

  `src/ui/keyboard/command-bar-controller.ts`, en `runCommand`, después de `CONFIG`:

```ts
    case 'IMPRESORA':
      enterPrinterScreen();
      clearBuffer();
      return;
```

  `src/ui/screens/printer-screen.tsx`:

```tsx
import type { TargetedKeyboardEvent } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';
import { paperFormat, type CheckoutAction, type PrintFormat } from '../../storage/printer-config.ts';
import { keepFocusOnMouseDown } from '../hooks/use-mouse-keeps-focus.ts';
import {
  cancelPrinterScreen,
  choosePrinterCheckout,
  choosePrinterFormat,
  printTestReceipt,
  savePrinterForm,
  setPrinterFooter,
  setPrinterHeader,
} from '../keyboard/printer-controller.ts';
import {
  CHECKOUT_LABELS,
  checkoutOptions,
  FORMAT_LABELS,
  FORMAT_OPTIONS,
  stepOption,
} from '../keyboard/printer-form-model.ts';
import { ReceiptView } from '../print/ReceiptView.tsx';
import { sampleDocumentFor } from '../print/resolve-receipt.ts';
import { printerErrorSignal, printerFormSignal } from '../state/printer.ts';

// Borde, fondo y la marca de la opción elegida: `.wizard-option` (tokens.css, #112).
const optionStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-2)',
  textAlign: 'left' as const,
  padding: 'var(--space-2) var(--space-3)',
  borderRadius: 'var(--radius-md)',
  color: 'var(--color-text)',
  fontFamily: 'var(--font-sans)',
  fontSize: 'var(--font-size-base)',
  cursor: 'pointer',
};

const textareaStyle = {
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--font-size-base)',
  padding: 'var(--space-2)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  background: 'var(--color-bg)',
  color: 'var(--color-text)',
  resize: 'vertical' as const,
};

function OptionGroup<T extends string>(props: {
  label: string;
  options: readonly T[];
  labels: Record<T, string>;
  selected: T;
  onChoose: (option: T) => void;
  autofocus?: boolean;
}) {
  const refs = useRef(new Map<T, HTMLButtonElement>());
  useLayoutEffect(() => {
    if (props.autofocus === true) refs.current.get(props.selected)?.focus();
    // Solo al montar: después el foco lo mueven las flechas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleKeyDown = (event: TargetedKeyboardEvent<HTMLButtonElement>) => {
    const direction =
      event.key === 'ArrowDown' || event.key === 'ArrowRight'
        ? 1
        : event.key === 'ArrowUp' || event.key === 'ArrowLeft'
          ? -1
          : 0;
    if (direction === 0) return;
    event.preventDefault();
    const next = stepOption(props.options, props.selected, direction);
    props.onChoose(next);
    refs.current.get(next)?.focus();
  };

  return (
    <fieldset style={{ border: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
      <legend style={{ fontWeight: 'bold', marginBottom: 'var(--space-1)' }}>{props.label}</legend>
      {props.options.map((option) => (
        <button
          key={option}
          ref={(element) => {
            if (element === null) refs.current.delete(option);
            else refs.current.set(option, element);
          }}
          type="button"
          class="wizard-option"
          aria-pressed={option === props.selected}
          tabIndex={option === props.selected ? 0 : -1}
          onClick={() => {
            props.onChoose(option);
          }}
          onKeyDown={handleKeyDown}
          style={optionStyle}
        >
          <span class="wizard-radio" aria-hidden="true" />
          <span class="wizard-option__title">{props.labels[option]}</span>
        </button>
      ))}
    </fieldset>
  );
}

/**
 * `/IMPRESORA` (#174): formato, qué pasa al cobrar, encabezado y pie, con la vista previa del
 * ticket de ejemplo. Ctrl+Enter guarda (Enter en un `textarea` es salto de línea), Esc cancela.
 */
export function PrinterScreen() {
  const form = printerFormSignal.value;
  const error = printerErrorSignal.value;

  const handleKeyDown = (event: TargetedKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      cancelPrinterScreen();
      return;
    }
    if (event.key === 'Enter' && event.ctrlKey) {
      event.preventDefault();
      savePrinterForm();
    }
  };

  return (
    <div
      onKeyDown={handleKeyDown}
      onMouseDown={keepFocusOnMouseDown}
      style={{
        height: 'var(--app-height)',
        overflowY: 'auto',
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) auto',
        gap: 'var(--space-4)',
        padding: 'var(--space-4)',
        background: 'var(--color-bg)',
        color: 'var(--color-text)',
        fontFamily: 'var(--font-sans)',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <h1 style={{ margin: 0, fontSize: 'var(--font-size-xl)' }}>Impresora</h1>
        <OptionGroup<PrintFormat>
          label="Formato"
          options={FORMAT_OPTIONS}
          labels={FORMAT_LABELS}
          selected={form.format}
          onChoose={choosePrinterFormat}
          autofocus
        />
        <OptionGroup<CheckoutAction>
          label="Al cobrar"
          options={checkoutOptions(form.format)}
          labels={CHECKOUT_LABELS}
          selected={form.onCheckout}
          onChoose={choosePrinterCheckout}
        />
        <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
          <strong>Encabezado</strong>
          <textarea
            rows={3}
            value={form.header}
            placeholder={'ej. Kiosco Don Pepe\nAv. Siempreviva 742'}
            onInput={(event) => {
              setPrinterHeader(event.currentTarget.value);
            }}
            style={textareaStyle}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
          <strong>Pie</strong>
          <textarea
            rows={2}
            value={form.footer}
            placeholder="ej. ¡Gracias por su compra!"
            onInput={(event) => {
              setPrinterFooter(event.currentTarget.value);
            }}
            style={textareaStyle}
          />
        </label>
        <div style={{ minHeight: 'var(--space-6)' }}>
          {error !== null && (
            <p role="alert" style={{ margin: 0, color: 'var(--color-danger)' }}>
              {error}
            </p>
          )}
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          <button type="button" class="btn" onClick={cancelPrinterScreen}>
            Cancelar (Esc)
          </button>
          {form.format !== 'none' && (
            <button type="button" class="btn" onClick={() => void printTestReceipt()}>
              Prueba de impresión
            </button>
          )}
          <button type="button" class="btn btn-primary" onClick={savePrinterForm}>
            Guardar (Ctrl+Enter)
          </button>
        </div>
      </div>
      <div aria-label="Vista previa" style={{ alignSelf: 'start', boxShadow: 'var(--shadow-card)', border: '1px solid var(--color-border)' }}>
        <ReceiptView document={sampleDocumentFor(form)} format={paperFormat(form.format)} />
      </div>
    </div>
  );
}
```

  > Confirmar en `tokens.css` que existe `--space-6` (si no, usar `--space-8` como en
  > `demo-reset-screen.tsx`). El placeholder de varios renglones se ve en gris claro por la regla
  > global de `--color-placeholder`.

- [ ] **Paso 10: tests de la pantalla** — `src/ui/screens/printer-screen.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_PRINTER_CONFIG } from '../../storage/printer-config.ts';
import { enterPrinterScreen } from '../keyboard/printer-controller.ts';
import { printerConfigSignal, printerFormSignal } from '../state/printer.ts';
import { activeScreenSignal } from '../state/screen.ts';
import { PrinterScreen } from './printer-screen.tsx';

beforeEach(() => {
  printerConfigSignal.value = DEFAULT_PRINTER_CONFIG;
  enterPrinterScreen();
});

afterEach(() => {
  localStorage.clear();
});

describe('PrinterScreen', () => {
  it('arranca con el foco en el formato elegido', () => {
    render(<PrinterScreen />);
    expect(document.activeElement?.textContent).toContain('A6');
  });

  it('↑ cambia el formato y mueve el foco', () => {
    render(<PrinterScreen />);
    fireEvent.keyDown(screen.getByRole('button', { name: 'A6' }), { key: 'ArrowUp' });
    expect(printerFormSignal.value.format).toBe('80mm');
    expect(document.activeElement?.textContent).toContain('80 mm');
  });

  it('con "No imprimir" no se ofrecen "Imprimir" ni la prueba', () => {
    render(<PrinterScreen />);
    fireEvent.click(screen.getByRole('button', { name: 'No imprimir' }));
    expect(screen.queryByRole('button', { name: 'Imprimir' })).toBeNull();
    expect(screen.queryByText('Prueba de impresión')).toBeNull();
  });

  it('Ctrl+Enter guarda y vuelve a la venta; Esc cancela', () => {
    render(<PrinterScreen />);
    fireEvent.click(screen.getByRole('button', { name: '58 mm' }));
    fireEvent.keyDown(screen.getByRole('button', { name: '58 mm' }), { key: 'Enter', ctrlKey: true });
    expect(printerConfigSignal.value.format).toBe('58mm');
    expect(activeScreenSignal.value).toBe('sale');
  });

  it('la vista previa usa el encabezado tipeado', () => {
    render(<PrinterScreen />);
    fireEvent.input(screen.getByLabelText('Encabezado'), { target: { value: 'Mi kiosco' } });
    expect(screen.getByText('Mi kiosco')).not.toBeNull();
  });
});
```

- [ ] **Paso 11:** `pnpm lint && pnpm typecheck && pnpm test && pnpm build` → verde. Revisar en
  `command-bar-controller.test.ts` / `commands` si hay un test que enumera `CORE_COMMANDS` y
  actualizarlo.
- [ ] **Paso 12: commit** — `feat(impresion): comando /IMPRESORA (#174)`.

---

### Tarea 8: Reimprimir desde `/RESUMEN`

**Archivos:**
- Modificar: `src/ui/keyboard/cash-summary-controller.ts`,
  `src/ui/keyboard/cash-summary-controller.test.ts`, `src/ui/screens/cash-summary-screen.tsx`,
  `src/ui/screens/cash-summary-screen.test.tsx`

**Interfaces:**
- Consume: `reprintReceipt` (Tarea 6); `ReceiptSource` (Tarea 5); `printerConfigSignal` (Tarea 4);
  `DayEntry` (`domain/day-summary.ts`).
- Produce: `reprintSourceFor(entry, customerNames): ReceiptSource | undefined`,
  `reprintEntry(entry, customerNames): void`.

- [ ] **Paso 1: tests que fallan** — sumar a `cash-summary-controller.test.ts`:

```ts
describe('reprintSourceFor', () => {
  const sale: Sale = {
    id: 's1',
    lines: [],
    payments: [{ method: 'cash', amount: 10 }],
    total: 10,
    status: 'closed',
    createdAt: '2026-10-02T12:00:00.000Z',
  };

  it('una venta se reimprime como copia', () => {
    expect(reprintSourceFor({ kind: 'sale', at: sale.createdAt, sale }, new Map())).toEqual({
      kind: 'sale',
      sale,
      copy: true,
    });
  });

  it('una cobranza se reimprime con el nombre del cliente y sin saldos', () => {
    const payment: CustomerPayment = {
      id: 'p1',
      customerId: 'c1',
      payments: [{ method: 'cash', amount: 500 }],
      total: 500,
      createdAt: '2026-10-02T13:00:00.000Z',
    };
    expect(
      reprintSourceFor({ kind: 'collection', at: payment.createdAt, payment }, new Map([['c1', 'Ana']])),
    ).toEqual({ kind: 'collection', payment, customerName: 'Ana', copy: true });
  });

  it('sin el cliente en la base usa su id', () => {
    const payment: CustomerPayment = {
      id: 'p1',
      customerId: 'c9',
      payments: [],
      total: 0,
      createdAt: '2026-10-02T13:00:00.000Z',
    };
    const source = reprintSourceFor({ kind: 'collection', at: payment.createdAt, payment }, new Map());
    expect(source?.kind === 'collection' ? source.customerName : null).toBe('c9');
  });

  it('un movimiento de caja o un arqueo no se reimprimen', () => {
    const count = { kind: 'count', at: '2026-10-02T09:00:00.000Z' } as unknown as DayEntry;
    expect(reprintSourceFor(count, new Map())).toBeUndefined();
  });
});
```

  > El último caso: armar un `DayEntry` de `kind: 'count'` real con la forma de `CashCount` del
  > archivo (mirar cómo lo arman los tests vecinos) en vez del `as unknown as`, que el lint puede
  > rechazar.

- [ ] **Paso 2:** → FALLA.

- [ ] **Paso 3: implementación** — sumar a `cash-summary-controller.ts`:

```ts
import type { DayEntry } from '../../domain/day-summary.ts';
import { reprintReceipt } from '../print/after-close.ts';
import type { ReceiptSource } from '../print/resolve-receipt.ts';

/** Qué se reimprime de una fila de Movimientos (#174): ventas y cobranzas, siempre como copia. */
export function reprintSourceFor(
  entry: DayEntry,
  customerNames: ReadonlyMap<string, string>,
): ReceiptSource | undefined {
  switch (entry.kind) {
    case 'sale':
      return { kind: 'sale', sale: entry.sale, copy: true };
    case 'collection':
      return {
        kind: 'collection',
        payment: entry.payment,
        customerName: customerNames.get(entry.payment.customerId) ?? entry.payment.customerId,
        copy: true,
      };
    case 'movement':
    case 'count':
      return undefined;
  }
}

/** Reimprimir (o ver, sin papel) la fila elegida; nada si no es una venta ni una cobranza. */
export function reprintEntry(entry: DayEntry, customerNames: ReadonlyMap<string, string>): void {
  const source = reprintSourceFor(entry, customerNames);
  if (source !== undefined) {
    reprintReceipt(source);
  }
}
```

- [ ] **Paso 4:** el test del controller → PASA.

- [ ] **Paso 5: la pantalla** — en `cash-summary-screen.tsx`, dentro de `CashSummaryScreen`, después
  de `const canGoForward = …`:

```tsx
  const selectedEntry =
    tab === 'movements' ? filteredEntries[selectedEntryIndexSignal.value] : undefined;
  const reprintable =
    selectedEntry !== undefined && reprintSourceFor(selectedEntry, view.customerNames) !== undefined;
  const reprintLabel =
    printerConfigSignal.value.format === 'none' ? 'Ver comprobante (Enter)' : 'Reimprimir (Enter)';
  const reprintSelected = () => {
    if (selectedEntry !== undefined) reprintEntry(selectedEntry, view.customerNames);
  };
```

  En `handleKeyDown`, antes de `const navHandled = …`:

```tsx
    // Enter no estaba usado en Movimientos (lo tipeado va al buscador): Reimprimir (#174). Un botón
    // enfocado con Tab se activa solo, de forma nativa.
    if (event.key === 'Enter' && !(event.target instanceof HTMLButtonElement)) {
      if (reprintable) {
        event.preventDefault();
        reprintSelected();
      }
      return;
    }
```

  > `handleKeyDown` se declara antes de los `return` condicionales; mover estas constantes a
  > antes de su declaración (después del `if (view === undefined) return null;`), o calcularlas
  > dentro del handler leyendo los signals. Lo importante: que `handleKeyDown` vea el
  > `selectedEntry` del render actual.

  En la segunda fila de la barra (la del buscador y las pestañas), después del `map` de
  `TAB_ORDER`:

```tsx
          {reprintable && (
            <button type="button" onClick={reprintSelected} style={tabButtonStyle(false)}>
              {reprintLabel}
            </button>
          )}
```

  (imports: `printerConfigSignal` de `../state/printer.ts`, `reprintEntry` y `reprintSourceFor` de
  `../keyboard/cash-summary-controller.ts`.)

- [ ] **Paso 6: tests de la pantalla** — sumar a `cash-summary-screen.test.tsx`, con el armado de
  día que ya usa el archivo (una venta y un arqueo) y una impresora falsa:

```tsx
it('con una venta elegida, Enter la reimprime como copia', async () => {
  // …armar el día con una venta (como los tests vecinos)…
  const printed: string[] = [];
  setReceiptPrinter({ print: (document) => { printed.push(document.marks.join(',')); return Promise.resolve(); } });
  printerConfigSignal.value = { ...DEFAULT_PRINTER_CONFIG, format: '80mm' };
  render(<CashSummaryScreen />);
  expect(screen.getByText('Reimprimir (Enter)')).not.toBeNull();
  fireEvent.keyDown(screen.getByLabelText('Buscar'), { key: 'Enter' });
  expect(printed).toEqual(['COPIA']);
  expect(activeScreenSignal.value).toBe('cash-summary');
});

it('con "No imprimir", Enter abre la copia en el comprobante', async () => {
  // …mismo día…
  printerConfigSignal.value = { ...DEFAULT_PRINTER_CONFIG, format: 'none' };
  render(<CashSummaryScreen />);
  expect(screen.getByText('Ver comprobante (Enter)')).not.toBeNull();
  fireEvent.keyDown(screen.getByLabelText('Buscar'), { key: 'Enter' });
  expect(activeScreenSignal.value).toBe('receipt');
  expect(receiptSignal.value?.returnTo).toBe('cash-summary');
});

it('con un arqueo elegido no hay botón y Enter no hace nada', async () => {
  // …un día con solo un arqueo…
  render(<CashSummaryScreen />);
  expect(screen.queryByText('Reimprimir (Enter)')).toBeNull();
});
```

  (restaurar `printerConfigSignal` al default en el `afterEach`.)

- [ ] **Paso 7:** `pnpm lint && pnpm typecheck && pnpm test` → verde.
- [ ] **Paso 8: commit** — `feat(impresion): reimprimir desde /RESUMEN (#174)`.

---

### Tarea 9: e2e

**Archivos:**
- Crear: `e2e/printing.spec.ts`
- Modificar: `e2e/keyboard-only.spec.ts`

- [ ] **Paso 1: el spec** — `e2e/printing.spec.ts`. El stub intercepta el `print` del iframe desde
  el realm de la página (el iframe `about:blank` no corre los init scripts):

```ts
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { confirmCheckout, fillPayment, seedCatalog } from './helpers.ts';
import { getAllFromStore } from './indexed-db.ts';

/** Registra el texto de cada impresión y dispara `afterprint`, sin abrir el diálogo real. */
async function stubPrinting(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const target = window as unknown as { __printed: string[] };
    target.__printed = [];
    const descriptor = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentWindow');
    Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
      configurable: true,
      get(this: HTMLIFrameElement) {
        const frameWindow = descriptor?.get?.call(this) as Window | null;
        if (frameWindow !== null) {
          frameWindow.print = () => {
            target.__printed.push(frameWindow.document.body.innerText);
            frameWindow.dispatchEvent(new Event('afterprint'));
          };
        }
        return frameWindow;
      },
    });
  });
}

function printedTexts(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __printed: string[] }).__printed);
}

async function configurePrinter(page: Page, format: string, onCheckout: string): Promise<void> {
  const commandBar = page.getByLabel('Barra de comandos');
  await commandBar.fill('/IMPRESORA');
  await commandBar.press('Enter');
  await expect(page.getByRole('heading', { name: 'Impresora' })).toBeVisible();
  await page.getByRole('button', { name: format, exact: true }).click();
  await page.getByRole('button', { name: onCheckout, exact: true }).click();
  await page.getByLabel('Encabezado').fill('Kiosco E2E');
  await page.keyboard.press('Control+Enter');
  await expect(commandBar).toBeVisible();
}

async function sellRice(page: Page): Promise<void> {
  const commandBar = page.getByLabel('Barra de comandos');
  await commandBar.fill('arroz');
  await expect(page.getByText('Arroz 1kg')).toBeVisible();
  await commandBar.press('Enter');
  await commandBar.press('Control+Enter');
  await expect(page.getByRole('heading', { name: 'Cobrar' })).toBeVisible();
  await fillPayment(page, 'Efectivo', 1200);
  await confirmCheckout(page);
}

test.beforeEach(async ({ page }) => {
  await stubPrinting(page);
  await page.goto('/');
  await seedCatalog(page);
});

test('Al cobrar: Imprimir — registra, imprime y sigue con la venta', async ({ page }) => {
  await configurePrinter(page, '58 mm', 'Imprimir');
  await sellRice(page);

  const commandBar = page.getByLabel('Barra de comandos');
  await expect(commandBar).toBeFocused();
  await expect(commandBar).toHaveValue('');
  await expect(page.getByRole('heading', { name: 'Comprobante' })).toHaveCount(0);
  await expect.poll(() => printedTexts(page)).toHaveLength(1);
  const [printed] = await printedTexts(page);
  expect(printed).toContain('Kiosco E2E');
  expect(printed).toContain('Arroz 1kg');
  expect(await getAllFromStore(page, 'sales')).toHaveLength(1);
});

test('Al cobrar: Nada — vuelve directo a la venta sin imprimir', async ({ page }) => {
  await configurePrinter(page, '80 mm', 'Nada');
  await sellRice(page);

  await expect(page.getByLabel('Barra de comandos')).toBeFocused();
  await expect(page.getByRole('heading', { name: 'Comprobante' })).toHaveCount(0);
  expect(await printedTexts(page)).toEqual([]);
  expect(await getAllFromStore(page, 'sales')).toHaveLength(1);
});

test('Reimprimir desde /RESUMEN imprime una copia', async ({ page }) => {
  await configurePrinter(page, 'A6', 'Nada');
  await sellRice(page);

  const commandBar = page.getByLabel('Barra de comandos');
  await commandBar.fill('/RESUMEN');
  await commandBar.press('Enter');
  await expect(page.getByText('Reimprimir (Enter)')).toBeVisible();
  await page.keyboard.press('Enter');

  await expect.poll(() => printedTexts(page)).toHaveLength(1);
  const [printed] = await printedTexts(page);
  expect(printed).toContain('COPIA');
});
```

  > Ajustar al detalle de los otros specs: si `seedCatalog` ya recarga la página (lo hace), el init
  > script sigue activo después del `reload`. Si la venta con 1200 no alcanza para "Arroz 1kg",
  > copiar el monto de `offline-sale.spec.ts`.

- [ ] **Paso 2: keyboard-only** — sumar a `e2e/keyboard-only.spec.ts`, con el mismo formato que los
  tests vecinos:

```ts
test('/IMPRESORA → Esc → la barra de comandos recupera el foco', async ({ page }) => {
  await page.goto('/');
  const commandBar = page.getByLabel('Barra de comandos');
  await commandBar.fill('/IMPRESORA');
  await commandBar.press('Enter');
  await expect(page.getByRole('heading', { name: 'Impresora' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'A6', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(commandBar).toBeFocused();
});
```

- [ ] **Paso 3:** `pnpm build && pnpm test:e2e` → verde (los specs existentes siguen esperando
  "Comprobante": la config por omisión es "Mostrar el comprobante").
- [ ] **Paso 4: commit** — `test(impresion): e2e de imprimir al cobrar, Nada y reimprimir (#174)`.

---

### Tarea 10: documentación

**Archivos:**
- Modificar: `AGENTS.md`, `src/ui/AGENTS.md`, `docs/publicacion.md`

- [ ] **Paso 1: `AGENTS.md`** —
  - En la tabla del índice, una fila: "Impresión: `/IMPRESORA`, `ReceiptDocument`, el puerto
    `ReceiptPrinter`, reimprimir" → `src/ui/AGENTS.md`.
  - En la tabla de comandos, después de `/CONFIG`: "`/IMPRESORA` | Formato del ticket (No
    imprimir, 58 mm, 80 mm, A6), qué pasa al cobrar, encabezado y pie; config local de la terminal
    (`storage/printer-config.ts`), aparte de la conexión".
  - En "Qué es esto", la frase de la impresión: "La impresión de tickets con `window.print()` (58 y
    80 mm y A6) está desde #174; ESC/POS directo, con corte y cajón, queda para #188".
  - En "Estructura de proyecto", `ui/` suma `print/` (el comprobante y su impresión).
  - En "Stack", la fila de impresión: "`window.print()` en un iframe (#174); Web Serial / WebUSB /
    Web Bluetooth — **pendiente** (#188)".
- [ ] **Paso 2: `src/ui/AGENTS.md`** — una sección "Impresión (#174)": `/IMPRESORA` (grupos tipo
  radio, Ctrl+Enter guarda, vista previa, prueba), `ui/print/` (`receipt-document.ts`,
  `ReceiptView.tsx` y `receipt.css` sin variables de tema, `browser-printer.tsx` con el iframe y
  `afterprint`, `resolve-receipt.ts`, `after-close.ts`), "Al cobrar", el comprobante con
  `receiptSignal` y `returnTo`, y Reimprimir/Ver comprobante en Movimientos de `/RESUMEN`.
  Actualizar las menciones a `receiptSaleSignal`/`receiptCollectionSignal` (la sección de cobranza
  las nombra).
- [ ] **Paso 3: `docs/publicacion.md`** — una sección corta "Imprimir sin el diálogo del
  navegador": abrir Chrome o Edge con `--kiosk-printing` (un acceso directo con el flag) manda el
  ticket a la impresora predeterminada sin preguntar; la impresora térmica tiene que ser la
  predeterminada y tener el papel del rollo elegido en su driver.
- [ ] **Paso 4:** `pnpm format:check` (Prettier sobre los `.md`) y commit —
  `docs: impresión de tickets en AGENTS.md y publicacion.md (#174)`.

---

## Al terminar

- `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm test:e2e`.
- Informe final con la prueba manual (ver "Cómo trabajamos"): `/IMPRESORA` → 58 mm + Imprimir +
  encabezado → vender → el diálogo de impresión con "Guardar como PDF" muestra el ticket de 58 mm;
  repetir con 80 mm y A6; "Nada" vuelve a la venta sin nada; "Mostrar" muestra el comprobante con
  el ancho del formato; `/RESUMEN` → Enter sobre una venta imprime "COPIA"; con "No imprimir", Enter
  abre la copia y Esc vuelve a `/RESUMEN`.
- `docs/historia.md` y la fila de "Estado del proyecto" de `AGENTS.md` se completan al mergear, con
  el número de PR.
