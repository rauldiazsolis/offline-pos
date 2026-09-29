// @vitest-environment node
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compareVersionsDesc, readPublishedVersions } from './version-info.ts';

function site(folders: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), 'site-'));
  for (const [name, info] of Object.entries(folders)) {
    mkdirSync(join(dir, name));
    if (info !== undefined) {
      writeFileSync(join(dir, name, 'version.json'), JSON.stringify(info));
    }
  }
  return dir;
}

const info = (version: string) => ({ version, contract: '4.4.0', minBackendContract: '4.0.0' });

describe('versiones publicadas (#148)', () => {
  it('ordena por semver, la más nueva primero', () => {
    expect(['0.9.0', '0.10.0', '0.1.0', '1.0.0'].sort(compareVersionsDesc)).toEqual([
      '1.0.0',
      '0.10.0',
      '0.9.0',
      '0.1.0',
    ]);
  });

  it('lee las carpetas con forma de versión e ignora el resto', () => {
    const dir = site({ '0.1.0': info('0.1.0'), '0.2.0': info('0.2.0'), versions: undefined });
    expect(readPublishedVersions(dir).map((v) => v.version)).toEqual(['0.2.0', '0.1.0']);
  });

  it('falla si una carpeta de versión no tiene version.json o no coincide', () => {
    expect(() => readPublishedVersions(site({ '0.1.0': undefined }))).toThrow(/0\.1\.0/);
    expect(() => readPublishedVersions(site({ '0.1.0': info('0.2.0') }))).toThrow(/0\.1\.0/);
  });
});
