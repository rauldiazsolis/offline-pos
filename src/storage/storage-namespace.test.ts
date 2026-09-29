import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { db } from './db.ts';
import {
  localStoragePrefixFor,
  STORAGE_NAMESPACE,
  storageKey,
  storageNamespaceFor,
} from './storage-namespace.ts';

describe('storageNamespaceFor (#148)', () => {
  it('en la raíz sigue siendo offline-pos: las terminales actuales no se enteran', () => {
    expect(storageNamespaceFor('/')).toBe('offline-pos');
    expect(storageNamespaceFor('/index.html')).toBe('offline-pos');
  });

  it('en una carpeta lleva la carpeta, con o sin index.html', () => {
    expect(storageNamespaceFor('/0.1.0/')).toBe('offline-pos@/0.1.0/');
    expect(storageNamespaceFor('/0.1.0/index.html')).toBe('offline-pos@/0.1.0/');
    expect(storageNamespaceFor('/pos/0.1.0/')).toBe('offline-pos@/pos/0.1.0/');
  });

  it('sin barra final la carpeta es la de arriba (la app no llega a cargar: sus assets dan 404)', () => {
    expect(storageNamespaceFor('/0.1.0')).toBe('offline-pos');
  });

  it('el prefijo de una carpeta nunca abarca las claves de otra', () => {
    const folders = ['/', '/0.1.0/', '/0.1.0/sub/', '/0.1.1/', '/pos/0.1.0/'];
    for (const a of folders) {
      for (const b of folders) {
        if (a === b) {
          continue;
        }
        const keyOfB = `${localStoragePrefixFor(b)}sync-config`;
        expect(keyOfB.startsWith(localStoragePrefixFor(a))).toBe(false);
      }
    }
  });
});

describe('en jsdom (servido en /)', () => {
  it('el namespace, las claves y la base son los de siempre', () => {
    expect(STORAGE_NAMESPACE).toBe('offline-pos');
    expect(storageKey('sync-config')).toBe('offline-pos:sync-config');
    expect(db.name).toBe('offline-pos');
  });
});
