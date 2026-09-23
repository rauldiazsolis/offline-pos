import { CONFIG_STORAGE_KEY, expect, test } from './fixtures.ts';

// Etapa 2c (#77): los comandos de la barra dependen del conector activo.
// `/DEMO_RESET` lo declara solo `rest-demo`; ni el REST genérico (el que
// siembra `fixtures.ts`) ni Google Sheets lo ofrecen.

test('con el REST genérico, /DEMO_RESET no existe: el menú no lo ofrece y Enter da "Comando desconocido"', async ({
  page,
}) => {
  await page.goto('/');
  const commandBar = page.getByLabel('Barra de comandos');
  await expect(commandBar).toBeVisible();

  await commandBar.fill('/');
  await expect(page.getByText('SINCRONIZAR')).toBeVisible();
  await expect(page.getByText('DEMO_RESET')).toHaveCount(0);

  await commandBar.fill('/DEMO_RESET');
  await commandBar.press('Enter');
  await expect(page.getByText('Comando desconocido: /DEMO_RESET')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Reiniciar demo' })).toHaveCount(0);
});

test('con rest-demo, /DEMO_RESET aparece en el menú y abre su pantalla de confirmación', async ({
  page,
}) => {
  // Se registra después del init script del fixture, así que su valor gana.
  await page.addInitScript(
    ({ key }) => {
      localStorage.setItem(
        key,
        JSON.stringify({
          type: 'rest-demo',
          baseUrl: 'http://127.0.0.1:9',
          verifiedAt: '2026-01-01T00:00:00.000Z',
          branch: 'Casa central',
          pointOfSale: 'Caja 1',
        }),
      );
    },
    { key: CONFIG_STORAGE_KEY },
  );
  await page.goto('/');
  const commandBar = page.getByLabel('Barra de comandos');
  await expect(commandBar).toBeVisible();

  await commandBar.fill('/DEMO');
  await expect(page.getByText('DEMO_RESET')).toBeVisible();

  await commandBar.press('Enter');
  await expect(page.getByRole('heading', { name: 'Reiniciar demo' })).toBeVisible();

  // Esc cancela sin reiniciar nada y devuelve la barra.
  await page.keyboard.press('Escape');
  await expect(commandBar).toBeVisible();
});
