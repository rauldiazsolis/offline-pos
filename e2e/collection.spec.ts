import { ACTIVE_CONFIG, CONFIG_STORAGE_KEY, expect, test } from './fixtures.ts';
import { getAllFromStore } from './indexed-db.ts';

type StoredOutboxEvent = {
  id: string;
  type: string;
  status: string;
  origin?: { branch?: string; pointOfSale?: string };
  payment?: { customerId: string; total: number; receipt?: { date: string; number: number } };
};
type StoredCustomer = { id: string; name: string };
type StoredBalance = { customerId: string; balance: number };

/**
 * Etapa 6 del epic #94 (#101): cobranza sin venta de punta a punta, offline y con locale `es-AR` —
 * Enter con la barra vacía y un cliente adjunto, recibo del día, saldo en la tarjeta de Cliente,
 * efectivo en el arqueo, `/RESUMEN` y el evento en el outbox.
 */
test.beforeEach(async ({ page, context }) => {
  await page.addInitScript(
    ({ key, config }) => {
      localStorage.setItem(key, JSON.stringify(config));
    },
    { key: CONFIG_STORAGE_KEY, config: { ...ACTIVE_CONFIG, locale: 'es-AR' } },
  );
  await page.goto('/');
  await expect(page.getByLabel('Barra de comandos')).toBeVisible();
  await context.setOffline(true);
});

test('cobranza sin venta: recibo, saldo, arqueo, /RESUMEN y outbox', async ({ page }) => {
  const commandBar = page.getByLabel('Barra de comandos');
  const balanceRow = page.getByTestId('customer-balance');

  // Cliente nuevo: sin saldo.
  await commandBar.fill('@Ana Gómez');
  await expect(page.getByText('Crear cliente', { exact: false })).toBeVisible();
  await commandBar.press('Enter');
  await expect(balanceRow).toHaveText('Saldo: Sin saldo');

  // Enter con la barra vacía, sin artículos y con cliente: la cobranza.
  await commandBar.press('Enter');
  await expect(page.getByRole('heading', { name: 'Cobranza a Ana Gómez' })).toBeVisible();
  await expect(page.getByLabel('Cuenta corriente')).toHaveCount(0);
  await page.keyboard.press('Control+Enter');
  await expect(page.getByText('Ingresá al menos un monto.')).toBeVisible();

  await page.getByLabel('Efectivo').fill('500');
  await page.keyboard.press('ArrowDown');
  await expect(page.getByLabel('Tarjeta de Débito')).toBeFocused();
  await page.keyboard.type('200');
  await expect(page.getByTestId('collection-total')).toHaveText('700,00');
  await expect(page.getByText('Después: A favor $700,00')).toBeVisible();
  await page.keyboard.press('Control+Enter');

  // Comprobante.
  await expect(page.getByRole('heading', { name: 'Recibo de cobranza' })).toBeVisible();
  await expect(page.getByText('Recibo #1')).toBeVisible();
  await expect(page.getByText('Saldo anterior: Sin saldo')).toBeVisible();
  await expect(page.getByText('Saldo nuevo: A favor $700,00')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(commandBar).toBeFocused();
  await expect(page.getByText('Consumidor Final')).toBeVisible();

  // El saldo nuevo en la tarjeta al volver a adjuntarla.
  await commandBar.fill('@Ana');
  await expect(page.getByText('Ana Gómez')).toBeVisible();
  await commandBar.press('Enter');
  await expect(balanceRow).toHaveText('Saldo: A favor $700,00');

  // Segunda cobranza, con /COBRAR: recibo #2.
  await commandBar.fill('/COBRAR');
  await commandBar.press('Enter');
  await expect(page.getByRole('heading', { name: 'Cobranza a Ana Gómez' })).toBeVisible();
  await page.getByLabel('Efectivo').fill('100');
  await page.keyboard.press('Control+Enter');
  await expect(page.getByText('Recibo #2')).toBeVisible();
  await page.keyboard.press('Escape');

  // IndexedDB: dos eventos pendientes con su recibo y su origen; el saldo local.
  const customers = await getAllFromStore<StoredCustomer>(page, 'customers');
  const ana = customers.find((customer) => customer.name === 'Ana Gómez');
  const events = (await getAllFromStore<StoredOutboxEvent>(page, 'outbox')).filter(
    (event) => event.type === 'customer-payment',
  );
  expect(events.map((event) => [event.status, event.payment?.receipt?.number])).toEqual([
    ['pending', 1],
    ['pending', 2],
  ]);
  expect(events[0]?.origin).toEqual({ branch: 'Casa central', pointOfSale: 'Caja 1' });
  const balances = await getAllFromStore<StoredBalance>(page, 'customerBalances');
  expect(balances.find((row) => row.customerId === ana?.id)?.balance).toBe(-800);

  // El arqueo espera el efectivo de las dos cobranzas (500 + 100).
  await commandBar.fill('/CAJA');
  await commandBar.press('Enter');
  await expect(page.getByRole('heading', { name: 'Caja' })).toBeVisible();
  await expect(page.getByText('$600,00')).toBeVisible();
  await page.keyboard.press('Escape');

  // /RESUMEN: los dos recibos y el total de cobranzas.
  await commandBar.fill('/RESUMEN');
  await commandBar.press('Enter');
  await expect(page.getByText('Recibo #1 · Ana Gómez')).toBeVisible();
  await expect(page.getByText('Recibo #2 · Ana Gómez')).toBeVisible();
  const sidebar = page.getByTestId('cash-summary-sidebar');
  await expect(sidebar.getByText('800,00')).toBeVisible();
  await expect(sidebar.getByText('(2 recibos)')).toBeVisible();
});

test('/COBRAR con cliente y sin artículos abre la cobranza; Esc vuelve con el cliente adjunto', async ({
  page,
}) => {
  const commandBar = page.getByLabel('Barra de comandos');
  await commandBar.fill('@Beto');
  await commandBar.press('Enter');

  await commandBar.press('Control+Enter');
  await expect(page.getByRole('heading', { name: 'Cobranza a Beto' })).toBeVisible();
  await page.keyboard.press('Escape');

  await expect(commandBar).toBeFocused();
  await expect(page.getByTestId('customer-balance')).toHaveText('Saldo: Sin saldo');
  expect(
    (await getAllFromStore<StoredOutboxEvent>(page, 'outbox')).filter(
      (event) => event.type === 'customer-payment',
    ),
  ).toEqual([]);
});
