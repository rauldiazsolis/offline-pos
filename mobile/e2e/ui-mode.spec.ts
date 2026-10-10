import { expect, test } from '@playwright/test';
import { BACKEND, expectNoSystemKeyboard } from './helpers.ts';

test.describe('en una pantalla ancha', () => {
  test.use({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false });

  test('escritorio y celular son la misma terminal: la venta en curso pasa de una a la otra', async ({
    page,
  }) => {
    await page.goto(`/?demo=true&backend=${encodeURIComponent(BACKEND)}&template=almacen`);
    // Sin elegir, una pantalla ancha abre la vista de escritorio.
    const bar = page.locator('.command-bar-input');
    await expect(bar).toBeVisible({ timeout: 20_000 });

    await bar.fill('/MOBILE');
    await bar.press('Enter');
    await expect(page.locator('html')).toHaveClass(/pos-mobile/);
    await expectNoSystemKeyboard(page);
    // En una pantalla ancha, la de celular sugiere volver.
    await expect(page.getByText('¿usar la versión de escritorio?')).toBeVisible();

    await page.getByRole('button', { name: /Leche entera 1L/ }).click();
    await page.getByRole('button', { name: 'Usar escritorio' }).click();

    await expect(page.locator('html')).not.toHaveClass(/pos-mobile/);
    await expect(page.getByText('Leche entera 1L')).toBeVisible();
    // La elección se recuerda al recargar.
    await page.reload();
    await expect(page.locator('.command-bar-input')).toBeVisible();
    await expect(page.getByText('Leche entera 1L')).toBeVisible();
  });
});

test('en el celular, escritorio no entra: ofrece volver a la versión para celular', async ({
  page,
}) => {
  await page.goto(`/?demo=true&backend=${encodeURIComponent(BACKEND)}&template=almacen`);
  await page
    .getByRole('navigation', { name: 'Secciones' })
    .getByRole('button', { name: 'Más' })
    .click();
  await page.locator('[data-command="DESKTOP"]').click();
  await expect(page.getByText('Pantalla no compatible')).toBeVisible();
  await page.getByRole('button', { name: 'Usar la versión para celular' }).click();
  await expect(page.getByRole('button', { name: /Leche entera 1L/ })).toBeVisible();
});
