import { describe, expect, it } from 'vitest';
import { restConfigFields, restConfigSchema } from './config.ts';

describe('restConfigSchema', () => {
  it('acepta una config mínima sin apiKey', () => {
    const parsed = restConfigSchema.safeParse({ type: 'rest', baseUrl: 'https://api.example.com' });

    expect(parsed.success).toBe(true);
  });

  it('acepta apiKey opcional', () => {
    const parsed = restConfigSchema.safeParse({
      type: 'rest',
      baseUrl: 'https://api.example.com',
      apiKey: 'secret',
    });

    expect(parsed.success).toBe(true);
  });

  it('rechaza una baseUrl que no es una URL', () => {
    const parsed = restConfigSchema.safeParse({ type: 'rest', baseUrl: 'no-es-una-url' });

    expect(parsed.success).toBe(false);
  });

  it('rechaza un type distinto de rest', () => {
    const parsed = restConfigSchema.safeParse({
      type: 'google-sheets',
      baseUrl: 'https://api.example.com',
    });

    expect(parsed.success).toBe(false);
  });
});

describe('restConfigFields', () => {
  it('lista baseUrl (obligatorio) y apiKey (opcional), en ese orden', () => {
    expect(restConfigFields).toEqual([
      {
        key: 'baseUrl',
        label: 'URL del sistema externo',
        optional: false,
        placeholder: 'https://api.miempresa.com',
      },
      {
        key: 'apiKey',
        label: 'API key',
        optional: true,
        placeholder: 'Token de acceso, si el backend lo exige',
      },
    ]);
  });
});
