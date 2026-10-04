// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { planReleaseTag } from './release-tag.ts';

const READY = {
  branch: 'main',
  dirty: false,
  head: 'abc123',
  originMain: 'abc123',
  packageVersion: '0.4.0',
  localTagExists: false,
  remoteTagExists: false,
};

function errorOf(result: ReturnType<typeof planReleaseTag>): string {
  return result.ok ? '' : result.error;
}

describe('pnpm release:tag', () => {
  it('con main limpio y al día, crea el tag de package.json', () => {
    expect(planReleaseTag(READY)).toEqual({ ok: true, tag: 'v0.4.0' });
  });

  it('frena fuera de main', () => {
    expect(errorOf(planReleaseTag({ ...READY, branch: 'claude/algo' }))).toMatch(
      /claude\/algo.*main/,
    );
  });

  it('frena con cambios sin commitear', () => {
    expect(errorOf(planReleaseTag({ ...READY, dirty: true }))).toContain('cambios sin commitear');
  });

  it('frena si main no está igual que origin/main', () => {
    expect(errorOf(planReleaseTag({ ...READY, originMain: 'def456' }))).toContain('git pull');
  });

  it.each(['', '0.4', '0.4.0-rc.1'])('frena con una versión inválida en package.json (%j)', (v) => {
    expect(errorOf(planReleaseTag({ ...READY, packageVersion: v }))).toContain('X.Y.Z');
  });

  it('frena si el tag ya existe, en GitHub o en la copia local, y dice qué hacer', () => {
    const remote = errorOf(planReleaseTag({ ...READY, remoteTagExists: true }));
    expect(remote).toMatch(/v0\.4\.0 ya existe en GitHub/);
    expect(remote).toContain('pnpm version');
    expect(errorOf(planReleaseTag({ ...READY, localTagExists: true }))).toMatch(
      /v0\.4\.0 ya existe en tu copia local/,
    );
  });
});
