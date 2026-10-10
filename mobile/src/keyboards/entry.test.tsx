import { fireEvent, render, screen } from '@testing-library/preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { decimalSeparator } from '../../../src/ui/parse-amount.ts';
import { resolveLocale } from '../../../src/ui/format.ts';
import { closeEntry, entrySignal, openNumberEntry, openTextEntry } from './entry.ts';
import { EntryHost } from './entry-host.tsx';

function tap(name: string): void {
  fireEvent.click(screen.getByRole('button', { name }));
}

function display(testId: string): string {
  return screen.getByTestId(testId).textContent;
}

// El decimal del locale de la terminal (en jsdom, el de `navigator.language`).
const DEC = decimalSeparator(resolveLocale());

beforeEach(() => {
  closeEntry();
});

describe('entrada numérica', () => {
  it('arma el número con las teclas y lo entrega al terminar', () => {
    const onDone = vi.fn();
    openNumberEntry({ title: 'Cantidad', options: { decimals: 3, signed: true }, onDone });
    render(<EntryHost />);
    tap('1');
    tap('Coma decimal');
    tap('5');
    expect(display('number-entry-display')).toContain(`1${DEC}5`);
    tap('Listo');
    expect(onDone).toHaveBeenCalledWith(1.5);
    expect(entrySignal.value).toBeNull();
  });

  it('el primer dígito reemplaza lo precargado y el signo lo vuelve negativo', () => {
    const onDone = vi.fn();
    openNumberEntry({
      title: 'Cantidad',
      initial: '2',
      options: { decimals: 3, signed: true },
      onDone,
    });
    render(<EntryHost />);
    tap('3');
    tap('Cambiar el signo');
    tap('Listo');
    expect(onDone).toHaveBeenCalledWith(-3);
  });

  it('con un error de validación no se cierra', () => {
    const onDone = vi.fn();
    openNumberEntry({
      title: 'Importe',
      options: { decimals: 2, signed: false },
      validate: (value) => (value === undefined ? 'Ingresá un importe.' : null),
      onDone,
    });
    render(<EntryHost />);
    tap('Listo');
    expect(screen.getByRole('alert').textContent).toBe('Ingresá un importe.');
    expect(onDone).not.toHaveBeenCalled();
  });

  it('un atajo rápido carga su valor', () => {
    const onDone = vi.fn();
    openNumberEntry({
      title: 'Peso',
      options: { decimals: 3, signed: false },
      quick: [{ label: '½ kg', text: `0${DEC}5` }],
      onDone,
    });
    render(<EntryHost />);
    tap('½ kg');
    tap('Listo');
    expect(onDone).toHaveBeenCalledWith(0.5);
  });

  it('acepta teclas físicas y Enter', () => {
    const onDone = vi.fn();
    openNumberEntry({ title: 'Importe', options: { decimals: 2, signed: false }, onDone });
    render(<EntryHost />);
    fireEvent.keyDown(window, { key: '4' });
    fireEvent.keyDown(window, { key: '2' });
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onDone).toHaveBeenCalledWith(42);
  });
});

describe('entrada de texto', () => {
  it('arma el texto con mayúscula por palabra y lo entrega', () => {
    const onDone = vi.fn();
    openTextEntry({
      title: 'Nombre',
      placeholder: 'Nombre del cliente',
      options: { capitalize: 'words', maxLength: 40 },
      onDone,
    });
    render(<EntryHost />);
    tap('A');
    tap('n');
    tap('a');
    expect(display('text-entry-display')).toContain('Ana');
    tap('Listo');
    expect(onDone).toHaveBeenCalledWith('Ana');
  });

  it('muestra resultados en vivo y sin onDone no tiene "Listo"', () => {
    openTextEntry({
      title: 'Buscar',
      placeholder: 'Nombre',
      options: { capitalize: 'none', maxLength: 40 },
      results: (text) => <p>Buscando «{text}»</p>,
    });
    render(<EntryHost />);
    tap('y');
    tap('e');
    expect(screen.getByText('Buscando «ye»')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Listo' })).toBeNull();
  });

  it('la capa de símbolos sirve para una URL', () => {
    const onDone = vi.fn();
    openTextEntry({
      title: 'URL',
      placeholder: 'ej. https://…',
      options: { capitalize: 'none', maxLength: 200 },
      onDone,
    });
    render(<EntryHost />);
    tap('h');
    tap('123');
    tap(':');
    tap('/');
    tap('Listo');
    expect(onDone).toHaveBeenCalledWith('h:/');
  });

  it('una clave se ve con puntos', () => {
    openTextEntry({
      title: 'Clave',
      placeholder: 'Clave',
      secret: true,
      options: { capitalize: 'none', maxLength: 80 },
      onDone: vi.fn(),
    });
    render(<EntryHost />);
    tap('x');
    tap('y');
    expect(display('text-entry-display')).toContain('••');
  });
});
