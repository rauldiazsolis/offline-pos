import { expect, test } from '@playwright/test';
import { openCashSession } from './helpers.ts';

const BACKEND_URL = 'http://localhost:4000';

test('vender con el minibackend real configurado: la venta llega al backend', async ({ page }) => {
  await page.goto('/');
  const commandBar = page.getByLabel('Barra de comandos');
  await expect(commandBar).toBeVisible();

  // Con el catálogo todavía vacío (Fase 7: ya no hay seed local), configurar
  // el minibackend y forzar un sync es requisito antes de poder vender.
  await commandBar.fill('/CONFIG');
  await commandBar.press('Enter');
  await expect(page.getByRole('heading', { name: 'Configurar conexión' })).toBeVisible();

  const urlInput = page.getByLabel(/URL del sistema externo/);
  await expect(urlInput).toHaveValue(BACKEND_URL);
  await urlInput.press('Enter');

  // El minibackend de demo implementa el contrato al pie de la letra —
  // `security: bearerAuth` es global en `docs/connector-api.openapi.yaml`,
  // así que a diferencia de un backend real que decida no exigirlo, acá el
  // pull de catálogo/clientes devuelve 401 sin un Bearer token (cualquier
  // valor no vacío alcanza, el minibackend no valida el contenido — ver
  // `demo-backend/src/router.ts::hasValidBearerToken`). Dejarlo en blanco
  // (como si de verdad fuera opcional para este backend) hace que el pull
  // falle en silencio: `sync/engine.ts::syncOnce` no distingue un pull
  // fallido de uno exitoso en el estado de sync, así que la barra de estado
  // igual muestra "Sincronizado" sin que el catálogo haya llegado.
  const apiKeyInput = page.getByLabel(/API key/);
  await apiKeyInput.fill('demo-api-key');
  await apiKeyInput.press('Enter');

  await page.getByLabel(/Locale/).press('Enter');
  await expect(commandBar).toBeVisible();

  await commandBar.fill('/SINCRONIZAR');
  await commandBar.press('Enter');

  await openCashSession(page, 500);

  await commandBar.fill('arroz');
  await expect(page.getByText('Arroz 1kg')).toBeVisible();
  await commandBar.press('Enter');
  await expect(commandBar).toHaveValue('');

  await commandBar.press('Control+Enter');
  await expect(page.getByRole('heading', { name: 'Cobrar' })).toBeVisible();
  const amountInput = page.getByLabel('Monto a cobrar');
  await amountInput.fill('1200');
  await amountInput.press('Enter');
  await expect(page.getByRole('heading', { name: 'Comprobante' })).toBeVisible();

  await expect
    .poll(
      async () => {
        const response = await page.request.get(`${BACKEND_URL}/_demo/api/sales`);
        const sales = (await response.json()) as { total: number }[];
        return sales.some((sale) => sale.total === 1200);
      },
      { timeout: 20_000 },
    )
    .toBe(true);
});
