// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

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
 * Lo que no puede aparecer en lo publicado del puente: issues (`\(#\d`, `#\d{2,}\b`, `, #\d` — el
 * `\b` deja pasar un color CSS como `#2563eb`, y ninguno confunde `'#,##0.00'`) ni archivos o
 * documentos internos del repo.
 */
const INTERNAL =
  /\(#\d|#\d{2,}\b|, #\d|superpowers|AGENTS\.md|pos-web-diseno|historia\.md|demo-backend|RNF-\d/;

describe('el puente de Google Sheets publicado (#180)', () => {
  it.each(['bridge.gs', 'columnas.gs'])('%s no cita issues ni archivos internos', (file) => {
    expect(read(`../src/connectors/google-sheets/${file}`)).not.toMatch(INTERNAL);
  });

  const SOURCES = '../../src/connectors/google-sheets/';
  const guide = read('../docs/integradores/google-sheets.md');

  it('la guía del puente enlaza los dos .gs y no cita nada interno fuera de esos links', () => {
    expect(guide.startsWith('# Google Sheets: el puente de Apps Script')).toBe(true);
    expect(guide).toContain(`](${SOURCES}bridge.gs)`);
    expect(guide).toContain(`](${SOURCES}columnas.gs)`);
    expect(guide.replaceAll(SOURCES, '')).not.toMatch(INTERNAL);
    expect(guide.replaceAll(SOURCES, '')).not.toContain('src/');
  });

  it('la guía del puente dice la versión del contrato que habla bridge.gs', () => {
    const bridge = read('../src/connectors/google-sheets/bridge.gs');
    const version = /var CONTRACT_VERSION = '([\d.]+)'/.exec(bridge)?.[1];
    expect(version).toBeDefined();
    expect(guide).toContain(`contrato **${version ?? ''}**`);
  });

  it('la guía para integradores y llms.txt enlazan al puente', () => {
    expect(read('../docs/integradores/guia.md')).toContain('](google-sheets.md)');
    const llms = read('../docs/integradores/llms.txt');
    expect(llms).toContain('](google-sheets.md)');
  });
});
