import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';

const WEB_APP_URL = 'https://script.google.com/macros/s/e2e/exec';
const STORAGE_KEY = 'offline-pos:sync-config';

test.beforeEach(async ({ page }) => {
  // El puente de Sheets simulado: guardar una conexión ahora la PRUEBA (pull
  // completo), así que toda acción responde OK con listas vacías (con CORS).
  await page.route('https://script.google.com/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({
        ok: true,
        data: { products: { items: [] }, customers: { items: [] }, lots: {} },
      }),
    }),
  );
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
  const parsed = JSON.parse(stored ?? 'null') as Record<string, unknown>;
  expect(parsed).toMatchObject({ type: 'google-sheets', webAppUrl: WEB_APP_URL });
  // Se guardó tras PROBAR la conexión: queda marcada como verificada.
  expect(parsed.verifiedAt).toBeTruthy();

  // Reabrir /CONFIG muestra lo guardado, no el formulario vacío.
  await openConfig(page);
  await expect(page.getByLabel('Tipo de conexión')).toHaveValue('google-sheets');
  await expect(page.getByLabel(/URL del Web App/)).toHaveValue(WEB_APP_URL);
});

test('Esc cancela sin guardar', async ({ page }) => {
  await page.goto('/');
  await openConfig(page);
  // El formulario arranca sin campos: primero hay que elegir el tipo.
  await page.getByLabel('Tipo de conexión').selectOption('rest');
  await page.getByLabel(/URL del sistema externo/).fill('http://localhost:9999');

  await page.keyboard.press('Escape');

  await expect(page.getByLabel('Barra de comandos')).toBeFocused();
  // Lo guardado no cambió: sigue la conexión activa del fixture.
  const stored = await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY);
  expect(stored).toContain('127.0.0.1:9');
  expect(stored).not.toContain('9999');
});
