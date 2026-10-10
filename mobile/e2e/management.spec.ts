import { expect, test, type Page } from '@playwright/test';
import { openDemo, typeOnKeyboard } from './helpers.ts';

function tab(page: Page, name: string) {
  return page.getByRole('navigation', { name: 'Secciones' }).getByRole('button', { name });
}

async function tapKeys(page: Page, digits: string): Promise<void> {
  for (const digit of digits) {
    await page
      .getByTestId('number-entry')
      .getByRole('button', { name: digit, exact: true })
      .click();
  }
}

async function pickCustomer(page: Page, query: string, name: RegExp): Promise<void> {
  await page.getByRole('button', { name: 'Cliente' }).click();
  await typeOnKeyboard(page, query);
  await page.getByTestId('text-entry').getByRole('button', { name }).click();
}

test('arqueo de caja con el teclado numérico', async ({ page }) => {
  await openDemo(page);
  await tab(page, 'Caja').click();
  await page.getByRole('button', { name: /Efectivo contado/ }).click();
  await tapKeys(page, '500');
  await page.getByRole('button', { name: 'Listo' }).click();
  await expect(page.getByText('Sobran $500,00')).toBeVisible();
  await page.getByRole('button', { name: 'Registrar arqueo' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Arqueo registrado' })).toBeVisible();
});

test('venta a cuenta corriente, cobranza y anulación', async ({ page }) => {
  await openDemo(page);

  // Venta a cuenta corriente de Rosa.
  await pickCustomer(page, 'Ros', /Rosa Benítez/);
  await page.getByRole('button', { name: /Leche entera 1L/ }).click();
  await page.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await page.getByTestId('ticket-sheet').getByRole('button', { name: 'Cobrar' }).click();
  await page.locator('[data-method="cash"]').click();
  await page.getByRole('button', { name: 'Nada' }).click();
  await page.getByRole('button', { name: 'Listo' }).click();
  await page.locator('[data-method="account"]').click();
  await page.getByRole('button', { name: /^Justo/ }).click();
  await page.getByRole('button', { name: 'Listo' }).click();
  await expect(page.getByTestId('checkout-sheet')).toContainText('Debe $1.100,00');
  await page.getByRole('button', { name: 'Confirmar' }).click();
  await expect(page.getByTestId('receipt-sheet')).toContainText('Cuenta corriente');
  await page.getByRole('button', { name: 'Nueva venta' }).click();

  // Cobranza sin venta: Rosa paga lo que debe.
  await pickCustomer(page, 'Ros', /Rosa Benítez/);
  await page.getByRole('button', { name: 'Cobranza', exact: true }).click();
  await page.locator('[data-method="cash"]').click();
  await page.getByRole('button', { name: /^Justo/ }).click();
  await page.getByRole('button', { name: 'Listo' }).click();
  await expect(page.getByTestId('collection-sheet')).toContainText('Sin saldo');
  await page.getByRole('button', { name: 'Confirmar cobranza' }).click();
  await expect(page.getByTestId('receipt-sheet')).toContainText('Recibo #1');
  await page.getByRole('button', { name: 'Nueva venta' }).click();

  // Anular el ticket desde "Más".
  await tab(page, 'Más').click();
  await page.locator('[data-command="ANULAR"]').click();
  await page.getByRole('button', { name: /Ticket #1/ }).click();
  await expect(page.getByText('¿Anular el Ticket #1?')).toBeVisible();
  await page.getByRole('button', { name: 'Anular', exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Anulado el Ticket #1 con el Ticket #2' }),
  ).toBeVisible();
});

test('alta de un cliente nuevo desde la venta', async ({ page }) => {
  await openDemo(page);
  await page.getByRole('button', { name: 'Cliente' }).click();
  await typeOnKeyboard(page, 'Lu');
  await page.getByRole('button', { name: /Crear el cliente «Lu»/ }).click();
  await expect(page.locator('.toolbar .tool.has')).toContainText('Lu');
});
