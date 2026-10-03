import { expect, test, type Page } from '@playwright/test';
import { test as fixtureTest } from './fixtures.ts';
import { confirmCheckout, fillPayment, seedCatalog } from './helpers.ts';
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
  // #193: caja, sucursal y empresa de la demo en la barra; caja y sucursal en la pestaña.
  await expect(page.getByText('Caja 1 - CENTRAL - Kiosco de demo')).toBeVisible();
  await expect(page).toHaveTitle('Caja 1 - CENTRAL');

  await commandBar.fill('arroz');
  await expect(page.getByText('Arroz 1kg')).toBeVisible();
  await commandBar.press('Enter'); // línea en la venta en curso (se persiste en draftCart)
  expect(await getAllFromStore(page, 'draftCart')).toHaveLength(1);

  await commandBar.fill('/ALTA');
  await commandBar.press('Enter');
  await expect(page).toHaveURL(/localhost:4001\/_demo\/onboarding\?return_url=/);
  await page.getByLabel('Nombre del comercio').fill('Almacén Rosa');
  await page.getByRole('button', { name: 'Crear comercio y volver al POS' }).click();

  await expect(page.getByLabel('Barra de comandos')).toBeVisible();
  await expect(page.getByText('DEMO', { exact: true })).toHaveCount(0);
  expect(page.url()).not.toContain('connect=');
  const config = await readConfig(page);
  expect(config).toMatchObject({ type: 'rest', baseUrl: BACKEND, apiKey: 'demo-api-key' });
  expect(config).not.toHaveProperty('demo');
  await expect(page.getByText('Arroz 1kg')).toHaveCount(0); // la venta en curso se borró
  // #193: ya no es una demo, la empresa es la del alta.
  await expect(page.getByText('Caja 1 - CENTRAL - Almacén Rosa')).toBeVisible();
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
  await page.getByRole('button', { name: 'Volver sin wipe_key' }).click();

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

fixtureTest(
  'con datos sin enviar: el link pide confirmación; Esc no toca nada, Enter abre la demo (#176)',
  async ({ page }) => {
    await page.goto('/');
    const commandBar = page.getByLabel('Barra de comandos');
    await expect(commandBar).toBeVisible();
    await seedCatalog(page);

    // Una venta que nunca llega: el backend del fixture es inalcanzable.
    await commandBar.fill('arroz');
    await expect(page.getByText('Arroz 1kg')).toBeVisible();
    await commandBar.press('Enter');
    await commandBar.press('Control+Enter');
    await expect(page.getByRole('heading', { name: 'Cobrar' })).toBeVisible();
    await fillPayment(page, 'Efectivo', 1200);
    await confirmCheckout(page);
    await expect(page.getByRole('heading', { name: 'Comprobante' })).toBeVisible();

    await page.goto(DEMO_LINK);
    await expect(page.getByRole('heading', { name: 'Abrir una demo' })).toBeVisible();
    await expect(page.getByText(/Sin enviar a 127\.0\.0\.1:9: 1 venta/)).toBeVisible();
    await expect(page.getByText(/Conexión a 127\.0\.0\.1:9/)).toBeVisible();
    expect(page.url()).not.toContain('demo=');

    await page.keyboard.press('Escape');
    await expect(page.getByLabel('Barra de comandos')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Abrir una demo' })).toHaveCount(0);
    expect(await getAllFromStore(page, 'sales')).toHaveLength(1);
    expect(await readConfig(page)).toMatchObject({ baseUrl: 'http://127.0.0.1:9' });

    await page.goto(DEMO_LINK);
    await expect(page.getByRole('heading', { name: 'Abrir una demo' })).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Borrar y abrir la demo (Enter)' }),
    ).toBeEnabled();
    await page.keyboard.press('Enter');
    await expect(page.getByText('DEMO', { exact: true })).toBeVisible();
    expect(await getAllFromStore(page, 'sales')).toHaveLength(0);
    // Sin navegar: el fixture vuelve a sembrar su conexión en cada carga de página.
    expect(await readConfig(page)).toMatchObject({ baseUrl: BACKEND, demo: { backend: BACKEND } });
  },
);

test('demo revocada: la barra lo dice y "Empezar una demo nueva" arranca otra limpia (#176)', async ({
  page,
}) => {
  await page.goto(DEMO_LINK);
  const commandBar = page.getByLabel('Barra de comandos');
  await expect(page.getByText('DEMO', { exact: true })).toBeVisible();
  const { apiKey: oldKey } = (await readConfig(page)) as { apiKey: string };
  expect(oldKey).toMatch(/^demo-/);

  await page.request.post(`${BACKEND}/_demo/revoke-demos`);
  // Al aplicar la demo arrancan ciclos de sync: si uno tiene el cerrojo, /SINCRONIZAR no corre y
  // hay que repetirlo.
  await expect(async () => {
    await commandBar.fill('/SINCRONIZAR');
    await commandBar.press('Enter');
    await expect(page.getByText('La demo terminó')).toBeVisible({ timeout: 2_000 });
  }).toPass();

  await page.getByRole('button', { name: 'Empezar una demo nueva (/DEMO_NUEVA)' }).click();
  await expect(page.getByLabel('Barra de comandos')).toBeVisible();
  await expect(page.getByText('DEMO', { exact: true })).toBeVisible();
  await expect(page.getByText('La demo terminó')).toHaveCount(0);
  expect(page.url()).not.toContain('demo=');
  const { apiKey } = (await readConfig(page)) as { apiKey: string };
  expect(apiKey).toMatch(/^demo-/);
  expect(apiKey).not.toBe(oldKey);
});
