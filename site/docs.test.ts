// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { APPS_SCRIPT_FILES } from '../src/connectors/google-sheets/apps-script-files.ts';
import { headingSlug } from './guide-page.ts';

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('docs publicadas para integradores (#148)', () => {
  it('el OpenAPI no manda a un integrador a issues, specs ni archivos internos', () => {
    const openapi = read('../docs/connector-api.openapi.yaml');
    expect(openapi).not.toMatch(/#\d+/);
    expect(openapi).not.toMatch(/superpowers|AGENTS\.md|pos-web-diseno|historia\.md/);
  });

  it('la guía y llms.txt existen y enlazan al OpenAPI', () => {
    const guide = read('../docs/integradores/guia.md');
    expect(guide.startsWith('# Guía para integradores')).toBe(true);
    expect(guide).toContain('../connector-api.openapi.yaml');
    expect(read('../docs/integradores/llms.txt')).toContain('../connector-api.openapi.yaml');
  });
});

/**
 * Lo que no puede aparecer en lo publicado del puente: issues (`(#1)`, `(#1,`, `#\d{2,}\b`, `, #\d`
 * — el `\b` deja pasar un color CSS como `#2563eb`, ninguno confunde `'#,##0.00'` y un ancla del
 * índice como `(#1-instalar…)` no es un issue) ni archivos o documentos internos del repo.
 */
const INTERNAL =
  /\(#\d+[),]|#\d{2,}\b|, #\d|superpowers|AGENTS\.md|pos-web-diseno|historia\.md|demo-backend|RNF-\d/;

describe('el puente de Google Sheets publicado (#180, #219)', () => {
  it.each(APPS_SCRIPT_FILES)('%s no cita issues ni archivos internos', (file) => {
    expect(read(`../src/connectors/google-sheets/${file}`)).not.toMatch(INTERNAL);
  });

  const SOURCES = '../../src/connectors/google-sheets/';
  const guide = read('../docs/integradores/google-sheets.md');
  const reference = read('../docs/integradores/google-sheets-referencia.md');

  it.each([
    ['el setup', guide, '# Google Sheets: conectar el POS a una planilla'],
    ['la referencia', reference, '# Google Sheets: referencia del puente'],
  ])('%s enlaza pos-sheets.gs y no cita nada interno fuera de ese link', (_, page, title) => {
    expect(page.startsWith(title)).toBe(true);
    expect(page).toContain(`](${SOURCES})`);
    expect(page.replaceAll(SOURCES, '')).not.toMatch(INTERNAL);
    expect(page.replaceAll(SOURCES, '')).not.toContain('src/');
  });

  it('el setup empieza por el índice, con un link a cada sección (#221)', () => {
    const index = guide.slice(
      guide.indexOf('## '),
      guide.indexOf('\n## ', guide.indexOf('## ') + 1),
    );
    const links = [...index.matchAll(/\]\(#([^)]+)\)/g)].map((match) => match[1] ?? '');
    const sections = [...guide.matchAll(/^## (.+)$/gm)].map((match) => headingSlug(match[1] ?? ''));
    expect(links.length).toBeGreaterThanOrEqual(5);
    expect(sections.slice(1, links.length + 1)).toEqual(links);
  });

  it('cada imagen del setup existe', () => {
    const images = [...guide.matchAll(/!\[[^\]]+\]\(([^)]+)\)/g)].map((match) => match[1] ?? '');
    expect(images.length).toBeGreaterThan(0);
    for (const image of images) {
      expect(existsSync(new URL(`../docs/integradores/${image}`, import.meta.url)), image).toBe(
        true,
      );
    }
  });

  it('el setup y la referencia se enlazan entre sí', () => {
    expect(guide).toContain('](google-sheets-referencia.md)');
    expect(reference).toContain('](google-sheets.md)');
  });

  it('la referencia dice la versión del contrato que habla bridge.gs', () => {
    const bridge = read('../src/connectors/google-sheets/bridge.gs');
    const version = /var CONTRACT_VERSION = '([\d.]+)'/.exec(bridge)?.[1];
    expect(version).toBeDefined();
    expect(reference).toContain(`contrato **${version ?? ''}**`);
  });

  it('la guía para integradores y llms.txt enlazan al puente', () => {
    const integradores = read('../docs/integradores/guia.md');
    expect(integradores).toContain('](google-sheets.md)');
    expect(integradores).toContain('](google-sheets-referencia.md)');
    const llms = read('../docs/integradores/llms.txt');
    expect(llms).toContain('](google-sheets.md)');
    expect(llms).toContain('](google-sheets-referencia.md)');
    expect(llms).toContain(`](${SOURCES})`);
  });
});
