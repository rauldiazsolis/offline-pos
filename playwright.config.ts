import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  reporter: 'list',
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
  ],
});
