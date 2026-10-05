import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { confirmCheckout, fillPayment, seedCatalog } from './helpers.ts';
import { getAllFromStore } from './indexed-db.ts';

/**
 * Registra el texto de cada impresión y dispara `afterprint`, sin abrir el diálogo real. Se
 * intercepta desde la página (el iframe `about:blank` de la impresión no corre los init scripts):
 * cada vez que la app pide el `contentWindow` de un iframe, se le reemplaza `print`. Se lee
 * `textContent` y no `innerText`, que depende del layout y el iframe mide 0×0.
 */
async function stubPrinting(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const target = window as unknown as { __printed: string[] };
    target.__printed = [];
    const descriptor = Object.getOwnPropertyDescriptor(
      HTMLIFrameElement.prototype,
      'contentWindow',
    );
    Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
      configurable: true,
      get(this: HTMLIFrameElement) {
        const frameWindow = descriptor?.get?.call(this) as Window | null;
        if (frameWindow !== null) {
          frameWindow.print = () => {
            target.__printed.push(frameWindow.document.body.textContent);
            frameWindow.dispatchEvent(new Event('afterprint'));
          };
        }
        return frameWindow;
      },
    });
  });
}

function printedTexts(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __printed: string[] }).__printed);
}

async function configurePrinter(page: Page, format: string, onCheckout: string): Promise<void> {
  const commandBar = page.getByLabel('Barra de comandos');
  await commandBar.fill('/IMPRESORA');
  await commandBar.press('Enter');
  await expect(page.getByRole('heading', { name: 'Impresora' })).toBeVisible();
  await page.getByLabel('Formato').selectOption({ label: format });
  await page.getByLabel('Al cobrar').selectOption({ label: onCheckout });
  await page.getByLabel('Encabezado').fill('Kiosco E2E');
  await page.keyboard.press('Control+Enter');
  await expect(commandBar).toBeVisible();
}

async function sellRice(page: Page): Promise<void> {
  const commandBar = page.getByLabel('Barra de comandos');
  await commandBar.fill('arroz');
  await expect(page.getByText('Arroz 1kg')).toBeVisible();
  await commandBar.press('Enter');
  await commandBar.press('Control+Enter');
  await expect(page.getByRole('heading', { name: 'Cobrar' })).toBeVisible();
  await fillPayment(page, 'Efectivo', 1200);
  await confirmCheckout(page);
}

test.beforeEach(async ({ page }) => {
  await stubPrinting(page);
  await page.goto('/');
  await seedCatalog(page);
});

test('Al cobrar: Imprimir — registra, imprime y sigue con la venta', async ({ page }) => {
  await configurePrinter(page, '58 mm', 'Imprimir');
  await sellRice(page);

  const commandBar = page.getByLabel('Barra de comandos');
  await expect(commandBar).toBeFocused();
  await expect(commandBar).toHaveValue('');
  await expect(page.getByRole('heading', { name: 'Comprobante' })).toHaveCount(0);
  await expect(page.getByText('Ticket #1 registrado y enviado a imprimir.')).toBeVisible();
  await expect.poll(() => printedTexts(page)).toHaveLength(1);
  const [printed] = await printedTexts(page);
  expect(printed).toContain('Kiosco E2E');
  expect(printed).toContain('Arroz 1kg');
  expect(await getAllFromStore(page, 'sales')).toHaveLength(1);
  // El iframe de impresión no queda en la página.
  await expect(page.locator('iframe')).toHaveCount(0);
});

test('Al cobrar: Nada — vuelve directo a la venta sin imprimir', async ({ page }) => {
  await configurePrinter(page, '80 mm', 'Nada');
  await sellRice(page);

  await expect(page.getByLabel('Barra de comandos')).toBeFocused();
  await expect(page.getByRole('heading', { name: 'Comprobante' })).toHaveCount(0);
  await expect(page.getByText('Ticket #1 registrado.')).toBeVisible();
  expect(await printedTexts(page)).toEqual([]);
  expect(await getAllFromStore(page, 'sales')).toHaveLength(1);
});

test('Reimprimir desde /RESUMEN imprime una copia', async ({ page }) => {
  await configurePrinter(page, 'A6', 'Nada');
  await sellRice(page);

  const commandBar = page.getByLabel('Barra de comandos');
  await commandBar.fill('/RESUMEN');
  await commandBar.press('Enter');
  await expect(page.getByText('Reimprimir (Enter)')).toBeVisible();
  await page.keyboard.press('Enter');

  await expect.poll(() => printedTexts(page)).toHaveLength(1);
  const [printed] = await printedTexts(page);
  expect(printed).toContain('COPIA');
  expect(printed).toContain('Arroz 1kg');
  await expect(page.getByText('Copia del Ticket #1 enviada a imprimir.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Resumen del día' })).toBeVisible();
});

test('la config de la impresora sobrevive a un reload', async ({ page }) => {
  await configurePrinter(page, '80 mm', 'Nada');
  await page.reload();

  const commandBar = page.getByLabel('Barra de comandos');
  await commandBar.fill('/IMPRESORA');
  await commandBar.press('Enter');
  await expect(page.getByLabel('Formato')).toBeFocused();
  await expect(page.getByLabel('Formato')).toHaveValue('80mm');
  await expect(page.getByLabel('Encabezado')).toHaveValue('Kiosco E2E');
});
