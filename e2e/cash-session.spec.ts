import { expect, test } from '@playwright/test';
import { confirmCheckout, fillPayment, openCashSession, seedCatalog } from './helpers.ts';
import { getAllFromStore } from './indexed-db.ts';

type StoredCashSession = {
  id: string;
  openedAt: string;
  closedAt?: string;
  openingAmount: number;
  closingAmount?: number;
  sales: string[];
};
type StoredSale = { id: string; status: string; total: number };
type StoredOutboxEvent = {
  id: string;
  type: string;
  status: string;
  session?: StoredCashSession;
};

test('abrir un turno, vender, cerrarlo con arqueo y encolar el evento de outbox', async ({
  page,
}) => {
  await page.goto('/');
  const commandBar = page.getByLabel('Barra de comandos');
  await expect(commandBar).toBeVisible();

  // Fase 7: sin backend en este spec, el catálogo no llega solo — se siembra
  // a mano (ver `helpers.ts::seedCatalog`).
  await seedCatalog(page);

  await openCashSession(page, 500);

  const openSessions = await getAllFromStore<StoredCashSession>(page, 'cashSessions');
  expect(openSessions).toHaveLength(1);
  expect(openSessions[0]).toMatchObject({ openingAmount: 500, sales: [] });
  expect(openSessions[0]?.closedAt).toBeUndefined();

  await commandBar.fill('arroz');
  await expect(page.getByText('Arroz 1kg')).toBeVisible();
  await commandBar.press('Enter');
  await commandBar.press('Control+Enter');
  await expect(page.getByRole('heading', { name: 'Cobrar' })).toBeVisible();

  await fillPayment(page, 'Efectivo', 1200);
  await confirmCheckout(page);
  await expect(page.getByRole('heading', { name: 'Comprobante' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(commandBar).toBeVisible();

  const [sale] = await getAllFromStore<StoredSale>(page, 'sales');
  expect(sale?.status).toBe('closed');

  const [afterSale] = await getAllFromStore<StoredCashSession>(page, 'cashSessions');
  expect(afterSale?.sales).toEqual([sale?.id]);
  expect(afterSale?.closedAt).toBeUndefined();

  // Volver a /CAJA con un turno ya abierto entra directo al resumen — no
  // vuelve a pedir el monto de apertura.
  await commandBar.fill('/CAJA');
  await commandBar.press('Enter');
  await expect(page.getByRole('heading', { name: 'Caja' })).toBeVisible();
  await expect(page.getByText('Turno abierto')).toBeVisible();

  const closingInput = page.getByLabel('Efectivo contado para cerrar el turno');
  await closingInput.fill('1700'); // 500 de apertura + 1200 de la venta en efectivo, sin diferencia
  await closingInput.press('Enter');
  await expect(
    page.getByText('¿Cerrar el turno con este efectivo contado? Enter confirma, Esc vuelve a editar.'),
  ).toBeVisible();

  await page.keyboard.press('Enter'); // confirma el cierre
  await expect(page.getByText('Turno cerrado. Enter o Esc vuelve a la venta.')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(commandBar).toBeVisible();

  const [closed] = await getAllFromStore<StoredCashSession>(page, 'cashSessions');
  expect(closed).toMatchObject({ openingAmount: 500, closingAmount: 1700, sales: [sale?.id] });
  expect(closed?.closedAt).toBeDefined();

  const outboxEvents = await getAllFromStore<StoredOutboxEvent>(page, 'outbox');
  const cashSessionEvent = outboxEvents.find((event) => event.type === 'cash-session');
  expect(cashSessionEvent).toMatchObject({ id: closed?.id, status: 'pending' });
  expect(cashSessionEvent?.session?.closingAmount).toBe(1700);
});

test('sin turno abierto, /COBRAR (Ctrl+Enter) rechaza cobrar', async ({ page }) => {
  await page.goto('/');
  const commandBar = page.getByLabel('Barra de comandos');
  await expect(commandBar).toBeVisible();

  // Fase 7: sin backend en este spec, el catálogo no llega solo — se siembra
  // a mano (ver `helpers.ts::seedCatalog`).
  await seedCatalog(page);

  await commandBar.fill('arroz');
  await expect(page.getByText('Arroz 1kg')).toBeVisible();
  await commandBar.press('Enter');

  await commandBar.press('Control+Enter');

  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Cobrar' })).not.toBeVisible();
});
