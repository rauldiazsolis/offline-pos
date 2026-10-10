import { expect, test } from '@playwright/test';
import { expectNoSystemKeyboard, openDemo } from './helpers.ts';

test.use({ serviceWorkers: 'allow' });

test('instalada una vez, la app abre y vende sin red', async ({ page, context }) => {
  await openDemo(page);
  // El service worker guarda todo el build al instalarse.
  await page.waitForFunction(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    return registration?.active?.state === 'activated';
  });

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('button', { name: /Leche entera 1L/ })).toBeVisible();
  await expect(page.getByTestId('sync-pill')).toContainText('Sin conexión');
  await expectNoSystemKeyboard(page);

  // Se vende igual: la venta queda pendiente en el outbox.
  await page.getByRole('button', { name: /Leche entera 1L/ }).click();
  await page.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await page.getByTestId('ticket-sheet').getByRole('button', { name: 'Cobrar' }).click();
  await page.getByRole('button', { name: 'Confirmar' }).click();
  await expect(page.getByTestId('receipt-sheet')).toContainText('Ticket #1');
  await page.getByRole('button', { name: 'Nueva venta' }).click();
  await expect(page.getByTestId('sync-pill')).toContainText('Sin conexión (');
});
