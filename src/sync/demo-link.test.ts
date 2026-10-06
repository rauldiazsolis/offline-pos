import { describe, expect, it } from 'vitest';
import { err, ok } from '../domain/result.ts';
import {
  buildDemoLink,
  buildOnboardingUrl,
  readConnectReturn,
  hasOnboardingParams,
  readDemoEntry,
  returnUrlFor,
  stripOnboardingParams,
} from './demo-link.ts';

const encode = (value: object) =>
  btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

describe('readDemoEntry', () => {
  it('sin demo=true no hay entrada', () => {
    expect(readDemoEntry('https://pos.x/?backend=https://b.x')).toBeUndefined();
  });
  it('https, con template y sin barra final', () => {
    expect(
      readDemoEntry('https://pos.x/?demo=true&backend=https://b.x/api/&template=almacen'),
    ).toEqual(ok({ backend: 'https://b.x/api', template: 'almacen' }));
  });
  it.each(['http://localhost:4000', 'http://127.0.0.1:4000'])(
    'http solo a localhost: %s',
    (backend) => {
      expect(readDemoEntry(`https://pos.x/?demo=true&backend=${backend}`)?.ok).toBe(true);
    },
  );
  it('http a otro host es inseguro', () => {
    expect(readDemoEntry('https://pos.x/?demo=true&backend=http://b.x')).toEqual(
      err('demo/invalid-link', { reason: 'backend-insecure' }),
    );
  });
  it('sin backend o inválido', () => {
    expect(readDemoEntry('https://pos.x/?demo=true')).toEqual(
      err('demo/invalid-link', { reason: 'backend-missing' }),
    );
    expect(readDemoEntry('https://pos.x/?demo=true&backend=nope')).toEqual(
      err('demo/invalid-link', { reason: 'backend-invalid' }),
    );
  });
});

describe('readConnectReturn', () => {
  const payload = {
    baseUrl: 'https://b.x',
    apiKey: 'k',
    branch: 'CENTRAL',
    pointOfSale: 'Caja 1',
    wipeKey: 'w',
  };
  it('decodifica el fragmento', () => {
    expect(readConnectReturn(`https://pos.x/#connect=${encode(payload)}`)).toEqual(
      ok({ type: 'rest', ...payload }),
    );
  });
  it('acepta type: rest explícito', () => {
    expect(
      readConnectReturn(`https://pos.x/#connect=${encode({ type: 'rest', ...payload })}`),
    ).toEqual(ok({ type: 'rest', ...payload }));
  });
  it('la forma de Google Sheets: type y webAppUrl; el secreto nunca se lee (#133)', () => {
    const sheets = {
      type: 'google-sheets',
      webAppUrl: 'https://script.google.com/macros/s/abc/exec',
      sharedSecret: 'no-viaja',
    };
    expect(readConnectReturn(`https://pos.x/#connect=${encode(sheets)}`)).toEqual(
      ok({ type: 'google-sheets', webAppUrl: 'https://script.google.com/macros/s/abc/exec' }),
    );
  });
  it('Google Sheets con la sucursal y la caja de la página del puente', () => {
    const sheets = {
      type: 'google-sheets',
      webAppUrl: 'https://script.google.com/macros/s/abc/exec',
      branch: ' Centro ',
      pointOfSale: 'Caja 2',
    };
    expect(readConnectReturn(`https://pos.x/#connect=${encode(sheets)}`)).toEqual(
      ok({
        type: 'google-sheets',
        webAppUrl: 'https://script.google.com/macros/s/abc/exec',
        branch: 'Centro',
        pointOfSale: 'Caja 2',
      }),
    );
  });
  it('Google Sheets con una caja en blanco: cuenta como ausente', () => {
    const sheets = {
      type: 'google-sheets',
      webAppUrl: 'https://script.google.com/macros/s/abc/exec',
      branch: 'Centro',
      pointOfSale: '  ',
    };
    expect(readConnectReturn(`https://pos.x/#connect=${encode(sheets)}`)).toEqual(
      ok({
        type: 'google-sheets',
        webAppUrl: 'https://script.google.com/macros/s/abc/exec',
        branch: 'Centro',
      }),
    );
  });
  it('Google Sheets sin webAppUrl https → demo/invalid-return', () => {
    for (const webAppUrl of [
      undefined,
      'no-es-url',
      'http://script.google.com/macros/s/abc/exec',
    ]) {
      const link = `https://pos.x/#connect=${encode({ type: 'google-sheets', webAppUrl })}`;
      expect(readConnectReturn(link)?.ok).toBe(false);
    }
  });
  it('un type desconocido → demo/invalid-return', () => {
    expect(
      readConnectReturn(`https://pos.x/#connect=${encode({ type: 'otro', ...payload })}`)?.ok,
    ).toBe(false);
  });
  it('sin fragmento no hay vuelta', () => {
    expect(readConnectReturn('https://pos.x/')).toBeUndefined();
  });
  it('basura o forma inválida → demo/invalid-return', () => {
    expect(readConnectReturn('https://pos.x/#connect=%%%')?.ok).toBe(false);
    expect(readConnectReturn(`https://pos.x/#connect=${encode({ apiKey: 'k' })}`)?.ok).toBe(false);
    expect(
      readConnectReturn(`https://pos.x/#connect=${encode({ ...payload, baseUrl: 'http://b.x' })}`)
        ?.ok,
    ).toBe(false);
  });
  it('ignora la query string: la config nunca viaja ahí', () => {
    expect(readConnectReturn('https://pos.x/?connect=abc')).toBeUndefined();
  });
});

