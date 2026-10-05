import { resolve } from 'node:path';
import { build, type Plugin } from 'vite';
import { collectPrecache, SW_FILE } from './precache.ts';

/**
 * `sw.js` (#54): al terminar el build de la app (con `public/` ya copiado), un segundo build de
 * `src/workers/sw.ts` como script clásico en un solo archivo, con la lista de `dist/` inyectada. Un
 * build aparte para que nunca comparta chunks con la app. Solo en `vite build`.
 */
export function serviceWorkerPlugin(): Plugin {
  let root = '';
  let outDir = '';
  return {
    name: 'pos-service-worker',
    apply: 'build',
    configResolved(config) {
      root = config.root;
      outDir = resolve(config.root, config.build.outDir);
    },
    async closeBundle() {
      const { files, hash } = collectPrecache(outDir);
      await build({
        configFile: false,
        root,
        logLevel: 'warn',
        publicDir: false,
        define: {
          __PRECACHE_FILES__: JSON.stringify(files),
          __PRECACHE_HASH__: JSON.stringify(hash),
        },
        build: {
          outDir,
          emptyOutDir: false,
          copyPublicDir: false,
          lib: {
            entry: resolve(root, 'src/workers/sw.ts'),
            formats: ['iife'],
            name: 'posServiceWorker',
            fileName: () => SW_FILE,
          },
        },
      });
    },
  };
}
