import { expect, test } from '@playwright/test';
import { expectNoSystemKeyboard, openDemo, typeOnKeyboard } from './helpers.ts';

test('sin conexión, la configuración no tiene nada que abra el teclado del sistema', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByTestId('config-screen')).toBeVisible();
  await expectNoSystemKeyboard(page);
  // Un campo se edita con el teclado propio.
  await page.locator('[data-config-field="branch"]').click();
  await expect(page.getByTestId('text-entry')).toBeVisible();
  await typeOnKeyboard(page, 'Centro');
  await page.getByRole('button', { name: 'Listo' }).click();
  await expect(page.locator('[data-config-field="branch"]')).toContainText('Centro');
  await expectNoSystemKeyboard(page);
});

test('cada pantalla de la venta se opera sin el teclado del sistema', async ({ page }) => {
  await openDemo(page);
  await expectNoSystemKeyboard(page);

  for (const tab of ['Resumen', 'Caja', 'Más', 'Vender']) {
    await page
      .getByRole('navigation', { name: 'Secciones' })
      .getByRole('button', { name: tab })
      .click();
    await expectNoSystemKeyboard(page);
  }

  await page.getByRole('button', { name: 'Buscar' }).click();
  await expectNoSystemKeyboard(page);
  await page.getByTestId('text-entry').getByRole('button', { name: 'Cerrar' }).click();

  await page.getByRole('button', { name: /Leche entera 1L/ }).click();
  await page.getByTestId('ticket-total').click();
  await expectNoSystemKeyboard(page);
  await page.getByTestId('ticket-line').first().click();
  await expect(page.getByTestId('number-entry')).toBeVisible();
  await expectNoSystemKeyboard(page);
});
