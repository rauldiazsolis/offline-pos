import { DEVICE_ID_STORAGE_KEY, expect, test } from './fixtures.ts';
import { seedCatalog } from './helpers.ts';
import { getAllFromStore } from './indexed-db.ts';

/**
 * Ciclo de vida del id de dispositivo (Etapa 2 de #94): una terminal sin id
 * pierde lo local al arrancar y vuelve al wizard, con la config precargada
 * pero sin probar.
 */
test('sin id de dispositivo: borra lo local y abre el wizard con el aviso, precargado', async ({
  page,
}) => {
  await page.goto('/');
  await seedCatalog(page);
  expect((await getAllFromStore(page, 'products')).length).toBeGreaterThan(0);

  await page.evaluate((key) => {
    localStorage.removeItem(key);
  }, DEVICE_ID_STORAGE_KEY);
  // El fixture vuelve a sembrar la config (con verifiedAt) en cada navegación,
  // pero no el id (una sola vez por pestaña): queda la config activa sin
  // identidad, que es justo el caso. El arranque le saca el verifiedAt.
  await page.reload();

  await expect(page.getByText('Esta terminal no tenía identidad')).toBeVisible();
  await expect(page.getByLabel('Sucursal')).toHaveValue('Casa central');
  await expect(page.getByLabel('Barra de comandos')).toHaveCount(0);
  expect(await getAllFromStore(page, 'products')).toHaveLength(0);
  const newId = await page.evaluate((key) => localStorage.getItem(key), DEVICE_ID_STORAGE_KEY);
  expect(newId).toMatch(/^[0-9a-f-]{36}$/);
});
