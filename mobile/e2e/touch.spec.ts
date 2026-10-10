import { expect, test } from '@playwright/test';
import { openDemo, typeOnKeyboard } from './helpers.ts';

test('el toque sostenido en un producto elige su cantidad', async ({ page }) => {
  await openDemo(page);
  const leche = page.getByRole('button', { name: /Leche entera 1L/ });
  const box = await leche.boundingBox();
  if (box === null) throw new Error('sin caja');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(page.getByTestId('number-entry')).toBeVisible();
  await page.mouse.up();
  await page.getByTestId('number-entry').getByRole('button', { name: '4', exact: true }).click();
  await page.getByRole('button', { name: 'Listo' }).click();
  // Sostener no sumó uno más: quedan 4.
  await expect(page.getByTestId('ticket-total')).toContainText('4.400');
});

test('al buscar, el teclado y el texto quedan fijos abajo aunque cambie la lista', async ({
  page,
}) => {
  await openDemo(page);
  await page.getByRole('button', { name: 'Buscar' }).click();
  const keyboard = page.locator('.lkeys');
  // Después de la animación de apertura de la hoja.
  await page.waitForTimeout(400);
  const before = await keyboard.boundingBox();
  await typeOnKeyboard(page, 'leche');
  const after = await keyboard.boundingBox();
  expect(after?.y).toBe(before?.y);
  // El texto va pegado arriba del teclado.
  const query = await page.getByTestId('text-entry-display').boundingBox();
  expect(query !== null && after !== null && query.y + query.height <= after.y).toBe(true);
  expect(after !== null && query !== null && after.y - (query.y + query.height) < 20).toBe(true);
});
