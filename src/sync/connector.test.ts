import { describe, expect, it } from 'vitest';
import {
  backendInfoSchema,
  batchLotStatusSchema,
  pullBatchResponseSchema,
  toBackendInfo,
  toPullBatchResult,
} from './connector.ts';

const product = {
  id: 'p1',
  sku: 'S',
  barcodes: [],
  name: 'N',
  price: 1,
  taxRate: 0.21,
  category: 'c',
  tracksStock: true,
  createdAt: '2026-01-01T00:00:00.000Z',
};
const customer = {
  id: 'c1',
  name: 'Ana',
  createdAt: '2026-01-02T00:00:00.000Z',
  blocked: { reason: 'Deuda' },
};

describe('schemas de red v3', () => {
  it('acepta los cuatro estados de lote y issues con eventId opcional', () => {
    for (const status of ['queued', 'processing', 'ok'] as const) {
      expect(batchLotStatusSchema.safeParse({ status }).success).toBe(true);
    }
    expect(
      batchLotStatusSchema.safeParse({
        status: 'issues',
        issues: [{ message: 'x', eventId: 'e1' }, { message: 'y' }],
      }).success,
    ).toBe(true);
    expect(batchLotStatusSchema.safeParse({ status: 'pending' }).success).toBe(false);
    expect(batchLotStatusSchema.safeParse({ status: 'issues', issues: ['texto'] }).success).toBe(
      false,
    );
  });

  it('exige createdAt en productos y clientes y acepta bloqueo', () => {
    const parsed = pullBatchResponseSchema.safeParse({
      products: { items: [product] },
      customers: { items: [customer] },
      stock: [],
      lots: {},
    });
    expect(parsed.success).toBe(true);
    const { createdAt: _omit, ...withoutDate } = product;
    expect(
      pullBatchResponseSchema.safeParse({
        products: { items: [withoutDate] },
        customers: { items: [] },
        stock: [],
        lots: {},
      }).success,
    ).toBe(false);
    const { createdAt: _omitCustomer, ...customerWithoutDate } = customer;
    expect(
      pullBatchResponseSchema.safeParse({
        products: { items: [] },
        customers: { items: [customerWithoutDate] },
        stock: [],
        lots: {},
      }).success,
    ).toBe(false);
  });

  it('toPullBatchResult omite nextCursor ausente y eventId ausente', () => {
    const parsed = pullBatchResponseSchema.parse({
      products: { items: [], nextCursor: 'c9' },
      customers: { items: [] },
      stock: [{ productId: 'p1', quantity: -1.5, updatedAt: 'x' }],
      lots: { l1: { status: 'issues', issues: [{ message: 'x' }] } },
    });
    const result = toPullBatchResult(parsed);
    expect(result.products).toEqual({ items: [], nextCursor: 'c9' });
    expect('nextCursor' in result.customers).toBe(false);
    expect(result.lots).toEqual({ l1: { status: 'issues', issues: [{ message: 'x' }] } });
  });
});

