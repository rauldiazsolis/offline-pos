import type { Page } from '@playwright/test';
import { ACTIVE_CONFIG, expect, test } from './fixtures.ts';
import { seedCatalog } from './helpers.ts';
import { getAllFromStore } from './indexed-db.ts';

type StoredStock = { productId: string; quantity: number };
type StoredOutboxEvent = { id: string; type: string; status: string };

const ARROZ_BARCODE = '7791234000011';
const ARROZ_ID = 'e2e-ALM-001';
const TRAINING_DB = 'offline-pos#entrenamiento';
const BANNER_TEXT = 'MODO ENTRENAMIENTO · nada se envía al backend · todo se borra al salir';

async function stockOf(page: Page, dbName?: string): Promise<number | undefined> {
  const rows = await getAllFromStore<StoredStock>(page, 'stock', dbName);
  return rows.find((row) => row.productId === ARROZ_ID)?.quantity;
}

/** Vende un arroz en efectivo y vuelve a la venta desde el comprobante (Al cobrar: Mostrar). */
async function sellArroz(page: Page, ticket: string, training: boolean): Promise<void> {
  const bar = page.getByLabel('Barra de comandos');
  await bar.fill(ARROZ_BARCODE);
  await bar.press('Enter');
  await bar.press('Enter');
  await expect(page.getByRole('heading', { name: 'Cobrar venta' })).toBeVisible();
  await page.keyboard.press('Control+Enter');
  await expect(page.getByRole('heading', { name: 'Comprobante' })).toBeVisible();
  await expect(page.getByText(ticket)).toBeVisible();
  await expect(page.getByText('ENTRENAMIENTO', { exact: true })).toHaveCount(training ? 1 : 0);
  await page.keyboard.press('Escape');
  await expect(bar).toBeVisible();
}

async function runCommand(page: Page, command: string): Promise<void> {
  const bar = page.getByLabel('Barra de comandos');
  await bar.fill(command);
  await bar.press('Enter');
}

/**
 * Modo entrenamiento (#177), el criterio de aceptación de punta a punta: una venta de práctica
 * descuenta stock en su base y se imprime con la marca, no aparece en ningún push, y al salir el
 * stock y `/RESUMEN` vuelven a lo real con la venta real de antes todavía pendiente. El backend
 * del fixture no existe: cada request a él se anota y se corta, así se ve si hubo un push.
 */
test('entrenamiento: vende con lo real, nada se empuja y al salir vuelve lo real', async ({
  page,
}) => {
  // Dos recargas (entrar y salir) y dos ventas: en frío llegó a 27 s, cerca del límite de 30.
  test.slow();
  const pushes: string[] = [];
  await page.route(`${ACTIVE_CONFIG.baseUrl}/**`, async (route) => {
    if (route.request().url().includes('/sync/push')) {
      pushes.push(route.request().url());
    }
    await route.abort();
  });

  await page.goto('/');
  // Sembrar recién con la app arriba: abrir IndexedDB mientras Dexie la crea se bloquea.
  await expect(page.getByLabel('Barra de comandos')).toBeVisible();
  await seedCatalog(page);

  // Una venta real que queda pendiente: el backend no contesta.
  await sellArroz(page, 'Ticket #1', false);
  expect(await stockOf(page)).toBe(39);

  // Entrar.
  await runCommand(page, '/ENTRENAMIENTO');
  await expect(page.getByRole('heading', { name: 'Entrar al entrenamiento' })).toBeVisible();
  await expect(page.getByText(/^Sin enviar: 1 venta y 1 movimiento más\./)).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByText(BANNER_TEXT)).toBeVisible();
  await expect(page).toHaveTitle(/^ENTRENAMIENTO · /);
  // El último envío de lo real, antes de entrar, sí podía intentar un push; desde acá, ninguno.
  pushes.length = 0;

  // `/CONFIG` está cortado.
  await runCommand(page, '/CONFIG');
  await expect(
    page.getByText('/CONFIG no está disponible: en entrenamiento; salí con /ENTRENAMIENTO.'),
  ).toBeVisible();
  await page.getByLabel('Barra de comandos').fill('');

  // Una venta de práctica: numeración propia, la marca en el comprobante y el stock de su base.
  await sellArroz(page, 'Ticket #1', true);
  expect(await stockOf(page, TRAINING_DB)).toBe(38);

  // `/SINCRONIZAR` en entrenamiento: el pull se intenta, el push nunca.
  const pull = page.waitForRequest((request) => request.url().includes('/sync/pull'));
  await runCommand(page, '/SINCRONIZAR');
  await pull;
  expect(pushes).toEqual([]);

  // Salir, con el botón de la franja.
  await page.getByRole('button', { name: 'Salir del entrenamiento (/ENTRENAMIENTO)' }).click();
  await expect(page.getByRole('heading', { name: 'Salir del entrenamiento' })).toBeVisible();
  await expect(page.getByText('1 venta', { exact: true })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Saliste del entrenamiento.')).toBeVisible();
  await expect(page.getByText(BANNER_TEXT)).toHaveCount(0);
  expect(pushes).toEqual([]);

  // Lo real, intacto: el stock y la venta real todavía pendiente.
  expect(await stockOf(page)).toBe(39);
  const outbox = await getAllFromStore<StoredOutboxEvent>(page, 'outbox');
  expect(
    outbox.filter((event) => event.type === 'sale' && event.status === 'pending'),
  ).toHaveLength(1);

  // `/RESUMEN` real: un solo ticket.
  await runCommand(page, '/RESUMEN');
  await expect(page.getByRole('heading', { name: 'Resumen del día' })).toBeVisible();
  await expect(page.getByText('Ticket #1')).toBeVisible();
  await expect(page.getByText('Ticket #2')).toHaveCount(0);
  await page.keyboard.press('Escape');

  // Y lo real sale en el próximo push.
  await runCommand(page, '/SINCRONIZAR');
  await expect.poll(() => pushes.length).toBeGreaterThan(0);
});
