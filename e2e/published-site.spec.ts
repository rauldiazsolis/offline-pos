import { expect, test } from '@playwright/test';

/**
 * El sitio publicado (#54), armado con `pnpm site:build` y servido en 4174: la home, el canal `/v4/`
 * con rutas relativas y su almacenamiento propio, y las docs. El redirect de `/versions`
 * (`_redirects`) es de Cloudflare: el preview de Vite no lo aplica. El canal va fijo: si el contrato
 * sube de major, que el test falle es lo que se quiere.
 */
test.describe.configure({ mode: 'serial' });

const SITE = 'http://localhost:4174';
const BACKEND = 'http://localhost:4002';
const CHANNEL = 'v4';

test('la home lista el backend local con su demo en el canal', async ({ page }) => {
  await page.goto(`${SITE}/`);
  const row = page.getByRole('row').filter({ hasText: 'demo-backend local' });
  await expect(row.getByRole('link', { name: 'Abrir demo' })).toHaveAttribute(
    'href',
    `${CHANNEL}/?demo=true&backend=${encodeURIComponent('http://localhost:4000')}`,
  );
  await expect(page.getByRole('link', { name: 'Docs' })).toHaveAttribute(
    'href',
    `${CHANNEL}/docs/`,
  );
  await expect(page.locator('a[href$=".zip"]')).toHaveCount(0);
  // #219: "Con Google Sheets", a las instrucciones del puente del canal.
  await expect(
    page.getByRole('link', { name: 'Instrucciones y el código para copiar' }),
  ).toHaveAttribute('href', `${CHANNEL}/docs/google-sheets/`);
});

test('el canal arranca con el link de demo y guarda todo en su propio almacenamiento', async ({
  page,
}) => {
  await page.goto(`${SITE}/${CHANNEL}/?demo=true&backend=${encodeURIComponent(BACKEND)}`);
  await expect(page.getByLabel('Barra de comandos')).toBeVisible();
  await expect(page.getByText('DEMO', { exact: true })).toBeVisible();

  const storage = await page.evaluate(async () => ({
    databases: (await indexedDB.databases()).map((database) => database.name),
    keys: Object.keys(localStorage),
    favicon: document.querySelector('link[rel="icon"]')?.getAttribute('href'),
  }));
  expect(storage.databases).toContain(`offline-pos@/${CHANNEL}/`);
  expect(storage.databases).not.toContain('offline-pos');
  expect(storage.keys).toContain(`offline-pos@/${CHANNEL}/:sync-config`);
  for (const key of storage.keys) {
    expect(key.startsWith(`offline-pos@/${CHANNEL}/:`)).toBe(true);
  }
  expect(storage.favicon).toBe('./favicon.svg');
  expect((await page.request.get(`${SITE}/${CHANNEL}/favicon.svg`)).ok()).toBe(true);
});

test('/v4/docs/ muestra la guía y enlaza el OpenAPI y llms.txt', async ({ page }) => {
  await page.goto(`${SITE}/${CHANNEL}/docs/`);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Guía para integradores' }),
  ).toBeVisible();
  for (const file of ['connector-api.openapi.yaml', 'llms.txt']) {
    expect((await page.request.get(`${SITE}/${CHANNEL}/docs/${file}`)).ok()).toBe(true);
  }
});

test('desde /v4/docs/ se llega al setup de Sheets, con sus imágenes, pos-sheets.gs y la referencia', async ({
  page,
}) => {
  await page.goto(`${SITE}/${CHANNEL}/docs/`);
  await page.getByRole('link', { name: 'setup de Google Sheets' }).click();
  await expect(page).toHaveURL(`${SITE}/${CHANNEL}/docs/google-sheets/`);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Google Sheets: conectar el POS a una planilla' }),
  ).toBeVisible();

  // #219: el puente en un solo archivo, con "Copiar el código" (se habilita al bajarlo).
  await expect(page.getByRole('button', { name: 'Copiar el código' })).toBeEnabled();
  const hrefs = [
    await page.getByRole('link', { name: 'pos-sheets.gs' }).first().getAttribute('href'),
    await page.getByRole('link', { name: 'OpenAPI' }).first().getAttribute('href'),
  ];
  for (const href of hrefs) {
    expect(href).not.toBeNull();
    expect((await page.request.get(new URL(href ?? '', page.url()).href)).ok()).toBe(true);
  }

  // #221: el índice lleva a su sección y cada imagen carga.
  await page.getByRole('link', { name: 'Conectar cada caja' }).click();
  await expect(page).toHaveURL(/#3-conectar-cada-caja$/);
  const images = page.locator('main img');
  expect(await images.count()).toBeGreaterThan(5);
  for (const image of await images.all()) {
    await image.scrollIntoViewIfNeeded();
    expect(await image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  }

  await page.getByRole('link', { name: 'referencia del puente' }).click();
  await expect(page).toHaveURL(`${SITE}/${CHANNEL}/docs/google-sheets/referencia.html`);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Google Sheets: referencia del puente' }),
  ).toBeVisible();
});
