import { describe, expect, it } from 'vitest';
import { err, ok } from '../domain/result.ts';
import {
  buildOnboardingUrl,
  readConnectReturn,
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
    expect(readConnectReturn(`https://pos.x/#connect=${encode(payload)}`)).toEqual(ok(payload));
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
  it('stripOnboardingParams saca solo lo del onboarding', () => {
    expect(
      stripOnboardingParams('https://pos.x/app/?demo=true&backend=b&template=t&otro=1#connect=a'),
    ).toBe('/app/?otro=1');
  });
});
