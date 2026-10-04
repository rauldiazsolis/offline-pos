// @vitest-environment node
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { collectPrecache } from './precache.ts';

function dist(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'precache-'));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(dir, path, '..'), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  return dir;
}

describe('collectPrecache (#54)', () => {
  it('lista todo el build en orden, con barras, sin sw.js', () => {
    const dir = dist({
      'index.html': '<html>',
      'assets/app-1.js': 'x',
      'favicon.svg': '<svg>',
      'sw.js': 'viejo',
    });
    expect(collectPrecache(dir).files).toEqual(['assets/app-1.js', 'favicon.svg', 'index.html']);
  });

  it('el hash cambia si cambia el contenido de un archivo, y no si cambia sw.js', () => {
    const a = collectPrecache(dist({ 'index.html': 'a', 'sw.js': '1' })).hash;
    expect(collectPrecache(dist({ 'index.html': 'a', 'sw.js': '2' })).hash).toBe(a);
    expect(collectPrecache(dist({ 'index.html': 'b', 'sw.js': '1' })).hash).not.toBe(a);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
  });
});
