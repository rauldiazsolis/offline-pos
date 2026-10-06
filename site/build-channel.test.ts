// @vitest-environment node
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildChannel } from './build-channel.ts';
import { renderGuidePage } from './guide-page.ts';

const INFO = { version: '0.3.0', contract: '4.5.0', minBackendContract: '4.0.0' };

function fixture(): { distDir: string; siteDir: string } {
  const root = mkdtempSync(join(tmpdir(), 'build-channel-'));
  const distDir = join(root, 'dist');
  mkdirSync(join(distDir, 'assets'), { recursive: true });
  writeFileSync(join(distDir, 'index.html'), '<!doctype html><title>offline-pos</title>');
  writeFileSync(join(distDir, 'assets', 'app-abc123.js'), 'console.log(1)');
  const siteDir = join(root, 'site');
  mkdirSync(siteDir);
  return { distDir, siteDir };
}

function publishedChannel(siteDir: string, version: string): void {
  mkdirSync(join(siteDir, 'v4', 'assets'), { recursive: true });
  writeFileSync(join(siteDir, 'v4', 'assets', 'viejo.js'), 'viejo');
  writeFileSync(join(siteDir, 'v4', 'version.json'), JSON.stringify({ ...INFO, version }));
}

describe('buildChannel (#54)', () => {
  it('arma v4/ con el build, version.json y las docs con el OpenAPI local', () => {
    const { distDir, siteDir } = fixture();
    const folder = buildChannel({ distDir, siteDir, info: INFO });

    expect(folder).toBe(join(siteDir, 'v4'));
    expect(existsSync(join(folder, 'assets', 'app-abc123.js'))).toBe(true);
    expect(JSON.parse(readFileSync(join(folder, 'version.json'), 'utf8'))).toEqual(INFO);
    const guide = readFileSync(join(folder, 'docs', 'guia.md'), 'utf8');
    expect(guide).toContain('](connector-api.openapi.yaml)');
    expect(guide).not.toContain('../connector-api.openapi.yaml');
    expect(guide).toContain('](google-sheets/)');
    const llms = readFileSync(join(folder, 'docs', 'llms.txt'), 'utf8');
    expect(llms).not.toContain('../');
    expect(llms).toContain('](google-sheets/guia.md)');
    expect(llms).toContain('](google-sheets/bridge.gs)');
    expect(llms).toContain('](google-sheets/columnas.gs)');
    expect(existsSync(join(folder, 'docs', 'connector-api.openapi.yaml'))).toBe(true);
    expect(readFileSync(join(folder, 'docs', 'index.html'), 'utf8')).toContain(
      '<h1>Guía para integradores</h1>',
    );
    expect(readdirSync(join(folder, 'docs')).filter((file) => file.endsWith('.gs'))).toEqual([]);
  });

  it('publica el puente de Sheets y su guía en docs/google-sheets/ (#180)', () => {
    const { distDir, siteDir } = fixture();
    const sheets = join(buildChannel({ distDir, siteDir, info: INFO }), 'docs', 'google-sheets');

    expect(readdirSync(sheets).sort()).toEqual([
      'bridge.gs',
      'columnas.gs',
      'guia.md',
      'index.html',
    ]);
    for (const file of ['bridge.gs', 'columnas.gs']) {
      expect(readFileSync(join(sheets, file), 'utf8')).toBe(
        readFileSync(new URL(`../src/connectors/google-sheets/${file}`, import.meta.url), 'utf8'),
      );
    }
    const guide = readFileSync(join(sheets, 'guia.md'), 'utf8');
    expect(guide).not.toContain('src/');
    expect(guide).toContain('](bridge.gs)');
    expect(guide).toContain('](columnas.gs)');
    expect(guide).toContain('](../guia.md)');
    expect(guide).toContain('](../connector-api.openapi.yaml)');
    const html = readFileSync(join(sheets, 'index.html'), 'utf8');
    expect(html).toContain('<h1>Google Sheets: el puente de Apps Script</h1>');
    expect(html).toContain('href="../connector-api.openapi.yaml"');
    expect(html).toContain('href="bridge.gs"');
  });

  it('reemplaza el canal entero con una versión más nueva', () => {
    const { distDir, siteDir } = fixture();
    publishedChannel(siteDir, '0.2.0');
    const folder = buildChannel({ distDir, siteDir, info: INFO });
    expect(existsSync(join(folder, 'assets', 'viejo.js'))).toBe(false);
    expect(JSON.parse(readFileSync(join(folder, 'version.json'), 'utf8'))).toEqual(INFO);
  });

  it('nunca repite ni baja la versión del canal', () => {
    for (const version of ['0.3.0', '0.4.0']) {
      const { distDir, siteDir } = fixture();
      publishedChannel(siteDir, version);
      expect(() => buildChannel({ distDir, siteDir, info: INFO })).toThrow(/ya está publicada/);
      expect(existsSync(join(siteDir, 'v4', 'assets', 'viejo.js'))).toBe(true);
    }
  });
});

describe('renderGuidePage', () => {
  it('convierte el Markdown dentro de la plantilla, con el título y la versión', () => {
    const html = renderGuidePage('# Guía para integradores\n\nHola **mundo**', '0.1.0');
    expect(html).toContain('<title>Guía para integradores · offline-pos 0.1.0</title>');
    expect(html).toContain('<strong>mundo</strong>');
  });

  it('en una subcarpeta de docs, el encabezado sube con docsRoot y el Markdown queda al lado', () => {
    const html = renderGuidePage('# Google Sheets', '0.1.0', '../');
    expect(html).toContain('href="guia.md"');
    expect(html).toContain('href="../connector-api.openapi.yaml"');
    expect(html).toContain('href="../llms.txt"');
    expect(html).toContain('href="../../../"');
  });

  it('sin docsRoot, el encabezado es el de docs/', () => {
    const html = renderGuidePage('# Guía para integradores', '0.1.0');
    expect(html).toContain('href="connector-api.openapi.yaml"');
    expect(html).toContain('href="llms.txt"');
    expect(html).toContain('href="../../"');
  });
});
