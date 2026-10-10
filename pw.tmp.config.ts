import base from './playwright.config.ts';
import { defineConfig } from '@playwright/test';
export default defineConfig({
  ...base,
  projects: base.projects?.map((p) => ({ ...p, use: { ...p.use, launchOptions: { executablePath: '/opt/pw-browsers/chromium' } } })),
});
