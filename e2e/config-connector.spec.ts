import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';

const WEB_APP_URL = 'https://script.google.com/macros/s/e2e/exec';
const STORAGE_KEY = 'offline-pos:sync-config';

test.beforeEach(async ({ page }) => {
  // El puente de Sheets simulado: aplicar una conexión nueva exige PROBARLA
  // (pull completo), así que toda acción responde OK con listas vacías (con CORS).
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

/** Con la terminal activa, /CONFIG abre el wizard en Revisar. */
async function openConfig(page: Page): Promise<void> {
  const commandBar = page.getByLabel('Barra de comandos');
  await commandBar.fill('/CONFIG');
  await commandBar.press('Enter');
  await expect(page.getByRole('heading', { name: 'Configurar conexión' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Paso 6: Revisar' })).toHaveAttribute(
    'aria-current',
    'step',
  );
}

test('pasar a Google Sheets solo con teclado: instrucciones, validación, prueba y resumen precargado', async ({
  page,
}) => {
  await page.goto('/');
  await openConfig(page);

  // Alt+2 vuelve a "Tipo de conexión"; ↓↓ de REST genérico a Google Sheets; Enter avanza.
  await page.keyboard.press('Alt+2');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('button', { name: /^Google Sheets/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.keyboard.press('Enter');

  // Datos del conector: el primer campo enfocado y las instrucciones del tipo a la vista.
  const urlField = page.getByLabel('URL del Web App de Google Apps Script');
  await expect(urlField).toBeFocused();
  await expect(page.getByText(/termina en \/exec/)).toBeVisible();

  // Validación al avanzar: una URL inválida no molesta mientras se tipea…
  await page.keyboard.type('no-es-una-url');
  await expect(page.getByRole('alert')).toHaveCount(0);
  // …pero Enter la rechaza, se queda en el paso y deja el campo seleccionado.
  await page.keyboard.press('Enter');
  await expect(page.getByRole('alert')).toContainText('URL del Web App');
  await expect(urlField).toBeFocused();

  // El campo quedó seleccionado: tipear reemplaza.
  await page.keyboard.type(WEB_APP_URL);
  await page.keyboard.press('Tab');
  await page.keyboard.type('secreto-e2e');
  await page.keyboard.press('Enter');
  await expect(page.getByText(/Conexión OK/)).toBeVisible();
  await page.keyboard.press('Enter');
  // Sin datos del usuario, "Datos locales" se saltea: directo a Revisar.
  await expect(page.getByRole('button', { name: 'Aplicar (Enter)' })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Barra de comandos')).toBeFocused();

  const stored = await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY);
  const parsed = JSON.parse(stored ?? 'null') as Record<string, unknown>;
  expect(parsed).toMatchObject({
    type: 'google-sheets',
    webAppUrl: WEB_APP_URL,
    sharedSecret: 'secreto-e2e',
    branch: 'Casa central',
    pointOfSale: 'Caja 1',
  });
  expect(parsed.verifiedAt).toBeTruthy();

  // Reabrir /CONFIG muestra lo guardado en el resumen, con el secreto oculto.
  await openConfig(page);
  await expect(page.getByRole('dialog').getByText(WEB_APP_URL).first()).toBeVisible();
  await expect(page.getByText(/Secreto compartido: •••/).first()).toBeVisible();
  await expect(page.getByText('secreto-e2e')).toHaveCount(0);
});

test('Esc cancela sin guardar', async ({ page }) => {
  await page.goto('/');
  await openConfig(page);
  await page.keyboard.press('Alt+3');
  await page.getByLabel('URL del sistema externo').fill('http://localhost:9999');

  await page.keyboard.press('Escape');

  await expect(page.getByLabel('Barra de comandos')).toBeFocused();
  // Lo guardado no cambió: sigue la conexión activa del fixture.
  const stored = await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY);
  expect(stored).toContain('127.0.0.1:9');
  expect(stored).not.toContain('9999');
});
