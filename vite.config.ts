import { readFileSync } from 'node:fs';
import preact from '@preact/preset-vite';
import { defaultExclude, defineConfig } from 'vitest/config';

const { version } = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf-8'),
) as { version: string };

// https://vite.dev/config/
export default defineConfig({
  plugins: [preact()],
  // Versión visible en /DIAGNOSTICO (#148). Vitest usa el mismo `define`.
  define: { __POS_VERSION__: JSON.stringify(version) },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: false,
    // e2e/ es de Playwright; demo-backend/ tiene su propio Vitest (entorno
    // node, no jsdom) — sin esto, sus *.test.ts colisionarían acá. .claude/ tiene
    // los worktrees de otras sesiones: copias enteras del repo con sus propios tests.
    exclude: [...defaultExclude, 'e2e/**', 'demo-backend/**', 'mini-erp/**', '.claude/**'],
  },
});
