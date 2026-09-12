import preact from '@preact/preset-vite';
import { defaultExclude, defineConfig } from 'vitest/config';

// https://vite.dev/config/
export default defineConfig({
  plugins: [preact()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: false,
    // e2e/ es de Playwright, no de Vitest — sin esto, sus *.spec.ts colisionan.
    exclude: [...defaultExclude, 'e2e/**'],
  },
});
