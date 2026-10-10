import { defineConfig, devices } from '@playwright/test';

const PORT = 4180;
/** Un demo-backend en memoria, propio de estos specs (`POST /demo-sessions` re-siembra la base). Mismo puerto que `e2e/helpers.ts`. */
const BACKEND_PORT = 4010;

// En un contenedor con otro Chromium que el que espera Playwright (`PW_CHROMIUM_EXECUTABLE`).
const executablePath = process.env.PW_CHROMIUM_EXECUTABLE;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: `http://localhost:${String(PORT)}`,
    trace: 'on-first-retry',
    serviceWorkers: 'block',
    locale: 'es-AR',
  },
  // Un celular Android con Chromium (el navegador de referencia), con pantalla táctil.
  projects: [
    {
      name: 'mobile-chromium',
      use: {
        ...devices['Pixel 7'],
        ...(executablePath !== undefined ? { launchOptions: { executablePath } } : {}),
      },
    },
  ],
  webServer: [
    {
      // La app publicada es la de la raíz, con las dos vistas; en un Pixel 7 abre la de celular.
      command: `pnpm build && pnpm preview --port ${String(PORT)} --strictPort`,
      cwd: '..',
      url: `http://localhost:${String(PORT)}`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: 'pnpm --filter demo-backend run start',
      env: { DEMO_BACKEND_PORT: String(BACKEND_PORT), DEMO_BACKEND_DB: ':memory:' },
      url: `http://localhost:${String(BACKEND_PORT)}/_demo`,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],
});
