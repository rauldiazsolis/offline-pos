import { ACTIVE_CONFIG, CONFIG_STORAGE_KEY, expect, test } from './fixtures.ts';
import { confirmCheckout, fillPayment, seedCatalog } from './helpers.ts';
import { getAllFromStore } from './indexed-db.ts';

type StoredSale = {
  id: string;
  status: string;
  total: number;
  lines: unknown[];
  payments: unknown[];
  createdAt: string;
  voidsSaleId?: string;
};
type StoredStockMovement = { saleId?: string; reason: string; delta: number };
type StoredOutboxEvent = { id: string; type: string; status: string; saleId?: string };

async function closeOneSale(page: import('@playwright/test').Page): Promise<void> {
  const commandBar = page.getByLabel('Barra de comandos');
  await commandBar.fill('arroz');
  await commandBar.press('Enter');
  await commandBar.press('Control+Enter');
  await fillPayment(page, 'Efectivo', 1200);
  await confirmCheckout(page);
  await expect(page.getByRole('heading', { name: 'Comprobante' })).toBeVisible();
}

test('anular una venta cerrada revierte el stock sin tocar sus datos originales', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await expect(page.getByLabel('Barra de comandos')).toBeVisible();

  // Fase 7: sin backend en este spec, el catálogo no llega solo — se siembra
  // a mano (ver `helpers.ts::seedCatalog`).
  await seedCatalog(page);

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
  await expect(page.getByRole('heading', { name: 'Anular' })).toBeVisible();
  await expect(page.getByTestId('void-row')).toBeVisible(); // carga async de la lista

  await page.keyboard.press('Enter'); // abre la confirmación de la única venta de la lista
  await expect(page.getByRole('dialog')).toContainText('¿Anular el Ticket #1?');
  await page.keyboard.press('Enter'); // confirma

  await expect(page.getByLabel('Barra de comandos')).toBeVisible();
  await expect(page.getByText('Anulado el Ticket #1 con el Ticket #2')).toBeVisible();

  // #99: la anulación es un ticket propio, negativo, que apunta al original; el original no se toca.
  const sales = await getAllFromStore<StoredSale>(page, 'sales');
  expect(sales).toHaveLength(2);
  const original = sales.find((sale) => sale.id === closed?.id);
  const voidTicket = sales.find((sale) => sale.voidsSaleId === closed?.id);
  expect(original).toEqual(closed);
  expect(voidTicket?.status).toBe('closed');
  expect(voidTicket?.total).toBe(-(closed?.total ?? 0));

  const movements = await getAllFromStore<StoredStockMovement>(page, 'stockMovements');
  expect(movements.find((m) => m.saleId === closed?.id)?.delta).toBe(-1);
  expect(movements.find((m) => m.saleId === voidTicket?.id)).toMatchObject({
    reason: 'sale-void',
    delta: 1,
  });

  // La anulación viaja como un evento `sale` más, con su propio id.
  const outboxEvents = await getAllFromStore<StoredOutboxEvent>(page, 'outbox');
  expect(outboxEvents.find((event) => event.id === voidTicket?.id)).toMatchObject({
    type: 'sale',
    status: 'pending',
  });
  expect(outboxEvents.some((event) => event.type === 'sale-void')).toBe(false);

  // Volver a /ANULAR: sin ninguna fila anulable (la original ya anulada y su anulación), el vacío.
  await commandBar.fill('/anular');
  await commandBar.press('Enter');
  await expect(
    page.getByText('No hay ventas ni cobranzas de las últimas 24 horas para anular.'),
  ).toBeVisible();
});

test.describe('anular una cobranza (#125)', () => {
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

  test('cobrar, anular desde /ANULAR con el buscador y ver el saldo y /RESUMEN', async ({
    page,
  }) => {
    const commandBar = page.getByLabel('Barra de comandos');
    const balanceRow = page.getByTestId('customer-balance');

    // Cobranza de $500 a un cliente nuevo.
    await commandBar.fill('@Ana Gómez');
    await expect(page.getByText('Crear cliente', { exact: false })).toBeVisible();
    await commandBar.press('Enter');
    await commandBar.press('Enter');
    await expect(page.getByRole('heading', { name: 'Cobranza a Ana Gómez' })).toBeVisible();
    await page.getByLabel('Efectivo').fill('500');
    await page.keyboard.press('Control+Enter');
    await expect(page.getByRole('heading', { name: 'Recibo de cobranza' })).toBeVisible();
    await page.keyboard.press('Escape');

    // Al cerrar el recibo el cliente queda desadjuntado: se vuelve a adjuntar para ver su saldo.
    await commandBar.fill('@Ana');
    await expect(page.getByText('Ana Gómez')).toBeVisible();
    await commandBar.press('Enter');
    await expect(balanceRow).toHaveText('Saldo: A favor $500,00');

    // /ANULAR: el buscador tiene el foco; "ana" encuentra el recibo.
    await commandBar.fill('/anular');
    await commandBar.press('Enter');
    await expect(page.getByRole('heading', { name: 'Anular' })).toBeVisible();
    await expect(page.getByTestId('void-row')).toHaveCount(1);
    await page.keyboard.type('ana');
    await expect(page.getByLabel('Buscar')).toHaveValue('ana');
    await expect(page.getByTestId('void-row')).toHaveCount(1);
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('¿Anular el Recibo #1 de Ana Gómez?');
    await expect(dialog).toContainText('A favor $500,00 → Sin saldo');
    await page.keyboard.press('Enter');

    // De vuelta en la venta: el aviso y el saldo que volvió.
    await expect(page.getByText('Anulado el Recibo #1 con el Recibo #2')).toBeVisible();
    await expect(balanceRow).toHaveText('Saldo: Sin saldo');

    const payments = await getAllFromStore<{ id: string; total: number; voidsPaymentId?: string }>(
      page,
      'customerPayments',
    );
    const original = payments.find((payment) => payment.voidsPaymentId === undefined);
    expect(payments.find((payment) => payment.voidsPaymentId === original?.id)?.total).toBe(-500);

    // Otra vez /ANULAR: nada anulable, las dos filas con su marca.
    await commandBar.fill('/anular');
    await commandBar.press('Enter');
    await expect(
      page.getByText('No hay ventas ni cobranzas de las últimas 24 horas para anular.'),
    ).toBeVisible();
    const rows = page.getByTestId('void-row');
    await expect(rows.nth(0)).toContainText('Anulación del #1');
    await expect(rows.nth(1)).toContainText('Anulada');
    await page.keyboard.press('Escape');

    // /RESUMEN: dos recibos, uno anulado.
    await commandBar.fill('/resumen');
    await commandBar.press('Enter');
    await expect(
      page.getByTestId('cash-summary-sidebar').getByText('(2 recibos, 1 anulados)'),
    ).toBeVisible();
  });
});
