import { readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { isMain } from './cli.ts';

const LEGACY = [/^\d+\.\d+\.\d+$/, /^\d+\.\d+\.\d+\.zip$/, /^versions$/];

/**
 * Lo que quedó de la publicación por carpetas (#148), que el canal reemplaza (#54): las carpetas
 * `x.y.z/`, sus zips y `/versions`. Cualquier otra cosa queda. Devuelve lo que borró.
 */
export function cleanupLegacy(siteDir: string): string[] {
  const removed = readdirSync(siteDir).filter((name) => LEGACY.some((re) => re.test(name)));
  for (const name of removed) {
    rmSync(join(siteDir, name), { recursive: true, force: true });
  }
  return removed;
}

if (isMain(import.meta.url)) {
  const { values } = parseArgs({ options: { site: { type: 'string' } } });
  if (values.site === undefined) {
    throw new Error('Uso: node site/cleanup.ts --site <dir>');
  }
  const removed = cleanupLegacy(values.site);
  console.log(removed.length === 0 ? 'Nada que limpiar' : `Borrado: ${removed.join(', ')}`);
}
