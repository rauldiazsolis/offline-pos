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
import { buildSheetsBundle } from './sheets-bundle.ts';

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
    expect(guide).toContain('](google-sheets/referencia.html)');
    const llms = readFileSync(join(folder, 'docs', 'llms.txt'), 'utf8');
    expect(llms).not.toContain('../');
    expect(llms).toContain('](google-sheets/guia.md)');
    expect(llms).toContain('](google-sheets/referencia.md)');
    expect(llms).toContain('](google-sheets/pos-sheets.gs)');
    expect(existsSync(join(folder, 'docs', 'connector-api.openapi.yaml'))).toBe(true);
    expect(readFileSync(join(folder, 'docs', 'index.html'), 'utf8')).toContain(
      '<h1>Guía para integradores</h1>',
    );
    expect(readdirSync(join(folder, 'docs')).filter((file) => file.endsWith('.gs'))).toEqual([]);
  });

  it('publica el puente de Sheets en un solo archivo, con su setup y su referencia (#219, #221)', () => {
    const { distDir, siteDir } = fixture();
    const sheets = join(buildChannel({ distDir, siteDir, info: INFO }), 'docs', 'google-sheets');

    expect(readdirSync(sheets).sort()).toEqual([
      'guia.md',
      'img',
      'index.html',
      'pos-sheets.gs',
      'referencia.html',
      'referencia.md',
    ]);
    expect(readFileSync(join(sheets, 'pos-sheets.gs'), 'utf8')).toBe(
      buildSheetsBundle({
        sourcesDir: new URL('../src/connectors/google-sheets/', import.meta.url).pathname,
        version: INFO.version,
      }),
    );
    for (const page of ['guia.md', 'referencia.md']) {
      const text = readFileSync(join(sheets, page), 'utf8');
      expect(text).not.toContain('src/');
      expect(text).toContain('](pos-sheets.gs)');
      expect(text).not.toContain('google-sheets');
    }

    const guide = readFileSync(join(sheets, 'guia.md'), 'utf8');
    expect(guide).toContain('](referencia.html)');
    const images = [...guide.matchAll(/\]\((img\/[^)]+)\)/g)].map((match) => match[1] ?? '');
    expect(images.length).toBeGreaterThan(0);
    for (const image of images) {
      expect(existsSync(join(sheets, image)), image).toBe(true);
    }
    const html = readFileSync(join(sheets, 'index.html'), 'utf8');
    expect(html).toContain('<h1>Google Sheets: conectar el POS a una planilla</h1>');
    expect(html).toContain('href="../connector-api.openapi.yaml"');
    expect(html).toContain('href="pos-sheets.gs"');
    expect(html).toContain('id="copiar"');
    expect(html).toContain('<a href="guia.md">Markdown</a>');

    const reference = readFileSync(join(sheets, 'referencia.md'), 'utf8');
    expect(reference).toContain('](../guia.md)');
    expect(reference).toContain('](../connector-api.openapi.yaml)');
    expect(reference).toContain('](./)');
    expect(reference).toContain('](./#volver-a-empezar)');
    const referenceHtml = readFileSync(join(sheets, 'referencia.html'), 'utf8');
    expect(referenceHtml).toContain('<h1>Google Sheets: referencia del puente</h1>');
    expect(referenceHtml).toContain('<a href="referencia.md">Markdown</a>');
    expect(referenceHtml).not.toContain('id="copiar"');
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
    const html = renderGuidePage('# Google Sheets', '0.1.0', { docsRoot: '../' });
    expect(html).toContain('href="guia.md"');
    expect(html).toContain('href="../connector-api.openapi.yaml"');
    expect(html).toContain('href="../llms.txt"');
    expect(html).toContain('href="../../../"');
  });

  it('con un archivo para copiar, el botón "Copiar el código", el link y su script', () => {
    const html = renderGuidePage('# Google Sheets', '0.1.0', {
      docsRoot: '../',
      copyFile: 'pos-sheets.gs',
    });
    expect(html).toContain('<button type="button" id="copiar" disabled>Copiar el código</button>');
    expect(html).toContain('<a href="pos-sheets.gs" download>pos-sheets.gs</a>');
    expect(html).toContain("fetch('pos-sheets.gs')");
  });

  it('sin archivo para copiar, ni botón ni script', () => {
    const html = renderGuidePage('# Guía para integradores', '0.1.0');
    expect(html).not.toContain('id="copiar"');
    expect(html).not.toContain('<script');
  });

  it('el encabezado enlaza el Markdown de la página (#221)', () => {
    const html = renderGuidePage('# Referencia', '0.1.0', { markdownFile: 'referencia.md' });
    expect(html).toContain('<a href="referencia.md">Markdown</a>');
  });

  it('los h2 y h3 llevan el id que les da GitHub, para el índice (#221)', () => {
    const html = renderGuidePage(
      '# Título\n\n## 1. Instalar el puente\n\n### (Opcional) El `secreto`, ¿sí?',
      '0.1.0',
    );
    expect(html).toContain('<h1>Título</h1>');
    expect(html).toContain('<h2 id="1-instalar-el-puente">1. Instalar el puente</h2>');
    expect(html).toContain(
      '<h3 id="opcional-el-secreto-sí">(Opcional) El <code>secreto</code>, ¿sí?</h3>',
    );
  });

  it('sin docsRoot, el encabezado es el de docs/', () => {
    const html = renderGuidePage('# Guía para integradores', '0.1.0');
    expect(html).toContain('href="connector-api.openapi.yaml"');
    expect(html).toContain('href="llms.txt"');
    expect(html).toContain('href="../../"');
  });
});
