import { expect, test } from '@playwright/test';
import { BACKEND, expectNoSystemKeyboard, typeAnything, typeOnKeyboard } from './helpers.ts';

test('conectar a mano con el wizard, todo con el teclado propio', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('config-screen')).toContainText('Paso 1 de 6');

  await page.locator('[data-config-field="branch"]').click();
  await typeOnKeyboard(page, 'Centro');
  await page.getByRole('button', { name: 'Listo' }).click();
  await page.locator('[data-config-field="pointOfSale"]').click();
  await typeOnKeyboard(page, 'Caja');
  await page.getByRole('button', { name: 'Listo' }).click();
  await page.getByRole('button', { name: 'Siguiente' }).click();

  await page.getByRole('button', { name: /REST \(minibackend de demo\)/ }).click();
  await page.locator('[data-config-field="baseUrl"]').click();
  await typeAnything(page, BACKEND);
  await page.getByRole('button', { name: 'Listo' }).click();
  await page.locator('[data-config-field="apiKey"]').click();
  await typeAnything(page, 'clave1');
  await page.getByRole('button', { name: 'Listo' }).click();
  await expectNoSystemKeyboard(page);
  await page.getByRole('button', { name: 'Siguiente' }).click();

  // Probar arranca solo.
  await expect(page.getByText(/Conexión OK/)).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await expect(page.getByTestId('config-screen')).toContainText('Revisar');
  await page.getByRole('button', { name: 'Aplicar' }).click();

  await expect(page.getByRole('button', { name: /Arroz 1kg|Leche entera 1L/ }).first()).toBeVisible(
    {
      timeout: 20_000,
    },
  );
  await expect(page.locator('.brand')).toContainText('Caja - Centro');
});
