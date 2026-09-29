// @vitest-environment node
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildVersionFolder } from './build-version.ts';
import { renderGuidePage } from './guide-page.ts';

const INFO = { version: '0.1.0', contract: '4.4.0', minBackendContract: '4.0.0' };

function fixture(): { distDir: string; siteDir: string } {
  const root = mkdtempSync(join(tmpdir(), 'build-version-'));
  const distDir = join(root, 'dist');
  mkdirSync(join(distDir, 'assets'), { recursive: true });
  writeFileSync(join(distDir, 'index.html'), '<!doctype html><title>offline-pos</title>');
  writeFileSync(join(distDir, 'assets', 'app-abc123.js'), 'console.log(1)');
  const siteDir = join(root, 'site');
  mkdirSync(siteDir);
  return { distDir, siteDir };
}

describe('buildVersionFolder (#148)', () => {
  it('copia el build, escribe version.json y publica las docs con el link al OpenAPI local', () => {
    const { distDir, siteDir } = fixture();
    const folder = buildVersionFolder({ distDir, siteDir, info: INFO });

    expect(folder).toBe(join(siteDir, '0.1.0'));
    expect(existsSync(join(folder, 'assets', 'app-abc123.js'))).toBe(true);
    expect(JSON.parse(readFileSync(join(folder, 'version.json'), 'utf8'))).toEqual(INFO);
    const guide = readFileSync(join(folder, 'docs', 'guia.md'), 'utf8');
    expect(guide).toContain('](connector-api.openapi.yaml)');
    expect(guide).not.toContain('../connector-api.openapi.yaml');
    expect(readFileSync(join(folder, 'docs', 'llms.txt'), 'utf8')).not.toContain('../');
    expect(existsSync(join(folder, 'docs', 'connector-api.openapi.yaml'))).toBe(true);
    expect(readFileSync(join(folder, 'docs', 'index.html'), 'utf8')).toContain(
      '<h1>Guía para integradores</h1>',
    );
  });

  it('nunca pisa una versión publicada', () => {
    const { distDir, siteDir } = fixture();
    buildVersionFolder({ distDir, siteDir, info: INFO });
    expect(() => buildVersionFolder({ distDir, siteDir, info: INFO })).toThrow(/inmutable/);
  });
});

describe('renderGuidePage', () => {
  it('convierte el Markdown dentro de la plantilla, con el título y la versión', () => {
    const html = renderGuidePage('# Guía para integradores\n\nHola **mundo**', '0.1.0');
    expect(html).toContain('<title>Guía para integradores · offline-pos 0.1.0</title>');
    expect(html).toContain('<strong>mundo</strong>');
  });
});
