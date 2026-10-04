import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

/** Lo que un canal declara de su POS: la versión, el contrato y el piso (#148, #54). */
export type VersionInfo = { version: string; contract: string; minBackendContract: string };

const semver = z.string().regex(/^\d+\.\d+\.\d+$/);
const versionInfoSchema = z.object({
  version: semver,
  contract: semver,
  minBackendContract: semver,
});

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

export const CHANNEL_FOLDER = /^v\d+$/;

/** El canal de un POS sale del major de su contrato (#54): `4.5.0` → `v4`. */
export function channelFor(contract: string): string {
  return `v${contract.split('.')[0] ?? ''}`;
}

export type ChannelInfo = VersionInfo & { channel: string };

/** `version.json` de una carpeta publicada, o `undefined` si no existe. Falla si es inválido. */
export function readChannelInfo(folder: string): VersionInfo | undefined {
  const path = join(folder, 'version.json');
  if (!existsSync(path)) {
    return undefined;
  }
  const parsed = versionInfoSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')) as unknown);
  if (!parsed.success) {
    throw new Error(`version.json inválido en ${folder}`);
  }
  return parsed.data;
}

/** Los canales publicados (`v<n>/`), el major más nuevo primero. Cada uno tiene que tener version.json. */
export function readChannels(siteDir: string): ChannelInfo[] {
  return readdirSync(siteDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && CHANNEL_FOLDER.test(entry.name))
    .map((entry) => {
      const info = readChannelInfo(join(siteDir, entry.name));
      if (info === undefined || channelFor(info.contract) !== entry.name) {
        throw new Error(`El canal ${entry.name} no tiene un version.json de su major`);
      }
      return { ...info, channel: entry.name };
    })
    .sort((a, b) => Number(b.channel.slice(1)) - Number(a.channel.slice(1)));
}
