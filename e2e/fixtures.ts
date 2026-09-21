import { test as base, expect } from '@playwright/test';

export const CONFIG_STORAGE_KEY = 'offline-pos:sync-config';

/**
 * Conexión `active` (con `verifiedAt`) apuntando a un backend inalcanzable: es
 * lo que necesitan los specs que ejercitan la app ya conectada y 100% offline
 * (sin backend real). Desde la Etapa 2b una terminal sin conexión activa solo
 * muestra `/CONFIG`, así que sin esto ningún spec llegaría a la venta. El sync
 * contra el puerto 9 falla en silencio (estado `sync-error`) sin molestar.
 */
export const ACTIVE_CONFIG = {
  type: 'rest',
  baseUrl: 'http://127.0.0.1:9',
  verifiedAt: '2026-01-01T00:00:00.000Z',
};

/** `test` de Playwright que siembra `ACTIVE_CONFIG` antes de que cargue la app (en cada navegación). */
export const test = base.extend({
  // El segundo parámetro de un fixture de Playwright se suele llamar `use`;
  // acá `provide` para que la regla de hooks de React no lo confunda con uno.
  page: async ({ page }, provide) => {
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
