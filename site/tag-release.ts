import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { planReleaseTag } from './release-tag.ts';

/**
 * `pnpm release:tag`: crea el tag `vX.Y.Z` desde package.json y lo sube, lo que dispara la Action
 * Publicación (`docs/publicacion.md`). Antes verifica que estés en main, limpio e igual que
 * origin/main, y que el tag no exista.
 */
function git(...args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf-8' }).trim();
}

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8')) as {
  version?: unknown;
};
const packageVersion = typeof pkg.version === 'string' ? pkg.version : '';
const tag = `v${packageVersion}`;

console.log('Trayendo origin…');
git('fetch', '--quiet', '--tags', 'origin');

const plan = planReleaseTag({
  branch: git('rev-parse', '--abbrev-ref', 'HEAD'),
  dirty: git('status', '--porcelain') !== '',
  head: git('rev-parse', 'HEAD'),
  originMain: git('rev-parse', 'origin/main'),
  packageVersion,
  localTagExists: git('tag', '--list', tag) !== '',
  remoteTagExists: git('ls-remote', '--tags', 'origin', `refs/tags/${tag}`) !== '',
});

if (!plan.ok) {
  console.error(plan.error);
  process.exit(1);
}

git('tag', '-a', plan.tag, '-m', plan.tag);
execFileSync('git', ['push', 'origin', plan.tag], { stdio: 'inherit' });
console.log(
  `Tag ${plan.tag} creado y subido: la publicación arranca sola (GitHub → Actions → Publicación).`,
);
