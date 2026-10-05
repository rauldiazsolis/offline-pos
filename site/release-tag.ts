/** Lo que necesita `planReleaseTag`: el estado del repo, leído por `site/tag-release.ts`. */
export type RepoState = {
  branch: string;
  dirty: boolean;
  head: string;
  originMain: string;
  packageVersion: string;
  localTagExists: boolean;
  remoteTagExists: boolean;
};

export type ReleaseTagPlan = { ok: true; tag: string } | { ok: false; error: string };

const SEMVER = /^\d+\.\d+\.\d+$/;
const BUMP_HINT =
  'subila en un PR (pnpm version minor|patch --no-git-tag-version) y, después del merge, volvé a correr esto';

/**
 * `pnpm release:tag`, como en el mini-erp: el tag sale de package.json y solo desde un `main`
 * limpio, igual que `origin/main`, con un tag que todavía no existe. Pura.
 */
export function planReleaseTag(state: RepoState): ReleaseTagPlan {
  if (state.branch !== 'main') {
    return {
      ok: false,
      error: `Estás en ${state.branch}: el tag se crea desde main (git switch main && git pull).`,
    };
  }
  if (state.dirty) {
    return {
      ok: false,
      error: 'Hay cambios sin commitear: el tag tiene que salir de main tal cual está en GitHub.',
    };
  }
  if (state.head !== state.originMain) {
    return {
      ok: false,
      error:
        'main no está igual que origin/main: corré git pull (o revisá si hay commits sin subir).',
    };
  }
  if (!SEMVER.test(state.packageVersion)) {
    return {
      ok: false,
      error: `package.json tiene una versión inválida (${JSON.stringify(state.packageVersion)}): tiene que ser X.Y.Z.`,
    };
  }
  const tag = `v${state.packageVersion}`;
  if (state.localTagExists || state.remoteTagExists) {
    const where = state.remoteTagExists ? 'en GitHub' : 'en tu copia local';
    return {
      ok: false,
      error: `El tag ${tag} ya existe ${where}. Para publicar otra versión, ${BUMP_HINT}.`,
    };
  }
  return { ok: true, tag };
}
