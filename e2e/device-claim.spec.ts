import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type Page,
  type TestInfo,
} from '@playwright/test';
import { z } from 'zod';
import { getAllFromStore } from './indexed-db.ts';

/**
 * Vincular la caja con un código (4.7.0, #230) contra el demo-backend de `4003`, en memoria y
 * propio de este archivo: el test de compatibilidad apaga `device-claim` en el panel, que es un
 * ajuste de todo el backend, así que los tests van en serie.
 *
 * Con `E2E_CAPTURAS=<carpeta>` guarda capturas (con `deviceScaleFactor: 2`) para revisar a mano;
 * sin la variable no escribe nada.
 */
test.describe.configure({ mode: 'serial' });

const BACKEND = 'http://localhost:4003';
const BRANCH = 'CENTRAL';
const CAPTURAS = process.env.E2E_CAPTURAS;

const claimTokenSchema = z.object({
  claimToken: z.string(),
  expiresAt: z.string(),
  connect: z.string(),
});
type ClaimTokenResponse = z.infer<typeof claimTokenSchema>;

async function issueClaimToken(
  request: APIRequestContext,
  pointOfSale: string,
): Promise<ClaimTokenResponse> {
  const response = await request.post(`${BACKEND}/_demo/claim-tokens`, {
    data: { branch: BRANCH, pointOfSale },
  });
  expect(response.status()).toBe(201);
  return claimTokenSchema.parse(await response.json());
}

async function setDeviceClaim(request: APIRequestContext, enabled: boolean): Promise<void> {
  const response = await request.put(`${BACKEND}/_demo/api/settings`, {
    data: { deviceClaim: enabled },
  });
  expect(response.ok()).toBe(true);
}

/** Un "equipo": un contexto propio (su almacenamiento y su id de dispositivo). */
async function newDevice(browser: Browser, testInfo: TestInfo): Promise<Page> {
  const baseURL = testInfo.project.use.baseURL;
  const context = await browser.newContext({
    ...(baseURL !== undefined ? { baseURL } : {}),
    serviceWorkers: 'block',
    // Las capturas, como las ve el usuario: en castellano y con más resolución.
    ...(CAPTURAS !== undefined ? { deviceScaleFactor: 2, locale: 'es-AR' } : {}),
  });
  return context.newPage();
}

async function capture(page: Page, name: string): Promise<void> {
  if (CAPTURAS !== undefined) {
    await page.screenshot({ path: join(CAPTURAS, `${name}.png`) });
  }
}

async function readConfig(page: Page): Promise<unknown> {
  return page.evaluate((): unknown => {
    const raw = localStorage.getItem('offline-pos:sync-config');
    const parsed: unknown = raw === null ? null : JSON.parse(raw);
    return parsed;
  });
}

