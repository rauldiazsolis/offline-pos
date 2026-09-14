import { expect, test } from '@playwright/test';
import { openCashSession } from './helpers.ts';

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
  await openCashSession(page);

  await commandBar.fill('arroz');
  await expect(page.getByText('Arroz 1kg')).toBeVisible();
  await commandBar.press('Enter');

  await commandBar.press('Control+Enter');
  const amountInput = page.getByLabel('Monto a cobrar');
  await amountInput.fill('1200');
  await amountInput.press('Enter');
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

test('venta → /CONFIG → Esc → la barra de comandos recupera el foco', async ({ page }) => {
  await page.goto('/');
  const commandBar = page.getByLabel('Barra de comandos');

  await commandBar.fill('/CONFIG');
  await commandBar.press('Enter');
  await expect(page.getByRole('heading', { name: 'Configurar conexión' })).toBeVisible();

  await page.keyboard.press('Escape');

  await expect(commandBar).toBeFocused();
});