describe('reglas de evolución (4.4.0, #128)', () => {
  const baseProduct = {
    id: 'p1',
    sku: 'S',
    barcodes: [],
    name: 'X',
    price: 1,
    taxRate: 0,
    category: 'c',
    tracksStock: true,
    createdAt: '2026-01-01T00:00:00Z',
  };
  const basePull = {
    products: { items: [baseProduct] },
    customers: { items: [] },
    stock: [],
    lots: {},
  };

  it('ningún schema de red es estricto: campos desconocidos en todos los niveles', () => {
    const parsed = pullBatchResponseSchema.safeParse({
      ...basePull,
      extra: 1,
      products: { items: [{ ...baseProduct, nuevo: true }], otro: 'x' },
      lots: { l1: { status: 'ok', extra: 1 } },
    });
    expect(parsed.success).toBe(true);
    expect(
      backendInfoSchema.safeParse({ contractVersion: '4.4.0', status: 'ok', x: 1 }).success,
    ).toBe(true);
  });

  it('status desconocido de /info → ok; capacidades opcionales', () => {
    const parsed = backendInfoSchema.parse({
      contractVersion: '4.5.0',
      status: 'degraded',
      message: 'm',
    });
    expect(toBackendInfo(parsed)).toEqual({ contractVersion: '4.5.0', status: 'ok', message: 'm' });
    const withCaps = backendInfoSchema.parse({
      contractVersion: '4.4.0',
      status: 'ok',
      capabilities: ['demo-sessions'],
    });
    expect(toBackendInfo(withCaps).capabilities).toEqual(['demo-sessions']);
  });

  it('company opcional (4.5.0): se conserva; mal formada o con nombre vacío, ausente', () => {
    const withCompany = backendInfoSchema.parse({
      contractVersion: '4.5.0',
      status: 'ok',
      company: { name: 'Kiosco Pepe' },
    });
    expect(toBackendInfo(withCompany).company).toEqual({ name: 'Kiosco Pepe' });

    const malformed = backendInfoSchema.parse({
      contractVersion: '4.5.0',
      status: 'ok',
      company: 3,
    });
    expect(toBackendInfo(malformed)).not.toHaveProperty('company');

    const blank = backendInfoSchema.parse({
      contractVersion: '4.5.0',
      status: 'ok',
      company: { name: '  ' },
    });
    expect(toBackendInfo(blank)).not.toHaveProperty('company');
  });

  it('portal opcional (4.6.0, #179): se conserva; mal formado, ausente', () => {
    const base = { contractVersion: '4.6.0', status: 'ok' };
    const withPortal = backendInfoSchema.parse({
      ...base,
      portal: { command: 'PANEL', label: 'Panel del backend' },
    });
    expect(toBackendInfo(withPortal).portal).toEqual({
      command: 'PANEL',
      label: 'Panel del backend',
    });
    for (const portal of [
      { command: 'panel', label: 'x' },
      { command: '/PANEL', label: 'x' },
      { command: 'P', label: 'x' },
      { command: 'A'.repeat(17), label: 'x' },
      { command: 'PANEL', label: '  ' },
      'PANEL',
    ]) {
      expect(toBackendInfo(backendInfoSchema.parse({ ...base, portal }))).not.toHaveProperty(
        'portal',
      );
    }
  });

  it('lo que el POS no entiende de un lote es "terminado con aviso", nunca processing', () => {
    const parsed = pullBatchResponseSchema.parse({
      ...basePull,
      lots: {
        l1: { status: 'archived' },
        l2: { status: 'issues', issues: ['texto'] },
        l3: 42,
      },
    });
    expect(toPullBatchResult(parsed).lots).toEqual({
      l1: {
        status: 'issues',
        issues: [{ message: 'El backend informó el estado «archived», que este POS no conoce.' }],
      },
      l2: {
        status: 'issues',
        issues: [
          {
            message:
              'El backend informó problemas con este lote en un formato que el POS no entiende.',
          },
        ],
      },
      l3: {
        status: 'issues',
        issues: [{ message: 'El backend informó un estado de lote que este POS no entiende.' }],
      },
    });
  });

  it('notices: severidad desconocida → info; uno mal formado se descarta sin tirar el pull', () => {
    const parsed = pullBatchResponseSchema.parse({
      ...basePull,
      notices: [
        { id: 'n1', severity: 'fatal', message: 'a' },
        { id: 'n2', message: 42 },
        { id: 'n3', severity: 'warning', message: 'b', ref: { type: 'sale', id: 's1' } },
      ],
    });
    expect(toPullBatchResult(parsed).notices).toEqual([
      { id: 'n1', severity: 'info', message: 'a' },
      { id: 'n3', severity: 'warning', message: 'b', ref: { type: 'sale', id: 's1' } },
    ]);
  });

  it('sin notices, el resultado no trae la clave', () => {
    expect('notices' in toPullBatchResult(pullBatchResponseSchema.parse(basePull))).toBe(false);
  });
});