/** Una venta de un arroz en efectivo, hasta el comprobante (que dice su número) y de vuelta. */
async function sellRice(page: Page, expectedTicket: string): Promise<void> {
  const commandBar = page.getByLabel('Barra de comandos');
  await commandBar.fill('arroz');
  await expect(page.getByText('Arroz 1kg')).toBeVisible();
  await commandBar.press('Enter');
  await commandBar.press('Enter');
  await expect(page.getByRole('heading', { name: 'Cobrar venta' })).toBeVisible();
  await page.keyboard.press('Control+Enter');
  await expect(page.getByRole('heading', { name: 'Comprobante' })).toBeVisible();
  await expect(page.getByText(expectedTicket)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(commandBar).toBeVisible();
}

async function runCommand(page: Page, command: string): Promise<void> {
  const commandBar = page.getByLabel('Barra de comandos');
  await commandBar.fill(command);
  await commandBar.press('Enter');
}

async function pendingEvents(page: Page): Promise<number> {
  const outbox = await getAllFromStore<{ status: string }>(page, 'outbox');
  return outbox.filter((event) => event.status === 'pending').length;
}

test('vincular con un código, retomar la caja en otro equipo y revocar el anterior', async ({
  browser,
  request,
}, testInfo) => {
  test.setTimeout(90_000);
  const pointOfSale = `Caja E2E ${String(Date.now())}`;

  // Equipo A: se vincula con un código y entra a la venta en esa caja.
  const first = await issueClaimToken(request, pointOfSale);
  const pageA = await newDevice(browser, testInfo);
  await pageA.goto(`/#connect=${first.connect}`);
  await expect(pageA.getByLabel('Barra de comandos')).toBeVisible();
  expect(pageA.url()).not.toContain('connect=');
  await expect(
    pageA.getByTestId('terminal-header').getByText(`${pointOfSale} - ${BRANCH}`),
  ).toBeVisible();
  expect(await readConfig(pageA)).toMatchObject({
    type: 'rest',
    baseUrl: BACKEND,
    branch: BRANCH,
    pointOfSale,
    apiKey: expect.any(String),
  });

  // A vende y sincroniza: la venta queda en el backend.
  await sellRice(pageA, 'Ticket #1');
  await runCommand(pageA, '/SINCRONIZAR');
  await expect.poll(() => pendingEvents(pageA)).toBe(0);

  // Equipo B: un código nuevo de la misma caja. Retoma la caja con la foto (hidratación).
  const second = await issueClaimToken(request, pointOfSale);
  const pageB = await newDevice(browser, testInfo);
  await pageB.goto(`/#connect=${second.connect}`);
  await expect(pageB.getByLabel('Barra de comandos')).toBeVisible();
  await runCommand(pageB, '/RESUMEN');
  await expect(pageB.getByRole('heading', { name: 'Resumen del día' })).toBeVisible();
  await expect(pageB.getByText('Ticket #1')).toBeVisible();
  await capture(pageB, 'resumen-equipo-nuevo');
  await pageB.keyboard.press('Escape');
  // Su próximo ticket sigue la numeración de la caja.
  await sellRice(pageB, 'Ticket #2');

  // A vende otra (queda sin enviar) y, al sincronizar, el backend dice que la caja es de otro.
  await sellRice(pageA, 'Ticket #2');
  await runCommand(pageA, '/SINCRONIZAR');
  const blocking = pageA.getByTestId('device-revoked-screen');
  await expect(
    pageA.getByRole('heading', { name: 'Esta caja fue vinculada en otro dispositivo' }),
  ).toBeVisible();
  await expect(pageA.getByLabel('Barra de comandos')).toHaveCount(0);
  await expect(pageA.getByTestId('device-revoked-pending')).toContainText('Sin enviar: 1 venta');
  await capture(pageA, 'bloqueante-escritorio');

  // Exportar (Enter): baja un .json con lo no enviado.
  const [download] = await Promise.all([pageA.waitForEvent('download'), blocking.press('Enter')]);
  expect(download.suggestedFilename()).toMatch(/^pendientes-.*\.json$/);
  const exported: unknown = JSON.parse(await readFile(await download.path(), 'utf-8'));
  expect(exported).toMatchObject({
    format: 'pos-pendientes',
    // La venta y su movimiento de stock.
    notSent: {
      summary: { byType: { sale: { count: 1 } } },
      events: expect.arrayContaining([expect.objectContaining({ type: 'sale' })]),
    },
  });
  await expect(pageA.getByText(`Descargado: ${download.suggestedFilename()}`)).toBeVisible();

  // Desvincular: el segundo paso, y Enter termina en /CONFIG sin conexión.
  await blocking.press('Alt+KeyD');
  await expect(pageA.getByText(/Se borran los datos locales de esta terminal/)).toBeVisible();
  await capture(pageA, 'bloqueante-escritorio-confirmacion');
  // Desvincular recarga: el arranque, sin conexión, abre /CONFIG requerido.
  await Promise.all([pageA.waitForEvent('load'), blocking.press('Enter')]);
  await expect(pageA.getByRole('heading', { name: 'Configurar conexión' })).toBeVisible();
  expect(await readConfig(pageA)).toBeNull();
  expect(await getAllFromStore(pageA, 'sales')).toHaveLength(0);

  await pageA.context().close();
  await pageB.context().close();
});

test('un backend sin device-claim: el código no configura nada', async ({
  browser,
  request,
}, testInfo) => {
  const pointOfSale = `Caja E2E vieja ${String(Date.now())}`;
  const token = await issueClaimToken(request, pointOfSale);
  await setDeviceClaim(request, false);
  try {
    const page = await newDevice(browser, testInfo);
    await page.goto(`/#connect=${token.connect}`);
    await expect(page.getByRole('heading', { name: 'Configurar conexión' })).toBeVisible();
    await expect(
      page.getByText(
        /No se pudo vincular la caja: este backend no ofrece vincular la caja con un código/,
      ),
    ).toBeVisible();
    expect(await readConfig(page)).toBeNull();
    await page.context().close();
  } finally {
    await setDeviceClaim(request, true);
  }
});
