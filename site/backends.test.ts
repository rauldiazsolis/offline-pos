// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { loadBackends, parseBackends, selectBackends } from './backends.ts';

describe('backends conocidos (#148)', () => {
  it('la lista del repo es válida y arranca con el demo-backend local', () => {
    const backends = loadBackends();
    expect(backends[0]).toMatchObject({ url: 'http://localhost:4000', local: 'demo-backend' });
  });

  it('acepta https y http a localhost', () => {
    expect(
      parseBackends([
        { name: 'A', url: 'https://erp.example.com' },
        { name: 'B', url: 'http://127.0.0.1:4000', notes: 'x' },
      ]),
    ).toHaveLength(2);
  });

  it('rechaza http fuera de localhost, un local desconocido y la lista vacía', () => {
    expect(() => parseBackends([{ name: 'A', url: 'http://erp.example.com' }])).toThrow(/https/);
    expect(() =>
      parseBackends([{ name: 'A', url: 'http://localhost:4000', local: 'otro' }]),
    ).toThrow();
    expect(() => parseBackends([])).toThrow();
  });

  it('onlyLocal se queda con los backends locales: el e2e no depende de uno publicado (#147)', () => {
    const backends = parseBackends([
      { name: 'A', url: 'http://localhost:4000', local: 'demo-backend' },
      { name: 'B', url: 'https://erp.example.com' },
    ]);
    expect(selectBackends(backends, { onlyLocal: true }).map(({ name }) => name)).toEqual(['A']);
    expect(selectBackends(backends, { onlyLocal: false })).toEqual(backends);
  });
});
