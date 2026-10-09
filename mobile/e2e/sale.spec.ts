import { expect, test } from '@playwright/test';
import { openDemo, typeOnKeyboard } from './helpers.ts';

test('una venta de punta a punta: grilla, búsqueda, cantidad, cobro y comprobante', async ({
  page,
}) => {
  await openDemo(page);

  // Un toque suma uno; dos toques, dos.
  await page.getByRole('button', { name: /Leche entera 1L/ }).click();
  await page.getByRole('button', { name: /Leche entera 1L/ }).click();
  await expect(page.getByTestId('ticket-total')).toContainText('2.200');

  // Buscar con el teclado de letras propio.
  await page.getByRole('button', { name: 'Buscar' }).click();
  await typeOnKeyboard(page, 'pol');
  await page
    .getByTestId('text-entry')
    .getByRole('button', { name: /Polenta 500g/ })
    .click();
  await expect(page.getByTestId('ticket-total')).toContainText('3.000');

  // Cambiar la cantidad desde el ticket, con el teclado numérico.
  await page.getByTestId('ticket-total').click();
  await page.getByTestId('ticket-line').filter({ hasText: 'Polenta' }).click();
  await page.getByTestId('number-entry').getByRole('button', { name: '3', exact: true }).click();
  await page.getByRole('button', { name: 'Listo' }).click();
  await expect(page.getByTestId('ticket-sheet')).toContainText('4.600');

  // Cobrar: Efectivo viene con el total; un billete rápido da el vuelto.
  await page.getByTestId('ticket-sheet').getByRole('button', { name: 'Cobrar' }).click();
  await expect(page.getByTestId('checkout-sheet')).toBeVisible();
  await page.locator('[data-method="cash"]').click();
  await page.getByRole('button', { name: '$ 10.000,00' }).click();
  await page.getByRole('button', { name: 'Listo' }).click();
  await expect(page.getByTestId('change')).toContainText('5.400');
  await page.getByRole('button', { name: 'Confirmar' }).click();

  // El comprobante, y una venta nueva.
  await expect(page.getByTestId('receipt-sheet')).toContainText('Ticket #1');
  await page.getByRole('button', { name: 'Nueva venta' }).click();
  await expect(page.getByTestId('ticket-total')).toContainText('0,00');

  // La venta quedó en el resumen del día.
  await page
    .getByRole('navigation', { name: 'Secciones' })
    .getByRole('button', { name: 'Resumen' })
    .click();
  await expect(page.getByRole('button', { name: /Ticket #1/ })).toBeVisible();
});
