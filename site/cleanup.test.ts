// @vitest-environment node
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cleanupLegacy } from './cleanup.ts';

describe('cleanupLegacy (#54)', () => {
  it('borra las carpetas por versión, los zips y /versions, y nada más', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cleanup-'));
    for (const folder of ['0.1.0', '0.2.0', 'versions', 'v4', 'otra']) {
      mkdirSync(join(dir, folder));
    }
    for (const file of ['0.1.0.zip', '0.2.0.zip', 'index.html', 'llms.txt', '_headers']) {
      writeFileSync(join(dir, file), '');
    }
    expect(cleanupLegacy(dir).sort()).toEqual([
      '0.1.0',
      '0.1.0.zip',
      '0.2.0',
      '0.2.0.zip',
      'versions',
    ]);
    for (const kept of ['v4', 'otra', 'index.html', 'llms.txt', '_headers']) {
      expect(existsSync(join(dir, kept))).toBe(true);
    }
    expect(cleanupLegacy(dir)).toEqual([]);
  });
});
