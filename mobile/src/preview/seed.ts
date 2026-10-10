import { z } from 'zod';
import { splitConnectorCustomers } from '../../../src/domain/customer.ts';
import { db } from '../../../src/storage/db.ts';
import { saveBackendCapabilities } from '../../../src/sync/backend-capabilities.ts';
import { saveBackendCompany } from '../../../src/sync/backend-company.ts';
import { saveBackendPortal } from '../../../src/sync/backend-portal.ts';
import { loadSyncConfig, saveSyncConfig } from '../../../src/sync/config.ts';
import { connectorCustomerSchema, connectorProductSchema } from '../../../src/sync/connector.ts';
import { DEVICE_ID_KEY } from '../../../src/sync/terminal-identity.ts';
import customersJson from '../../../demo-backend/src/fixtures/customers.json';
import productsJson from '../../../demo-backend/src/fixtures/products.json';
import { previewModeSignal } from './flag.ts';

/**
 * Vista previa para el celular (`pnpm --filter pos-mobile build:preview`): la app de siempre con
 * los datos de ejemplo del demo-backend ya cargados, para probarla donde no puede llamar a un
 * backend (un Artifact de claude.ai). La conexión apunta a un backend que no existe: todo se guarda
 * local y el estado dice que no sincroniza. Nunca entra en la app publicada: solo en el build de `build:preview`.
 */
const fixtureProductSchema = connectorProductSchema.extend({ initialStock: z.number() });

export async function seedPreview(): Promise<void> {
  previewModeSignal.value = true;
  if (loadSyncConfig().ok) {
    return;
  }
  const now = new Date().toISOString();
  localStorage.setItem(DEVICE_ID_KEY, crypto.randomUUID());
  saveSyncConfig({
    type: 'rest',
    baseUrl: 'https://vista-previa.invalid',
    branch: 'Centro',
    pointOfSale: 'Caja 1',
    locale: 'es-AR',
    verifiedAt: now,
  });
  saveBackendCompany({ name: 'Kiosco de ejemplo' });
  // Como el demo-backend: el portal se ve (al tocarlo no abre: no hay backend).
  saveBackendCapabilities(['demo-sessions', 'customer-payment-void', 'portal']);
  saveBackendPortal({ command: 'PANEL', label: 'Panel del backend' });

  const products = z.array(fixtureProductSchema).parse(productsJson);
  const raws = z.array(connectorCustomerSchema).parse(customersJson);
  const { customers, accounts, balances } = splitConnectorCustomers(raws, { now });
  await db.transaction(
    'rw',
    [db.products, db.stock, db.customers, db.customerAccounts, db.customerBalances],
    async () => {
      await db.products.bulkPut(products.map(({ initialStock: _stock, ...product }) => product));
      await db.stock.bulkPut(
        products.map((product) => ({
          productId: product.id,
          quantity: product.initialStock,
          updatedAt: now,
        })),
      );
      await db.customers.bulkPut(customers);
      await db.customerAccounts.bulkPut(accounts);
      await db.customerBalances.bulkPut(balances);
    },
  );
}
