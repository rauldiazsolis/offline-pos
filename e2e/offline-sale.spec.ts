import { expect, test } from '@playwright/test';
import { getAllFromStore } from './indexed-db.ts';

type StoredSale = { id: string; status: string; total: number };

test('vender offline: buscar, agregar al carrito, cobrar y persistir', async ({
  page,
  context,
}) => {
  await page.goto('/');
  const commandBar = page.getByLabel('Barra de comandos');
  await expect(commandBar).toBeVisible();

  // La app ya cargó (assets + catálogo sembrado) — recién ahora se corta la
  // red, para probar exactamente lo que Fase 1 promete: la capa de datos no
  // necesita conexión.
  await context.setOffline(true);

  await commandBar.fill('arroz');
  await expect(page.getByText('Arroz 1kg')).toBeVisible();
  await commandBar.press('Enter');

  // El buffer se vació al agregar; "Arroz 1kg" que queda visible es la línea del carrito.
  await expect(commandBar).toHaveValue('');
  await expect(page.getByText('Arroz 1kg')).toBeVisible();

  await commandBar.press('Control+Enter');
  await expect(page.getByRole('heading', { name: 'Cobrar' })).toBeVisible();

  const amountInput = page.getByLabel('Monto a cobrar');
  await amountInput.fill('1200');
  await amountInput.press('Enter');

  await expect(page.getByRole('heading', { name: 'Comprobante' })).toBeVisible();

  const sales = await getAllFromStore<StoredSale>(page, 'sales');
  expect(sales).toHaveLength(1);
  expect(sales[0]).toMatchObject({ status: 'closed', total: 1200 });
});
