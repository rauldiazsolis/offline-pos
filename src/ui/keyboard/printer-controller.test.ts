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
  choosePrinterCheckout,
  choosePrinterFormat,
  enterPrinterScreen,
  printTestReceipt,
  savePrinterForm,
  setPrinterFooter,
  setPrinterHeader,
} from './printer-controller.ts';

const printed: string[] = [];

beforeEach(() => {
  printed.length = 0;
  setReceiptPrinter({
    print: (document, format) => {
      printed.push(`${format}:${document.marks.join(',')}:${document.header.join('|')}`);
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
    printerErrorSignal.value = 'viejo';
    enterPrinterScreen();
    expect(activeScreenSignal.value).toBe('printer');
    expect(printerFormSignal.value.format).toBe('80mm');
    expect(printerErrorSignal.value).toBeNull();
  });

  it('guardar persiste, actualiza la config en memoria y vuelve a la venta', () => {
    enterPrinterScreen();
    choosePrinterFormat('58mm');
    choosePrinterCheckout('print');
    setPrinterHeader('Kiosco');
    setPrinterFooter('Gracias');
    savePrinterForm();
    const expected = { format: '58mm', onCheckout: 'print', header: 'Kiosco', footer: 'Gracias' };
    expect(loadPrinterConfig()).toEqual(expected);
    expect(printerConfigSignal.value).toEqual(expected);
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

  it('elegir "No imprimir" con "Imprimir" pasa a mostrar el comprobante', () => {
    enterPrinterScreen();
    choosePrinterFormat('80mm');
    choosePrinterCheckout('print');
    choosePrinterFormat('none');
    expect(printerFormSignal.value.onCheckout).toBe('show');
  });

  it('la prueba imprime el ejemplo con lo que está en pantalla, sin guardar', async () => {
    enterPrinterScreen();
    choosePrinterFormat('80mm');
    setPrinterHeader('Mi kiosco');
    await printTestReceipt();
    expect(printed).toEqual(['80mm:PRUEBA:Mi kiosco']);
    expect(loadPrinterConfig()).toEqual(DEFAULT_PRINTER_CONFIG);
  });

  it('con "No imprimir" la prueba no hace nada', async () => {
    enterPrinterScreen();
    choosePrinterFormat('none');
    await printTestReceipt();
    expect(printed).toEqual([]);
  });
});
