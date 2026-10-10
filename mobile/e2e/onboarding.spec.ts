import { expect, test } from '@playwright/test';
import { openDemo } from './helpers.ts';

test('de la demo al comercio propio: el alta vuelve al POS mobile ya conectado', async ({
  page,
}) => {
  await openDemo(page);
  await expect(page.getByText('DEMO', { exact: true })).toBeVisible();

  // Una venta en la demo; el alta la borra (vuelve con el wipe_key de esta terminal).
  await page.getByRole('button', { name: /Leche entera 1L/ }).click();
  await page.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await page.getByTestId('ticket-sheet').getByRole('button', { name: 'Cobrar' }).click();
  await page.getByRole('button', { name: 'Confirmar' }).click();
  await page.getByRole('button', { name: 'Nueva venta' }).click();

  await page.getByRole('button', { name: 'Crear mi comercio' }).first().click();
  // La página del alta del backend: el nombre viene precargado.
  await page.getByRole('button', { name: 'Crear comercio y volver al POS' }).click();

  await expect(page.locator('.brand h1')).toHaveText('Mi comercio', { timeout: 20_000 });
  await expect(page.getByText('DEMO', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Leche entera 1L/ })).toBeVisible();
});
