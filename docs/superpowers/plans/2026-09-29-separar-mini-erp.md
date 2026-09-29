# Separar el mini-erp (Etapa 1, #158) — plan de implementación

> **Para agentes:** se ejecuta **inline** con `superpowers:executing-plans`, tarea por tarea y con
> checkpoints (convención de offline-pos: nada de un subagente por tarea). Los pasos usan checkboxes
> (`- [ ]`).

**Objetivo:** que `rauldiazsolis/mini-erp` exista como repo público, con la historia de
`mini-erp/`, reglas propias que Claude carga, dependencias propias, el contrato fijado desde lo
publicado y CI verde, y con los issues del mini-erp transferidos.

**Arquitectura:** `git subtree split` sobre `origin/main` de offline-pos → push al `main` del repo
nuevo (la única acción sin PR). Después, una rama en un clon **fuera** del árbol de offline-pos
(`C:\dev\mini-erp`), con commits chicos, y un PR con merge commit. offline-pos no cambia en esta etapa,
salvo el PR de docs con el spec y este plan.

**Stack:** git (`subtree`), `gh`, pnpm 10.33.0, Node 24 (local: v24.14.1), Vitest, Zod 3 (el del
mini-erp), GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-29-separar-mini-erp-design.md` (sección "Etapa 1"). Epic
#161, issue #158.

## Restricciones globales

- Todo en español: commits, comentarios, issues, PR y documentos.
- **pnpm solo desde PowerShell** (en este Windows no anda desde Bash). `git` y `gh` desde Bash.
- Commits con heredoc (`git commit -F - <<'EOF'`), terminados en
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. PR terminados en
  `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- Repo nuevo: `rauldiazsolis/mini-erp`, **público**. Clon de trabajo: `C:\dev\mini-erp` (fuera de
  `C:\dev\offline-pos`, a propósito). Rama: `claude/separar-de-offline-pos`.
- Contrato inicial: POS publicado `0.1.0` → contrato `4.4.0`, piso `4.0.0`. El mini-erp implementa
  `4.2.0`, y en esta etapa **no cambia** ni una línea de su comportamiento.
