import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

export const SW_FILE = 'sw.js';

/**
 * Lo que el service worker guarda al instalarse (#54): todo el build menos él mismo, con rutas
 * relativas (se resuelven contra la URL de `sw.js`, así anda en cualquier carpeta), y un hash del
 * contenido que nombra la caché: un build distinto, una caché nueva.
 */
export function collectPrecache(outDir: string): { files: string[]; hash: string } {
  const files = readdirSync(outDir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(outDir, join(entry.parentPath, entry.name)).split(sep).join('/'))
    .filter((path) => path !== SW_FILE)
    .sort();
  const hash = createHash('sha256');
  for (const path of files) {
    hash
      .update(path)
      .update('\0')
      .update(readFileSync(join(outDir, path)))
      .update('\0');
  }
  return { files, hash: hash.digest('hex').slice(0, 16) };
}
