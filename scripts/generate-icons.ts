import { readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

/**
 * Íconos de la PWA (#54, #196), sacados de `scripts/pwa-icon.svg` con el Chromium de Playwright: se
 * corre a mano (`node scripts/generate-icons.ts`) y los PNG se commitean. Ningún generador como
 * dependencia. Como en mini contax, dos variantes de la misma marca: `public/favicon.svg` (el ticket
 * grande, para que se lea a 16 px) y `pwa-icon.svg` (el ticket más angosto con la línea, para los
 * tamaños grandes). El maskable tiene el fondo lleno y más margen: Android lo recorta en círculo.
 */
const BRAND = '#4f46e5'; // el índigo de la marca, el mismo que mini contax
const ICONS = [
  { file: 'icon-192.png', size: 192, padding: 0, background: 'transparent' },
  { file: 'icon-512.png', size: 512, padding: 0, background: 'transparent' },
  { file: 'icon-maskable-512.png', size: 512, padding: 0.1, background: BRAND },
];

const svg = readFileSync(new URL('./pwa-icon.svg', import.meta.url)).toString('base64');
const browser = await chromium.launch();
const page = await browser.newPage();
for (const { file, size, padding, background } of ICONS) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<body style="margin:0;width:${String(size)}px;height:${String(size)}px;
    background:${background};display:grid;place-items:center">
    <img src="data:image/svg+xml;base64,${svg}" style="width:${String(Math.round(size * (1 - 2 * padding)))}px"></body>`);
  await page.screenshot({
    path: new URL(`../public/${file}`, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
    omitBackground: background === 'transparent',
  });
}
await browser.close();
console.log('Íconos generados en public/');
