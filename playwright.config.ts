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
  // Solo Chromium — es el navegador de referencia del proyecto (ver CLAUDE.md).
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
  ],
});
