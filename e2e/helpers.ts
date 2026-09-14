import { expect, type Page } from '@playwright/test';

/**
 * Fase 6: `/COBRAR` (y `Ctrl+Enter`) exige un turno de caja abierto — todo
 * spec que llegue al cobro necesita abrir uno primero. Maneja la pantalla
 * real de `/CAJA` (no escribe directo en IndexedDB, a diferencia de
 * `indexed-db.ts::putIntoStore`) porque abrir un turno es justamente lo que
 * este helper existe para ejercitar de punta a punta, no solo para dar por
 * sentado que ya está abierto.
 */
export async function openCashSession(page: Page, openingAmount = 0): Promise<void> {
  const commandBar = page.getByLabel('Barra de comandos');
  await commandBar.fill('/CAJA');
  await commandBar.press('Enter');
  await expect(page.getByRole('heading', { name: 'Caja' })).toBeVisible();

  const amountInput = page.getByLabel('Monto de apertura del turno');
  await amountInput.fill(String(openingAmount));
  await amountInput.press('Enter');
  await expect(page.getByText('Turno abierto')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(commandBar).toBeVisible();
}
