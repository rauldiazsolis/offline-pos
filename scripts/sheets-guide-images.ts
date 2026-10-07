import { chromium, type Page } from '@playwright/test';
import { loadAppsScript } from '../src/test/apps-script.ts';

/**
 * Las capturas reales del setup de Google Sheets (#221): la página de la planilla y el POS conectado,
 * con el Chromium de Playwright. Se corre a mano desde la raíz del repo cuando cambian esas pantallas
 * y los PNG se commitean, como los íconos de la PWA. Las pantallas de Google son SVG hechos a mano,
 * en la misma carpeta.
 *
 *   pnpm build && pnpm preview          # en otra terminal: el POS en http://localhost:4173/
 *   node scripts/sheets-guide-images.ts [--pos http://localhost:4173/]
 *
 * Corre los `.gs` con la planilla falsa de los tests: la página llama a sus funciones con un
 * `google.script.run` que las ejecuta acá, y el POS habla con el mismo `doPost`.
 */
const POS = process.argv.includes('--pos')
  ? (process.argv[process.argv.indexOf('--pos') + 1] ?? '')
  : 'http://localhost:4173/';
const WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbx…/exec';
const OUT = new URL('../docs/integradores/img/google-sheets/', import.meta.url).pathname.replace(
  /^\/([A-Za-z]:)/,
  '$1',
);

const app = loadAppsScript({ defaultRows: 100, webAppUrl: WEB_APP_URL });
app.spreadsheet.insertSheet('Hoja 1');

/** Lo que agrega Apps Script alrededor de la página, con las funciones corriendo acá. */
const GOOGLE_SCRIPT_RUN = `window.google = { script: { get run() {
  let ok = () => {}, fail = () => {};
  const runner = new Proxy({}, { get: (_, name) => {
    if (name === 'withSuccessHandler') return (f) => { ok = f; return runner; };
    if (name === 'withFailureHandler') return (f) => { fail = f; return runner; };
    return (arg) => window.gsRun(name, arg === undefined ? null : arg).then(ok, (e) => fail(e));
  } });
  return runner;
} } };`;

/** La página tal como la sirve `doGet`, con `google.script.run` antes de su script. */
async function homePage(page: Page): Promise<void> {
  const html = app.page().html.replace('<script>', `<script>${GOOGLE_SCRIPT_RUN}</script><script>`);
  await page.setContent(html);
}

// `CHROMIUM_PATH`, para un Chromium que no es el de esta versión de Playwright.
const executablePath = process.env.CHROMIUM_PATH;
const browser = await chromium.launch(executablePath === undefined ? {} : { executablePath });
const context = await browser.newContext({ deviceScaleFactor: 2, locale: 'es-AR' });

// La página de la planilla, en un ancho de celular grande y con el alto de lo que muestra.
const home = await context.newPage();
await home.setViewportSize({ width: 600, height: 200 });
await home.exposeFunction('gsRun', (name: string, arg: unknown) =>
  app.run(`${name}(${arg === null ? '' : JSON.stringify(arg)})`),
);
await homePage(home);
await home.fill('#comercio', 'Ferretería El Tornillo');
await home.fill('#sucursal', 'Centro');
await home.fill('#caja', 'Caja 1');
await home.screenshot({ path: `${OUT}preparar-1-formulario.png`, fullPage: true });

await home.click('#ir');
await home.waitForSelector('#pos');
await home.screenshot({ path: `${OUT}preparar-2-lista.png`, fullPage: true });

await home.fill('#caja', 'Caja 2');
await home.locator('.caja', { hasText: 'Abrir el POS' }).screenshot({
  path: `${OUT}conectar-1-caja.png`,
});
const link = (await home.getAttribute('#pos', 'href')) ?? '';

app.run(`escribirConfiguracion_([['permitirReiniciar', 'Sí']])`);
await homePage(home);
await home.screenshot({ path: `${OUT}reiniciar-2-boton.png`, fullPage: true });

// El POS conectado: el link de "Abrir el POS", con el POS local en vez del publicado.
const pos = await context.newPage();
await pos.setViewportSize({ width: 1280, height: 720 });
await pos.route('https://script.google.com/**', async (route) => {
  const request = JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>;
  await route.fulfill({ contentType: 'application/json', body: JSON.stringify(app.raw(request)) });
});
await pos.goto(`${POS}${link.slice(link.indexOf('#'))}`);
const bar = pos.getByRole('textbox').first();
await bar.waitFor();
await pos.getByText('Ferretería El Tornillo').first().waitFor();
for (const search of ['martillo', 'destornillador plano']) {
  await bar.fill(search);
  await pos.waitForTimeout(300);
  await bar.press('Enter');
}
await pos.waitForTimeout(500);
await pos.screenshot({ path: `${OUT}conectar-2-pos.png` });

await browser.close();
console.log(`Capturas en ${OUT}`);
