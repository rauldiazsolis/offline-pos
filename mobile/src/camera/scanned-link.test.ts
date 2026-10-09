import { describe, expect, it } from 'vitest';
import { connectionTargetFrom } from './scanned-link.ts';

const HERE = 'https://pos.contax.ar/v4/mobile/';

describe('connectionTargetFrom', () => {
  it('un link de demo del POS de escritorio se aplica a la dirección del mobile', () => {
    expect(
      connectionTargetFrom(
        'https://pos.contax.ar/v4/?demo=true&backend=https%3A%2F%2Fmini.contax.ar%2Fconnector&template=kiosco',
        HERE,
      ),
    ).toBe(
      'https://pos.contax.ar/v4/mobile/?demo=true&backend=https%3A%2F%2Fmini.contax.ar%2Fconnector&template=kiosco',
    );
  });

  it('la vuelta con #connect= conserva el fragmento', () => {
    expect(connectionTargetFrom('https://otro.example/pos/#connect=eyJhIjoxfQ', HERE)).toBe(
      'https://pos.contax.ar/v4/mobile/#connect=eyJhIjoxfQ',
    );
  });

  it('cualquier otro texto no es un link de conexión', () => {
    expect(connectionTargetFrom('7790895000997', HERE)).toBeNull();
    expect(connectionTargetFrom('https://example.com/', HERE)).toBeNull();
    expect(connectionTargetFrom('https://example.com/?demo=true', HERE)).toBeNull();
  });
});
