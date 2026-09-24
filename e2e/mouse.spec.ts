import { expect as baseExpect, test as baseTest, type Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { seedCatalog } from './helpers.ts';

/** Teclado + mouse (Etapa 2 de #94): lo mismo que con teclado, a puros clicks. */

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': '*',
};

async function routeRestBackend(page: Page): Promise<void> {
  await page.route('http://backend.test/**', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: CORS });
      return;
    }
    const path = new URL(route.request().url()).pathname;
    const body =
      path === '/sync/pull'
        ? { products: { items: [] }, customers: { items: [] }, stock: [], lots: {} }
        : path === '/info'
          ? { contractVersion: '4.0.0', status: 'ok' }
          : {};
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: CORS,
      body: JSON.stringify(body),
    });
  });
}

baseTest('el wizard de /CONFIG se completa solo con clicks', async ({ page }) => {
  await routeRestBackend(page);
  await page.goto('/');

  await page.getByLabel('Sucursal').fill('Casa central');
  await page.getByLabel('Punto de venta').fill('Caja 1');
  await page.getByRole('button', { name: 'Siguiente (Enter)' }).click();
  await page.getByRole('button', { name: /^REST genérico/ }).click();
  await page.getByLabel('URL del sistema externo').fill('http://backend.test');
  await page.getByRole('button', { name: 'Siguiente (Enter)' }).click();
  await baseExpect(page.getByText(/Conexión OK/)).toBeVisible();
  await page.getByRole('button', { name: 'Siguiente (Enter)' }).click();
  await page.getByRole('button', { name: 'Aplicar (Enter)' }).click();

  await baseExpect(page.getByLabel('Barra de comandos')).toBeVisible();
});

test.describe('pantalla de venta', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await seedCatalog(page);
  });

  test('click en un artículo del overlay lo agrega y la barra conserva el foco', async ({
    page,
  }) => {
    const commandBar = page.getByLabel('Barra de comandos');
    await commandBar.fill('arr');
    await page.getByText('Arroz 1kg').click();

    await expect(page.getByRole('cell', { name: 'Arroz 1kg' })).toBeVisible();
    await expect(commandBar).toBeFocused();
  });

  test('con el carrito vacío, /COBRAR está deshabilitado y el click no hace nada', async ({
    page,
  }) => {
    const commandBar = page.getByLabel('Barra de comandos');
    await commandBar.fill('/');
    const cobrar = page.getByRole('listitem').filter({ hasText: '/COBRAR' });
    await expect(cobrar).toHaveAttribute('aria-disabled', 'true');

    await cobrar.click();

    await expect(page.getByRole('heading', { name: 'Cobrar' })).toHaveCount(0);
    await expect(commandBar).toBeFocused();
  });

  test('click en la tarjeta de Cliente cierra el overlay sin tocar lo tipeado', async ({
    page,
  }) => {
    const commandBar = page.getByLabel('Barra de comandos');
    await commandBar.fill('/');
    await expect(page.getByText('/CAJA')).toBeVisible();

    await page.getByText('Consumidor Final').click();

    await expect(page.getByText('/CAJA')).toHaveCount(0);
    await expect(commandBar).toHaveValue('/');
    await expect(commandBar).toBeFocused();
  });

  test('click en la barra de estado abre /DIAGNOSTICO', async ({ page }) => {
    await page.getByTitle('Ver diagnóstico de sincronización (/DIAGNOSTICO)').click();

    await expect(
      page.getByRole('heading', { name: 'Diagnóstico de sincronización' }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Cerrar (Esc)' }).click();
    await expect(page.getByLabel('Barra de comandos')).toBeFocused();
  });
});
