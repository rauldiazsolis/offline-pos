import { expect, test, type Page } from '@playwright/test';
import { seedDeviceIdentity } from './fixtures.ts';
import { completeWizardRest } from './helpers.ts';
import { getAllFromStore, putIntoStore } from './indexed-db.ts';

const STORAGE_KEY = 'offline-pos:sync-config';
const SHEETS_URL = 'https://script.google.com/macros/s/e2e/exec';
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': '*',
};

/**
 * Backend REST simulado en http://backend.test: OPTIONS, /info (4.0.0, #99) y
 * /sync/push y /sync/pull vacíos. Devuelve cuántos pulls recibió (la prueba de conexión es
 * un pull).
 */
async function routeRestBackend(page: Page): Promise<{ pulls: () => number }> {
  let pulls = 0;
  await page.route('http://backend.test/**', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: CORS });
      return;
    }
    const path = new URL(route.request().url()).pathname;
    if (path === '/sync/pull') {
      pulls += 1;
    }
    const body =
      path === '/sync/pull'
        ? { products: { items: [] }, customers: { items: [] }, stock: [], lots: {} }
        : path === '/info'
          ? { contractVersion: '4.0.0', status: 'ok' }
          : {};
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: CORS,
      body: JSON.stringify(body),
    });
  });
  return { pulls: () => pulls };
}

/** Puente de Sheets simulado: un producto propio, sin clientes. */
async function routeSheetsBridge(page: Page): Promise<void> {
  await page.route('https://script.google.com/**', async (route) => {
    // 4.0.0 (#99): la prueba de conexión pregunta primero la acción `info`.
    const { action } = JSON.parse(route.request().postData() ?? '{}') as { action?: string };
    const data =
      action === 'info'
        ? { contractVersion: '4.0.0', status: 'ok' }
        : {
            products: {
              items: [
                {
                  id: 'sheet-p1',
                  sku: 'SHEET-1',
                  barcodes: [],
                  name: 'Producto de la planilla',
                  price: 500,
                  taxRate: 0.21,
                  category: 'x',
                  // Contrato v3 (#96): la fecha de alta es obligatoria en el pull.
                  createdAt: '2026-01-01T00:00:00.000Z',
                },
              ],
            },
            customers: { items: [] },
            lots: {},
          };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: CORS,
      body: JSON.stringify({ ok: true, data }),
    });
  });
}

// Fecha de hoy: una venta sincronizada de hace más de 7 días la borra la limpieza (#98) apenas
// termina el pull de aplicar la conexión, y la terminal quedaría sin datos que conservar.
const closedSale = {
  id: 'e2e-sale-1',
  lines: [],
  payments: [],
  total: 0,
  status: 'closed',
  createdAt: new Date().toISOString(),
};

async function storedConfig(page: Page): Promise<Record<string, unknown> | null> {
  const raw = await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY);
  return JSON.parse(raw ?? 'null') as Record<string, unknown> | null;
}

/**
 * Terminal ya conectada al backend REST simulado, con una venta local; abre
 * /CONFIG (en Revisar), cambia a Google Sheets y prueba: queda en "Datos
 * locales" (hay una venta que conservar o borrar).
 */
async function switchToSheetsWithASale(page: Page): Promise<void> {
  await page.goto('/');
  await completeWizardRest(page, { baseUrl: 'http://backend.test' });
  await putIntoStore(page, 'sales', closedSale);

  const commandBar = page.getByLabel('Barra de comandos');
  await commandBar.fill('/CONFIG');
  await commandBar.press('Enter');
  await expect(page.getByRole('button', { name: 'Aplicar (Enter)' })).toBeVisible();

  await page.keyboard.press('Alt+2');
  await page.getByRole('button', { name: /^Google Sheets/ }).click();
  await page.getByLabel('URL del Web App de Google Apps Script').fill(SHEETS_URL);
  await page.keyboard.press('Enter');
  await expect(page.getByText(/Conexión OK/)).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Mantener los datos locales' })).toBeVisible();
}

test('sin config guardada abre el wizard en Terminal y no hay forma de salir', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Configurar conexión' })).toBeVisible();
  await expect(page.getByText('Configurá y probá la conexión para empezar.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Paso 1: Terminal' })).toHaveAttribute(
    'aria-current',
    'step',
  );
  await expect(page.getByLabel('Sucursal')).toBeFocused();
  // El foco se ve apenas carga, sin haber tocado una tecla (anillo del campo enfocado).
  await expect(page.getByLabel('Sucursal')).toHaveCSS('outline-style', 'solid');
  await expect(page.getByLabel('Barra de comandos')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Cancelar (Esc)' })).toHaveCount(0);

  await page.keyboard.press('Escape');

  await expect(page.getByRole('heading', { name: 'Configurar conexión' })).toBeVisible();
  await expect(page.getByLabel('Barra de comandos')).toHaveCount(0);
});

test('una prueba fallida se queda en Probar con el error y no guarda nada', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Sucursal').fill('Casa central');
  await page.getByLabel('Punto de venta').fill('Caja 1');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: /^REST genérico/ }).click();
  await page.getByLabel('URL del sistema externo').fill('http://127.0.0.1:9');

  await page.keyboard.press('Enter');

  await expect(page.getByRole('alert')).toContainText('No se pudo conectar con el servidor');
  await expect(page.getByRole('button', { name: 'Reintentar (Enter)' })).toBeVisible();
  await page.getByRole('button', { name: 'Corregir datos (Alt+3)' }).click();
  await expect(page.getByLabel('URL del sistema externo')).toHaveValue('http://127.0.0.1:9');
  await expect(page.getByLabel('Barra de comandos')).toHaveCount(0);
  expect(await storedConfig(page)).toBeNull();
});

