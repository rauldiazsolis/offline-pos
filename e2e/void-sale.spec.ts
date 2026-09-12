import { expect, test } from '@playwright/test';
import { getAllFromStore } from './indexed-db.ts';

type StoredSale = {
  id: string;
  status: string;
  total: number;
  lines: unknown[];
  payments: unknown[];
  createdAt: string;
};
type StoredStockMovement = { saleId?: string; reason: string; delta: number };

async function closeOneSale(page: import('@playwright/test').Page): Promise<void> {
  const commandBar = page.getByLabel('Barra de comandos');
  await commandBar.fill('arroz');
  await commandBar.press('Enter');
  await commandBar.press('Control+Enter');
  const amountInput = page.getByLabel('Monto a cobrar');
  await amountInput.fill('1200');
  await amountInput.press('Enter');
  await expect(page.getByRole('heading', { name: 'Comprobante' })).toBeVisible();
}

test('anular una venta cerrada revierte el stock sin tocar sus datos originales', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await expect(page.getByLabel('Barra de comandos')).toBeVisible();
  await context.setOffline(true);

  await closeOneSale(page);
  const [closed] = await getAllFromStore<StoredSale>(page, 'sales');
  expect(closed?.status).toBe('closed');

  // Volver a la venta y anular la que se acaba de cerrar.
  await page.keyboard.press('Escape');
  const commandBar = page.getByLabel('Barra de comandos');
  await expect(commandBar).toBeVisible();

  await commandBar.fill('/anular');
  await commandBar.press('Enter');
  await expect(page.getByRole('heading', { name: 'Anular venta' })).toBeVisible();
  await expect(page.getByRole('listitem')).toBeVisible(); // carga async de la lista

  await page.keyboard.press('Enter'); // selecciona la única venta de la lista
  await expect(page.getByText('¿Anular esta venta? Enter confirma, Esc cancela.')).toBeVisible();
  await page.keyboard.press('Enter'); // confirma

  await expect(page.getByLabel('Barra de comandos')).toBeVisible();

  const [voided] = await getAllFromStore<StoredSale>(page, 'sales');
  expect(voided?.status).toBe('voided');
  expect(voided?.lines).toEqual(closed?.lines);
  expect(voided?.payments).toEqual(closed?.payments);
  expect(voided?.total).toBe(closed?.total);
  expect(voided?.createdAt).toBe(closed?.createdAt);

  const movements = await getAllFromStore<StoredStockMovement>(page, 'stockMovements');
  const forThisSale = movements.filter((movement) => movement.saleId === closed?.id);
  expect(forThisSale).toHaveLength(2);
  expect(forThisSale.find((m) => m.reason === 'sale')?.delta).toBe(-1);
  expect(forThisSale.find((m) => m.reason === 'sale-void')?.delta).toBe(1);
});
