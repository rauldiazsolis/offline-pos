import { expect, test, type Page } from '@playwright/test';
import { test as fixtureTest } from './fixtures.ts';
import { confirmCheckout, fillPayment } from './helpers.ts';
import { getAllFromStore } from './indexed-db.ts';

/**
 * Onboarding de demo (#128) contra el demo-backend real, el de `4001` (en memoria): cada
 * `POST /demo-sessions` re-siembra su base, así que los tests de este archivo van en serie.
 */
test.describe.configure({ mode: 'serial' });

const BACKEND = 'http://localhost:4001';
const DEMO_LINK = `/?demo=true&backend=${encodeURIComponent(BACKEND)}`;

function readConfig(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(
    () =>
      JSON.parse(localStorage.getItem('offline-pos:sync-config') ?? '{}') as Record<
        string,
        unknown
      >,
  );
}

test('link de demo → venta en demo → /ALTA → alta falsa → vuelve configurado y sin lo local', async ({
  page,
}) => {
  await page.goto(DEMO_LINK);
  const commandBar = page.getByLabel('Barra de comandos');
  await expect(commandBar).toBeVisible();
  await expect(page.getByText('DEMO', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Crear mi comercio (/ALTA)' })).toBeVisible();
  expect(page.url()).not.toContain('demo=');

  await commandBar.fill('arroz');
  await expect(page.getByText('Arroz 1kg')).toBeVisible();
  await commandBar.press('Enter'); // línea en la venta en curso (se persiste en draftCart)
  expect(await getAllFromStore(page, 'draftCart')).toHaveLength(1);

  await commandBar.fill('/ALTA');
  await commandBar.press('Enter');
  await expect(page).toHaveURL(/localhost:4001\/_demo\/onboarding\?return_url=/);
  await page.getByRole('link', { name: 'Crear comercio y volver al POS' }).click();

  await expect(page.getByLabel('Barra de comandos')).toBeVisible();
  await expect(page.getByText('DEMO', { exact: true })).toHaveCount(0);
  expect(page.url()).not.toContain('connect=');
  const config = await readConfig(page);
  expect(config).toMatchObject({ type: 'rest', baseUrl: BACKEND, apiKey: 'demo-api-key' });
  expect(config).not.toHaveProperty('demo');
  await expect(page.getByText('Arroz 1kg')).toHaveCount(0); // la venta en curso se borró
});

test('template desconocido: arranca con el default y avisa', async ({ page }) => {
  await page.goto(`${DEMO_LINK}&template=nope`);
  await expect(page.getByText('La plantilla nope no existe; se usó kiosco.')).toBeVisible();
  await expect(page.getByText('DEMO', { exact: true })).toBeVisible();
});

test('vuelta sin wipe_key con datos: wizard precargado, nada borrado', async ({ page }) => {
  await page.goto(DEMO_LINK);
  const commandBar = page.getByLabel('Barra de comandos');
  await expect(commandBar).toBeVisible();

  // Una venta cerrada: son datos del usuario.
  await commandBar.fill('arroz');
  await expect(page.getByText('Arroz 1kg')).toBeVisible();
  await commandBar.press('Enter');
  await commandBar.press('Control+Enter');
  await expect(page.getByRole('heading', { name: 'Cobrar' })).toBeVisible();
  await fillPayment(page, 'Efectivo', 1200);
  await confirmCheckout(page);
  await expect(page.getByRole('heading', { name: 'Comprobante' })).toBeVisible();
  await page.keyboard.press('Escape');

  await commandBar.fill('/ALTA');
  await commandBar.press('Enter');
  await expect(page).toHaveURL(/localhost:4001\/_demo\/onboarding\?return_url=/);
  await page.getByRole('link', { name: 'Volver sin wipe_key' }).click();

  await expect(page.getByRole('heading', { name: 'Configurar conexión' })).toBeVisible();
  await expect(page.getByText(/Volviste del alta/)).toBeVisible();
  expect(page.url()).not.toContain('connect=');
  expect(await getAllFromStore(page, 'sales')).toHaveLength(1);
  // Sin aplicar nada, la config guardada sigue siendo la de la demo.
  expect(await readConfig(page)).toHaveProperty('demo');
});

test('avisos del backend: "Avisos (1)" y el detalle en /DIAGNOSTICO', async ({ page }) => {
  await page.goto(DEMO_LINK);
  const commandBar = page.getByLabel('Barra de comandos');
  await expect(commandBar).toBeVisible();
  // Después de crear la demo: /demo-sessions re-siembra la base y borra los ajustes del panel.
  await page.request.put(`${BACKEND}/_demo/api/settings`, {
    data: { notice: { enabled: true, severity: 'warning', message: 'Aviso de prueba' } },
  });
  try {
    await commandBar.fill('/SINCRONIZAR');
    await commandBar.press('Enter');
    await page.getByRole('button', { name: 'Avisos (1)' }).click();
    await expect(page.getByText('Aviso de prueba')).toBeVisible();
  } finally {
    await page.request.put(`${BACKEND}/_demo/api/settings`, {
      data: { notice: { enabled: false, severity: 'warning', message: '' } },
    });
  }
});

fixtureTest('con una conexión real el link se ignora y avisa', async ({ page }) => {
  await page.goto(DEMO_LINK);
  await expect(
    page.getByText('Esta terminal ya está conectada: se ignoró el link de demo.'),
  ).toBeVisible();
  expect(page.url()).not.toContain('demo=');
  expect(await readConfig(page)).toMatchObject({ baseUrl: 'http://127.0.0.1:9' });
});
