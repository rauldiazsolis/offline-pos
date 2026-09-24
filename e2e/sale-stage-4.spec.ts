import type { Page } from '@playwright/test';
import { ACTIVE_CONFIG, CONFIG_STORAGE_KEY, expect, test } from './fixtures.ts';
import { openCashSession, seedCatalog } from './helpers.ts';
import { getAllFromStore } from './indexed-db.ts';

type StoredSale = {
  id: string;
  total: number;
  payments: { method: string; amount: number }[];
  voidsSaleId?: string;
};

const ARROZ = '7791234000011';

/**
 * Etapa 4 del epic #94 (#99): Enter para cobrar, cantidades con signo y
 * decimales, devolución (ticket negativo) y anulación como ticket propio.
 * Offline, con el catálogo sembrado a mano y locale `es-AR` (coma decimal).
 */
test.beforeEach(async ({ page, context }) => {
  // Después del init script de `fixtures.ts`: lo pisa con la misma config más el locale.
  await page.addInitScript(
    ({ key, config }) => {
      localStorage.setItem(key, JSON.stringify(config));
    },
    { key: CONFIG_STORAGE_KEY, config: { ...ACTIVE_CONFIG, locale: 'es-AR' } },
  );
  await page.goto('/');
  await expect(page.getByLabel('Barra de comandos')).toBeVisible();
  await seedCatalog(page);
  await context.setOffline(true);
  await openCashSession(page);
});

async function backToSale(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(page.getByLabel('Barra de comandos')).toBeVisible();
}

test('Enter con la barra vacía abre Cobro con el total precargado y Ctrl+Enter cobra', async ({
  page,
}) => {
  const commandBar = page.getByLabel('Barra de comandos');
  await commandBar.fill(ARROZ);
  await commandBar.press('Enter');
  await expect(page.getByRole('cell', { name: 'Arroz 1kg' })).toBeVisible();

  await commandBar.press('Enter');
  await expect(page.getByRole('heading', { name: 'Cobrar venta' })).toBeVisible();
  const cash = page.getByLabel('Efectivo');
  await expect(cash).toHaveValue('1200');
  await expect(cash).toBeFocused();
  expect(
    await cash.evaluate(
      (input: HTMLInputElement) =>
        input.selectionStart === 0 && input.selectionEnd === input.value.length,
    ),
  ).toBe(true);

  await page.keyboard.press('Control+Enter');
  await expect(page.getByRole('heading', { name: 'Comprobante' })).toBeVisible();
});

test('cantidades decimales y con signo', async ({ page }) => {
  const commandBar = page.getByLabel('Barra de comandos');
  await commandBar.fill(`1,5*${ARROZ}`);
  await commandBar.press('Enter');
  await expect(page.getByRole('cell', { name: '1,5', exact: true })).toBeVisible();

  // La línea recién agregada queda seleccionada: una cantidad + Enter la reemplaza.
  await commandBar.fill('-2');
  await commandBar.press('Enter');
  await expect(page.getByRole('cell', { name: '-2', exact: true })).toBeVisible();
});

test('devolución: una línea libre negativa se cobra en modo devolución', async ({ page }) => {
  const commandBar = page.getByLabel('Barra de comandos');
  await commandBar.fill('-1*regalo$100');
  await commandBar.press('Enter');
  await expect(page.getByRole('cell', { name: 'regalo' })).toBeVisible();

  await commandBar.press('Enter');
  await expect(page.getByRole('heading', { name: 'Devolver 100,00' })).toBeVisible();
  await page.keyboard.press('Control+Enter');
  await expect(page.getByRole('heading', { name: 'Comprobante' })).toBeVisible();

  const [refund] = await getAllFromStore<StoredSale>(page, 'sales');
  expect(refund?.total).toBe(-100);
  expect(refund?.payments).toEqual([{ method: 'cash', amount: -100 }]);
});

test('anular genera un ticket propio y /ANULAR marca la original y la anulación', async ({
  page,
}) => {
  const commandBar = page.getByLabel('Barra de comandos');
  // Dos ventas: la más nueva se anula, la otra queda anulable.
  for (const code of [ARROZ, '7791234000028']) {
    await commandBar.fill(code);
    await commandBar.press('Enter');
    await commandBar.press('Enter');
    await expect(page.getByRole('heading', { name: 'Cobrar venta' })).toBeVisible();
    await page.keyboard.press('Control+Enter');
    await expect(page.getByRole('heading', { name: 'Comprobante' })).toBeVisible();
    await backToSale(page);
  }

  await commandBar.fill('/anular');
  await commandBar.press('Enter');
  await expect(page.getByRole('heading', { name: 'Anular venta' })).toBeVisible();
  await expect(page.getByRole('listitem').first()).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByText('¿Anular esta venta? Enter confirma, Esc cancela.')).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(commandBar).toBeVisible();

  const sales = await getAllFromStore<StoredSale>(page, 'sales');
  expect(sales).toHaveLength(3);
  const voidTicket = sales.find((sale) => sale.voidsSaleId !== undefined);
  expect(voidTicket?.total).toBe(-900);

  await commandBar.fill('/anular');
  await commandBar.press('Enter');
  await expect(page.getByText('Anulada', { exact: true })).toBeVisible();
  await expect(page.getByText(/^Anulación de \d\d:\d\d · 900,00$/)).toBeVisible();
});
