// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  cellFor,
  renderRootLlms,
  renderVersionsPage,
  sameIgnoringGeneratedAt,
  type KnownBackend,
} from './versions-page.ts';

const V010 = { version: '0.1.0', contract: '4.4.0', minBackendContract: '4.0.0' };
const V020 = { version: '0.2.0', contract: '4.5.0', minBackendContract: '4.1.0' };

const backend = (contract: string, notes?: string): KnownBackend => ({
  entry: { name: 'Demo <local>', url: 'http://localhost:4000', ...(notes ? { notes } : {}) },
  facts: { contract, capabilities: ['demo-sessions'], checkedAt: '2026-09-29T12:00:00.000Z' },
});

describe('cellFor (#148)', () => {
  it('compatible: el link de demo a la carpeta, con el backend codificado', () => {
    expect(cellFor(V010, backend('4.4.0'))).toEqual({
      kind: 'demo',
      href: '../0.1.0/?demo=true&backend=http%3A%2F%2Flocalhost%3A4000',
    });
  });

  it('incompatible por major: un backend 5.0.0 deja atrás a los POS 4.x', () => {
    expect(cellFor(V010, backend('5.0.0'))).toEqual({
      kind: 'incompatible',
      text: 'Incompatible: el backend habla 5.0.0; este POS acepta 4.x desde 4.0.0',
    });
  });

  it('incompatible por piso', () => {
    expect(cellFor(V020, backend('4.0.0')).kind).toBe('incompatible');
  });
});

describe('renderVersionsPage', () => {
  const html = renderVersionsPage(
    [V020, V010],
    [backend('4.4.0', '<b>ojo</b>')],
    '2026-09-29T12:00:00.000Z',
  );

  it('una fila por versión, la más nueva primero, con docs y zip', () => {
    expect(html.indexOf('0.2.0')).toBeLessThan(html.indexOf('0.1.0'));
    expect(html).toContain('href="../0.1.0/docs/"');
    expect(html).toContain('href="../0.1.0.zip"');
    expect(html).toContain('Abrir demo');
  });

  it('escapa lo que viene de la lista', () => {
    expect(html).toContain('Demo &lt;local&gt;');
    expect(html).toContain('&lt;b&gt;ojo&lt;/b&gt;');
    expect(html).not.toContain('<b>ojo</b>');
  });

  it('dos generaciones que solo difieren en la fecha son iguales', () => {
    const other = renderVersionsPage(
      [V020, V010],
      [backend('4.4.0', '<b>ojo</b>')],
      '2026-09-30T12:00:00.000Z',
    );
    expect(other).not.toBe(html);
    expect(sameIgnoringGeneratedAt(html, other)).toBe(true);
    expect(
      sameIgnoringGeneratedAt(html, renderVersionsPage([V010], [], '2026-09-29T12:00:00.000Z')),
    ).toBe(false);
  });
});

describe('renderRootLlms', () => {
  it('apunta a las docs de la versión más nueva y lista todas', () => {
    const llms = renderRootLlms([V020, V010]);
    expect(llms).toContain('[Guía para integradores (0.2.0)](0.2.0/docs/guia.md)');
    expect(llms).toContain('- [0.1.0](0.1.0/docs/llms.txt): contrato 4.4.0');
  });
});
