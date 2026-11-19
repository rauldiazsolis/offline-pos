import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { expectNoSystemKeyboard, openDemo } from './helpers.ts';

/**
 * La caja vinculada en otro dispositivo (4.7.0, #230) en la vista de celular. El recorrido con el
 * backend (el código, el 409 y la descarga) lo prueba `e2e/device-claim.spec.ts` en escritorio;
 * acá se siembra la marca (`device-revoked`, la restaura el arranque) y se mira la pantalla.
 *
 * Con `E2E_CAPTURAS=<carpeta>` guarda una captura; sin la variable no escribe nada.
 */
const CAPTURAS = process.env.E2E_CAPTURAS;

test('con la marca: pantalla bloqueante, sin teclado del sistema, y desvincular pide confirmación', async ({
  page,
}) => {
  await openDemo(page);
  await page.evaluate(() => {
    localStorage.setItem(
      'offline-pos:device-revoked',
      JSON.stringify({ at: new Date().toISOString() }),
    );
  });
  await page.reload();

  const blocking = page.getByTestId('device-revoked-screen');
  await expect(
    blocking.getByRole('heading', { name: 'Esta caja fue vinculada en otro dispositivo' }),
  ).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Secciones' })).toHaveCount(0);
  await expect(blocking.getByTestId('device-revoked-pending')).toContainText(
    'No hay nada pendiente',
  );
  await expect(
    blocking.getByRole('button', { name: 'Exportar datos locales pendientes (.json)' }),
  ).toBeVisible();
  await expectNoSystemKeyboard(page);
  if (CAPTURAS !== undefined) {
    await page.screenshot({ path: join(CAPTURAS, 'bloqueante-celular.png') });
  }

  await blocking.getByRole('button', { name: 'Desvincular esta terminal' }).click();
  await expect(blocking.getByText(/Se borran los datos locales de esta terminal/)).toBeVisible();
  await blocking.getByRole('button', { name: 'Volver' }).click();
  await expect(blocking.getByText(/Se borran los datos locales/)).toHaveCount(0);
});
