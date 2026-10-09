import { readFileSync } from 'node:fs';
import preact from '@preact/preset-vite';
import { defaultExclude, defineConfig } from 'vitest/config';
import { serviceWorkerPlugin } from '../build/sw-plugin.ts';

const { version } = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf-8'),
) as { version: string };

// El POS mobile reusa `../src` (dominio, storage, sync, conectores y controllers) sin copiarlo, y sus
// dependencias salen del `node_modules` de la raíz: así hay una sola copia de Preact y de signals
// (dos copias rompen la reactividad sin avisar). `dedupe` lo asegura aunque alguien las declare acá.
export default defineConfig({
  // Rutas relativas, como el POS de escritorio (#148): el mismo build anda en cualquier carpeta.
  base: './',
  // El service worker de escritorio (#54), compilado desde `src/workers/sw.ts` de este proyecto.
  plugins: [preact(), serviceWorkerPlugin()],
  resolve: { dedupe: ['preact', '@preact/signals', 'dexie'] },
  define: { __POS_VERSION__: JSON.stringify(version) },
  server: { fs: { allow: ['..'] } },
  test: {
    environment: 'jsdom',
    setupFiles: ['../src/test/setup.ts'],
    globals: false,
    include: ['src/**/*.test.{ts,tsx}'],
    exclude: [...defaultExclude, 'e2e/**'],
  },
});
