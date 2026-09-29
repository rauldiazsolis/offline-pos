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
