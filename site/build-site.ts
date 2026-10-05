import { mkdirSync, rmSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { buildChannel, currentVersionInfo } from './build-channel.ts';
import { buildHomePage } from './build-home-page.ts';
import { isMain } from './cli.ts';

/**
 * El sitio completo desde cero, para probarlo en local y en el e2e (#148, #54): la versión actual en
 * su canal más la home. No parte de la rama `publish`.
 */
if (isMain(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      dist: { type: 'string' },
      out: { type: 'string' },
      'only-local': { type: 'boolean', default: false },
    },
  });
  if (values.dist === undefined || values.out === undefined) {
    throw new Error('Uso: node site/build-site.ts --dist <dir> --out <dir> [--only-local]');
  }
  rmSync(values.out, { recursive: true, force: true });
  mkdirSync(values.out, { recursive: true });
  buildChannel({ distDir: values.dist, siteDir: values.out, info: currentVersionInfo() });
  await buildHomePage(values.out, new Date(), { onlyLocal: values['only-local'] });
  console.log(`Sitio armado en ${values.out}`);
}
