import { expect, test, type Page } from '@playwright/test';

const WEB_APP_URL = 'https://script.google.com/macros/s/e2e/exec';
const STORAGE_KEY = 'offline-pos:sync-config';

test.beforeEach(async ({ page }) => {
  // Ningún test de este archivo necesita hablar con Google: si el motor de
  // sync intenta sincronizar contra el Web App, que falle rápido y en silencio.
  await page.route('https://script.google.com/**', (route) => route.abort());
});

async function openConfig(page: Page): Promise<void> {
  const commandBar = page.getByLabel('Barra de comandos');
  await commandBar.fill('/CONFIG');
  await commandBar.press('Enter');
  await expect(page.getByRole('heading', { name: 'Configurar conexión' })).toBeVisible();
}

test('elegir Google Sheets solo con teclado, validar al confirmar, guardar y verlo precargado', async ({
  page,
}) => {
  await page.goto('/');
  await openConfig(page);

  // El foco arranca en el selector de tipo; type-ahead ("G") elige Google Sheets.
  const typeSelect = page.getByLabel('Tipo de conexión');
  await expect(typeSelect).toBeFocused();
  await typeSelect.press('G');
  await expect(typeSelect).toHaveValue('google-sheets');

  // Los campos de REST desaparecen, los de Sheets aparecen, el selector sigue.
  await expect(page.getByLabel(/URL del sistema externo/)).toHaveCount(0);
  await page.keyboard.press('Tab');
  await expect(page.getByLabel(/URL del Web App/)).toBeFocused();

  // Validación solo al confirmar: una URL inválida no molesta mientras se tipea…
  await page.keyboard.type('no-es-una-url');
  await expect(page.getByRole('alert')).toHaveCount(0);
  // …pero Ctrl+Enter la rechaza, se queda en el modal y deja el campo seleccionado.
  await page.keyboard.press('Control+Enter');
  await expect(page.getByRole('alert')).toContainText('URL del Web App');
  await expect(page.getByRole('heading', { name: 'Configurar conexión' })).toBeVisible();

  // El campo quedó enfocado y seleccionado: tipear reemplaza.
  await page.keyboard.type(WEB_APP_URL);
  await page.keyboard.press('Control+Enter');
  await expect(page.getByLabel('Barra de comandos')).toBeFocused();

  const stored = await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY);
  expect(JSON.parse(stored ?? 'null')).toEqual({ type: 'google-sheets', webAppUrl: WEB_APP_URL });

  // Reabrir /CONFIG muestra lo guardado, no los defaults del demo.
  await openConfig(page);
  await expect(page.getByLabel('Tipo de conexión')).toHaveValue('google-sheets');
  await expect(page.getByLabel(/URL del Web App/)).toHaveValue(WEB_APP_URL);
});

test('una config guardada por una versión anterior (sin type) se lee como REST y se precarga', async ({
  page,
}) => {
  await page.addInitScript((key) => {
    localStorage.setItem(
      key,
      JSON.stringify({ baseUrl: 'http://localhost:4123', apiKey: 'clave-vieja' }),
    );
  }, STORAGE_KEY);

  await page.goto('/');
  await openConfig(page);

  await expect(page.getByLabel('Tipo de conexión')).toHaveValue('rest');
  // Valores distintos de los defaults del demo (4000 / demo-token): prueba que
  // se leyó la config vieja y no que cayó a los defaults por "inválida".
  await expect(page.getByLabel(/URL del sistema externo/)).toHaveValue('http://localhost:4123');
  await expect(page.getByLabel(/API key/)).toHaveValue('clave-vieja');
});

test('Esc cancela sin guardar', async ({ page }) => {
  await page.goto('/');
  await openConfig(page);
  await page.getByLabel(/URL del sistema externo/).fill('http://localhost:9999');

  await page.keyboard.press('Escape');

  await expect(page.getByLabel('Barra de comandos')).toBeFocused();
  const stored = await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY);
  expect(stored).toBeNull();
});
