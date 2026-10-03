import { afterEach, describe, expect, it } from 'vitest';
import { setTerminalIdentity } from './state/sync.ts';
import { startTerminalTitle, terminalContextText, terminalTitle } from './terminal-context.ts';

const identity = { branch: 'Central', pointOfSale: 'Caja 1' };

describe('contexto de la terminal (#193)', () => {
  it('caja - sucursal - empresa', () => {
    expect(terminalContextText(identity, 'Kiosco Pepe')).toBe('Caja 1 - Central - Kiosco Pepe');
  });

  it('sin empresa, caja - sucursal', () => {
    expect(terminalContextText(identity, undefined)).toBe('Caja 1 - Central');
  });

  it('sin identidad, nada', () => {
    expect(terminalContextText(null, 'Kiosco Pepe')).toBeNull();
    expect(terminalTitle(null)).toBeNull();
  });

  it('el título no lleva la empresa', () => {
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
