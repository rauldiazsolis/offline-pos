import { fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_PRINTER_CONFIG, loadPrinterConfig } from '../../storage/printer-config.ts';
import { enterPrinterScreen } from '../keyboard/printer-controller.ts';
import { printerConfigSignal, printerFormSignal, setReceiptPrinter } from '../state/printer.ts';
import { activeScreenSignal } from '../state/screen.ts';
import { PrinterScreen } from './printer-screen.tsx';

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
  enterPrinterScreen();
});

afterEach(() => {
  localStorage.clear();
  printerConfigSignal.value = DEFAULT_PRINTER_CONFIG;
});

describe('PrinterScreen', () => {
  it('arranca con el foco en el formato elegido', () => {
    render(<PrinterScreen />);
    expect(document.activeElement?.textContent).toBe('A6');
  });

  it('↑ cambia el formato y mueve el foco', () => {
    render(<PrinterScreen />);
    fireEvent.keyDown(screen.getByRole('button', { name: 'A6' }), { key: 'ArrowUp' });
    expect(printerFormSignal.value.format).toBe('80mm');
    expect(document.activeElement?.textContent).toBe('80 mm');
  });

  it('con "No imprimir" no se ofrecen "Imprimir" ni la prueba', () => {
    render(<PrinterScreen />);
    expect(screen.queryByRole('button', { name: 'Imprimir' })).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'No imprimir' }));
    expect(screen.queryByRole('button', { name: 'Imprimir' })).toBeNull();
    expect(screen.queryByText('Prueba de impresión')).toBeNull();
  });

  it('Ctrl+Enter guarda y vuelve a la venta', () => {
    render(<PrinterScreen />);
    fireEvent.click(screen.getByRole('button', { name: '58 mm' }));
    fireEvent.keyDown(screen.getByRole('button', { name: '58 mm' }), {
      key: 'Enter',
      ctrlKey: true,
    });
    expect(printerConfigSignal.value.format).toBe('58mm');
    expect(loadPrinterConfig().format).toBe('58mm');
    expect(activeScreenSignal.value).toBe('sale');
  });

  it('Esc cancela sin guardar', () => {
    render(<PrinterScreen />);
    fireEvent.click(screen.getByRole('button', { name: '58 mm' }));
    fireEvent.keyDown(screen.getByRole('button', { name: '58 mm' }), { key: 'Escape' });
    expect(printerConfigSignal.value).toEqual(DEFAULT_PRINTER_CONFIG);
    expect(activeScreenSignal.value).toBe('sale');
  });

  it('la prueba imprime el ejemplo en el formato elegido', () => {
    render(<PrinterScreen />);
    fireEvent.click(screen.getByRole('button', { name: '80 mm' }));
    fireEvent.click(screen.getByText('Prueba de impresión'));
    expect(printed).toEqual(['80mm:PRUEBA']);
  });

  it('la vista previa usa el encabezado tipeado y el formato elegido', () => {
    const { container } = render(<PrinterScreen />);
    fireEvent.input(screen.getByLabelText('Encabezado'), { target: { value: 'Mi kiosco' } });
    expect(screen.getByText('Mi kiosco')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '58 mm' }));
    expect(container.querySelector('.receipt--58mm')).not.toBeNull();
  });
});
