import { expect, test } from './fixtures.ts';
import { seedCatalog } from './helpers.ts';
import { getAllFromStore } from './indexed-db.ts';

/**
 * Una sola pestaña del POS por almacenamiento (#175): páginas del mismo contexto de Playwright
 * comparten `localStorage`, IndexedDB, `navigator.locks` y `BroadcastChannel`, como dos pestañas de
 * un navegador. Solo la primera página siembra la conexión (`fixtures.ts`): las demás comparten su
 * almacenamiento.
 */
const SECONDARY_HEADING = 'El POS está abierto en otra pestaña';
const TAKE_OVER = 'Usar esta pestaña (Enter)';

test('una segunda pestaña muestra el aviso y no opera', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByLabel('Barra de comandos')).toBeVisible();

  const second = await page.context().newPage();
  await second.goto('/');

  await expect(second.getByRole('heading', { name: SECONDARY_HEADING })).toBeVisible();
  await expect(second.getByLabel('Barra de comandos')).toHaveCount(0);
  await expect(second.getByRole('button', { name: TAKE_OVER })).toBeFocused();
  await expect(second).toHaveTitle('POS en otra pestaña');
  await expect(page.getByLabel('Barra de comandos')).toBeVisible();
});

test('"Usar esta pestaña" se lleva la venta en curso y deja la original como segunda', async ({
  page,
}) => {
  await page.goto('/');
  const commandBar = page.getByLabel('Barra de comandos');
  await expect(commandBar).toBeVisible();
  await seedCatalog(page);
  await commandBar.fill('arroz');
  await commandBar.press('Enter');
  await expect(page.getByText('Arroz 1kg')).toBeVisible();
  await expect
    .poll(
      async () =>
        (await getAllFromStore<{ cart: { lines: unknown[] } }>(page, 'draftCart'))[0]?.cart.lines
          .length,
    )
    .toBe(1);

  const second = await page.context().newPage();
  await second.goto('/');
  await second.getByRole('button', { name: TAKE_OVER }).press('Enter');

  await expect(second.getByLabel('Barra de comandos')).toBeVisible();
  await expect(second.getByText('Arroz 1kg')).toBeVisible();
  await expect(page.getByRole('heading', { name: SECONDARY_HEADING })).toBeVisible();
  await expect(page.getByText('Se empezó a usar el POS en otra pestaña.')).toBeVisible();
  await expect(page.getByLabel('Barra de comandos')).toHaveCount(0);
});

test('con la original cerrada, "Usar esta pestaña" toma el control enseguida', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByLabel('Barra de comandos')).toBeVisible();
  const second = await page.context().newPage();
  await second.goto('/');
  await expect(second.getByRole('heading', { name: SECONDARY_HEADING })).toBeVisible();

  await page.close();
  await second.getByRole('button', { name: TAKE_OVER }).click();

  // Menos que los 5 s después de los cuales le quitaría el cerrojo a una original colgada.
  await expect(second.getByLabel('Barra de comandos')).toBeVisible({ timeout: 3000 });
});

test('otra carpeta del mismo origen tiene su propia pestaña que manda', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByLabel('Barra de comandos')).toBeVisible();

  // El build real servido en otra carpeta del mismo origen: la app usa rutas relativas, así que
  // `/otra-carpeta/assets/…` es el mismo asset de `/assets/…`.
  const context = page.context();
  await context.route('**/otra-carpeta/**', async (route) => {
    const url = new URL(route.request().url());
    url.pathname = url.pathname.replace('/otra-carpeta/', '/');
    await route.fulfill({ response: await route.fetch({ url: url.toString() }) });
  });
  const other = await context.newPage();
  await other.goto('/otra-carpeta/');

  // Sin config en su almacenamiento: `/CONFIG` requerido, no el aviso de otra pestaña.
  await expect(other.getByRole('heading', { name: 'Configurar conexión' })).toBeVisible();
  await expect(other.getByRole('heading', { name: SECONDARY_HEADING })).toHaveCount(0);
  const databases = await other.evaluate(async () =>
    (await indexedDB.databases()).map((database) => database.name),
  );
  expect(databases).toContain('offline-pos@/otra-carpeta/');
  await expect(page.getByLabel('Barra de comandos')).toBeVisible();
});
