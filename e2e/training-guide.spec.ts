import { expect, test } from './fixtures.ts';
import { seedCatalog } from './helpers.ts';
import { getAllFromStore } from './indexed-db.ts';

const TRAINING_DB = 'offline-pos#entrenamiento';
const BANNER_TEXT = 'MODO ENTRENAMIENTO · nada se envía al backend · todo se borra al salir';

/**
 * Guía de entrenamiento (#226), de punta a punta: con la caja vacía, la venta invita a la guía; se
 * entra al entrenamiento con la guía y "Hacelo" (F2) recorre las cuatro lecciones. Si un cambio en
 * la barra o en un comando deja una lección vieja, este test no llega al final.
 */
test('guía: invitación con la caja vacía y las cuatro lecciones con "Hacelo"', async ({ page }) => {
  // Dos recargas y unos veinte pasos escritos letra por letra.
  test.slow();
  await page.goto('/');
  await expect(page.getByLabel('Barra de comandos')).toBeVisible();
  await seedCatalog(page);

  // La invitación, con la caja sin movimientos; el botón no le saca el foco a la barra.
  await expect(page.getByText('¿Es la primera vez que usás el POS?')).toBeVisible();
  await page.getByRole('button', { name: 'Empezar la guía (/ENTRENAMIENTO)' }).click();
  await expect(page.getByRole('heading', { name: 'Entrar al entrenamiento' })).toBeVisible();
  await page.keyboard.press('Enter');

  await expect(page.getByText(BANNER_TEXT)).toBeVisible();
  const panel = page.getByRole('region', { name: 'Guía de entrenamiento' });
  await expect(panel).toContainText('Lección 1 de 4');
  await expect(panel).toContainText('Tu primera venta');
  await expect(page.getByLabel('Barra de comandos')).toBeFocused();

  // F2 hace cada paso y, entre lecciones, pasa a la siguiente.
  const finished = panel.getByText('Guía terminada');
  for (let press = 0; press < 40 && !(await finished.isVisible()); press += 1) {
    await page.keyboard.press('F2');
    await expect(panel.getByRole('button', { name: 'Haciéndolo…' })).toHaveCount(0, {
      timeout: 15_000,
    });
  }
  await expect(finished).toBeVisible();
  await expect(panel).toContainText('seguís en el entrenamiento');

  // Las tres ventas de la guía son de práctica, y se sigue en el entrenamiento.
  expect(await getAllFromStore(page, 'sales', TRAINING_DB)).toHaveLength(3);
  expect(await getAllFromStore(page, 'sales')).toHaveLength(0);
  await page.keyboard.press('F2');
  await expect(panel).toHaveCount(0);
  await expect(page.getByText(BANNER_TEXT)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Abrir la guía (/GUIA)' })).toBeVisible();
});

test('guía: fuera del entrenamiento /GUIA dice cómo entrar; adentro, se escribe a mano', async ({
  page,
}) => {
  test.slow();
  await page.goto('/');
  await expect(page.getByLabel('Barra de comandos')).toBeVisible();
  await seedCatalog(page);
  const bar = page.getByLabel('Barra de comandos');

  await bar.fill('/GUIA');
  await bar.press('Enter');
  await expect(
    page.getByText('/GUIA no está disponible: solo en entrenamiento; entrá con /ENTRENAMIENTO.'),
  ).toBeVisible();

  // Entrar sin la guía y abrirla con el comando.
  await bar.fill('/ENTRENAMIENTO');
  await bar.press('Enter');
  await page.keyboard.press('Alt+Enter');
  await expect(page.getByText(BANNER_TEXT)).toBeVisible();
  const panel = page.getByRole('region', { name: 'Guía de entrenamiento' });
  await expect(panel).toHaveCount(0);
  await bar.fill('/GUIA');
  await bar.press('Enter');
  await expect(panel).toContainText('paso 1 de 4');

  // Lo que se escribe se compara en vivo con lo esperado, y el paso se cumple por el resultado.
  const expected = panel.locator('[data-guide-text]');
  const word = (await expected.textContent()) ?? '';
  await bar.pressSequentially(word.slice(0, 2));
  await expect(panel.locator('.guide-panel__text-ok')).toHaveText(word.slice(0, 2));
  await bar.pressSequentially(word.slice(2));
  await bar.press('Enter');
  await expect(panel).toContainText('paso 2 de 4');
});
