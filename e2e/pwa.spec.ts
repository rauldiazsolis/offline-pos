import { readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { ACTIVE_CONFIG } from './fixtures.ts';

/**
 * Service worker y PWA (#54), con service workers habilitados (el resto de la suite los bloquea).
 * Un servidor propio sirve el `dist/` de 4173 en `/v4/`, como el canal publicado, y puede cambiar
 * `sw.js` para que el navegador vea una versión nueva sin un segundo build.
 */
test.use({ serviceWorkers: 'allow' });
test.describe.configure({ mode: 'serial' });

const PORT = 4175;
const ORIGIN = `http://localhost:${String(PORT)}`;
const CHANNEL = `${ORIGIN}/v4/`;
const DIST = fileURLToPath(new URL('../dist/', import.meta.url));
const TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json',
};
let swSuffix = '';
let server: Server;

test.beforeAll(async () => {
  server = createServer((req, res) => {
    const path = new URL(req.url ?? '/', ORIGIN).pathname;
    if (!path.startsWith('/v4/')) {
      res.writeHead(404).end();
      return;
    }
    const relative = path.slice('/v4/'.length) || 'index.html';
    const file = join(DIST, normalize(relative));
    readFile(file)
      .then((content) => {
        const body =
          relative === 'sw.js' ? Buffer.concat([content, Buffer.from(swSuffix)]) : content;
        res.writeHead(200, {
          'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
          'cache-control': 'no-store',
        });
        res.end(body);
      })
      .catch(() => res.writeHead(404).end());
  });
  await new Promise<void>((resolve) => server.listen(PORT, resolve));
});

test.afterAll(async () => {
  await new Promise<void>((resolve) =>
    server.close(() => {
      resolve();
    }),
  );
});

test.beforeEach(async ({ page }) => {
  swSuffix = '';
  // Conexión activa en el almacenamiento de /v4/, una vez por pestaña (pos.reset() la borra).
  await page.addInitScript((config) => {
    if (sessionStorage.getItem('e2e:seeded') === null) {
      localStorage.setItem('offline-pos@/v4/:sync-config', JSON.stringify(config));
      localStorage.setItem('offline-pos@/v4/:device-id', 'e2e-device-id');
      sessionStorage.setItem('e2e:seeded', '1');
    }
  }, ACTIVE_CONFIG);
});

/**
 * Abre el canal y espera a que la página quede controlada por el service worker. Cada test tiene un
 * contexto nuevo: en la primera carga el service worker se instala pero no controla la página (no
 * hay `clients.claim()`, a propósito), así que se recarga una vez.
 */
async function openControlled(page: Page): Promise<void> {
  await page.goto(CHANNEL);
  await expect(page.getByLabel('Barra de comandos')).toBeVisible();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await expect(page.getByLabel('Barra de comandos')).toBeVisible();
}

test('después de la primera carga, sin red y con F5 el POS abre', async ({ page, context }) => {
  await page.goto(CHANNEL);
  await expect(page.getByLabel('Barra de comandos')).toBeVisible();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByLabel('Barra de comandos')).toBeVisible();
});

test('una versión nueva se avisa y /ACTUALIZAR la aplica, nunca con una venta en curso', async ({
  page,
}) => {
  await openControlled(page);
  const bar = page.getByLabel('Barra de comandos');

  swSuffix = '\n// e2e: versión nueva\n';
  await page.evaluate(async () => {
    await (await navigator.serviceWorker.getRegistration())?.update();
  });
  const button = page.getByRole('button', { name: 'Versión nueva (/ACTUALIZAR)' });
  await expect(button).toBeVisible();

  await bar.fill('algo$100');
  await bar.press('Enter');
  await bar.fill('/ACTUALIZAR');
  await bar.press('Enter');
  await expect(page.getByText('Terminá o descartá la venta para actualizar.')).toBeVisible();
  await expect(button).toBeVisible();

  await bar.fill('/DESCARTAR');
  await bar.press('Enter');
  await page.evaluate(() => {
    (window as unknown as { e2eMarker: boolean }).e2eMarker = true;
  });
  await bar.fill('/ACTUALIZAR');
  await bar.press('Enter');
  await page.waitForFunction(() => !('e2eMarker' in window));
  await expect(page.getByLabel('Barra de comandos')).toBeVisible();
  await expect(button).toBeHidden();
});

test('pos.reset() da de baja el service worker y las cachés de su carpeta', async ({ page }) => {
  await openControlled(page);
  // Una marca dentro de la caché actual: el nombre de la caché sale del contenido del build, así que
  // al reinstalarse vuelve a ser el mismo; la marca solo sobrevive si la caché nunca se borró.
  const cacheName = await page.evaluate(async () => {
    const names = await caches.keys();
    const name = names.find((n) => n.startsWith('offline-pos@/v4/:sw:'));
    if (name !== undefined) {
      await (await caches.open(name)).put('/v4/e2e-marca', new Response('marca'));
    }
    return name;
  });
  expect(cacheName).toBeDefined();

  // pos.reset() recarga sin cambiar la URL: se espera el `load` de la recarga.
  const reloaded = page.waitForEvent('load');
  await page.evaluate(() => {
    void (window as unknown as { pos: { reset: () => Promise<void> } }).pos.reset();
  });
  await reloaded;
  await expect
    .poll(() => page.evaluate(async () => (await caches.match('/v4/e2e-marca')) === undefined))
    .toBe(true);
  const names = await page.evaluate(() => caches.keys());
  expect(names.every((name) => name.startsWith('offline-pos@/v4/:sw:'))).toBe(true);
});

test('el manifest y sus íconos cargan', async ({ page }) => {
  await page.goto(CHANNEL);
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(href).toBe('./manifest.webmanifest');
  const manifest = (await (await page.request.get(`${CHANNEL}manifest.webmanifest`)).json()) as {
    icons: { src: string }[];
    display: string;
  };
  expect(manifest.display).toBe('standalone');
  for (const icon of manifest.icons) {
    expect((await page.request.get(`${CHANNEL}${icon.src}`)).ok()).toBe(true);
  }
});
