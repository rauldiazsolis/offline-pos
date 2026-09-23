import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConnectorProduct } from './connector.ts';
import { err, ok } from '../domain/result.ts';
import type { LocalDataSummary } from '../storage/local-data.ts';
import { fakeConnector } from '../test/fake-connector.ts';
import type { SyncConfig } from './config.ts';
import { originKey, planConnectionChange, probeConnection, withTimeout } from './connection.ts';
import { tryAcquireSyncLock } from './engine.ts';

afterEach(() => {
  vi.unstubAllGlobals();
});

const config: SyncConfig = { type: 'rest', baseUrl: 'https://api.example.com' };

const product: ConnectorProduct = {
  id: 'p1',
  sku: 'S1',
  barcodes: [],
  name: 'Arroz',
  price: 100,
  taxRate: 0.21,
  category: 'x',
  tracksStock: false,
  createdAt: '2025-01-01T00:00:00.000Z',
};

describe('withTimeout', () => {
  it('devuelve el resultado si llega a tiempo', async () => {
    const result = await withTimeout(Promise.resolve(ok(42)), 1000);

    expect(result).toEqual({ ok: true, value: 42 });
  });

  it('devuelve sync/timeout si vence', async () => {
    const never = new Promise<never>(() => undefined);

    const result = await withTimeout(never, 30);

    expect(result).toEqual({ ok: false, error: 'sync/timeout', meta: { seconds: 1 } });
  });
});

describe('probeConnection', () => {
  it('trae productos, stock y clientes en memoria, con los cursores', async () => {
    const connector = fakeConnector({
      pullBatch: () =>
        Promise.resolve(
          ok({
            products: { items: [product], nextCursor: 'cur-p' },
            stock: [{ productId: 'p1', quantity: 5, updatedAt: '2026-01-01T00:00:00.000Z' }],
            customers: {
              items: [{ id: 'c1', name: 'Ana', createdAt: '2025-01-01T00:00:00.000Z' }],
              nextCursor: 'cur-c',
            },
            lots: {},
          }),
        ),
    });

    const result = await probeConnection(config, { connector });

    expect(result).toEqual({
      ok: true,
      value: {
        products: [product],
        stock: [{ productId: 'p1', quantity: 5, updatedAt: '2026-01-01T00:00:00.000Z' }],
        customers: [{ id: 'c1', name: 'Ana', createdAt: '2025-01-01T00:00:00.000Z' }],
        cursors: { products: 'cur-p', customers: 'cur-c' },
      },
    });
  });

  it('sin cursores en la respuesta, no los inventa', async () => {
    const result = await probeConnection(config, { connector: fakeConnector() });

    expect(result).toEqual({
      ok: true,
      value: { products: [], stock: [], customers: [], cursors: {} },
    });
  });

  it('propaga la falla del pull tal cual', async () => {
    const failure = err('sync/request-failed', { status: 401, message: 'x' });
    const connector = fakeConnector({ pullBatch: () => Promise.resolve(failure) });

    const result = await probeConnection(config, { connector });

    expect(result).toEqual(failure);
  });

  it('pide sin cursores y sin lotes de interés — un candidato nuevo no tiene lotes en vuelo', async () => {
    const pullBatch = vi
      .fn()
      .mockResolvedValue(
        ok({ products: { items: [] }, customers: { items: [] }, stock: [], lots: {} }),
      );

    await probeConnection(config, { connector: fakeConnector({ pullBatch }) });

    expect(pullBatch).toHaveBeenCalledWith({
      deviceId: expect.any(String) as unknown,
      cursors: {},
      pendingLotIds: [],
    });
  });

  it('un backend colgado devuelve sync/timeout en vez de esperar para siempre', async () => {
    const connector = fakeConnector({
      pullBatch: () => new Promise<never>(() => undefined),
    });

    const result = await probeConnection(config, { connector, timeoutMs: 30 });

    expect(result).toMatchObject({ ok: false, error: 'sync/timeout' });
  });

  it('sin conector inyectado, arma el real desde la config (REST: POST a {baseUrl}/sync/pull)', async () => {
    const fetchMock = vi.fn((_url: string) =>
      Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () =>
          Promise.resolve({
            products: { items: [] },
            customers: { items: [] },
            stock: [],
            lots: {},
          }),
      } as Response),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await probeConnection(config);

    expect(result.ok).toBe(true);
    const paths = fetchMock.mock.calls.map(([url]) => new URL(url).pathname);
    expect(paths).toEqual(['/sync/pull']);
  });
});

