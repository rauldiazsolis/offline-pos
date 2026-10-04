import { describe, expect, it } from 'vitest';
import {
  parseSwMessage,
  routeRequest,
  staleCaches,
  swCacheName,
  swCachePrefix,
} from './sw-logic.ts';

const SCOPE = 'https://pos.x/v4/';
const PRECACHED = new Set(['https://pos.x/v4/index.html', 'https://pos.x/v4/assets/app-1.js']);
const get = (url: string, mode = 'cors') => ({ method: 'GET', url, mode });

describe('caché del service worker por carpeta (#54)', () => {
  it('el prefijo sale de la carpeta del scope, con el criterio del almacenamiento', () => {
    expect(swCachePrefix('https://pos.x/')).toBe('offline-pos:sw:');
    expect(swCachePrefix(SCOPE)).toBe('offline-pos@/v4/:sw:');
    expect(swCachePrefix('https://pos.x/pos/v4/')).toBe('offline-pos@/pos/v4/:sw:');
    expect(swCacheName(SCOPE, 'abc')).toBe('offline-pos@/v4/:sw:abc');
  });

  it('borra solo las cachés viejas de su carpeta', () => {
    const names = [
      'offline-pos@/v4/:sw:viejo',
      'offline-pos@/v4/:sw:actual',
      'offline-pos@/v5/:sw:otro',
      'offline-pos:sw:raiz',
      'offline-pos@/v4/sub/:sw:hija',
      'otra-app',
    ];
    expect(staleCaches(names, SCOPE, 'offline-pos@/v4/:sw:actual')).toEqual([
      'offline-pos@/v4/:sw:viejo',
    ]);
    expect(staleCaches(names, 'https://pos.x/', 'offline-pos:sw:nuevo')).toEqual([
      'offline-pos:sw:raiz',
    ]);
  });
});

describe('routeRequest', () => {
  it('una navegación dentro del scope recibe el index, con o sin query', () => {
    expect(routeRequest(get('https://pos.x/v4/', 'navigate'), SCOPE, PRECACHED)).toEqual({
      kind: 'navigation',
    });
    expect(
      routeRequest(get('https://pos.x/v4/?demo=true&backend=x', 'navigate'), SCOPE, PRECACHED),
    ).toEqual({ kind: 'navigation' });
  });

  it('un archivo de la lista sale de la caché, sin la query', () => {
    expect(routeRequest(get('https://pos.x/v4/assets/app-1.js?x=1'), SCOPE, PRECACHED)).toEqual({
      kind: 'precached',
      url: 'https://pos.x/v4/assets/app-1.js',
    });
  });

  it('todo lo demás va a la red', () => {
    for (const request of [
      get('https://backend.y/sync/pull'),
      get('https://pos.x/v5/', 'navigate'),
      get('https://pos.x/', 'navigate'),
      get('https://pos.x/v4/version.json'),
      { method: 'POST', url: 'https://pos.x/v4/index.html', mode: 'cors' },
    ]) {
      expect(routeRequest(request, SCOPE, PRECACHED)).toEqual({ kind: 'network' });
    }
  });
});

describe('parseSwMessage', () => {
  it('solo reconoce skip-waiting', () => {
    expect(parseSwMessage({ type: 'skip-waiting' })).toEqual({ type: 'skip-waiting' });
    expect(parseSwMessage({ type: 'otra' })).toBeNull();
    expect(parseSwMessage('skip-waiting')).toBeNull();
  });
});
