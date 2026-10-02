import type { TargetedKeyboardEvent } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';
import {
  paperFormat,
  type CheckoutAction,
  type PrintFormat,
} from '../../storage/printer-config.ts';
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

const fieldStyle = { display: 'flex', flexDirection: 'column' as const, gap: 'var(--space-1)' };

/**
 * Un grupo tipo radio (patrón "Teclado y mouse"): el foco está en la opción elegida y ↑/↓ (o ←/→)
 * eligen la vecina y llevan el foco con ella; Tab sale del grupo.
 */
function OptionGroup<T extends string>(props: {
  label: string;
  options: readonly T[];
  labels: Record<T, string>;
  selected: T;
  onChoose: (option: T) => void;
  autofocus?: boolean;
}) {
  const groupRef = useRef<HTMLFieldSetElement>(null);
  const autofocus = props.autofocus === true;

  useLayoutEffect(() => {
    // Solo al montar: después el foco lo mueven las flechas.
    if (autofocus) {
      groupRef.current?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]')?.focus();
    }
  }, [autofocus]);

  const focusOption = (option: T) => {
    const index = props.options.indexOf(option);
    groupRef.current?.querySelectorAll<HTMLButtonElement>('button')[index]?.focus();
  };

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
    focusOption(next);
  };

  return (
    <fieldset
      ref={groupRef}
      style={{
        border: 'none',
        margin: 0,
        padding: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-1)',
      }}
    >
      <legend style={{ fontWeight: 'bold', padding: 0, marginBottom: 'var(--space-1)' }}>
        {props.label}
      </legend>
      {props.options.map((option) => (
        <button
          key={option}
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
 * ticket de ejemplo. Ctrl+Enter guarda (Enter en un `textarea` es salto de línea), Alt+P imprime
 * la prueba y Esc cancela.
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
      return;
    }
    // Por la tecla física: en algunos sistemas Alt+P escribe otro carácter (`event.key` no es "p").
    if (event.altKey && event.code === 'KeyP') {
      event.preventDefault();
      if (form.format !== 'none') void printTestReceipt();
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
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) auto',
        alignItems: 'start',
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
        <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          <button type="button" class="btn" onClick={cancelPrinterScreen}>
            Cancelar (Esc)
          </button>
          {form.format !== 'none' && (
            <button
              type="button"
              class="btn"
              onClick={() => {
                void printTestReceipt();
              }}
            >
              Prueba de impresión (Alt+P)
            </button>
          )}
          <button type="button" class="btn btn-primary" onClick={savePrinterForm}>
            Guardar (Ctrl+Enter)
          </button>
        </div>
      </div>
      <section
        aria-label="Vista previa"
        // El papel a tamaño real, sin el zoom de la app (`.receipt-paper`, tokens.css).
        class="receipt-paper"
        style={{ boxShadow: 'var(--shadow-card)', border: '1px solid var(--color-border)' }}
      >
        <ReceiptView document={sampleDocumentFor(form)} format={paperFormat(form.format)} />
      </section>
    </div>
  );
}
