import { fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_PRINTER_CONFIG, loadPrinterConfig } from '../../storage/printer-config.ts';
import { enterPrinterScreen } from '../keyboard/printer-controller.ts';
import { printerConfigSignal, printerFormSignal, setReceiptPrinter } from '../state/printer.ts';
import { activeScreenSignal } from '../state/screen.ts';
import { PrinterScreen } from './printer-screen.tsx';

const printed: string[] = [];

function formatSelect(): HTMLSelectElement {
  return screen.getByLabelText<HTMLSelectElement>('Formato');
}

function checkoutSelect(): HTMLSelectElement {
  return screen.getByLabelText<HTMLSelectElement>('Al cobrar');
}

function testButton(): HTMLButtonElement {
  return screen.getByRole<HTMLButtonElement>('button', { name: 'Prueba de impresión (Alt+P)' });
}

beforeEach(() => {
  printed.length = 0;
  setReceiptPrinter({
    print: (document, format) => {
      printed.push(`${format}:${document.marks.join(',')}`);
      return Promise.resolve();
    },
  });
  printerConfigSignal.value = DEFAULT_PRINTER_CONFIG;
  enterPrinterScreen();
});

afterEach(() => {
  localStorage.clear();
  printerConfigSignal.value = DEFAULT_PRINTER_CONFIG;
});

describe('PrinterScreen', () => {
  it('arranca con el foco en el formato, con lo guardado elegido', () => {
    render(<PrinterScreen />);
    expect(document.activeElement).toBe(formatSelect());
    expect(formatSelect().value).toBe('a6');
    expect(checkoutSelect().value).toBe('show');
  });

  it('elegir un formato cambia el formulario y la vista previa', () => {
    const { container } = render(<PrinterScreen />);
    fireEvent.change(formatSelect(), { target: { value: '58mm' } });
    expect(printerFormSignal.value.format).toBe('58mm');
    expect(container.querySelector('.receipt--58mm')).not.toBeNull();
  });

  it('con "No imprimir" no se ofrece "Imprimir" y la prueba queda deshabilitada', () => {
    render(<PrinterScreen />);
    const options = () => [...checkoutSelect().options].map((option) => option.textContent);
    expect(options()).toEqual(['Imprimir', 'Mostrar el comprobante', 'Nada']);
    expect(testButton().disabled).toBe(false);

    fireEvent.change(formatSelect(), { target: { value: 'none' } });

    expect(options()).toEqual(['Mostrar el comprobante', 'Nada']);
    expect(testButton().disabled).toBe(true);
  });

  it('elegir "Al cobrar" cambia el formulario', () => {
    render(<PrinterScreen />);
    fireEvent.change(checkoutSelect(), { target: { value: 'skip' } });
    expect(printerFormSignal.value.onCheckout).toBe('skip');
  });

  it('Ctrl+Enter guarda y vuelve a la venta', () => {
    render(<PrinterScreen />);
    fireEvent.change(formatSelect(), { target: { value: '58mm' } });
    fireEvent.keyDown(formatSelect(), { key: 'Enter', ctrlKey: true });
    expect(printerConfigSignal.value.format).toBe('58mm');
    expect(loadPrinterConfig().format).toBe('58mm');
    expect(activeScreenSignal.value).toBe('sale');
  });

  it('Esc cancela sin guardar', () => {
    render(<PrinterScreen />);
    fireEvent.change(formatSelect(), { target: { value: '58mm' } });
    fireEvent.keyDown(formatSelect(), { key: 'Escape' });
    expect(printerConfigSignal.value).toEqual(DEFAULT_PRINTER_CONFIG);
    expect(activeScreenSignal.value).toBe('sale');
  });

  it('la prueba imprime el ejemplo en el formato elegido', () => {
    render(<PrinterScreen />);
    fireEvent.change(formatSelect(), { target: { value: '80mm' } });
    fireEvent.click(testButton());
    expect(printed).toEqual(['80mm:PRUEBA']);
  });

  it('Alt+P imprime la prueba, también desde un textarea; con "No imprimir" no hace nada', () => {
    render(<PrinterScreen />);
    fireEvent.keyDown(screen.getByLabelText('Encabezado'), {
      key: 'π',
      code: 'KeyP',
      altKey: true,
    });
    expect(printed).toEqual(['a6:PRUEBA']);
    fireEvent.change(formatSelect(), { target: { value: 'none' } });
    fireEvent.keyDown(formatSelect(), { key: 'p', code: 'KeyP', altKey: true });
    expect(printed).toEqual(['a6:PRUEBA']);
  });

  it('la vista previa usa el encabezado tipeado', () => {
    render(<PrinterScreen />);
    fireEvent.input(screen.getByLabelText('Encabezado'), { target: { value: 'Mi kiosco' } });
    expect(screen.getByText('Mi kiosco')).not.toBeNull();
  });
});
