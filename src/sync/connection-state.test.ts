import { describe, expect, it } from 'vitest';
import { err, ok } from '../domain/result.ts';
import { connectionState } from './connection-state.ts';

describe('connectionState', () => {
  it('sin config guardada: unconfigured', () => {
    expect(connectionState(err('sync/config-missing', undefined))).toBe('unconfigured');
  });

  it('config inválida: unconfigured', () => {
    expect(connectionState(err('sync/config-invalid', { issues: [] }))).toBe('unconfigured');
  });

  it('config sin verifiedAt (incluye las guardadas antes de la Etapa 2b): unverified', () => {
    expect(connectionState(ok({ type: 'rest', baseUrl: 'https://api.example.com' }))).toBe(
      'unverified',
    );
  });

  it('config con verifiedAt: active', () => {
    expect(
      connectionState(
        ok({
          type: 'rest',
          baseUrl: 'https://api.example.com',
          verifiedAt: '2026-01-01T00:00:00.000Z',
        }),
      ),
    ).toBe('active');
  });
});
