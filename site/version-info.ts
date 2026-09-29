import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

/** Lo único que una carpeta de versión declara: hechos del POS, que nunca cambian (#148). */
export type VersionInfo = { version: string; contract: string; minBackendContract: string };

const semver = z.string().regex(/^\d+\.\d+\.\d+$/);
const versionInfoSchema = z.object({
  version: semver,
  contract: semver,
  minBackendContract: semver,
});

export const VERSION_FOLDER = /^\d+\.\d+\.\d+$/;

export function compareVersionsDesc(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pb[i] ?? 0) - (pa[i] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}

export function readPublishedVersions(siteDir: string): VersionInfo[] {
  return readdirSync(siteDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && VERSION_FOLDER.test(entry.name))
    .map((entry) => {
      const path = join(siteDir, entry.name, 'version.json');
      if (!existsSync(path)) {
        throw new Error(`La carpeta publicada ${entry.name} no tiene version.json`);
      }
      const parsed = versionInfoSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')) as unknown);
      if (!parsed.success || parsed.data.version !== entry.name) {
        throw new Error(`version.json inválido en la carpeta ${entry.name}`);
      }
      return parsed.data;
    })
    .sort((a, b) => compareVersionsDesc(a.version, b.version));
}