describe('links de ida y limpieza', () => {
  it('buildOnboardingUrl conserva la query del backend', () => {
    expect(buildOnboardingUrl('https://b.x/alta?x=1', 'https://pos.x/app/', 'w1')).toBe(
      'https://b.x/alta?x=1&return_url=https%3A%2F%2Fpos.x%2Fapp%2F&wipe_key=w1',
    );
  });
  it('returnUrlFor usa origin + pathname (anda en una subruta)', () => {
    expect(returnUrlFor('https://pos.x/app/?demo=true#connect=a')).toBe('https://pos.x/app/');
  });
  it('hasOnboardingParams: un link de demo o la vuelta del alta (#177)', () => {
    expect(hasOnboardingParams('https://pos.x/app/?demo=true&backend=b')).toBe(true);
    expect(hasOnboardingParams('https://pos.x/app/#connect=a')).toBe(true);
    expect(hasOnboardingParams('https://pos.x/app/?otro=1#x=2')).toBe(false);
  });
  it('stripOnboardingParams saca solo lo del onboarding', () => {
    expect(
      stripOnboardingParams('https://pos.x/app/?demo=true&backend=b&template=t&otro=1#connect=a'),
    ).toBe('/app/?otro=1');
  });
});

describe('buildDemoLink (#176)', () => {
  it('arma el link en la misma carpeta, con backend y template', () => {
    const link = buildDemoLink('https://pos.x/0.3.0/?x=1#a', 'https://b.x/connector', 'kiosco');
    const url = new URL(link);
    expect(`${url.origin}${url.pathname}`).toBe('https://pos.x/0.3.0/');
    expect(url.searchParams.get('demo')).toBe('true');
    expect(url.searchParams.get('backend')).toBe('https://b.x/connector');
    expect(url.searchParams.get('template')).toBe('kiosco');
    expect(url.searchParams.get('x')).toBeNull();
    expect(url.hash).toBe('');
  });

  it('sin template no lo pone, y readDemoEntry lo lee de vuelta', () => {
    const link = buildDemoLink('https://pos.x/', 'https://b.x');
    expect(new URL(link).searchParams.has('template')).toBe(false);
    expect(readDemoEntry(link)).toEqual(ok({ backend: 'https://b.x' }));
  });
});
