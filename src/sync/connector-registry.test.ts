import { afterEach, describe, expect, it, vi } from 'vitest';
import type { z } from 'zod';
import { googleSheetsConfigSchema } from '../connectors/google-sheets/config.ts';
import { restConfigSchema } from '../connectors/rest/config.ts';
import {
  CONNECTOR_TYPES,
  connectorConfigSchema,
  connectorFields,
  connectorLabel,
  createConnector,
  toFieldValues,
} from './connector-registry.ts';

afterEach(() => {
  vi.unstubAllGlobals();
});

function okResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: () => Promise.resolve(body),
  } as Response;
}

describe('connectorConfigSchema', () => {
  it('discrimina por type: rest', () => {
    const parsed = connectorConfigSchema.safeParse({
      type: 'rest',
      baseUrl: 'https://api.example.com',
    });

    expect(parsed.success).toBe(true);
  });

  it('discrimina por type: google-sheets', () => {
    const parsed = connectorConfigSchema.safeParse({
      type: 'google-sheets',
      webAppUrl: 'https://script.google.com/macros/s/abc/exec',
    });

    expect(parsed.success).toBe(true);
  });

  it('rechaza un type desconocido', () => {
    expect(connectorConfigSchema.safeParse({ type: 'csv', path: 'x' }).success).toBe(false);
  });

  it('rechaza una config rest sin baseUrl', () => {
    expect(connectorConfigSchema.safeParse({ type: 'rest' }).success).toBe(false);
  });

  it('rechaza una config google-sheets con webAppUrl inválida', () => {
    expect(
      connectorConfigSchema.safeParse({ type: 'google-sheets', webAppUrl: 'no-es-una-url' })
        .success,
    ).toBe(false);
  });
});

describe('createConnector', () => {
  it('type rest: arma el conector REST (GET a {baseUrl}/products)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ items: [] }));
    vi.stubGlobal('fetch', fetchMock);

    const connector = createConnector({ type: 'rest', baseUrl: 'https://api.example.com' });
    await connector.pullProducts({});

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe('https://api.example.com/products');
  });

  it('type google-sheets: arma el conector de Sheets (POST al Web App con la acción)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ ok: true, data: { items: [] } }));
    vi.stubGlobal('fetch', fetchMock);

    const connector = createConnector({
      type: 'google-sheets',
      webAppUrl: 'https://script.google.com/macros/s/abc/exec',
    });
    await connector.pullProducts({});

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://script.google.com/macros/s/abc/exec');
    expect(JSON.parse(init.body as string)).toMatchObject({ action: 'pullProducts' });
  });
});

describe('CONNECTOR_TYPES', () => {
  it('lista REST y Google Sheets con su etiqueta', () => {
    expect(CONNECTOR_TYPES.map((info) => [info.type, info.label])).toEqual([
      ['rest', 'REST genérico'],
      ['google-sheets', 'Google Sheets'],
    ]);
  });

  const schemas = { rest: restConfigSchema, 'google-sheets': googleSheetsConfigSchema };

  it.each(CONNECTOR_TYPES)(
    'los campos de $type coinciden con las claves y la opcionalidad de su schema',
    (info) => {
      const shape: Record<string, z.ZodType> = schemas[info.type].shape;
      const schemaKeys = Object.keys(shape).filter((key) => key !== 'type');

      expect(info.fields.map((field) => field.key)).toEqual(schemaKeys);
      for (const field of info.fields) {
        const acceptsUndefined = shape[field.key]?.safeParse(undefined).success;
        expect(field.optional).toBe(acceptsUndefined);
      }
    },
  );
});

describe('connectorLabel / connectorFields', () => {
  it('devuelven la etiqueta y los campos del tipo pedido', () => {
    expect(connectorLabel('google-sheets')).toBe('Google Sheets');
    expect(connectorFields('rest').map((field) => field.key)).toEqual(['baseUrl', 'apiKey']);
  });
});

describe('toFieldValues', () => {
  it('rest: baseUrl y apiKey (ausente → cadena vacía)', () => {
    expect(toFieldValues({ type: 'rest', baseUrl: 'https://api.example.com' })).toEqual({
      baseUrl: 'https://api.example.com',
      apiKey: '',
    });
  });

  it('google-sheets: webAppUrl y sharedSecret', () => {
    expect(
      toFieldValues({
        type: 'google-sheets',
        webAppUrl: 'https://script.google.com/macros/s/abc/exec',
        sharedSecret: 's3cr3t',
      }),
    ).toEqual({ webAppUrl: 'https://script.google.com/macros/s/abc/exec', sharedSecret: 's3cr3t' });
  });

  it('devuelve exactamente las claves que declara connectorFields', () => {
    expect(Object.keys(toFieldValues({ type: 'rest', baseUrl: 'https://a.com' }))).toEqual(
      connectorFields('rest').map((field) => field.key),
    );
    expect(
      Object.keys(toFieldValues({ type: 'google-sheets', webAppUrl: 'https://a.com' })),
    ).toEqual(connectorFields('google-sheets').map((field) => field.key));
  });
});
