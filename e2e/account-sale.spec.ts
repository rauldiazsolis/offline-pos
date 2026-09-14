import { expect, test } from '@playwright/test';
import { openCashSession } from './helpers.ts';
import { getAllFromStore, putIntoStore } from './indexed-db.ts';

type StoredCustomer = { id: string; name: string };
type StoredSale = { id: string; status: string; payments: { method: string; amount: number }[] };

test('cuenta corriente offline dentro del margen: cierra la venta', async ({ page, context }) => {
  await page.goto('/');
  const commandBar = page.getByLabel('Barra de comandos');
  await expect(commandBar).toBeVisible();

  await context.setOffline(true);
  await openCashSession(page);

  // Alta de cliente local (RF-16) — sin match existente, "@<nombre>" + Enter lo crea.
  await commandBar.fill('@Cliente Prueba');
  await expect(page.getByText('Crear cliente', { exact: false })).toBeVisible();
  await commandBar.press('Enter');
  await expect(page.getByText('Cliente Prueba')).toBeVisible();

  // No usa toHaveLength(1): desde el Ciclo 7 el catálogo de clientes de
  // ejemplo (`storage/seed-customers.ts`) siembra unos cuantos de arranque
  // — el que importa acá es el recién creado, encontrado por nombre.
  const customers = await getAllFromStore<StoredCustomer>(page, 'customers');
  const customer = customers.find((c) => c.name === 'Cliente Prueba');
  expect(customer).toBeDefined();
  const customerId = customer?.id;

  // La cuenta cacheada en producción vendría de un pull real — acá se
  // siembra directo (no hay backend en los e2e, ver CLAUDE.md).
  await putIntoStore(page, 'customerAccounts', {
    customerId,
    creditLimit: 2000,
    margin: 0,
    balance: 0,
    updatedAt: '2026-01-01T00:00:00.000Z',
  });

  await commandBar.fill('arroz');
  await expect(page.getByText('Arroz 1kg')).toBeVisible();
  await commandBar.press('Enter');

  await commandBar.press('Control+Enter');
  await expect(page.getByRole('heading', { name: 'Cobrar' })).toBeVisible();

  const amountInput = page.getByLabel('Monto a cobrar');
  await amountInput.fill('/CUENTA');
  await amountInput.press('Enter');

  await expect(page.getByRole('heading', { name: 'Comprobante' })).toBeVisible();

  const sales = await getAllFromStore<StoredSale>(page, 'sales');
  expect(sales).toHaveLength(1);
  expect(sales[0]?.payments).toEqual([{ method: 'account', amount: 1200 }]);

  const movements = await getAllFromStore(page, 'accountMovements');
  expect(movements).toHaveLength(1);
});

test('cuenta corriente offline sin cuenta cacheada: rechaza el cobro', async ({
  page,
  context,
}) => {
  await page.goto('/');
  const commandBar = page.getByLabel('Barra de comandos');
  await expect(commandBar).toBeVisible();

  await context.setOffline(true);
  await openCashSession(page);

  await commandBar.fill('@Sin Credito');
  await commandBar.press('Enter');
  await expect(page.getByText('Sin Credito')).toBeVisible();

  await commandBar.fill('arroz');
  await expect(page.getByText('Arroz 1kg')).toBeVisible();
  await commandBar.press('Enter');

  await commandBar.press('Control+Enter');
  await expect(page.getByRole('heading', { name: 'Cobrar' })).toBeVisible();

  const amountInput = page.getByLabel('Monto a cobrar');
  await amountInput.fill('/CUENTA');
  await amountInput.press('Enter');

  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Cobrar' })).toBeVisible();

  const sales = await getAllFromStore(page, 'sales');
  expect(sales).toHaveLength(0);
});
