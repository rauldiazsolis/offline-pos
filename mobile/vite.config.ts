import { readFileSync } from 'node:fs';
import preact from '@preact/preset-vite';
import { defaultExclude, defineConfig } from 'vitest/config';

const { version } = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf-8'),
) as { version: string };

// La vista de celular es parte de la app de la raíz (una sola app con las dos vistas, publicada por
// el build de la raíz). Esta config es para los tests de `mobile/`, el servidor de desarrollo y la
// vista previa con datos de ejemplo (`build:preview`). Las dependencias salen del `node_modules` de
// la raíz: `dedupe` asegura una sola copia de Preact y de signals.
export default defineConfig(({ mode }) => ({
  base: './',
  publicDir: '../public',
  plugins: [preact()],
  resolve: { dedupe: ['preact', '@preact/signals', 'dexie'] },
  define: {
    __POS_VERSION__: JSON.stringify(version),
    // La vista previa con datos de ejemplo (`src/preview/seed.ts`).
    __PREVIEW__: JSON.stringify(mode === 'preview'),
  },
  server: { fs: { allow: ['..'] } },
  test: {
    environment: 'jsdom',
    setupFiles: ['../src/test/setup.ts'],
    globals: false,
    include: ['src/**/*.test.{ts,tsx}'],
    exclude: [...defaultExclude, 'e2e/**'],
  },
}));
