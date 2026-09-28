import { expect, test } from '@playwright/test';
import { completeWizardRest, confirmCheckout, fillPayment } from './helpers.ts';

const BACKEND_URL = 'http://localhost:4000';

// Los dos tests resetean el mismo minibackend: en paralelo, uno le borraría los datos al otro.
test.describe.configure({ mode: 'serial' });

test('vender con el minibackend real configurado: la venta llega al backend', async ({ page }) => {
  // `demo-backend/data/demo.sqlite` está en `.gitignore` y sobrevive entre
  // corridas locales de `pnpm test:e2e` (nada lo borra salvo un checkout
  // nuevo, como en CI, o un reset explícito) — sin esto, una segunda corrida
  // local encontraría la venta de $1200 de la corrida anterior y pasaría sin
  // haber sincronizado nada de verdad. Mismo endpoint que ya usa `/DEMO_RESET`
  // vía `storage/demo-reset.ts::resetDemoBackend` (Task 14), sin pasar por la
  // UI del POS — no hace falta, este reset es contra el backend nomás.
  await page.request.post('http://localhost:4000/_demo/reset');

  await page.goto('/');
  // Sin config guardada la app abre directo en el wizard de /CONFIG (modo
  // requerido): configurar y probar la conexión con el minibackend es requisito
  // antes de poder vender (Fase 7: ya no hay seed local).
  await expect(page.getByRole('heading', { name: 'Configurar conexión' })).toBeVisible();

  // El minibackend de demo implementa el contrato al pie de la letra —
  // `security: bearerAuth` es global en `docs/connector-api.openapi.yaml`,
  // así que el pull devuelve 401 sin un Bearer token (cualquier valor no vacío
  // alcanza, ver `demo-backend/src/router.ts::hasValidBearerToken`). Sin API
  // key, la PRUEBA de conexión falla con "El servidor rechazó las credenciales
  // (401)". El catálogo llega al aplicar, no hace falta un sync aparte.
  await completeWizardRest(page, {
    baseUrl: BACKEND_URL,
    apiKey: 'demo-api-key',
    type: 'rest-demo',
    branch: 'Sucursal e2e',
    pointOfSale: 'Caja e2e',
  });
  const commandBar = page.getByLabel('Barra de comandos');
  await expect(commandBar).toBeVisible();

  // Con el conector rest-demo el menú de "/" ofrece /DEMO_RESET (Etapa 2c).
  await commandBar.fill('/DEMO');
  await expect(page.getByText('DEMO_RESET')).toBeVisible();

  await commandBar.fill('/SINCRONIZAR');
  await commandBar.press('Enter');

  await commandBar.fill('arroz');
  await expect(page.getByText('Arroz 1kg')).toBeVisible();
  await commandBar.press('Enter');
  await expect(commandBar).toHaveValue('');

  await commandBar.press('Control+Enter');
  await expect(page.getByRole('heading', { name: 'Cobrar' })).toBeVisible();
  await fillPayment(page, 'Efectivo', 1200);
  await confirmCheckout(page);
  await expect(page.getByRole('heading', { name: 'Comprobante' })).toBeVisible();

  await expect
    .poll(
      async () => {
        const response = await page.request.get(`${BACKEND_URL}/_demo/api/sales`);
        const sales = (await response.json()) as {
          total: number;
          ticket?: { date: string; number: number };
        }[];
        // #120: la venta llega con su número de ticket.
        return sales.some((sale) => sale.total === 1200 && sale.ticket?.number === 1);
      },
      { timeout: 20_000 },
    )
    .toBe(true);
});

test('una cobranza llega al minibackend con su recibo y el saldo vuelve en el pull (#101)', async ({
  page,
}) => {
  await page.request.post(`${BACKEND_URL}/_demo/reset`);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Configurar conexión' })).toBeVisible();
  await completeWizardRest(page, {
    baseUrl: BACKEND_URL,
    apiKey: 'demo-api-key',
    type: 'rest-demo',
    branch: 'Sucursal e2e',
    pointOfSale: 'Caja e2e',
  });
  const commandBar = page.getByLabel('Barra de comandos');
  await expect(commandBar).toBeVisible();

  // Carlos Pérez viene sembrado con saldo 1200 (debe).
  await commandBar.fill('@Carlos');
  await expect(page.getByText('Carlos Pérez')).toBeVisible();
  await commandBar.press('Enter');
  await expect(page.getByTestId('customer-balance')).toContainText('Debe');

  await commandBar.press('Enter');
  await expect(page.getByRole('heading', { name: 'Cobranza a Carlos Pérez' })).toBeVisible();
  await page.getByLabel('Efectivo').fill('200');
  await page.keyboard.press('Control+Enter');
  await expect(page.getByRole('heading', { name: 'Recibo de cobranza' })).toBeVisible();
  await page.keyboard.press('Escape');

  await expect
    .poll(
      async () => {
        const response = await page.request.get(`${BACKEND_URL}/_demo/api/customer-payments`);
        const payments = (await response.json()) as {
          customerId: string;
          total: number;
          receipt?: { number: number };
        }[];
        return payments.some(
          (payment) =>
            payment.customerId === 'cust-02' &&
            payment.total === 200 &&
            payment.receipt?.number === 1,
        );
      },
      { timeout: 20_000 },
    )
    .toBe(true);

  // Después de un pull, el saldo del backend (1200 - 200) en la tarjeta.
  await commandBar.fill('/SINCRONIZAR');
  await commandBar.press('Enter');
  await commandBar.fill('@Carlos');
  await expect(page.getByText('Carlos Pérez')).toBeVisible();
  await commandBar.press('Enter');
  await expect(page.getByTestId('customer-balance')).toHaveText(/Saldo: Debe \$?1[.,]?000/, {
    timeout: 20_000,
  });
});
