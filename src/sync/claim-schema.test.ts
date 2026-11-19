import { describe, expect, it } from 'vitest';
import { claimResponseSchema, toClaimResponse } from './claim-schema.ts';
import { deviceRevokedBodySchema, incompatibleContractBodySchema } from './connector.ts';

describe('respuesta de POST /claim (4.7.0, #230)', () => {
  it('acepta la conexión mínima y omite los opcionales ausentes', () => {
    const parsed = claimResponseSchema.parse({
      apiKey: 'key-1',
      branch: 'Centro',
      pointOfSale: 'Caja 1',
    });
    expect(toClaimResponse(parsed)).toEqual({
      apiKey: 'key-1',
      branch: 'Centro',
      pointOfSale: 'Caja 1',
    });
  });

  it('conserva company y register; mal formados o vacíos cuentan como ausentes', () => {
    const full = toClaimResponse(
      claimResponseSchema.parse({
        apiKey: 'k',
        branch: 'b',
        pointOfSale: 'p',
        company: { name: 'Kiosco Pepe' },
        register: { name: 'Caja 1' },
      }),
    );
    expect(full.company).toEqual({ name: 'Kiosco Pepe' });
    expect(full.register).toEqual({ name: 'Caja 1' });

    const bad = toClaimResponse(
      claimResponseSchema.parse({
        apiKey: 'k',
        branch: 'b',
        pointOfSale: 'p',
        company: { name: '  ' },
        register: 'Caja 1',
      }),
    );
    expect('company' in bad).toBe(false);
    expect('register' in bad).toBe(false);
  });

  it('ignora campos desconocidos y exige apiKey no vacía', () => {
    expect(
      claimResponseSchema.safeParse({ apiKey: 'k', branch: 'b', pointOfSale: 'p', extra: 1 })
        .success,
    ).toBe(true);
    expect(
      claimResponseSchema.safeParse({ apiKey: ' ', branch: 'b', pointOfSale: 'p' }).success,
    ).toBe(false);
    expect(claimResponseSchema.safeParse({ branch: 'b', pointOfSale: 'p' }).success).toBe(false);
  });
});

describe('los dos 409 (4.7.0, #230)', () => {
  it('device-revoked e incompatible-contract se distinguen por code', () => {
    const revoked = { code: 'device-revoked', message: 'Vinculada en otro equipo' };
    const incompatible = { code: 'incompatible-contract', contractVersion: '5.0.0' };
    expect(deviceRevokedBodySchema.safeParse(revoked).success).toBe(true);
    expect(deviceRevokedBodySchema.safeParse({ code: 'device-revoked' }).success).toBe(true);
    expect(deviceRevokedBodySchema.safeParse(incompatible).success).toBe(false);
    expect(incompatibleContractBodySchema.safeParse(revoked).success).toBe(false);
  });
});