- No se actualiza TypeScript (sigue `~5.7.3`): es la Etapa 3 (#122).
- Versiones de las dependencias de lint, las de la raíz de offline-pos: `eslint ^10.10.0`,
  `@eslint/js ^10.0.1`, `typescript-eslint ^8.70.0`, `eslint-config-prettier ^10.1.8`.
- Verificación del repo nuevo en cada commit: `pnpm lint; pnpm typecheck; pnpm test` (y
  `pnpm build` si se toca config o cliente), todo en verde.
- La historia de offline-pos no se reescribe; en esta etapa no se borra nada de offline-pos (eso es la
  Etapa 2, #159).

## Archivos

Repo nuevo (`C:\dev\mini-erp`):

| Archivo | Qué | Tarea |
|---|---|---|
| `package.json` | dependencias de lint, `packageManager`, `engines`, script `contract:update` | 3, 4 |
| `pnpm-lock.yaml` | regenerado | 3, 4 |
| `tsconfig.json` | `include` suma `scripts/**/*` | 4 |
| `scripts/contract-source.ts` | parte pura: URL, `version.json`, `info.version` | 4 |
| `scripts/contract-update.ts` | el comando: red y disco | 4 |
| `test/contract-source.test.ts` | tests de la parte pura | 4 |
| `docs/connector-api.openapi.yaml` | copia byte a byte de la publicada | 4 |
| `contract.json` | procedencia de la copia | 4 |
| `AGENTS.md` | reescrito: reglas del repo | 5 |
| `CLAUDE.md` | `@AGENTS.md` | 5 |
| `.github/workflows/ci.yml` | CI | 6 |
| `README.md` | qué es y cómo levantarlo | 6 |

offline-pos: solo `docs/superpowers/specs/2026-09-29-separar-mini-erp-design.md` (ya commiteado) y
este plan.

---

### Tarea 1: split y creación del repo

**Archivos:** ninguno (rama temporal en offline-pos y repo nuevo en GitHub).

- [ ] **Paso 1: actualizar y hacer el split** (Bash, en el worktree de offline-pos)

```bash
git fetch origin
git subtree split --prefix=mini-erp -b mini-erp-split origin/main
```

Esperado: imprime el SHA del último commit del split.

- [ ] **Paso 2: verificar el split**

```bash
git rev-list --count mini-erp-split
git diff --stat mini-erp-split origin/main:mini-erp
git ls-tree -r --name-only mini-erp-split | grep -iE '\.sqlite|\.env|data/' || echo "sin datos"
git log -p mini-erp-split | grep -iE 'mpos_[a-z0-9]{8,}|BEGIN (RSA|OPENSSH)|password\s*[:=]\s*["'\''][^"'\'']{6,}' | head || true
```

Esperado: `37`; el `diff --stat` vacío; "sin datos"; el último grep sin líneas (o solo contraseñas
de tests evidentes, que se revisan a ojo antes de seguir). Si el conteo no da 37, parar y revisar
con `git log --oneline mini-erp-split` antes de publicar nada.

- [ ] **Paso 3: crear el repo y pushear**

```bash
gh repo create rauldiazsolis/mini-erp --public \
  --description "Backend multitenant (Express + SQLite) que implementa el Connector API de offline-pos"
git push https://github.com/rauldiazsolis/mini-erp.git mini-erp-split:main
git branch -D mini-erp-split
gh repo view rauldiazsolis/mini-erp --json isPrivate,defaultBranchRef --jq '.isPrivate, .defaultBranchRef.name'
```

Esperado: `false` y `main`.

- [ ] **Paso 4: checkpoint con el usuario** — mostrar el link del repo y el conteo de commits.

### Tarea 2: etiquetas y transferencia de issues

**Archivos:** ninguno (GitHub).

- [ ] **Paso 1: crear las etiquetas en el repo nuevo**

```bash
R=rauldiazsolis/mini-erp
gh label create "feature:contrato"    -R $R -c 1D76DB -d "Connector API: sync, holds, demo-sessions" --force
gh label create "feature:transversal" -R $R -c 5319E7 -d "Lo que cruza todo el repo" --force
gh label create "feature:publicacion" -R $R -c 0E8A16 -d "Deploy y hosting" --force
gh label create "backlog"             -R $R -c C2E0C6 -d "Se prioriza después de lo ya diseñado" --force
gh label list -R $R --json name --jq '.[].name'
```

(`documentation` y `bug` ya vienen por defecto en un repo nuevo; el `list` lo confirma.)

- [ ] **Paso 2: transferir y anotar los números nuevos**

```bash
for n in 122 144 160; do gh issue transfer $n rauldiazsolis/mini-erp -R rauldiazsolis/offline-pos; done
```

Esperado: cada línea imprime la URL nueva (`https://github.com/rauldiazsolis/mini-erp/issues/N`).
Anotar el mapeo: #122 → `mini-erp#A`, #144 → `mini-erp#B`, #160 → `mini-erp#C`. Se usan en las
Tareas 5 y 6.

- [ ] **Paso 3: reetiquetar**

```bash
R=rauldiazsolis/mini-erp
gh issue edit A -R $R --add-label feature:transversal --remove-label feature:mini-erp
gh issue edit B -R $R --add-label feature:contrato    --remove-label feature:mini-erp
gh issue edit C -R $R --add-label feature:publicacion --remove-label feature:mini-erp
gh issue list -R $R --json number,title,labels --jq '.[] | "\(.number) \(.title) \([.labels[].name]|join(","))"'
```

(`--remove-label` de una etiqueta que no se transfirió avisa y sigue; no es un error.)

- [ ] **Paso 4: actualizar el epic #161** con los números nuevos

Bajar el cuerpo, reemplazar `#122`, `#144` y `#160` en la lista de etapas y en "Issues" por
`rauldiazsolis/mini-erp#A`, `#B` y `#C` (GitHub igual redirige los viejos, pero así el link queda
directo), y subirlo:

```bash
S=<scratchpad>
gh issue view 161 -R rauldiazsolis/offline-pos --json body --jq .body > "$S/161.md"
# editar "$S/161.md" con Edit (reemplazos puntuales, no sed a ciegas)
gh api -X PATCH repos/rauldiazsolis/offline-pos/issues/161 -F body=@"$S/161.md" --jq .number
```

### Tarea 3: clon limpio y dependencias propias

**Archivos:** modificar `package.json` y `pnpm-lock.yaml` del repo nuevo.

- [ ] **Paso 1: clonar y crear la rama** (Bash)

```bash
git clone https://github.com/rauldiazsolis/mini-erp.git /c/dev/mini-erp
cd /c/dev/mini-erp && git checkout -b claude/separar-de-offline-pos
```

- [ ] **Paso 2: línea de base, que demuestra el hueco** (PowerShell, en `C:\dev\mini-erp`)

```powershell
pnpm install --frozen-lockfile; pnpm typecheck; pnpm test; pnpm lint
```

Esperado: `typecheck` y `test` en verde (157 tests o más) y **`lint` falla** porque no encuentra
`@eslint/js`, `typescript-eslint` o `eslint` (#122, punto 4). Si `install --frozen-lockfile` falla
porque el lockfile se generó dentro del workspace de offline-pos, correr `pnpm install` y tomarlo como
parte de este mismo commit. Si `typecheck` o `test` fallan con Node 24, **parar**: es el riesgo
"Node 22 → 24" del spec y se investiga (`superpowers:systematic-debugging`) antes de seguir.

- [ ] **Paso 3: sumar las dependencias**

```powershell
pnpm add -D eslint@^10.10.0 @eslint/js@^10.0.1 typescript-eslint@^8.70.0 eslint-config-prettier@^10.1.8
```

- [ ] **Paso 4: `packageManager` y `engines`** en `package.json`, después de `"type": "module",`:

```json
  "packageManager": "pnpm@10.33.0",
  "engines": {
    "node": ">=24"
  },
```

- [ ] **Paso 5: verificar desde cero**

```powershell
Remove-Item -Recurse -Force node_modules; pnpm install --frozen-lockfile; pnpm lint; pnpm typecheck; pnpm test; pnpm build
```

Esperado: todo en verde. Revisar el diff del lockfile: solo entran `eslint`, `@eslint/js`,
`typescript-eslint`, `eslint-config-prettier` y sus dependencias transitivas. Si `lint` encuentra
errores reales (y no de configuración), no se arreglan acá: se anotan en el issue de #122 y se
consulta con el usuario.

- [ ] **Paso 6: commit**

```bash
git add package.json pnpm-lock.yaml
git commit -F - <<'EOF'
build: dependencias de lint propias, pnpm 10.33.0 y Node 24

Fuera de offline-pos no hay un node_modules padre del que resolver eslint,
@eslint/js, typescript-eslint y eslint-config-prettier (#122, punto 4).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

### Tarea 4: contrato fijado (`pnpm contract:update`)

**Archivos:**
- Crear: `scripts/contract-source.ts`, `scripts/contract-update.ts`, `test/contract-source.test.ts`,
  `docs/connector-api.openapi.yaml` (generado), `contract.json` (generado).
- Modificar: `tsconfig.json` (`include`), `package.json` (script).

**Interfaces (produce):**
- `contractBaseUrl(posVersion: string): string` → `https://offline-pos.pages.dev/<v>/`; lanza si
  `posVersion` no es `x.y.z`.
- `parseVersionJson(raw: unknown, expectedPosVersion: string): PublishedVersion` con
  `PublishedVersion = { version: string; contract: string; minBackendContract: string }`; lanza si
  no valida o si `version !== expectedPosVersion`.
- `openApiInfoVersion(yaml: string): string | undefined` → la `version` del bloque `info:`.
- `contractJson(v: PublishedVersion): ContractJson` con
  `ContractJson = { posVersion; contract; minBackendContract; source }` (todos `string`).

- [ ] **Paso 1: `tsconfig.json`** — en `include`, sumar `"scripts/**/*"`:

```json
  "include": ["src/**/*", "test/**/*", "scripts/**/*", "vitest.config.ts", "vite.config.ts"]
```

- [ ] **Paso 2: el test que falla** — `test/contract-source.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import {
  contractBaseUrl,
  contractJson,
  openApiInfoVersion,
  parseVersionJson,
} from '../scripts/contract-source.ts';

describe('contractBaseUrl', () => {
  it('arma la carpeta publicada de una versión del POS', () => {
    expect(contractBaseUrl('0.1.0')).toBe('https://offline-pos.pages.dev/0.1.0/');
  });

  it.each(['v0.1.0', '0.1', '0.1.0-rc.1', '', '../0.1.0'])('rechaza %j', (bad) => {
    expect(() => contractBaseUrl(bad)).toThrow(/x\.y\.z/);
  });
});

describe('parseVersionJson', () => {
  const ok = { version: '0.1.0', contract: '4.4.0', minBackendContract: '4.0.0' };

  it('acepta el version.json publicado', () => {
    expect(parseVersionJson(ok, '0.1.0')).toEqual(ok);
  });

  it('rechaza un version.json de otra versión', () => {
    expect(() => parseVersionJson(ok, '0.2.0')).toThrow(/0\.1\.0.*0\.2\.0/);
  });

  it('rechaza un version.json sin contrato', () => {
    expect(() => parseVersionJson({ version: '0.1.0' }, '0.1.0')).toThrow(/version\.json/);
  });

  it('rechaza versiones que no son x.y.z', () => {
    expect(() => parseVersionJson({ ...ok, contract: '4.4' }, '0.1.0')).toThrow(/version\.json/);
  });
});

describe('openApiInfoVersion', () => {
  it('lee la versión con comillas simples', () => {
    const yaml = "openapi: 3.1.0\ninfo:\n  title: X\n  version: '4.4.0'\n  description: |\n    y\n";
    expect(openApiInfoVersion(yaml)).toBe('4.4.0');
  });

  it('lee la versión sin comillas y con comillas dobles', () => {
    expect(openApiInfoVersion('info:\n  version: 4.3.0\n')).toBe('4.3.0');
    expect(openApiInfoVersion('info:\n  version: "4.2.0"\n')).toBe('4.2.0');
  });

  it('ignora un version: fuera del bloque info', () => {
    const yaml = "info:\n  title: X\nservers:\n  version: '9.9.9'\n";
    expect(openApiInfoVersion(yaml)).toBeUndefined();
  });

  it('devuelve undefined sin bloque info', () => {
    expect(openApiInfoVersion('openapi: 3.1.0\n')).toBeUndefined();
  });

  it('tolera fines de línea CRLF', () => {
    expect(openApiInfoVersion("info:\r\n  version: '4.4.0'\r\n")).toBe('4.4.0');
  });
});

describe('contractJson', () => {
  it('guarda la procedencia de la copia', () => {
    expect(
      contractJson({ version: '0.1.0', contract: '4.4.0', minBackendContract: '4.0.0' }),
    ).toEqual({
      posVersion: '0.1.0',
      contract: '4.4.0',
      minBackendContract: '4.0.0',
      source: 'https://offline-pos.pages.dev/0.1.0/',
    });
  });
});
```

- [ ] **Paso 3: verificar que falla** (PowerShell)

```powershell
pnpm vitest run test/contract-source.test.ts
```

Esperado: FAIL, no se puede resolver `../scripts/contract-source.ts`.

- [ ] **Paso 4: la implementación pura** — `scripts/contract-source.ts`

```typescript
import { z } from 'zod';

/**
 * De dónde sale la copia del contrato: siempre de una carpeta publicada e inmutable del POS, nunca
 * de main de offline-pos. Es tooling (lo corre una persona a mano), así que lanza en vez de
 * devolver un Result.
 */
export const PUBLISHED_POS_ORIGIN = 'https://offline-pos.pages.dev';

const SEMVER = /^\d+\.\d+\.\d+$/;
const semver = z.string().regex(SEMVER);

const publishedVersionSchema = z.object({
  version: semver,
  contract: semver,
  minBackendContract: semver,
});

export type PublishedVersion = z.infer<typeof publishedVersionSchema>;

export type ContractJson = {
  posVersion: string;
  contract: string;
  minBackendContract: string;
  source: string;
};

export function contractBaseUrl(posVersion: string): string {
  if (!SEMVER.test(posVersion)) {
    throw new Error(`La versión del POS tiene que ser x.y.z (sin "v"): ${JSON.stringify(posVersion)}`);
  }
  return `${PUBLISHED_POS_ORIGIN}/${posVersion}/`;
}

export function parseVersionJson(raw: unknown, expectedPosVersion: string): PublishedVersion {
  const parsed = publishedVersionSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`version.json publicado inválido: ${issues}`);
  }
  if (parsed.data.version !== expectedPosVersion) {
    throw new Error(
      `version.json dice ${parsed.data.version} pero se pidió ${expectedPosVersion}`,
    );
  }
  return parsed.data;
}

/** La `version` del bloque `info:` de primer nivel, sin sumar un parser de YAML. */
export function openApiInfoVersion(yaml: string): string | undefined {
  const lines = yaml.split(/\r?\n/);
  const start = lines.indexOf('info:');
  if (start === -1) return undefined;
  for (const line of lines.slice(start + 1)) {
    if (line !== '' && !line.startsWith(' ')) return undefined;
    const match = /^ {2}version:\s*['"]?(\d+\.\d+\.\d+)['"]?\s*$/.exec(line);
    if (match) return match[1];
  }
  return undefined;
}

export function contractJson(v: PublishedVersion): ContractJson {
  return {
    posVersion: v.version,
    contract: v.contract,
    minBackendContract: v.minBackendContract,
    source: contractBaseUrl(v.version),
  };
}
```

- [ ] **Paso 5: verificar que pasa**

```powershell
pnpm vitest run test/contract-source.test.ts
```

Esperado: PASS (todos).

- [ ] **Paso 6: el comando** — `scripts/contract-update.ts`

```typescript
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  contractBaseUrl,
  contractJson,
  openApiInfoVersion,
  parseVersionJson,
} from './contract-source.ts';

/**
 * pnpm contract:update <versión del POS publicada>
 * Baja el OpenAPI de esa carpeta publicada y deja su procedencia en contract.json. No escribe nada
 * si algo no coincide.
 */
const root = resolve(import.meta.dirname, '..');
const openApiPath = resolve(root, 'docs/connector-api.openapi.yaml');
const contractJsonPath = resolve(root, 'contract.json');

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url);
  if (res.status !== 200) throw new Error(`${url} respondió ${String(res.status)}`);
  return res.text();
}

async function previousContract(): Promise<string> {
  try {
    const raw: unknown = JSON.parse(await readFile(contractJsonPath, 'utf8'));
    return typeof raw === 'object' && raw !== null && 'contract' in raw && typeof raw.contract === 'string'
      ? raw.contract
      : '(ninguno)';
  } catch {
    return '(ninguno)';
  }
}

const posVersion = process.argv[2] ?? '';
const base = contractBaseUrl(posVersion);
const published = parseVersionJson(JSON.parse(await fetchText(`${base}version.json`)), posVersion);
const yaml = await fetchText(`${base}docs/connector-api.openapi.yaml`);
const infoVersion = openApiInfoVersion(yaml);
if (infoVersion !== published.contract) {
  throw new Error(
    `El OpenAPI publicado dice ${String(infoVersion)} y version.json dice ${published.contract}`,
  );
}

const before = await previousContract();
await writeFile(openApiPath, yaml);
await writeFile(contractJsonPath, `${JSON.stringify(contractJson(published), null, 2)}\n`);
console.log(`Contrato: ${before} → ${published.contract} (POS ${published.version}, ${base})`);
```

Nota: `writeFile(openApiPath, yaml)` escribe el texto tal cual llegó (byte a byte, con los mismos
fines de línea). `docs/` todavía no existe: crear la carpeta antes de la primera corrida (Paso 8).

- [ ] **Paso 7: script en `package.json`**, después de `"lint:fix"`:

```json
    "contract:update": "node scripts/contract-update.ts"
```

- [ ] **Paso 8: bajar el contrato 0.1.0** (PowerShell)

```powershell
New-Item -ItemType Directory -Force docs | Out-Null; pnpm contract:update 0.1.0
```

Esperado: `Contrato: (ninguno) → 4.4.0 (POS 0.1.0, https://offline-pos.pages.dev/0.1.0/)`. Después
comprobar que es idéntico al publicado:

```bash
curl -s https://offline-pos.pages.dev/0.1.0/docs/connector-api.openapi.yaml | cmp - docs/connector-api.openapi.yaml && echo idéntico
cat contract.json
```

Y probar el camino de error: `pnpm contract:update 9.9.9` tiene que fallar con "respondió 404" sin
tocar ningún archivo (`git status` limpio salvo lo de este paso).

- [ ] **Paso 9: verificar todo**

```powershell
pnpm lint; pnpm typecheck; pnpm test
```

Si `lint` se queja de `scripts/` por reglas de `strictTypeChecked` (por ejemplo
`restrict-template-expressions`), corregir el código del script, no la config.

- [ ] **Paso 10: commit**

```bash
git add tsconfig.json package.json scripts test/contract-source.test.ts docs/connector-api.openapi.yaml contract.json
git commit -F - <<'EOF'
feat: contrato fijado desde la carpeta publicada del POS (0.1.0, 4.4.0)

pnpm contract:update <versión> baja el OpenAPI de https://offline-pos.pages.dev/<versión>/
y deja su procedencia en contract.json. El mini-erp sigue implementando 4.2.0.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

### Tarea 5: reglas del repo (`AGENTS.md` y `CLAUDE.md`)

**Archivos:** reescribir `AGENTS.md`; crear `CLAUDE.md`.

**Consume:** los números `mini-erp#A`, `#B`, `#C` de la Tarea 2.

- [ ] **Paso 1: `CLAUDE.md`**, con una sola línea y el salto final:

```
@AGENTS.md
```

- [ ] **Paso 2: reescribir `AGENTS.md`** con este contenido (reemplazando `#A`, `#B`, `#C` por los
números reales). Sale de fusionar el `AGENTS.md` actual con `.agents/rules/mini-erp.md` de offline-pos
(este último **no** viene en el split: está fuera de `mini-erp/`; se lee de offline-pos con
`git show origin/main:.agents/rules/mini-erp.md`). Lo único que se toma de ahí y no está en el
`AGENTS.md` es Hardwired/IoC:

````markdown
# AGENTS.md

Reglas para trabajar en este repo. Cada decisión nueva de arquitectura o de convención se anota acá
en el mismo trabajo que la toma. La historia de las fases está en [`PLAN.md`](./PLAN.md).

## Qué es esto

`mini-erp` es un backend multitenant (Express + SQLite) con un admin web (Preact) que implementa el
**Connector API** de [offline-pos](https://github.com/rauldiazsolis/offline-pos), un POS web
offline-first. Es **un backend más** de los que usan el POS: el POS no lo conoce ni tiene código para
él. Hasta el 2026-09-29 vivía en `mini-erp/` dentro de offline-pos (epic
rauldiazsolis/offline-pos#161); la historia de esa carpeta se conservó al mudarlo.

## Relación con offline-pos y el contrato

- El contrato lo define y lo publica offline-pos. **Acá nunca se cambia**: si el mini-erp necesita
  algo del contrato, se abre un issue en offline-pos.
- **Contrato publicado**: la copia en `docs/connector-api.openapi.yaml`, con su procedencia en
  `contract.json`. Hoy: POS `0.1.0`, contrato **4.4.0**, piso **4.0.0**.
- **Contrato implementado**: **4.2.0** (4.1.0 suma `Sale.ticket`, el número del ticket en su día;
  4.2.0 suma `CustomerPayment.receipt` y define `balance` como el saldo de cualquier cliente, tenga o
  no crédito). Es compatible con el POS por el piso. Lo que falta de 4.4.0 (capacidades,
  `/demo-sessions`, `notices`, la vuelta del onboarding) es #B.
- **Actualizar la copia**: `pnpm contract:update <versión del POS>`. Siempre de una carpeta publicada
  (`https://offline-pos.pages.dev/<versión>/`), nunca de `main` de offline-pos. El diff del OpenAPI
  muestra qué cambió; implementarlo es trabajo aparte, con su issue.
- La guía para integradores está publicada junto al OpenAPI (`/<versión>/docs/`).

## Cómo trabajamos

Las mismas convenciones que offline-pos.

- **Idioma**: todo en español (respuestas, specs, planes, commits, comentarios e issues), aunque el
  pedido o las instrucciones de un skill vengan en inglés.
- **Plan antes de codear**: un trabajo de varios pasos arranca con brainstorming y un plan que el
  usuario revisa y aprueba. El plan se ejecuta **inline** (`superpowers:executing-plans`, tarea por
  tarea y con checkpoints), no con un subagente por tarea. Specs y planes en `docs/superpowers/`.
- **Informe final con prueba manual**: al terminar, un informe con instrucciones paso a paso de qué
  hacer en la UI (o con `curl`) y qué se debería ver. La prueba la hace el usuario.
- **Revisión sin cambios**: en una revisión no se toca código salvo pedido explícito en el momento; las
  observaciones se anotan como issues. Contestar una pregunta de alcance no es la luz verde para
  implementar: esa es aparte y explícita.
- **Ramas y PR**: cada etapa en su rama (`claude/<tema>`), con commits chicos verificados
  localmente. El PR se abre al terminar la etapa, después de la revisión, y se mergea con **merge
  commit**, nunca squash.
- **CI**: después de un push no se espera ni se lee el CI; alcanzan los chequeos locales. Si el CI
  falla, el usuario avisa.
- **Issues en GitHub**, nunca en un markdown del repo. "Anotá: …" crea un issue y se sigue con lo que
  se estaba haciendo. Etiquetas `feature:<slug>` (`feature:contrato`, `feature:publicacion`,
  `feature:transversal`, y las que hagan falta) y `backlog` (se prioriza después de lo ya diseñado).
  El cuerpo alcanza para arrancar una sesión nueva sin más contexto.
- **Claude mantiene los issues**: en el cuerpo del PR va "Closes #N" (GitHub no reconoce "Cierra");
  después del merge se verifica que se haya cerrado.
- **Dependencias**: con opciones equivalentes, la que tenga menos dependencias propias
  (`npm view <paquete> dependencies`).
- **Commits**: mensajes convencionales en español (`feat:`, `fix:`, `docs:`, `build:`, `ci:`,
  `test:`, `refactor:`).

## Verificación

```bash
pnpm lint && pnpm typecheck && pnpm test
```

Y `pnpm build` si se toca el cliente o la config de Vite. Todo en verde antes de cada commit. En
Windows, pnpm se corre desde PowerShell.

## Convenciones de TypeScript y Node

- **TypeScript estricto**: `any` prohibido; `unknown` solo en fronteras externas (payloads HTTP) y
  validado con Zod en la línea siguiente.
- **Node 24 sin compilar** (strip de tipos): `pnpm dev` y `pnpm start` corren `.ts` directo.
  - Sin "parameter properties" en constructores (`constructor(private db: DatabaseSync)` no se puede
    stripear); la propiedad se declara en el cuerpo de la clase:
    ```typescript
    class MiServicio {
      private db: DatabaseSync;
      constructor(db: DatabaseSync) {
        this.db = db;
      }
    }
    ```
  - Imports relativos con extensión (`.ts`, `.tsx`): `allowImportingTsExtensions` + `noEmit`.
  - `--watch-path=src/server` en desarrollo: un `--watch` global reinicia en bucle con cada escritura
    en SQLite (`data/`) o en `dist/`.
- **UI (Preact)**: tipar con `JSX.IntrinsicElements['button']`, `JSX.TargetedEvent`, etc.; nada de
  tipos laxos.
- Endurecer esto (TypeScript nuevo, `erasableSyntaxOnly`, `exactOptionalPropertyTypes`, todos los
  eventos del push con Zod) es #A.

## Arquitectura

- **DB por tenant** con `DatabaseSync` de `node:sqlite`:
  - `data/system.sqlite`: usuarios, tenants, membresías, roles globales (`root`, `support`, `user`) y
    API keys de terminales.
  - `data/tenants/<tenantId>.sqlite`: catálogo, stock por sucursal, clientes, cuentas corrientes,
    ventas y lotes de sincronización.
- **Auth propia**: sin servicios externos; `node:crypto` (`scryptSync`, comparación timing-safe). El
  primer usuario registrado queda `root` (cerrarlo antes de publicar es parte de #C). `root` y
  `support` pueden impersonar cualquier tenant.
- **IoC con Hardwired 1.6.2** (versión exacta): servicios por request con
  `req.tenantScope.use(serviceDef)`; nunca `new Service()` para un servicio de tenant. La base del
  tenant es `unbound` (`tenantDbDef`): resolverla desde el contenedor raíz falla a propósito, para
  que no haya fugas entre tenants. Detalle en `src/server/di/container.ts` y la Fase 5 de `PLAN.md`.
- **Connector API** bajo `/connector`:
  - Push validado con Zod al aplicarse: un evento inválido queda como `issue` del lote, con su
    `eventId`, sin tumbar el resto. Hoy se valida solo `sale` (con `passthrough`); los otros tipos,
    en #A.
  - **El backend nunca rechaza de forma síncrona el contenido de un lote**: responde `200` y reporta
    las inconsistencias como `issues` en el pull.
  - `X-POS-Contract-Version`: `409 IncompatibleContract` si el major difiere (salvo en `/info`).
- **Admin** en `src/client/`: Preact + `@preact/signals` + Tailwind CSS v4 (`@tailwindcss/vite`,
  como middleware de Express).
  - Estado solo con signals (`signal`, `computed`, stores por dominio en `src/client/state/`). **Sin
    hooks de React** (`useState`, `useEffect`, etc.).
  - Temas claro, oscuro y del sistema: `src/client/state/theme-state.ts`, variante class-based
    `@custom-variant dark (&:where(.dark, .dark *))` en `index.css`, script anti-FOUC en
    `index.html` y `ThemeToggle.tsx` en `Header.tsx`, `AuthView.tsx` y `SettingsView.tsx`.
  - Componentes propios estilo shadcn, sin librerías de UI externas innecesarias.

## Datos semilla y fidelidad al contrato

- Catálogos iniciales, fixtures y presets de rubro en `src/server/seeds/`, nunca dentro de servicios
  o controladores.
- Historial simulado siempre con fechas relativas a `new Date()` (`now - N días`), nunca fijas, para
  que los dashboards muestren datos vigentes.
- No asumir DTOs ni respuestas de sync: verificar siempre `docs/connector-api.openapi.yaml`.

## Estado

Fases 1 a 7 hechas (núcleo multitenant, API de gestión, admin, grillas, IoC, sync en vivo con el POS,
temas): detalle en `PLAN.md`. Sigue:

1. #A: estrictez de TypeScript y Zod.
2. #B: contrato 4.4.0 con `/demo-sessions` y demos aisladas.
3. #C: publicarlo como backend de la demo pública del POS.
````

- [ ] **Paso 3: chequear que no quedó nada viejo**

```bash
grep -nE "rama \`mini-erp\`|nunca ejecuta|ignore-workspace|Node 22|v4\.0\.0|territorial" AGENTS.md || echo limpio
```

Esperado: `limpio`.

- [ ] **Paso 4: verificar y commitear** (`pnpm lint; pnpm typecheck; pnpm test` en PowerShell no
deberían cambiar, pero se corren igual)

```bash
git add AGENTS.md CLAUDE.md
git commit -F - <<'EOF'
docs: AGENTS.md del repo propio y CLAUDE.md que lo importa

Fusiona las reglas del mini-erp con .agents/rules/mini-erp.md de offline-pos y adopta
su forma de trabajo; sin límite territorial ni rama mini-erp. Resuelve
rauldiazsolis/offline-pos#131.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

### Tarea 6: CI y README

**Archivos:** crear `.github/workflows/ci.yml` y `README.md`.

- [ ] **Paso 1: `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7

      - uses: pnpm/action-setup@v5

      - uses: actions/setup-node@v7
        with:
          node-version: '24'
          cache: 'pnpm'

      - run: pnpm install --frozen-lockfile

      - run: pnpm lint

      - run: pnpm typecheck

      - run: pnpm test

      - run: pnpm build
```

- [ ] **Paso 2: `README.md`** (reemplazando `#A`, `#B`, `#C`)

````markdown
# mini-erp

Backend multitenant (Express + SQLite) con un admin web (Preact) que implementa el **Connector API**
de [offline-pos](https://github.com/rauldiazsolis/offline-pos): catálogo, stock por sucursal,
clientes, cuentas corrientes y sincronización con las terminales del POS.

## Levantarlo

Requiere Node 24 y pnpm 10.

```bash
pnpm install
pnpm dev
```

El servidor queda en `http://localhost:4100`: el admin en `/` y el Connector API en `/connector`. El
primer usuario que se registra queda como `root`. Los datos van a `data/` (SQLite, un archivo por
comercio).

## Contrato

- Implementa el Connector API **4.2.0**; el POS acepta backends desde **4.0.0**.
- La copia del contrato publicado está en [`docs/connector-api.openapi.yaml`](./docs/connector-api.openapi.yaml),
  con su procedencia en [`contract.json`](./contract.json). Se actualiza con
  `pnpm contract:update <versión del POS>`.
- Lo que falta de 4.4.0 está en #B.

## Desarrollo

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

Las reglas del repo están en [`AGENTS.md`](./AGENTS.md); la historia de las fases, en
[`PLAN.md`](./PLAN.md).
````

El puerto (`4100`, o `PORT`) sale de `src/server/server.ts`. Antes de escribir "admin en `/`",
confirmarlo con `pnpm dev` (el servidor también expone `/api`); si difiere, el README dice lo que
haga el código.

- [ ] **Paso 3: commit**

```bash
git add .github/workflows/ci.yml README.md
git commit -F - <<'EOF'
ci: lint, typecheck, test y build con Node 24; README

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

### Tarea 7: revisión, PR y cierre

- [ ] **Paso 1: verificación final desde un clon limpio** (PowerShell), para descartar que algo
dependa del `node_modules` local:

```powershell
$t = Join-Path $env:TEMP "mini-erp-check"; Remove-Item -Recurse -Force $t -ErrorAction SilentlyContinue
git clone --branch claude/separar-de-offline-pos C:\dev\mini-erp $t; Set-Location $t
pnpm install --frozen-lockfile; pnpm lint; pnpm typecheck; pnpm test; pnpm build
```

Esperado: todo en verde. Después, borrar `$t`.

- [ ] **Paso 2: informe al usuario con prueba manual** (se detiene acá hasta su OK):
  1. Abrir `https://github.com/rauldiazsolis/mini-erp`: README a la vista y la historia con los 37
     commits más los de la rama.
  2. En `C:\dev\mini-erp`: `pnpm dev`, abrir `http://localhost:4100`, registrarse y entrar al admin.
  3. En el admin, crear una API key de terminal (Configuración → Terminales POS) y
     `curl -H "Authorization: Bearer <key>" http://localhost:4100/connector/info` → `contractVersion`
     `4.2.0` (`/info` pide la key: todo `/connector` pasa por `requirePosAuth`).
  4. Abrir una sesión de Claude Code en `C:\dev\mini-erp` y preguntarle "¿qué reglas rigen este
     repo?": tiene que contestar desde `AGENTS.md`, sin que se lo pidan.
  5. `pnpm contract:update 0.1.0` no cambia nada (`git status` limpio).

- [ ] **Paso 3: push y PR** (después del OK)

```bash
cd /c/dev/mini-erp && git push -u origin claude/separar-de-offline-pos
gh pr create -R rauldiazsolis/mini-erp --base main --head claude/separar-de-offline-pos \
  --title "Separar el mini-erp de offline-pos" --body-file <scratchpad>/pr-mini-erp.md
```

Cuerpo (`pr-mini-erp.md`):

```markdown
Etapa 1 del epic rauldiazsolis/offline-pos#161: el mini-erp en su propio repo.

- Dependencias de lint propias, pnpm 10.33.0 y Node 24 (sin node_modules padre).
- Contrato fijado desde la carpeta publicada del POS: `pnpm contract:update`, hoy 0.1.0 → 4.4.0
  (implementado: 4.2.0).
- `AGENTS.md` propio (fusión con `.agents/rules/mini-erp.md`, forma de trabajo de offline-pos) y
  `CLAUDE.md` que lo importa.
- CI (lint, typecheck, test, build) y README.

Closes rauldiazsolis/offline-pos#158
Closes rauldiazsolis/offline-pos#131

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

- [ ] **Paso 4: merge con merge commit** (cuando el usuario lo apruebe) y CI de `main`

```bash
gh pr merge <N> -R rauldiazsolis/mini-erp --merge
gh run list -R rauldiazsolis/mini-erp --branch main --limit 1
```

Esta vez el CI **sí** se mira (es el primero del repo y la Etapa 2 depende de él), pero con una
sola consulta, sin quedarse esperando: si todavía corre, se le avisa al usuario y se vuelve a mirar
cuando lo pida. La Etapa 2 no arranca sin ese verde.

- [ ] **Paso 5: verificar cierres y tildar el epic**

```bash
gh issue view 158 -R rauldiazsolis/offline-pos --json state --jq .state
gh issue view 131 -R rauldiazsolis/offline-pos --json state --jq .state
```

Si alguno sigue `OPEN` (el cierre entre repos no se aplicó), cerrarlo con
`gh issue close <n> -R rauldiazsolis/offline-pos -c "Resuelto en rauldiazsolis/mini-erp#<PR>."`.
Tildar #158 en el epic #161 ("— rauldiazsolis/mini-erp#<PR>").

- [ ] **Paso 6: PR de docs en offline-pos** (esta rama: spec y plan)

```bash
cd /c/dev/offline-pos/.claude/worktrees/mini-erp-separate-repo-5a8aac
git push -u origin claude/mini-erp-separate-repo-5a8aac
gh pr create -R rauldiazsolis/offline-pos --base main --title "docs: spec y plan de la separación del mini-erp (#161)" \
  --body "Spec del epic #161 y plan de su Etapa 1 (#158, ya hecha en rauldiazsolis/mini-erp#<PR>). Solo docs. Parte de #161.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

Merge con merge commit cuando el usuario lo apruebe. Con eso, la Etapa 2 (#159) arranca en una
sesión nueva desde `origin/main`.

## Desvíos aprobados durante la implementación

- **Tarea 1**: `gh repo view` no tiene el campo `visibility`; la verificación usa `isPrivate`
  (corregido arriba). Al revisar la historia apareció `DEV_POS_API_KEY` en `src/server/db/dev-seed.ts`:
  una key de desarrollo, no un secreto, así que el repo se publicó igual. El problema es que el seed
  corre en cada arranque; quedó anotado en rauldiazsolis/mini-erp#3 como requisito antes de publicar.
- **Tarea 2**: la transferencia dio #122 → rauldiazsolis/mini-erp#1, #144 → #2, #160 → #3. GitHub
  reescribió solo las referencias del epic #161.
- **Tarea 3**: pnpm guardó los specifiers resueltos (`eslint ^10.11.0`, `typescript-eslint ^8.71.0`).
  El lockfile solo sumó líneas. Con Node 24 no se rompió nada (173 tests).
- **Tarea 5**: `ThemeToggle` también se usa en `MerchantOnboardingView.tsx` y, en configuración, en
  `AppearanceSection.tsx`; `AGENTS.md` lo dice así.
- **Tarea 6**: el README no dice "el primer usuario que se registra queda como `root`": el seed de
  desarrollo registra antes un admin con email y contraseña fijos, que queda `root`. El README
  describe los datos de desarrollo sin copiar las credenciales, y el riesgo (más grave que la key)
  se sumó a rauldiazsolis/mini-erp#3. El link a #2 va completo porque en un README GitHub no linkea
  `#N`.
- **Agregado a pedido del usuario**: `.gitattributes` con `* text=auto eol=lf` como quinto commit del
  PR. Todo el repo ya estaba con LF, así que no hubo renormalización.
- **Resultado**: rauldiazsolis/mini-erp#4, mergeado con merge commit (`1350f94`); cerró #158 y #131.
