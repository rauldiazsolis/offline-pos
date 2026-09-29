import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

/**
 * El sitio publicado (#148), armado con `pnpm site:build` y servido en 4174: `/versions`, la
 * carpeta de la versión con rutas relativas y su almacenamiento propio, y las docs. El redirect de
 * `/` a `/versions/` (`_redirects`) es de Cloudflare: el preview de Vite no lo aplica.
 */
test.describe.configure({ mode: 'serial' });

const SITE = 'http://localhost:4174';
const BACKEND = 'http://localhost:4002';
const { version: VERSION } = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf-8'),
) as { version: string };

test('/versions lista la versión actual con su link de demo, docs y zip', async ({ page }) => {
  await page.goto(`${SITE}/versions/`);
  const row = page.getByRole('row').filter({ has: page.getByRole('rowheader', { name: VERSION }) });
  await expect(row.getByRole('link', { name: 'Abrir demo' })).toHaveAttribute(
    'href',
    `../${VERSION}/?demo=true&backend=${encodeURIComponent('http://localhost:4000')}`,
  );
  await expect(row.getByRole('link', { name: 'Docs' })).toHaveAttribute(
    'href',
    `../${VERSION}/docs/`,
  );
  await expect(row.getByRole('link', { name: 'Zip' })).toHaveAttribute('href', `../${VERSION}.zip`);
});

test('la carpeta arranca con el link de demo y guarda todo en su propio almacenamiento', async ({
  page,
}) => {
  await page.goto(`${SITE}/${VERSION}/?demo=true&backend=${encodeURIComponent(BACKEND)}`);
  await expect(page.getByLabel('Barra de comandos')).toBeVisible();
  await expect(page.getByText('DEMO', { exact: true })).toBeVisible();

  const storage = await page.evaluate(async () => ({
    databases: (await indexedDB.databases()).map((database) => database.name),
    keys: Object.keys(localStorage),
    favicon: document.querySelector('link[rel="icon"]')?.getAttribute('href'),
  }));
  expect(storage.databases).toContain(`offline-pos@/${VERSION}/`);
  expect(storage.databases).not.toContain('offline-pos');
  expect(storage.keys).toContain(`offline-pos@/${VERSION}/:sync-config`);
  for (const key of storage.keys) {
    expect(key.startsWith(`offline-pos@/${VERSION}/:`)).toBe(true);
  }
  expect(storage.favicon).toBe('./favicon.svg');
  expect((await page.request.get(`${SITE}/${VERSION}/favicon.svg`)).ok()).toBe(true);
});

test('/<versión>/docs/ muestra la guía y enlaza el OpenAPI de al lado', async ({ page }) => {
  await page.goto(`${SITE}/${VERSION}/docs/`);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Guía para integradores' }),
  ).toBeVisible();
  expect((await page.request.get(`${SITE}/${VERSION}/docs/connector-api.openapi.yaml`)).ok()).toBe(
    true,
  );
  expect((await page.request.get(`${SITE}/${VERSION}/docs/llms.txt`)).ok()).toBe(true);
});
