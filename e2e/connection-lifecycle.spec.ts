import { expect, test, type Page } from '@playwright/test';
import { getAllFromStore, putIntoStore } from './indexed-db.ts';

const STORAGE_KEY = 'offline-pos:sync-config';
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': '*',
};

/** Backend REST simulado en http://backend.test: OPTIONS + /sync/push y /sync/pull vacíos. */
async function routeRestBackend(page: Page): Promise<void> {
  await page.route('http://backend.test/**', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: CORS });
      return;
    }
    const path = new URL(route.request().url()).pathname;
    const body =
      path === '/sync/pull'
        ? { products: { items: [] }, customers: { items: [] }, stock: [], lots: {} }
        : {};
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: CORS,
      body: JSON.stringify(body),
    });
  });
}

/** Puente de Sheets simulado: un producto propio, sin clientes. */
async function routeSheetsBridge(page: Page): Promise<void> {
  await page.route('https://script.google.com/**', async (route) => {
    const data = {
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

/** Primer arranque contra el backend REST simulado: elegir REST, tipear la URL y confirmar. */
async function firstRunAgainstRestBackend(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Tipo de conexión').selectOption('rest');
  await page.getByLabel(/URL del sistema externo/).fill('http://backend.test');
  await page.keyboard.press('Control+Enter');
  await expect(page.getByLabel('Barra de comandos')).toBeVisible();
}

const closedSale = {
  id: 'e2e-sale-1',
  lines: [],
  payments: [],
  total: 0,
  status: 'closed',
  createdAt: '2026-01-01T00:00:00.000Z',
};

/** Abre /CONFIG desde la barra de comandos y elige Google Sheets con su URL. */
async function switchToSheets(page: Page): Promise<void> {
  const commandBar = page.getByLabel('Barra de comandos');
  await commandBar.fill('/CONFIG');
  await commandBar.press('Enter');
  await page.getByLabel('Tipo de conexión').selectOption('google-sheets');
  await page.getByLabel(/URL del Web App/).fill('https://script.google.com/macros/s/e2e/exec');
  await page.keyboard.press('Control+Enter');
}

test('sin config guardada la app abre directo en /CONFIG y no hay forma de salir', async ({
  page,
}) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Configurar conexión' })).toBeVisible();
  await expect(page.getByText('Configurá y probá la conexión para empezar.')).toBeVisible();
  await expect(page.getByLabel('Barra de comandos')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Cancelar' })).toHaveCount(0);

  await page.keyboard.press('Escape');

  await expect(page.getByRole('heading', { name: 'Configurar conexión' })).toBeVisible();
  await expect(page.getByLabel('Barra de comandos')).toHaveCount(0);
});

test('una prueba fallida deja el modal abierto con lo tipeado y no guarda nada', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByLabel('Tipo de conexión').selectOption('rest');
  await page.getByLabel(/URL del sistema externo/).fill('http://127.0.0.1:9');

  await page.keyboard.press('Control+Enter');

  await expect(page.getByRole('alert')).toContainText('No se pudo conectar con el servidor');
  await expect(page.getByLabel(/URL del sistema externo/)).toHaveValue('http://127.0.0.1:9');
  await expect(page.getByLabel('Barra de comandos')).toHaveCount(0);
  expect(await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY)).toBeNull();
});

test('una config guardada antes de la Etapa 2b (sin type ni verifiedAt) pide probarla una vez, precargada', async ({
  page,
}) => {
  await page.addInitScript((key) => {
    localStorage.setItem(
      key,
      JSON.stringify({ baseUrl: 'http://backend.test', apiKey: 'clave-vieja' }),
    );
  }, STORAGE_KEY);
  await routeRestBackend(page);

  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Configurar conexión' })).toBeVisible();
  await expect(page.getByLabel('Tipo de conexión')).toHaveValue('rest');
  await expect(page.getByLabel(/URL del sistema externo/)).toHaveValue('http://backend.test');
  await expect(page.getByLabel(/API key/)).toHaveValue('clave-vieja');

  await page.getByLabel(/API key/).press('Control+Enter');

  await expect(page.getByLabel('Barra de comandos')).toBeVisible();
  const raw = await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY);
  const stored = JSON.parse(raw ?? 'null') as Record<string, unknown>;
  expect(stored.verifiedAt).toBeTruthy();
  expect(stored.type).toBe('rest');
});

test('cambiar de conector con datos: advierte qué se pierde, y al confirmar borra y carga lo nuevo', async ({
  page,
}) => {
  await routeRestBackend(page);
  await routeSheetsBridge(page);
  await firstRunAgainstRestBackend(page);
  await putIntoStore(page, 'sales', closedSale);

  await switchToSheets(page);

  await expect(
    page.getByText('Cambiar de conexión borra los datos de esta terminal'),
  ).toBeVisible();
  await expect(page.getByText(/1 venta/)).toBeVisible();
  // Todavía no cambió nada.
  expect(await getAllFromStore(page, 'sales')).toHaveLength(1);

  await page.keyboard.press('Enter');

  await expect(page.getByLabel('Barra de comandos')).toBeVisible();
  expect(await getAllFromStore(page, 'sales')).toHaveLength(0);
  const products = await getAllFromStore<{ name: string }>(page, 'products');
  expect(products.map((product) => product.name)).toEqual(['Producto de la planilla']);
});

test('Esc en la confirmación vuelve a editar sin borrar nada', async ({ page }) => {
  await routeRestBackend(page);
  await routeSheetsBridge(page);
  await firstRunAgainstRestBackend(page);
  await putIntoStore(page, 'sales', closedSale);
  await switchToSheets(page);
  await expect(
    page.getByText('Cambiar de conexión borra los datos de esta terminal'),
  ).toBeVisible();

  await page.keyboard.press('Escape');

  await expect(page.getByLabel(/URL del Web App/)).toBeVisible();
  expect(await getAllFromStore(page, 'sales')).toHaveLength(1);
});