describe('probeConnection — convivencia con el motor de sync', () => {
  it('espera a que termine un ciclo en curso antes de tocar la red', async () => {
    const release = tryAcquireSyncLock();
    if (release === undefined) throw new Error('el cerrojo debería estar libre');
    const pullBatch = vi.fn(() =>
      Promise.resolve(
        ok({ products: { items: [] }, customers: { items: [] }, stock: [], lots: {} }),
      ),
    );

    const probing = probeConnection(config, { connector: fakeConnector({ pullBatch }) });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(pullBatch).not.toHaveBeenCalled();

    release();
    const result = await probing;

    expect(result.ok).toBe(true);
    expect(pullBatch).toHaveBeenCalledTimes(1);
  });

  it('mientras prueba tiene el cerrojo: ningún ciclo de sync puede arrancar en paralelo', async () => {
    let lockDuringProbe: unknown = 'sin medir';
    const connector = fakeConnector({
      pullBatch: () => {
        lockDuringProbe = tryAcquireSyncLock();
        return Promise.resolve(
          ok({ products: { items: [] }, customers: { items: [] }, stock: [], lots: {} }),
        );
      },
    });

    await probeConnection(config, { connector });

    expect(lockDuringProbe).toBeUndefined();
  });

  it('al terminar (bien o mal) libera el cerrojo', async () => {
    await probeConnection(config, {
      connector: fakeConnector({
        pullBatch: () => Promise.resolve(err('sync/request-failed', { message: 'boom' })),
      }),
    });

    const release = tryAcquireSyncLock();
    expect(release).not.toBeUndefined();
    release?.();
  });

  it('si el ciclo en curso no termina a tiempo, devuelve connection/sync-busy sin probar', async () => {
    const release = tryAcquireSyncLock();
    if (release === undefined) throw new Error('el cerrojo debería estar libre');
    const pullBatch = vi.fn(() =>
      Promise.resolve(
        ok({ products: { items: [] }, customers: { items: [] }, stock: [], lots: {} }),
      ),
    );

    const result = await probeConnection(config, {
      connector: fakeConnector({ pullBatch }),
      lockWaitMs: 40,
    });
    release();

    expect(result).toEqual({ ok: false, error: 'connection/sync-busy', meta: undefined });
    expect(pullBatch).not.toHaveBeenCalled();
  });
});

describe('probeConnection — progreso', () => {
  it('informa el progreso: pulling sin cerrojo tomado', async () => {
    const stages: string[] = [];
    await probeConnection(config, {
      connector: fakeConnector(),
      onProgress: (stage) => stages.push(stage),
    });
    expect(stages).toEqual(['pulling']);
  });

  it('informa waiting-lock si hay un ciclo en curso', async () => {
    const release = tryAcquireSyncLock();
    const stages: string[] = [];
    const probe = probeConnection(config, {
      connector: fakeConnector(),
      onProgress: (stage) => stages.push(stage),
    });
    release?.();
    await probe;
    expect(stages).toEqual(['waiting-lock', 'pulling']);
  });
});

describe('originKey', () => {
  it('normaliza: sin barra final y con el host en minúsculas', () => {
    expect(originKey({ type: 'rest', baseUrl: 'https://Api.Example.com/' })).toBe(
      'https://api.example.com',
    );
    expect(originKey({ type: 'rest', baseUrl: 'https://api.example.com/v1/' })).toBe(
      'https://api.example.com/v1',
    );
  });

  it('el type no forma parte del origen: rest y rest-demo con el mismo endpoint son el mismo backend', () => {
    expect(originKey({ type: 'rest-demo', baseUrl: 'https://Api.Example.com/' })).toBe(
      originKey({ type: 'rest', baseUrl: 'https://api.example.com' }),
    );
  });

  it('usa webAppUrl para Google Sheets', () => {
    expect(
      originKey({
        type: 'google-sheets',
        webAppUrl: 'https://script.google.com/macros/s/abc/exec',
      }),
    ).toBe('https://script.google.com/macros/s/abc/exec');
  });

  it('la API key, el secreto y el locale no forman parte del origen', () => {
    expect(
      originKey({
        type: 'rest',
        baseUrl: 'https://api.example.com',
        apiKey: 'a',
        locale: 'es-AR',
      }),
    ).toBe(originKey({ type: 'rest', baseUrl: 'https://api.example.com', apiKey: 'b' }));
  });

  it('dos backends distintos tienen orígenes distintos', () => {
    expect(originKey({ type: 'rest', baseUrl: 'https://a.example.com' })).not.toBe(
      originKey({ type: 'rest', baseUrl: 'https://b.example.com' }),
    );
  });
});

describe('planConnectionChange', () => {
  const empty: LocalDataSummary = {
    products: 0,
    customers: 0,
    sales: 0,
    cashSessions: 0,
    pendingOutbox: 0,
    pendingSales: 0,
    draftCartLines: 0,
  };
  const withSales: LocalDataSummary = { ...empty, products: 10, sales: 3 };
  const other: SyncConfig = { type: 'rest', baseUrl: 'https://otro.example.com' };

  it('mismo origen (aunque cambie la API key): no borra ni pregunta, tenga o no datos', () => {
    const plan = planConnectionChange({
      current: config,
      candidate: { ...config, apiKey: 'nueva' },
      localData: withSales,
    });

    expect(plan).toEqual({ wipe: false, needsConfirmation: false });
  });

  it('origen distinto con datos del usuario: borra y pide confirmación', () => {
    const plan = planConnectionChange({ current: config, candidate: other, localData: withSales });

    expect(plan).toEqual({ wipe: true, needsConfirmation: true });
  });

  it('origen distinto con solo catálogo y clientes: borra sin preguntar', () => {
    const plan = planConnectionChange({
      current: config,
      candidate: other,
      localData: { ...empty, products: 50, customers: 20 },
    });

    expect(plan).toEqual({ wipe: true, needsConfirmation: false });
  });

  it('sin config actual pero con datos del usuario: origen desconocido, pide confirmación', () => {
    const plan = planConnectionChange({
      current: undefined,
      candidate: config,
      localData: withSales,
    });

    expect(plan).toEqual({ wipe: true, needsConfirmation: true });
  });

  it('primer arranque (sin config ni datos): borra (no-op) y no pregunta', () => {
    const plan = planConnectionChange({ current: undefined, candidate: config, localData: empty });

    expect(plan).toEqual({ wipe: true, needsConfirmation: false });
  });
});
