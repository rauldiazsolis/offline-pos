import { afterEach, describe, expect, it } from 'vitest';
import { setTerminalIdentity } from './state/sync.ts';
import { startTerminalTitle, terminalHeading, terminalTitle } from './terminal-context.ts';

const identity = { branch: 'Central', pointOfSale: 'Caja 1' };

describe('encabezado de la terminal (#193)', () => {
  it('la empresa como título y la caja debajo', () => {
    expect(terminalHeading(identity, 'Kiosco Pepe')).toEqual({
      title: 'Kiosco Pepe',
      subtitle: 'Caja 1 - Central',
    });
  });

  it('sin empresa (o vacía), la caja es el título', () => {
    expect(terminalHeading(identity, undefined)).toEqual({ title: 'Caja 1 - Central' });
    expect(terminalHeading(identity, '  ')).toEqual({ title: 'Caja 1 - Central' });
  });

  it('sin identidad, nada', () => {
    expect(terminalHeading(null, 'Kiosco Pepe')).toBeNull();
    expect(terminalTitle(null)).toBeNull();
  });

  it('el título de la pestaña no lleva la empresa', () => {
    expect(terminalTitle(identity)).toBe('Caja 1 - Central');
  });
});

describe('título de la pestaña (#193)', () => {
  let stop: (() => void) | undefined;
  afterEach(() => {
    stop?.();
    setTerminalIdentity(null);
  });

  it('sigue a la identidad; sin ella, el título de siempre', () => {
    setTerminalIdentity(null);
    stop = startTerminalTitle('offline-pos');
    expect(document.title).toBe('offline-pos');

    setTerminalIdentity(identity);
    expect(document.title).toBe('Caja 1 - Central');

    setTerminalIdentity(null);
    expect(document.title).toBe('offline-pos');
  });
});
