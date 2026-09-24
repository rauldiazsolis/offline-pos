import { test as base, expect, type Page } from '@playwright/test';

export const CONFIG_STORAGE_KEY = 'offline-pos:sync-config';
export const DEVICE_ID_STORAGE_KEY = 'offline-pos:device-id';

/**
 * Conexión `active` (con `verifiedAt`, sucursal y punto de venta) apuntando a
 * un backend inalcanzable: es lo que necesitan los specs que ejercitan la app
 * ya conectada y 100% offline (sin backend real). Desde la Etapa 2b una
 * terminal sin conexión activa solo muestra `/CONFIG`, así que sin esto
 * ningún spec llegaría a la venta. El sync contra el puerto 9 falla en
 * silencio (estado `sync-error`) sin molestar.
 */
export const ACTIVE_CONFIG = {
  type: 'rest',
  baseUrl: 'http://127.0.0.1:9',
  verifiedAt: '2026-01-01T00:00:00.000Z',
  branch: 'Casa central',
  pointOfSale: 'Caja 1',
};

/**
 * Una terminal con config ya tiene id de dispositivo (Etapa 2 de #94): sin él,
 * el arranque la trataría como una terminal que perdió su identidad (borra lo
 * local y le saca el `verifiedAt` a la config). Se siembra **una sola vez por
 * pestaña** (marca en `sessionStorage`, que sobrevive a un reload): así un
 * spec puede borrar el id y recargar para probar justo ese caso
 * (`terminal-identity.spec.ts`) sin que este script lo vuelva a poner.
 */
export async function seedDeviceIdentity(page: Page): Promise<void> {
  await page.addInitScript((key) => {
    if (sessionStorage.getItem('e2e:device-id-seeded') === null) {
      localStorage.setItem(key, 'e2e-device-id');
      sessionStorage.setItem('e2e:device-id-seeded', '1');
    }
  }, DEVICE_ID_STORAGE_KEY);
}

/** `test` de Playwright que siembra `ACTIVE_CONFIG` antes de que cargue la app (en cada navegación). */
export const test = base.extend({
  // El segundo parámetro de un fixture de Playwright se suele llamar `use`;
  // acá `provide` para que la regla de hooks de React no lo confunda con uno.
  page: async ({ page }, provide) => {
    await seedDeviceIdentity(page);
    await page.addInitScript(
      ({ key, config }) => {
        localStorage.setItem(key, JSON.stringify(config));
      },
      { key: CONFIG_STORAGE_KEY, config: ACTIVE_CONFIG },
    );
    await provide(page);
  },
});

export { expect };
