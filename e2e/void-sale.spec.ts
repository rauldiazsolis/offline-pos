import { expect, test } from './fixtures.ts';
import { confirmCheckout, fillPayment, openCashSession, seedCatalog } from './helpers.ts';
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
  await openCashSession(page);
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
  await expect(page.getByRole('heading', { name: 'Anular venta' })).toBeVisible();
  await expect(page.getByRole('listitem')).toBeVisible(); // carga async de la lista

  await page.keyboard.press('Enter'); // selecciona la única venta de la lista
  await expect(page.getByText('¿Anular esta venta? Enter confirma, Esc cancela.')).toBeVisible();
  await page.keyboard.press('Enter'); // confirma

  await expect(page.getByLabel('Barra de comandos')).toBeVisible();

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
  await expect(page.getByText('No hay ventas de las últimas 24 horas para anular.')).toBeVisible();
});
