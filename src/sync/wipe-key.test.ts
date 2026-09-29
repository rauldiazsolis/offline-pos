import { beforeEach, describe, expect, it } from 'vitest';
import { consumeWipeKey, issueWipeKey, WIPE_KEY_TTL_MS } from './wipe-key.ts';

const now = new Date('2026-09-28T12:00:00Z');

beforeEach(() => {
  localStorage.clear();
});

describe('wipe_key del onboarding (#128)', () => {
  it('se emite, se consume una vez y no vuelve a valer', () => {
    const key = issueWipeKey(now, () => 'k1');
    expect(key).toBe('k1');
    expect(consumeWipeKey('k1', now)).toBe(true);
    expect(consumeWipeKey('k1', now)).toBe(false);
  });

  it('otra clave no vale y no consume la emitida', () => {
    issueWipeKey(now, () => 'k1');
    expect(consumeWipeKey('k2', now)).toBe(false);
    expect(consumeWipeKey('k1', now)).toBe(true);
  });

  it('vence a las 2 h', () => {
    issueWipeKey(now, () => 'k1');
    expect(consumeWipeKey('k1', new Date(now.getTime() + WIPE_KEY_TTL_MS + 1))).toBe(false);
  });

  it('sin clave o con lo guardado inválido, false', () => {
    expect(consumeWipeKey(undefined, now)).toBe(false);
    localStorage.setItem('offline-pos:pending-wipe-key', 'basura');
    expect(consumeWipeKey('k1', now)).toBe(false);
  });
});
