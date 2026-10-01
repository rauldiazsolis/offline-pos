import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  reporter: 'list',
  // Un reintento solo en CI (#169): así `trace: 'on-first-retry'` deja la traza de un flake, que el
  // workflow sube como artefacto. Un test que pasa al reintentar se ve como "flaky" en el log.
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: `http://localhost:${String(PORT)}`,
    trace: 'on-first-retry',
  },
  // Solo Chromium — es el navegador de referencia del proyecto (ver AGENTS.md).
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: `pnpm build && pnpm preview --port ${String(PORT)}`,
      url: `http://localhost:${String(PORT)}`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      // Minibackend de demo (Fase 7) — solo lo necesita
      // e2e/minibackend-sync.spec.ts, pero levantarlo para toda la suite es
      // más simple que filtrar por spec, y no interfiere con el resto (esos
      // specs nunca configuran /CONFIG).
      command: 'pnpm --filter demo-backend run start',
      url: 'http://localhost:4000/_demo',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      // Onboarding de demo (#128): `POST /demo-sessions` re-siembra la base, así que
      // `e2e/demo-onboarding.spec.ts` usa su propio backend, en memoria.
      command: 'pnpm --filter demo-backend run start',
      env: { DEMO_BACKEND_PORT: '4001', DEMO_BACKEND_DB: ':memory:' },
      url: 'http://localhost:4001/_demo',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      // Sitio publicado armado en local (#148): la versión actual en /<versión>/ más /versions,
      // solo con el demo-backend local para no depender de un backend publicado (#147).
      command: 'pnpm site:build --only-local && pnpm site:preview',
      url: 'http://localhost:4174/versions/',
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
    {
      // Backend en memoria propio de `e2e/published-site.spec.ts`: `POST /demo-sessions`
      // re-siembra la base, así que no comparte el de `demo-onboarding.spec.ts` (#148).
      command: 'pnpm --filter demo-backend run start',
      env: { DEMO_BACKEND_PORT: '4002', DEMO_BACKEND_DB: ':memory:' },
      url: 'http://localhost:4002/_demo',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],
});
