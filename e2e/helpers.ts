import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, type Page } from '@playwright/test';
import { putIntoStore } from './indexed-db.ts';

type CatalogFixtureEntry = {
  sku: string;
  barcodes: string[];
  name: string;
  price: number;
  taxRate: number;
  category: string;
  tracksStock: boolean;
  initialStock: number;
};

// Mismo fixture que `storage/seed-catalog.ts` usa en producción — leído
// crudo desde disco (no importado como módulo TS) para no acoplar el e2e a
// código interno de la app, mismo criterio que `indexed-db.ts`.
const catalogFixture = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../src/storage/fixtures/catalog.json', import.meta.url)),
    'utf-8',
  ),
) as CatalogFixtureEntry[];

/**
 * Siembra el catálogo directo en IndexedDB (sin pasar por Dexie/el código de
 * la app, mismo criterio que `getAllFromStore`/`putIntoStore`) — desde
 * Fase 7, `bootstrap.ts` ya no siembra nada al arrancar (los datos vienen
 * del backend vía sync), así que los specs 100% offline (sin backend, ver
 * CLAUDE.md) necesitan poblar el catálogo a mano para poder buscar/vender.
 * `CatalogRepository` (`storage/catalog-repository.ts`) se arma una sola vez
 * en el bootstrap a partir de lo que ya esté en Dexie — por eso hace falta
 * un `reload()` después de sembrar para que lo recoja. Llamar **antes** de
 * `context.setOffline(true)`: el reload necesita la app real todavía
 * accesible, y sembrar en IndexedDB no depende de la red de todos modos.
 */
export async function seedCatalog(page: Page): Promise<void> {
  const now = new Date().toISOString();
  for (const entry of catalogFixture) {
    const productId = `e2e-${entry.sku}`;
    await putIntoStore(page, 'products', {
      id: productId,
      sku: entry.sku,
      barcodes: entry.barcodes,
      name: entry.name,
      price: entry.price,
      taxRate: entry.taxRate,
      category: entry.category,
      tracksStock: entry.tracksStock,
    });
    await putIntoStore(page, 'stock', {
      productId,
      quantity: entry.initialStock,
      updatedAt: now,
    });
  }

  await page.reload();
  await expect(page.getByLabel('Barra de comandos')).toBeVisible();
}

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
  // El paso 'open' ya no muestra ningún resumen (ver CLAUDE.md, /CAJA
  // simplificado) — la única señal visible de que el turno abrió es que el
  // input pasa a pedir el efectivo de cierre.
  await expect(page.getByLabel('Efectivo contado para cerrar el turno')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(commandBar).toBeVisible();
}

/**
 * Tipea un monto en el campo de un medio de pago de la pantalla de Cobro ya
 * abierta — `label` es el texto exacto de `ui/payment-labels.ts`
 * (`PAYMENT_METHOD_LABELS`), ej. 'Efectivo', 'Cuenta corriente'.
 */
export async function fillPayment(page: Page, label: string, amount: number): Promise<void> {
  await page.getByLabel(label).fill(String(amount));
}

/** Ctrl+Enter en la pantalla de Cobro — confirma el cobro con lo tipeado en los campos. */
export async function confirmCheckout(page: Page): Promise<void> {
  await page.keyboard.press('Control+Enter');
}

/**
 * Recorre el wizard de `/CONFIG` solo con teclado (Etapa 2 de #94) contra un
 * backend REST y aplica: Terminal → Tipo → Datos del conector → Probar (arranca
 * solo) → Revisar. Pensado para una terminal sin datos del usuario (el paso
 * "Datos locales" se saltea). Termina en la pantalla de venta.
 */
export async function completeWizardRest(
  page: Page,
  params: {
    baseUrl: string;
    apiKey?: string;
    branch?: string;
    pointOfSale?: string;
    type?: 'rest' | 'rest-demo';
  },
): Promise<void> {
  await page.getByLabel('Sucursal').fill(params.branch ?? 'Casa central');
  await page.getByLabel('Punto de venta').fill(params.pointOfSale ?? 'Caja 1');
  await page.keyboard.press('Enter');
  const label = params.type === 'rest-demo' ? /^REST \(minibackend de demo\)/ : /^REST genérico/;
  await page.getByRole('button', { name: label }).click();
  await page.getByLabel('URL del sistema externo').fill(params.baseUrl);
  if (params.apiKey !== undefined) {
    await page.getByLabel('API key (opcional)').fill(params.apiKey);
  }
  await page.keyboard.press('Enter');
  await expect(page.getByText(/Conexión OK/)).toBeVisible({ timeout: 25_000 });
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Aplicar (Enter)' })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Barra de comandos')).toBeVisible();
}
