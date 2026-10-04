import { readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

/**
 * Íconos de la PWA (#54), sacados del `favicon.svg` con el Chromium de Playwright: se corre a mano
 * una vez (`node scripts/generate-icons.ts`) y los PNG se commitean. Ningún generador como
 * dependencia. El maskable deja más margen: Android lo recorta en círculo.
 */
const ICONS = [
  { file: 'icon-192.png', size: 192, padding: 0.12 },
  { file: 'icon-512.png', size: 512, padding: 0.12 },
  { file: 'icon-maskable-512.png', size: 512, padding: 0.22 },
];
const BACKGROUND = '#12141c'; // --color-chrome-bg de tokens.css

const svg = readFileSync(new URL('../public/favicon.svg', import.meta.url)).toString('base64');
const browser = await chromium.launch();
const page = await browser.newPage();
for (const { file, size, padding } of ICONS) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<body style="margin:0;width:${String(size)}px;height:${String(size)}px;
    background:${BACKGROUND};display:grid;place-items:center">
    <img src="data:image/svg+xml;base64,${svg}" style="width:${String(Math.round(size * (1 - 2 * padding)))}px"></body>`);
  await page.screenshot({
    path: new URL(`../public/${file}`, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
  });
}
await browser.close();
console.log('Íconos generados en public/');
