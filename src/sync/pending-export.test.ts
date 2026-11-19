import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { OutboxEvent } from '../domain/outbox.ts';
import type { Sale } from '../domain/sale.ts';
import { db } from '../storage/db.ts';
import { saveSyncConfig } from './config.ts';
import {
  buildPendingExport,
  buildPendingExportFile,
  pendingExportFileName,
} from './pending-export.ts';
import { addAwaitingLot, setCurrentPushLot } from './push-lot.ts';

const NOW = '2026-11-19T15:00:00.000Z';

function sale(id: string, total: number): Sale {
  return {
    id,
    lines: [{ kind: 'freeform', description: 'Algo', qty: 1, unitPrice: total }],
    payments: [{ method: 'cash', amount: total }],
    total,
    status: 'closed',
    createdAt: '2026-11-19T10:00:00.000Z',
  };
}

function saleEvent(
  id: string,
  total: number,
  status: OutboxEvent['status'],
  createdAt: string,
): OutboxEvent {
  return {
    type: 'sale',
    sale: { ...sale(id, total), createdAt },
    id,
    status,
    createdAt,
    origin: { branch: 'CENTRAL', pointOfSale: 'Caja 1' },
  };
}

beforeEach(async () => {
  await db.open();
  saveSyncConfig({
    type: 'rest',
    baseUrl: 'https://b.x',
    apiKey: 'secreta',
    branch: 'CENTRAL',
    pointOfSale: 'Caja 1',
    verifiedAt: NOW,
  });
});

afterEach(async () => {
  db.close();
  await db.delete();
  localStorage.clear();
});

describe('buildPendingExport (4.7.0, #230)', () => {
  it('lo no enviado, con el lote congelado marcado, y la conexión sin la apiKey', async () => {
    await db.outbox.bulkAdd([
      saleEvent('s2', 50, 'pending', '2026-11-19T11:00:00.000Z'),
      saleEvent('s1', 100.1, 'pending', '2026-11-19T10:00:00.000Z'),
      {
        type: 'customer-payment',
        payment: {
          id: 'p1',
          customerId: 'c1',
          payments: [{ method: 'cash', amount: 30 }],
          total: 30,
          createdAt: '2026-11-19T12:00:00.000Z',
        },
        id: 'p1',
        status: 'pending',
        createdAt: '2026-11-19T12:00:00.000Z',
      },
      saleEvent('ya-confirmado', 999, 'synced', '2026-11-19T09:00:00.000Z'),
    ]);
    setCurrentPushLot({
      id: 'lote-congelado',
      eventIds: ['s1'],
      createdAt: NOW,
      retries: 2,
      nextAttemptAt: NOW,
    });

    const exported = await buildPendingExport(NOW);

    expect(exported).toMatchObject({
      format: 'pos-pendientes',
      version: 1,
      exportedAt: NOW,
      deviceId: 'test-device-id',
      training: false,
      connection: {
        type: 'rest',
        baseUrl: 'https://b.x',
        branch: 'CENTRAL',
        pointOfSale: 'Caja 1',
      },
    });
    expect(JSON.stringify(exported)).not.toContain('secreta');
    expect(exported.notSent.events.map((event) => [event.id, event.lotId])).toEqual([
      ['s1', 'lote-congelado'],
      ['s2', undefined],
      ['p1', undefined],
    ]);
    expect(exported.notSent.events[0]).toEqual({
      id: 's1',
      type: 'sale',
      createdAt: '2026-11-19T10:00:00.000Z',
      origin: { branch: 'CENTRAL', pointOfSale: 'Caja 1' },
      lotId: 'lote-congelado',
      payload: { sale: { ...sale('s1', 100.1), createdAt: '2026-11-19T10:00:00.000Z' } },
    });
    expect(exported.notSent.summary).toEqual({
      events: 3,
      byType: { sale: { count: 2, total: 150.1 }, 'customer-payment': { count: 1, total: 30 } },
    });
  });

  it('los de lotes en espera van aparte, como enviados sin confirmar', async () => {
    await db.outbox.bulkAdd([
      saleEvent('s1', 10, 'synced', '2026-11-19T10:00:00.000Z'),
      saleEvent('resuelto', 10, 'synced', '2026-11-19T10:00:00.000Z'),
    ]);
    addAwaitingLot({ id: 'lote-espera', sentAt: NOW, eventIds: ['s1'] });

    const exported = await buildPendingExport(NOW);

    expect(exported.notSent.events).toEqual([]);
    expect(exported.sentUnconfirmed.events.map((event) => [event.id, event.lotId])).toEqual([
      ['s1', 'lote-espera'],
    ]);
    expect(exported.sentUnconfirmed.summary).toEqual({
      events: 1,
      byType: { sale: { count: 1, total: 10 } },
    });
  });

  it('con Google Sheets exporta la URL del Web App y nunca el secreto', async () => {
    saveSyncConfig({
      type: 'google-sheets',
      webAppUrl: 'https://script.google.com/x/exec',
      sharedSecret: 'secreto-de-sheets',
      pointOfSale: 'Caja 1',
    });

    const exported = await buildPendingExport(NOW);

    expect(exported.connection).toEqual({
      type: 'google-sheets',
      webAppUrl: 'https://script.google.com/x/exec',
      pointOfSale: 'Caja 1',
    });
    expect(JSON.stringify(exported)).not.toContain('secreto-de-sheets');
  });
});

describe('pendingExportFileName (4.7.0, #230)', () => {
  it('pendientes-<caja>-<fecha>.json, con la caja sin espacios ni tildes', () => {
    expect(pendingExportFileName('Caja Única 1', '2026-11-19T15:00:00.000Z')).toMatch(
      /^pendientes-caja-unica-1-2026-11-1\d\.json$/,
    );
  });

  it('sin caja, "caja"', () => {
    expect(pendingExportFileName(undefined, '2026-11-19T15:00:00.000Z')).toMatch(
      /^pendientes-caja-2026-11-1\d\.json$/,
    );
    expect(pendingExportFileName('  ', '2026-11-19T15:00:00.000Z')).toMatch(/^pendientes-caja-/);
  });
});

describe('buildPendingExportFile (4.7.0, #230)', () => {
  it('el nombre, el tipo y el JSON indentado que se vuelve a leer igual', async () => {
    await db.outbox.add(saleEvent('s1', 10, 'pending', '2026-11-19T10:00:00.000Z'));

    const file = await buildPendingExportFile(NOW);

    expect(file.fileName).toMatch(/^pendientes-caja-1-2026-11-1\d\.json$/);
    expect(file.mimeType).toBe('application/json');
    expect(file.content).toContain('\n  "format": "pos-pendientes"');
    expect(JSON.parse(file.content)).toEqual(JSON.parse(JSON.stringify(file.data)));
  });
});
