import type { TargetedKeyboardEvent } from 'preact';
import { paperFormat } from '../../storage/printer-config.ts';
import { useFocusOnMount } from '../hooks/use-focus-on-mount.ts';
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
} from '../keyboard/printer-form-model.ts';
import { ReceiptPreview } from '../print/ReceiptPreview.tsx';
import { sampleDocumentFor } from '../print/resolve-receipt.ts';
import { printerErrorSignal, printerFormSignal } from '../state/printer.ts';
import { scaledPx } from '../text-scale.ts';

const controlStyle = {
  fontSize: 'var(--font-size-base)',
  padding: 'var(--space-2)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  background: 'var(--color-bg)',
  color: 'var(--color-text)',
};

const selectStyle = { ...controlStyle, fontFamily: 'var(--font-sans)', cursor: 'pointer' };

const textareaStyle = {
  ...controlStyle,
  fontFamily: 'var(--font-mono)',
  resize: 'vertical' as const,
};

const fieldStyle = { display: 'flex', flexDirection: 'column' as const, gap: 'var(--space-1)' };
const buttonRowStyle = { display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' as const };

/**
 * `/IMPRESORA` (#174): formato, qué pasa al cobrar, encabezado y pie, con la vista previa del
 * ticket de ejemplo. Ctrl+Enter guarda (Enter en un `textarea` es salto de línea), Alt+P imprime
 * la prueba y Esc cancela. La pantalla no cambia de forma con el formato ni con el ancho de la
 * ventana: el formulario tiene un ancho máximo y la vista previa, un marco de ancho fijo.
 */
export function PrinterScreen() {
  const formatRef = useFocusOnMount<HTMLSelectElement>();
  const form = printerFormSignal.value;
  const error = printerErrorSignal.value;
  const canPrint = form.format !== 'none';

  const handleKeyDown = (event: TargetedKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      cancelPrinterScreen();
      return;
    }
    if (event.key === 'Enter' && event.ctrlKey) {
      event.preventDefault();
      savePrinterForm();
      return;
    }
    // Por la tecla física: en algunos sistemas Alt+P escribe otro carácter (`event.key` no es "p").
    if (event.altKey && event.code === 'KeyP') {
      event.preventDefault();
      if (canPrint) void printTestReceipt();
    }
  };

  return (
    <div
      onKeyDown={handleKeyDown}
      // Teclado + mouse (Etapa 2 de #94): ver ui/hooks/use-mouse-keeps-focus.ts.
      onMouseDown={keepFocusOnMouseDown}
      style={{
        height: 'var(--app-height)',
        overflowY: 'auto',
        boxSizing: 'border-box',
        display: 'grid',
        gridTemplateColumns: `minmax(0, ${scaledPx(480)}) auto`,
        justifyContent: 'start',
        alignItems: 'start',
        gap: 'var(--space-6)',
        padding: 'var(--space-4)',
        background: 'var(--color-bg)',
        color: 'var(--color-text)',
        fontFamily: 'var(--font-sans)',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <h1 style={{ margin: 0, fontSize: 'var(--font-size-xl)' }}>Impresora</h1>
        <label style={fieldStyle}>
          <strong>Formato</strong>
          <select
            ref={formatRef}
            value={form.format}
            onChange={(event) => {
              const format = FORMAT_OPTIONS.find((option) => option === event.currentTarget.value);
              if (format !== undefined) choosePrinterFormat(format);
            }}
            style={selectStyle}
          >
            {FORMAT_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {FORMAT_LABELS[option]}
              </option>
            ))}
          </select>
        </label>
        <label style={fieldStyle}>
          <strong>Al cobrar</strong>
          <select
            value={form.onCheckout}
            onChange={(event) => {
              const action = checkoutOptions(form.format).find(
                (option) => option === event.currentTarget.value,
              );
              if (action !== undefined) choosePrinterCheckout(action);
            }}
            style={selectStyle}
          >
            {checkoutOptions(form.format).map((option) => (
              <option key={option} value={option}>
                {CHECKOUT_LABELS[option]}
              </option>
            ))}
          </select>
        </label>
        <label style={fieldStyle}>
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
        <label style={fieldStyle}>
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
        {/* Dos líneas fijas: la prueba siempre ocupa su lugar (deshabilitada sin papel). */}
        <div style={buttonRowStyle}>
          <button
            type="button"
            class="btn"
            disabled={!canPrint}
            onClick={() => {
              void printTestReceipt();
            }}
          >
            Prueba de impresión (Alt+P)
          </button>
        </div>
        <div style={buttonRowStyle}>
          <button type="button" class="btn" onClick={cancelPrinterScreen}>
            Cancelar (Esc)
          </button>
          <button type="button" class="btn btn-primary" onClick={savePrinterForm}>
            Guardar (Ctrl+Enter)
          </button>
        </div>
      </div>
      <section aria-label="Vista previa">
        <ReceiptPreview document={sampleDocumentFor(form)} format={paperFormat(form.format)} />
      </section>
    </div>
  );
}