test('config probada de la Etapa 1 sin sucursal (incomplete): completar la terminal guarda sin volver a probar', async ({
  page,
}) => {
  await seedDeviceIdentity(page);
  await page.addInitScript((key) => {
    if (localStorage.getItem(key) === null) {
      localStorage.setItem(
        key,
        JSON.stringify({
          type: 'rest',
          baseUrl: 'http://backend.test',
          verifiedAt: '2026-01-01T00:00:00.000Z',
        }),
      );
    }
  }, STORAGE_KEY);
  const backend = await routeRestBackend(page);

  await page.goto('/');

  await expect(page.getByLabel('Sucursal')).toBeFocused();
  await expect(page.getByText('Esta terminal no tenía identidad')).toHaveCount(0);
  await page.getByLabel('Sucursal').fill('Casa central');
  await page.getByLabel('Punto de venta').fill('Caja 1');
  await page.keyboard.press('Control+Enter');

  await expect(page.getByRole('button', { name: 'Aplicar (Enter)' })).toBeVisible();
  await expect(
    page.getByText('Se guarda la sucursal, el punto de venta y el locale.'),
  ).toBeVisible();
  expect(backend.pulls()).toBe(0);

  await page.keyboard.press('Enter');

  await expect(page.getByLabel('Barra de comandos')).toBeVisible();
  expect(await storedConfig(page)).toMatchObject({
    branch: 'Casa central',
    pointOfSale: 'Caja 1',
    verifiedAt: '2026-01-01T00:00:00.000Z',
  });
});

test('una config guardada antes de la Etapa 2b (sin type ni verifiedAt) queda precargada y pide probarla', async ({
  page,
}) => {
  await seedDeviceIdentity(page);
  await page.addInitScript((key) => {
    if (localStorage.getItem(key) === null) {
      localStorage.setItem(
        key,
        JSON.stringify({ baseUrl: 'http://backend.test', apiKey: 'clave-vieja' }),
      );
    }
  }, STORAGE_KEY);
  await routeRestBackend(page);

  await page.goto('/');

  await page.getByLabel('Sucursal').fill('Casa central');
  await page.getByLabel('Punto de venta').fill('Caja 1');
  await page.keyboard.press('Control+Enter');
  // La conexión precargada nunca se probó: Ctrl+Enter se frena en Probar y la lanza.
  await expect(page.getByText(/Conexión OK/)).toBeVisible();
  await page.keyboard.press('Control+Enter');
  await expect(page.getByText(/Se conecta a backend\.test/)).toBeVisible();
  await page.keyboard.press('Enter');

  await expect(page.getByLabel('Barra de comandos')).toBeVisible();
  const stored = await storedConfig(page);
  expect(stored).toMatchObject({ type: 'rest', apiKey: 'clave-vieja' });
  expect(stored?.verifiedAt).toBeTruthy();
});

test('cambiar de conexión con una venta: Mantener (preseleccionada) conserva la venta y trae el catálogo nuevo', async ({
  page,
}) => {
  await routeRestBackend(page);
  await routeSheetsBridge(page);
  await switchToSheetsWithASale(page);

  await expect(page.getByRole('button', { name: 'Mantener los datos locales' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.keyboard.press('Enter');
  await expect(page.getByText(/se conserva 1 venta/)).toBeVisible();
  await page.keyboard.press('Enter');

  await expect(page.getByLabel('Barra de comandos')).toBeVisible();
  expect(await getAllFromStore(page, 'sales')).toHaveLength(1);
  const products = await getAllFromStore<{ name: string }>(page, 'products');
  expect(products.map((product) => product.name)).toEqual(['Producto de la planilla']);
});

test('cambiar de conexión eligiendo Borrar: confirma con los conteos y borra lo local', async ({
  page,
}) => {
  await routeRestBackend(page);
  await routeSheetsBridge(page);
  await switchToSheetsWithASale(page);

  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('button', { name: 'Borrar los datos locales' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.keyboard.press('Enter');
  await expect(page.getByText(/Se van a borrar: 1 venta/)).toBeVisible();
  // Todavía no cambió nada.
  expect(await getAllFromStore(page, 'sales')).toHaveLength(1);

  await page.keyboard.press('Enter');

  await expect(page.getByLabel('Barra de comandos')).toBeVisible();
  expect(await getAllFromStore(page, 'sales')).toHaveLength(0);
  const products = await getAllFromStore<{ name: string }>(page, 'products');
  expect(products.map((product) => product.name)).toEqual(['Producto de la planilla']);
});

test('Esc en la confirmación de borrado vuelve a las opciones sin borrar nada', async ({
  page,
}) => {
  await routeRestBackend(page);
  await routeSheetsBridge(page);
  await switchToSheetsWithASale(page);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.getByText(/Se van a borrar: 1 venta/)).toBeVisible();

  await page.keyboard.press('Escape');

  await expect(page.getByRole('button', { name: 'Borrar los datos locales' })).toBeVisible();
  expect(await getAllFromStore(page, 'sales')).toHaveLength(1);
});
