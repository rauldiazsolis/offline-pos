import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { seedCatalog } from './helpers.ts';

/**
 * #111: por debajo de 1024 px la app se achica con `zoom`, pero el texto no baja de 11 px efectivos
 * (tamaño CSS × zoom), ningún botón parte su etiqueta y nada se sale de la pantalla. A 1440 px los
 * tamaños son los de siempre.
 */
const MIN_EFFECTIVE_PX = 11;

type Measure = {
  smallest: { px: number; text: string };
  wrappedButtons: string[];
  overflows: boolean;
};

async function measure(page: Page): Promise<Measure> {
  return page.evaluate(() => {
    // El zoom efectivo es el producto del de cada ancestro: `.app-zoom-wrapper` achica la app y el
    // ticket en pantalla lo cancela (`.receipt-paper`, #174).
    const zoomOf = (element: Element): number => {
      let zoom = 1;
      for (let node: Element | null = element; node !== null; node = node.parentElement) {
        zoom *= Number(getComputedStyle(node).zoom) || 1;
      }
      return zoom;
    };
    let smallest = { px: Number.POSITIVE_INFINITY, text: '' };
    for (const element of document.querySelectorAll('body *')) {
      if (element.getClientRects().length === 0) continue;
      const hasText = [...element.childNodes].some(
        (node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim() !== '',
      );
      if (!hasText) continue;
      const px = parseFloat(getComputedStyle(element).fontSize) * zoomOf(element);
      if (px < smallest.px) {
        smallest = { px, text: element.textContent.trim().slice(0, 40) };
      }
    }
    // Las opciones y los pasos del wizard son botones de varios renglones a propósito.
    const wrappedButtons = [...document.querySelectorAll('button')]
      .filter((button) => button.getClientRects().length > 0)
      .filter((button) => !button.matches('.wizard-option, .wizard-step-button'))
      .filter((button) => {
        const range = document.createRange();
        range.selectNodeContents(button);
        const rects = [...range.getClientRects()]
          .filter((rect) => rect.width > 0)
          .sort((a, b) => a.top - b.top);
        let lines = 0;
        let bottom = Number.NEGATIVE_INFINITY;
        for (const rect of rects) {
          if (rect.top >= bottom - 1) {
            lines += 1;
            bottom = rect.bottom;
          } else {
            bottom = Math.max(bottom, rect.bottom);
          }
        }
        return lines > 1;
      })
      .map((button) => button.textContent.trim());
    const overflows = document.documentElement.scrollWidth > window.innerWidth;
    return { smallest, wrappedButtons, overflows };
  });
}

async function expectLegible(page: Page, where: string): Promise<void> {
  const result = await measure(page);
  expect(result.smallest.px, `${where}: "${result.smallest.text}"`).toBeGreaterThanOrEqual(
    MIN_EFFECTIVE_PX,
  );
  expect(result.wrappedButtons, `${where}: botones partidos`).toEqual([]);
  expect(result.overflows, `${where}: desborde horizontal`).toBe(false);
}

async function runCommand(page: Page, command: string): Promise<void> {
  const bar = page.getByLabel('Barra de comandos');
  await bar.fill(command);
  await bar.press('Enter');
}

test.describe('a 600 × 700', () => {
  test.use({ viewport: { width: 600, height: 700 } });

  test('todas las pantallas se leen: texto ≥ 11 px, botones enteros, sin desborde', async ({
    page,
  }) => {
    await page.goto('/');
    await seedCatalog(page);
    const bar = page.getByLabel('Barra de comandos');
    for (const product of ['arroz', 'fideos', 'yerba']) {
      await bar.fill(product);
      await bar.press('Enter');
    }
    await expectLegible(page, 'venta');
    await bar.fill('/');
    await expectLegible(page, 'menú de /');
    await bar.fill('@');
    await expectLegible(page, 'clientes');
    await bar.fill('ar');
    await expectLegible(page, 'búsqueda');
    await bar.fill('');

    await page.keyboard.press('Control+Enter');
    await expect(page.getByLabel('Efectivo')).toBeFocused();
    await expectLegible(page, 'Cobro');
    await page.keyboard.press('Control+Enter');
    await expect(page.getByRole('heading', { name: 'Comprobante' })).toBeVisible();
    await expectLegible(page, 'comprobante');
    await page.keyboard.press('Escape');

    await bar.fill('@Ana');
    await bar.press('Enter');
    await expect(bar).toHaveValue('');
    await bar.press('Enter');
    await expect(page.getByLabel('Efectivo')).toBeFocused();
    await expectLegible(page, 'cobranza');
    await page.keyboard.press('Escape');

    await runCommand(page, '/RESUMEN');
    await expectLegible(page, '/RESUMEN Movimientos');
    await page.keyboard.press('Alt+2');
    await expectLegible(page, '/RESUMEN Productos');
    await page.keyboard.press('Alt+3');
    await expectLegible(page, '/RESUMEN Medios de pago');
    await page.keyboard.press('Escape');

    await runCommand(page, '/CAJA');
    await expectLegible(page, '/CAJA');
    await page.keyboard.press('Escape');

    await runCommand(page, '/ANULAR');
    await expectLegible(page, '/ANULAR');
    await page.keyboard.press('Escape');

    await runCommand(page, '/DIAGNOSTICO');
    await expectLegible(page, '/DIAGNOSTICO');
    await page.keyboard.press('Escape');

    // #174: el ticket de la vista previa es el papel a tamaño real (58 mm: 9 pt, la letra más chica).
    await runCommand(page, '/IMPRESORA');
    await expectLegible(page, '/IMPRESORA A6');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    await expect(page.getByRole('button', { name: '58 mm', exact: true })).toBeFocused();
    await expectLegible(page, '/IMPRESORA 58 mm');
    await page.keyboard.press('Escape');

    await runCommand(page, '/CONFIG');
    for (const step of ['1', '2', '3', '4', '5', '6']) {
      await page.keyboard.press(`Alt+${step}`);
      await expectLegible(page, `/CONFIG paso ${step}`);
    }
  });
});

test.describe('a 1440 × 900', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('el texto más chico sigue en 13 px', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByLabel('Barra de comandos')).toBeVisible();
    const result = await measure(page);
    expect(result.smallest.px).toBe(13);
  });
});
