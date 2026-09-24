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

  it('config con verifiedAt, sucursal y punto de venta: active', () => {
    expect(
      connectionState(
        ok({
          type: 'rest',
          baseUrl: 'https://api.example.com',
          verifiedAt: '2026-01-01T00:00:00.000Z',
          branch: 'Centro',
          pointOfSale: 'Caja 1',
        }),
      ),
    ).toBe('active');
  });

  it('verificada pero sin sucursal o punto de venta es incomplete', () => {
    expect(connectionState(ok({ type: 'rest', baseUrl: 'http://x', verifiedAt: 'y' }))).toBe(
      'incomplete',
    );
    expect(
      connectionState(
        ok({ type: 'rest', baseUrl: 'http://x', verifiedAt: 'y', branch: 'A', pointOfSale: '  ' }),
      ),
    ).toBe('incomplete');
  });

  it('verificada con identidad completa es active', () => {
    expect(
      connectionState(
        ok({ type: 'rest', baseUrl: 'http://x', verifiedAt: 'y', branch: 'A', pointOfSale: 'B' }),
      ),
    ).toBe('active');
  });
});
