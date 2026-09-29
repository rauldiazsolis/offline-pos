import { mkdirSync, rmSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { buildVersionFolder, currentVersionInfo } from './build-version.ts';
import { buildVersionsPage } from './build-versions-page.ts';
import { isMain } from './cli.ts';

/**
 * El sitio completo desde cero, para probarlo en local y en el e2e (#148): la versión actual más
 * `/versions`. No arma el zip (lo hace la Action con `zip`) ni parte de la rama `publish`.
 */
if (isMain(import.meta.url)) {
  const { values } = parseArgs({ options: { dist: { type: 'string' }, out: { type: 'string' } } });
  if (values.dist === undefined || values.out === undefined) {
    throw new Error('Uso: node site/build-site.ts --dist <dir> --out <dir>');
  }
  rmSync(values.out, { recursive: true, force: true });
  mkdirSync(values.out, { recursive: true });
  buildVersionFolder({ distDir: values.dist, siteDir: values.out, info: currentVersionInfo() });
  await buildVersionsPage(values.out, new Date());
  console.log(`Sitio armado en ${values.out}`);
}
