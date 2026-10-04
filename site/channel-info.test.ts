// @vitest-environment node
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { channelFor, compareVersionsDesc, readChannels } from './channel-info.ts';

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

const info = (version: string, contract = '4.5.0') => ({
  version,
  contract,
  minBackendContract: '4.0.0',
});

describe('canales publicados (#54)', () => {
  it('ordena versiones por semver, la más nueva primero', () => {
    expect(['0.9.0', '0.10.0', '0.1.0', '1.0.0'].sort(compareVersionsDesc)).toEqual([
      '1.0.0',
      '0.10.0',
      '0.9.0',
      '0.1.0',
    ]);
  });

  it('el canal sale del major del contrato', () => {
    expect(channelFor('4.5.0')).toBe('v4');
    expect(channelFor('5.0.0')).toBe('v5');
  });

  it('lee los canales, el major más nuevo primero, e ignora las carpetas viejas', () => {
    const dir = site({
      v4: info('0.3.0'),
      v5: info('1.0.0', '5.0.0'),
      '0.2.0': info('0.2.0'),
      versions: undefined,
    });
    expect(readChannels(dir).map((c) => [c.channel, c.version])).toEqual([
      ['v5', '1.0.0'],
      ['v4', '0.3.0'],
    ]);
  });

  it('falla si un canal no tiene version.json o es de otro major', () => {
    expect(() => readChannels(site({ v4: undefined }))).toThrow(/v4/);
    expect(() => readChannels(site({ v4: info('0.3.0', '5.0.0') }))).toThrow(/v4/);
  });
});
