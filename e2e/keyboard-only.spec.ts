import { expect, test } from './fixtures.ts';
import { confirmCheckout, fillPayment, openCashSession, seedCatalog } from './helpers.ts';

/**
 * Auditoría de accesibilidad por teclado (Fase 4): recorre cada pantalla
 * "popup" (cobro, anulación, comprobante, config) solo con teclado y
 * confirma que la barra de comandos recupera el foco al volver — regresión
 * directa del bug real reportado (CommandBarInput usaba `autoFocus` nativo,
 * que no dispara de forma confiable al remontarse tras un Esc).
 */

test('venta → /COBRAR → Esc → la barra de comandos recupera el foco', async ({ page }) => {
  await page.goto('/');
  const commandBar = page.getByLabel('Barra de comandos');
  await expect(commandBar).toBeFocused();
  await openCashSession(page);
  // Etapa 2 de #94: /COBRAR necesita algo que cobrar.
  await commandBar.fill('regalo$100');
  await commandBar.press('Enter');

  await commandBar.press('Control+Enter');
  await expect(page.getByRole('heading', { name: 'Cobrar' })).toBeVisible();

  await page.keyboard.press('Escape');

  await expect(commandBar).toBeFocused();
});

test('venta → /ANULAR → Esc → la barra de comandos recupera el foco', async ({ page }) => {
  await page.goto('/');
  const commandBar = page.getByLabel('Barra de comandos');

  await commandBar.fill('/ANULAR');
  await commandBar.press('Enter');
  await expect(page.getByRole('heading', { name: 'Anular venta' })).toBeVisible();

  await page.keyboard.press('Escape');

  await expect(commandBar).toBeFocused();
});

test('venta → cobrar → Comprobante → Esc → la barra de comandos recupera el foco', async ({
  page,
}) => {
  await page.goto('/');
  const commandBar = page.getByLabel('Barra de comandos');
  await expect(commandBar).toBeVisible();

  // Fase 7: sin backend en este spec, el catálogo no llega solo — se siembra
  // a mano (ver `helpers.ts::seedCatalog`).
  await seedCatalog(page);

  await openCashSession(page);

  await commandBar.fill('arroz');
  await expect(page.getByText('Arroz 1kg')).toBeVisible();
  await commandBar.press('Enter');

  await commandBar.press('Control+Enter');
  await fillPayment(page, 'Efectivo', 1200);
  await confirmCheckout(page);
  await expect(page.getByRole('heading', { name: 'Comprobante' })).toBeVisible();

  await page.keyboard.press('Escape');

  await expect(commandBar).toBeFocused();
});

test('venta → /CAJA → Esc → la barra de comandos recupera el foco', async ({ page }) => {
  await page.goto('/');
  const commandBar = page.getByLabel('Barra de comandos');

  await commandBar.fill('/CAJA');
  await commandBar.press('Enter');
  await expect(page.getByRole('heading', { name: 'Caja' })).toBeVisible();

  await page.keyboard.press('Escape');

  await expect(commandBar).toBeFocused();
});

test('venta → /RESUMEN → Esc → la barra de comandos recupera el foco', async ({ page }) => {
  await page.goto('/');
  const commandBar = page.getByLabel('Barra de comandos');
  await openCashSession(page);

  await commandBar.fill('/RESUMEN');
  await commandBar.press('Enter');
  await expect(page.getByRole('heading', { name: 'Resumen del turno' })).toBeVisible();

  await page.keyboard.press('Escape');

  await expect(commandBar).toBeFocused();
});

test('/RESUMEN sin ningún turno muestra error y no navega', async ({ page }) => {
  await page.goto('/');
  const commandBar = page.getByLabel('Barra de comandos');

  await commandBar.fill('/RESUMEN');
  await commandBar.press('Enter');

  await expect(page.getByText('No hay ningún turno de caja para consultar.')).toBeVisible();
  await expect(commandBar).toBeFocused();
});

test('venta → /CONFIG → Esc → la barra de comandos recupera el foco', async ({ page }) => {
  await page.goto('/');
  const commandBar = page.getByLabel('Barra de comandos');

  await commandBar.fill('/CONFIG');
  await commandBar.press('Enter');
  await expect(page.getByRole('heading', { name: 'Configurar conexión' })).toBeVisible();
  // Con la terminal activa, el wizard abre en Revisar.
  await expect(page.getByRole('button', { name: 'Aplicar (Enter)' })).toBeVisible();

  await page.keyboard.press('Escape');

  await expect(commandBar).toBeFocused();
});

test('venta → /DIAGNOSTICO → Esc → la barra de comandos recupera el foco', async ({ page }) => {
  await page.goto('/');
  const commandBar = page.getByLabel('Barra de comandos');

  await commandBar.fill('/DIAGNOSTICO');
  await commandBar.press('Enter');
  await expect(page.getByRole('heading', { name: 'Diagnóstico de sincronización' })).toBeVisible();
  await expect(page.getByText('Sin probar').or(page.getByText(/Probada:/))).toBeVisible();

  await page.keyboard.press('Escape');

  await expect(commandBar).toBeFocused();
});

test('venta → /ANULAR → click en "Volver a la venta (Esc)" → la barra de comandos recupera el foco', async ({
  page,
}) => {
  await page.goto('/');
  const commandBar = page.getByLabel('Barra de comandos');

  await commandBar.fill('/ANULAR');
  await commandBar.press('Enter');
  await expect(page.getByRole('heading', { name: 'Anular venta' })).toBeVisible();

  await page.getByRole('button', { name: 'Volver a la venta (Esc)' }).click();

  await expect(commandBar).toBeFocused();
});
