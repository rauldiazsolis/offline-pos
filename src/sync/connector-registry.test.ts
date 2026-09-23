import { afterEach, describe, expect, it, vi } from 'vitest';
import type { z } from 'zod';
import { googleSheetsConfigSchema } from '../connectors/google-sheets/config.ts';
import { restConfigSchema } from '../connectors/rest/config.ts';
import { restDemoConfigSchema } from '../connectors/rest-demo/config.ts';
import {
  connectorInfo,
  CONNECTOR_TYPES,
  connectorCommands,
  connectorConfigSchema,
  connectorFields,
  connectorLabel,
  connectorPullMode,
  createConnector,
  toFieldValues,
  secretConfigKeys,
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
  it('type rest: arma el conector REST (POST a {baseUrl}/sync/pull)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        okResponse({ products: { items: [] }, customers: { items: [] }, stock: [], lots: {} }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const connector = createConnector({ type: 'rest', baseUrl: 'https://api.example.com' });
    await connector.pullBatch({ deviceId: 'dev-1', cursors: {}, pendingLotIds: [] });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe('https://api.example.com/sync/pull');
  });

  it('type rest-demo: arma el mismo conector REST (POST a {baseUrl}/sync/pull)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        okResponse({ products: { items: [] }, customers: { items: [] }, stock: [], lots: {} }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const connector = createConnector({ type: 'rest-demo', baseUrl: 'http://localhost:4000' });
    await connector.pullBatch({ deviceId: 'dev-1', cursors: {}, pendingLotIds: [] });

    expect((fetchMock.mock.calls[0] as [string])[0]).toBe('http://localhost:4000/sync/pull');
  });

  it('type google-sheets: arma el conector de Sheets (POST al Web App con la acción)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({
        ok: true,
        data: { products: { items: [] }, customers: { items: [] }, lots: {} },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const connector = createConnector({
      type: 'google-sheets',
      webAppUrl: 'https://script.google.com/macros/s/abc/exec',
    });
    await connector.pullBatch({ deviceId: 'dev-1', cursors: {}, pendingLotIds: [] });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://script.google.com/macros/s/abc/exec');
    expect(JSON.parse(init.body as string)).toMatchObject({ action: 'pullBatch' });
  });
});

describe('CONNECTOR_TYPES', () => {
  it('cada tipo tiene descripción e instrucciones', () => {
    for (const info of CONNECTOR_TYPES) {
      expect(info.description.trim()).not.toBe('');
      expect(info.setupHelp.length).toBeGreaterThan(0);
    }
  });

  it('connectorInfo devuelve la entrada del tipo', () => {
    expect(connectorInfo('google-sheets').label).toBe('Google Sheets');
  });

  it('lista REST, REST (minibackend de demo) y Google Sheets con su etiqueta', () => {
    expect(CONNECTOR_TYPES.map((info) => [info.type, info.label])).toEqual([
      ['rest', 'REST genérico'],
      ['rest-demo', 'REST (minibackend de demo)'],
      ['google-sheets', 'Google Sheets'],
    ]);
  });

  const schemas = {
    rest: restConfigSchema,
    'rest-demo': restDemoConfigSchema,
    'google-sheets': googleSheetsConfigSchema,
  };

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

describe('connectorCommands', () => {
  it('rest-demo declara /DEMO_RESET', () => {
    expect(connectorCommands('rest-demo')).toEqual([
      {
        name: 'DEMO_RESET',
        description: 'Borrar todos los datos locales y reiniciar la demo',
        action: 'demo-reset',
      },
    ]);
  });

  it('rest, google-sheets y "sin conector" no declaran comandos propios', () => {
    expect(connectorCommands('rest')).toEqual([]);
    expect(connectorCommands('google-sheets')).toEqual([]);
    expect(connectorCommands(null)).toEqual([]);
  });
});

describe('connectorPullMode (Etapa de la foto completa)', () => {
  it('REST y el minibackend entregan deltas por since; Sheets no tiene delta y cada pull es completo', () => {
    expect(connectorPullMode('rest')).toBe('delta');
    expect(connectorPullMode('rest-demo')).toBe('delta');
    expect(connectorPullMode('google-sheets')).toBe('snapshot');
  });

  it('todos los tipos lo declaran', () => {
    for (const info of CONNECTOR_TYPES) {
      expect(['delta', 'snapshot']).toContain(info.pullMode);
    }
  });
});

describe('toFieldValues', () => {
  it('rest: baseUrl y apiKey (ausente → cadena vacía)', () => {
    expect(toFieldValues({ type: 'rest', baseUrl: 'https://api.example.com' })).toEqual({
      baseUrl: 'https://api.example.com',
      apiKey: '',
    });
  });

  it('rest-demo: baseUrl y apiKey, igual que rest', () => {
    expect(
      toFieldValues({ type: 'rest-demo', baseUrl: 'http://localhost:4000', apiKey: 'k' }),
    ).toEqual({
      baseUrl: 'http://localhost:4000',
      apiKey: 'k',
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

describe('secretConfigKeys', () => {
  it('junta las credenciales que marca cada conector', () => {
    expect([...secretConfigKeys()].sort()).toEqual(['apiKey', 'sharedSecret']);
  });
});
