import { expect, type Page } from '@playwright/test';

/** El demo-backend en memoria que levanta `playwright.config.ts`. */
export const BACKEND = 'http://localhost:4010';

/**
 * Todo lo que abriría el teclado del sistema: un `input` de texto, un `textarea`, un `select` o algo
 * editable. La regla central del POS mobile es que no exista nunca.
 */
const KEYBOARD_SELECTOR = [
  'input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]):not([type="range"]):not([type="color"]):not([type="file"]):not([inputmode="none"])',
  'textarea:not([inputmode="none"])',
  'select',
  '[contenteditable]:not([contenteditable="false"])',
].join(', ');

export async function expectNoSystemKeyboard(page: Page): Promise<void> {
  await expect(page.locator(KEYBOARD_SELECTOR)).toHaveCount(0);
}

/** Abre el POS con un link de demo del demo-backend: crea la demo, la prueba y entra a la venta. */
export async function openDemo(page: Page): Promise<void> {
  await page.goto(`/?demo=true&backend=${encodeURIComponent(BACKEND)}&template=almacen`);
  await expect(page.getByRole('button', { name: /Leche entera 1L/ })).toBeVisible({
    timeout: 20_000,
  });
}

/** Toca las teclas del teclado de letras propio, una por una. */
export async function typeOnKeyboard(page: Page, text: string): Promise<void> {
  for (const char of text) {
    await page.locator('.lkeys').getByRole('button', { name: char, exact: true }).click();
  }
}
