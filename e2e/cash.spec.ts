import type { Page } from '@playwright/test';
import { ACTIVE_CONFIG, CONFIG_STORAGE_KEY, expect, test } from './fixtures.ts';
import { seedCatalog } from './helpers.ts';
import { getAllFromStore } from './indexed-db.ts';

type StoredCashCount = { id: string; expected: number; counted: number; adjustmentId?: string };
type StoredOutboxEvent = {
  id: string;
  type: string;
  status: string;
  movement?: { source: string };
};
type StoredSale = { id: string; voidsSaleId?: string; ticket?: { date: string; number: number } };

const ARROZ = '7791234000011';

/**
 * Etapa 5 del epic #94 (#100, #120): caja sin turnos — arqueo, ingreso y egreso con conceptos
 * sugeridos, venta sin turno con numeración, `/RESUMEN` del día y el aviso de 24 h. Offline, con
 * locale `es-AR`.
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
  // Sembrar recarga la página: antes de cortar la red.
  await seedCatalog(page);
  await context.setOffline(true);
});

const CASH_COMMANDS = {
  count: ['/ARQUEO', 'Arqueo de caja'],
  in: ['/INGRESO', 'Ingreso de caja'],
  out: ['/EGRESO', 'Egreso de caja'],
} as const;

async function openCash(page: Page, kind: keyof typeof CASH_COMMANDS): Promise<void> {
  const [command, title] = CASH_COMMANDS[kind];
  const commandBar = page.getByLabel('Barra de comandos');
  await commandBar.fill(command);
  await commandBar.press('Enter');
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
}

test('arqueo inicial: sin arqueo previo, registra el contado y encola el ajuste', async ({
  page,
}) => {
  await openCash(page, 'count');
  await expect(
    page.getByText('Sin arqueo previo · esperado desde el inicio de la terminal'),
  ).toBeVisible();
  const counted = page.getByLabel('Contado');
  await expect(counted).toBeFocused();

  await counted.fill('1000');
  await expect(page.getByText('Sobran $1.000,00')).toBeVisible();
  await counted.press('Enter');

  await expect(page.getByText('Arqueo registrado: sobran $1.000,00')).toBeVisible();
  const counts = await getAllFromStore<StoredCashCount>(page, 'cashCounts');
  expect(counts).toMatchObject([{ expected: 0, counted: 1000 }]);
  const events = await getAllFromStore<StoredOutboxEvent>(page, 'outbox');
  expect(events).toMatchObject([
    { type: 'cash-movement', status: 'pending', movement: { source: 'count-adjustment' } },
  ]);
});

test('ingreso con concepto sugerido y egreso mayor que el saldo (#224)', async ({ page }) => {
  // Monto primero: Enter pasa al Concepto y Enter en el Concepto confirma.
  await openCash(page, 'in');
  await expect(page.getByLabel('Monto')).toBeFocused();
  await page.keyboard.type('500');
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Concepto')).toBeFocused();
  await page.keyboard.type('Cambio inicial');
  await page.keyboard.press('Enter');
  await expect(page.getByText('Ingreso registrado')).toBeVisible();

  // La segunda vez, el concepto ya aparece como sugerencia: el primer Enter lo toma y el
  // segundo confirma.
  await openCash(page, 'in');
  await page.keyboard.type('100');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('list', { name: 'Sugerencias' })).toBeVisible();
  await expect(page.getByText('Cambio inicial')).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Concepto')).toHaveValue('Cambio inicial');
  await expect(page.getByLabel('Concepto')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Ingreso registrado')).toBeVisible();

  // Egreso: advierte que supera el saldo, pero igual registra.
  await openCash(page, 'out');
  await page.keyboard.type('9000');
  await expect(page.getByText('El egreso supera el saldo esperado ($600,00)')).toBeVisible();
  await page.keyboard.press('Enter');
  await page.keyboard.type('Proveedor');
  await page.keyboard.press('Enter');
  await expect(page.getByText('Egreso registrado')).toBeVisible();

  const movements = await getAllFromStore<{ direction: string; amount: number; concept: string }>(
    page,
    'cashMovements',
  );
  expect(movements.map(({ direction, amount, concept }) => [direction, amount, concept])).toEqual(
    expect.arrayContaining([
      ['in', 500, 'Cambio inicial'],
      ['in', 100, 'Cambio inicial'],
      ['out', 9000, 'Proveedor'],
    ]),
  );
});

test('venta sin turno, anulación numerada y /RESUMEN del día', async ({ page }) => {
  const commandBar = page.getByLabel('Barra de comandos');

  // Dos ventas sin abrir ningún turno: la más nueva se anula, así la otra sigue anulable y
  // `/ANULAR` muestra la lista.
  for (const expected of ['Ticket #1', 'Ticket #2']) {
    await commandBar.fill(ARROZ);
    await commandBar.press('Enter');
    await commandBar.press('Enter');
    await expect(page.getByRole('heading', { name: 'Cobrar venta' })).toBeVisible();
    await page.keyboard.press('Control+Enter');
    await expect(page.getByRole('heading', { name: 'Comprobante' })).toBeVisible();
    await expect(page.getByText(expected)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(commandBar).toBeVisible();
  }

  await commandBar.fill('/anular');
  await commandBar.press('Enter');
  await expect(page.getByTestId('void-row').first()).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(commandBar).toBeVisible();

  const sales = await getAllFromStore<StoredSale>(page, 'sales');
  expect(sales.find((sale) => sale.voidsSaleId !== undefined)?.ticket?.number).toBe(3);

  await commandBar.fill('/anular');
  await commandBar.press('Enter');
  await expect(page.getByText('· Anulación del #2', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');

  await commandBar.fill('/RESUMEN');
  await commandBar.press('Enter');
  await expect(page.getByRole('heading', { name: 'Resumen del día' })).toBeVisible();
  await expect(page.getByTestId('day-heading')).toHaveText(/^Hoy · /);
  await expect(page.getByText('Ticket #3')).toBeVisible();
  await expect(page.getByText('· Anulación del #2')).toBeVisible();
  await expect(page.getByText('Saldo de efectivo actual')).toBeVisible();
});

test('el aviso "Sin arqueo en 24 h" abre el arqueo y desaparece al arquear', async ({ page }) => {
  const notice = page.getByRole('button', { name: 'Sin arqueo en 24 h' });
  await expect(notice).toBeVisible();

  await notice.click();
  await expect(page.getByRole('heading', { name: 'Arqueo de caja' })).toBeVisible();
  await expect(page.getByLabel('Contado')).toBeFocused();

  await page.getByLabel('Contado').fill('0');
  await page.keyboard.press('Enter');
  await expect(page.getByText('Arqueo registrado: sin diferencia')).toBeVisible();
  await expect(notice).toHaveCount(0);
});
