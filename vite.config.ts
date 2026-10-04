import { readFileSync } from 'node:fs';
import preact from '@preact/preset-vite';
import { defaultExclude, defineConfig } from 'vitest/config';
import { serviceWorkerPlugin } from './build/sw-plugin.ts';

const { version } = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf-8'),
) as { version: string };

// https://vite.dev/config/
export default defineConfig({
  // Rutas relativas (#148): el mismo build anda en /, en /0.1.0/ o en cualquier carpeta de quien
  // copie el zip. Revisa la decisión de #128 de dejar '/'.
  base: './',
  plugins: [preact(), serviceWorkerPlugin()],
  // Versión visible en /DIAGNOSTICO (#148). Vitest usa el mismo `define`.
  define: { __POS_VERSION__: JSON.stringify(version) },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: false,
    // e2e/ es de Playwright; demo-backend/ tiene su propio Vitest (entorno
    // node, no jsdom) — sin esto, sus *.test.ts colisionarían acá. .claude/ tiene
    // los worktrees de otras sesiones: copias enteras del repo con sus propios tests.
    exclude: [
      ...defaultExclude,
      'e2e/**',
      'demo-backend/**',
      '.claude/**',
      // Sitio publicado armado en local (#148).
      '.site-dist/**',
      '.site-out/**',
    ],
  },
});
