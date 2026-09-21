import { expect, test } from './fixtures.ts';
import { confirmCheckout, fillPayment, openCashSession, seedCatalog } from './helpers.ts';

/**
 * Issue #17: la venta en curso vivía solo en memoria — un refresh la
 * borraba sin ningún rastro. Este test es justo lo que un unit test no
 * puede probar (persiste, sí, pero no que sobreviva un reload real de la
 * página): agregar algo al carrito, recargar, y confirmar que sigue ahí.
 */
test('recargar la página no borra el carrito en curso', async ({ page }) => {
  await page.goto('/');
  const commandBar = page.getByLabel('Barra de comandos');
  await expect(commandBar).toBeVisible();

  // Fase 7: sin backend en este spec, el catálogo no llega solo — se siembra
  // a mano (ver `helpers.ts::seedCatalog`).
  await seedCatalog(page);

  await commandBar.fill('arroz');
  await expect(page.getByText('Arroz 1kg')).toBeVisible();
  await commandBar.press('Enter');
  await expect(commandBar).toHaveValue('');
  await expect(page.getByText('Arroz 1kg')).toBeVisible();

  await page.reload();

  await expect(page.getByLabel('Barra de comandos')).toBeVisible();
  await expect(page.getByText('Arroz 1kg')).toBeVisible();
});

test('cerrar la venta limpia el draft — el siguiente refresh arranca con el carrito vacío', async ({
  page,
}) => {
  await page.goto('/');
  const commandBar = page.getByLabel('Barra de comandos');
  await expect(commandBar).toBeVisible();

  // Fase 7: sin backend en este spec, el catálogo no llega solo — se siembra
  // a mano (ver `helpers.ts::seedCatalog`).
  await seedCatalog(page);

  await openCashSession(page);

  await commandBar.fill('arroz');
  await commandBar.press('Enter');
  await commandBar.press('Control+Enter');
  await expect(page.getByRole('heading', { name: 'Cobrar' })).toBeVisible();

  await fillPayment(page, 'Efectivo', 1200);
  await confirmCheckout(page);
  await expect(page.getByRole('heading', { name: 'Comprobante' })).toBeVisible();

  await page.reload();

  await expect(page.getByLabel('Barra de comandos')).toBeVisible();
  await expect(page.getByText('Arroz 1kg')).not.toBeVisible();
});
