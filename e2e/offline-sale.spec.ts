import { expect, test } from '@playwright/test';
import { confirmCheckout, fillPayment, openCashSession, seedCatalog } from './helpers.ts';
import { getAllFromStore } from './indexed-db.ts';

type StoredSale = { id: string; status: string; total: number };
type StoredOutboxEvent = { id: string; type: string; status: string };

test('vender offline: buscar, agregar al carrito, cobrar y persistir', async ({
  page,
  context,
}) => {
  await page.goto('/');
  const commandBar = page.getByLabel('Barra de comandos');
  await expect(commandBar).toBeVisible();

  // Fase 7: sin backend en este spec, el catálogo no llega solo — se siembra
  // a mano (ver `helpers.ts::seedCatalog`).
  await seedCatalog(page);

  // La app ya cargó (assets + catálogo sembrado) — recién ahora se corta la
  // red, para probar exactamente lo que Fase 1 promete: la capa de datos no
  // necesita conexión.
  await context.setOffline(true);

  // Fase 6: /COBRAR exige un turno de caja abierto — abrir uno también es
  // 100% local, así que funciona igual sin red.
  await openCashSession(page);

  await commandBar.fill('arroz');
  await expect(page.getByText('Arroz 1kg')).toBeVisible();
  await commandBar.press('Enter');

  // El buffer se vació al agregar; "Arroz 1kg" que queda visible es la línea del carrito.
  await expect(commandBar).toHaveValue('');
  await expect(page.getByText('Arroz 1kg')).toBeVisible();

  await commandBar.press('Control+Enter');
  await expect(page.getByRole('heading', { name: 'Cobrar' })).toBeVisible();

  await fillPayment(page, 'Efectivo', 1200);
  await confirmCheckout(page);

  await expect(page.getByRole('heading', { name: 'Comprobante' })).toBeVisible();

  const sales = await getAllFromStore<StoredSale>(page, 'sales');
  expect(sales).toHaveLength(1);
  expect(sales[0]).toMatchObject({ status: 'closed', total: 1200 });

  // Regresión barata contra un error de migración/versión de Dexie: la
  // venta cerrada tiene que dejar su evento de outbox pendiente de sync.
  const outboxEvents = await getAllFromStore<StoredOutboxEvent>(page, 'outbox');
  const saleEvent = outboxEvents.find((event) => event.type === 'sale');
  expect(saleEvent).toMatchObject({ id: sales[0]?.id, status: 'pending' });
});
