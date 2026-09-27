import preact from '@preact/preset-vite';
import { defaultExclude, defineConfig } from 'vitest/config';

// https://vite.dev/config/
export default defineConfig({
  plugins: [preact()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: false,
    // e2e/ es de Playwright; demo-backend/ tiene su propio Vitest (entorno
    // node, no jsdom) — sin esto, sus *.test.ts colisionarían acá.
    exclude: [...defaultExclude, 'e2e/**', 'demo-backend/**', 'mini-erp/**'],
  },
});
