import { expect, test } from './fixtures.ts';
import { seedCatalog } from './helpers.ts';
import { getAllFromStore } from './indexed-db.ts';

type StoredCustomer = { name: string };

/**
 * #152: el alta de `@<nombre nuevo>` es async y vacía la barra al terminar (#146). Lo que el operador
 * tipea o escanea mientras tanto no se pierde, y su Enter lo procesa. Para no depender de la carga de
 * la máquina, el alta se demora desde afuera: una transacción de escritura sobre `customers`
 * sostenida 400 ms deja en cola la escritura del alta.
 */
test('lo tipeado mientras se crea un cliente no se pierde y su Enter lo agrega', async ({
  page,
  context,
}) => {
  await page.goto('/');
  const commandBar = page.getByLabel('Barra de comandos');
  await expect(commandBar).toBeVisible();
  await seedCatalog(page);
  await context.setOffline(true);

  await commandBar.fill('@Cliente Lento');
  await page.evaluate(() => {
    const open = indexedDB.open('offline-pos');
    open.onsuccess = () => {
      const store = open.result.transaction('customers', 'readwrite').objectStore('customers');
      const until = performance.now() + 400;
      const hold = (): void => {
        if (performance.now() < until) {
          store.count().onsuccess = hold;
        }
      };
      hold();
    };
  });
  await commandBar.press('Enter');

  // Con el alta todavía en cola: se escanea un artículo y se confirma.
  await commandBar.fill('arroz');
  await expect(page.getByText('Arroz 1kg')).toBeVisible();
  await commandBar.press('Enter');

  await expect(page.locator('tbody').getByText('Arroz 1kg')).toBeVisible();
  await expect(commandBar).toHaveValue('');
  await expect(page.getByText('Cliente Lento', { exact: true })).toBeVisible();
  const customers = await getAllFromStore<StoredCustomer>(page, 'customers');
  expect(customers.filter((customer) => customer.name === 'Cliente Lento')).toHaveLength(1);

  await commandBar.press('Control+Enter');
  await expect(page.getByRole('heading', { name: 'Cobrar' })).toBeVisible();
});
