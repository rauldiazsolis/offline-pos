// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  actionFor,
  renderHomePage,
  renderRootLlms,
  sameIgnoringGeneratedAt,
  type KnownBackend,
} from './home-page.ts';

const V4 = { channel: 'v4', version: '0.3.0', contract: '4.5.0', minBackendContract: '4.0.0' };
const V4_ALTO = { ...V4, minBackendContract: '4.3.0' };

const backend = (contract: string, notes?: string): KnownBackend => ({
  entry: { name: 'Demo <local>', url: 'http://localhost:4000', ...(notes ? { notes } : {}) },
  facts: { contract, capabilities: ['demo-sessions'], checkedAt: '2026-10-03T12:00:00.000Z' },
});

describe('actionFor (#54)', () => {
  it('compatible: demo en el canal de su major, con el backend codificado', () => {
    expect(actionFor(backend('4.4.0'), [V4])).toEqual({
      kind: 'demo',
      href: 'v4/?demo=true&backend=http%3A%2F%2Flocalhost%3A4000',
    });
  });

  it('sin canal para su major', () => {
    expect(actionFor(backend('5.0.0'), [V4])).toEqual({
      kind: 'incompatible',
      text: 'Incompatible: no hay POS para el contrato 5.x',
    });
  });

  it('canal con un piso más alto', () => {
    expect(actionFor(backend('4.1.0'), [V4_ALTO])).toEqual({
      kind: 'incompatible',
      text: 'Incompatible: el backend habla 4.1.0; el POS de /v4/ acepta 4.x desde 4.3.0',
    });
  });
});

describe('renderHomePage', () => {
  const html = renderHomePage([V4], [backend('4.4.0', '<b>ojo</b>')], '2026-10-03T12:00:00.000Z');

  it('una fila por backend con su demo, y las docs del canal y los tags para integradores', () => {
    expect(html).toContain('href="v4/?demo=true&amp;backend=http%3A%2F%2Flocalhost%3A4000"');
    expect(html).toContain('Abrir demo');
    expect(html).toContain('href="v4/docs/"');
    // Afuera del sitio: en una pestaña nueva.
    expect(html).toContain(
      'href="https://github.com/rauldiazsolis/offline-pos/tags" target="_blank" rel="noopener"',
    );
    expect(html).not.toContain('.zip');
    expect(html).not.toContain('../');
  });

  it('escapa lo que viene de la lista', () => {
    expect(html).toContain('Demo &lt;local&gt;');
    expect(html).not.toContain('<b>ojo</b>');
  });

  it('dos generaciones que solo difieren en la fecha son iguales', () => {
    const other = renderHomePage(
      [V4],
      [backend('4.4.0', '<b>ojo</b>')],
      '2026-10-04T12:00:00.000Z',
    );
    expect(sameIgnoringGeneratedAt(html, other)).toBe(true);
    expect(
      sameIgnoringGeneratedAt(html, renderHomePage([V4], [], '2026-10-03T12:00:00.000Z')),
    ).toBe(false);
  });
});

describe('renderRootLlms', () => {
  it('apunta a las docs del canal más nuevo y lista los canales', () => {
    const llms = renderRootLlms([V4]);
    expect(llms).toContain('[Guía para integradores (/v4/, POS 0.3.0)](v4/docs/guia.md)');
    expect(llms).toContain('- [/v4/](v4/docs/llms.txt): contrato 4.5.0');
  });
});
