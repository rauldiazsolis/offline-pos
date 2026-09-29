# Limpiar offline-pos después de separar el mini-erp (Etapa 2, #159) — plan de implementación

> **Para agentes:** se ejecuta **inline** con `superpowers:executing-plans`, tarea por tarea y con
> checkpoints (convención de offline-pos: nada de un subagente por tarea). Los pasos usan checkboxes
> (`- [ ]`).

**Objetivo:** offline-pos sin `mini-erp/` ni `.agents/`, con el `pnpm-lock.yaml` de la raíz sin el
importer viejo del mini-erp (cierra #153), las reglas al día (el mini-erp pasa a ser un backend
externo, en `rauldiazsolis/mini-erp`) y todo en verde.

**Arquitectura:** solo borrado, configuración y documentación; ni una línea de `src/` cambia de
comportamiento. Criterio de la documentación: **reglas al día, historia intacta** — los `AGENTS.md`
dicen cómo es hoy; `docs/historia.md` suma una entrada; los specs y planes viejos de
`docs/superpowers/` no se tocan.

**Stack:** git, `gh`, pnpm 10.33.0 (solo desde PowerShell), ESLint, Vitest, Vite, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-29-separar-mini-erp-design.md` (sección "Etapa 2"). Epic
#161, issue #159; cierra también #153.

## Restricciones globales

- Todo en español: commits, comentarios, issues, PR y documentos.
- **pnpm solo desde PowerShell** (en este Windows no anda desde Bash). `git` y `gh` desde Bash, con
  `-R rauldiazsolis/offline-pos`. Cuerpos de issues: `gh api -X PATCH
  repos/rauldiazsolis/offline-pos/issues/<n> -F body=@archivo` (`gh pr edit` e `gh issue view` fallan
  por la deprecación de Projects classic; para leer, `gh api .../issues/<n> --jq .body`).
- Commits con heredoc (`git commit -F - <<'EOF'`), terminados en
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. El PR termina en
  `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- Rama: la de este worktree, `claude/recursing-mccarthy-89ec5b`, desde `516aa28` (merge de #162).
- Verificación de cada commit: `pnpm lint; pnpm typecheck; pnpm test; pnpm build` en verde (y
  `pnpm test:e2e` al final). Flakes conocidos: #142 (`pnpm test`) y #155 (`demo-onboarding.spec.ts`):
  se vuelve a correr antes de investigar.
- Prettier: el repo no pasa `pnpm format:check` (#135). Los `AGENTS.md`, `docs/historia.md` y
  `docs/superpowers/` están en `.prettierignore` (prosa formateada a mano, líneas de ~100
  caracteres); solo se formatea con Prettier `eslint.config.js` y `vite.config.ts`.
- `.agents/` se borra entero: el usuario confirmó (2026-09-29) que también usa Antigravity IDE con
  offline-pos, pero que le alcanza el `AGENTS.md` de la raíz. Las reglas se escriben neutrales
  respecto del agente.
- La etiqueta `feature:mini-erp` de GitHub se borra (pedido del usuario al aprobar el plan: el
  mini-erp ya no tiene nada que hacer en offline-pos).
- Fuera de alcance: los `.gs` de Sheets (#138) y cualquier cambio en `rauldiazsolis/mini-erp`.

## Archivos

| Archivo | Cambio |
|---|---|
| `mini-erp/` (145 archivos) | Se borra |
| `.agents/rules/mini-erp.md` | Se borra (único archivo de `.agents/`, verificado) |
| `eslint.config.js:19` | Sale `'mini-erp/**'` de los ignores |
| `vite.config.ts:28` | Sale `'mini-erp/**'` del `exclude` de Vitest |
| `pnpm-lock.yaml` | Sale el importer `mini-erp:` (línea 91) y los paquetes que solo usaba él |
| `AGENTS.md` | Sección "POS y mini-erp", estructura, Connector API, "Estado del proyecto", "Issues abiertas" |
| `src/sync/AGENTS.md:184,212,223,230` | El mini-erp pasa a ser "un backend externo" o sale (lo histórico ya está en `docs/historia.md`) |
| `docs/historia.md` | Una entrada nueva después de "Publicación del MVP" |
| Este plan | Sección "Desvíos" al final, si los hay |

---

### Tarea 1: borrar `mini-erp/` y `.agents/`, y sus ignores

**Archivos:** `mini-erp/`, `.agents/`, `eslint.config.js`, `vite.config.ts`.

- [ ] **Paso 1: verificar qué se borra.**

```bash
git ls-files .agents          # esperado: solo .agents/rules/mini-erp.md
ls -a .agents .agents/rules   # nada sin versionar
git ls-files mini-erp | wc -l # esperado: 145
git status --short mini-erp   # esperado: vacío (nada local sin commitear)
```

Si `mini-erp/` tiene archivos sin versionar (un `node_modules`, un `.db` de desarrollo), se borran
igual: son locales y el repo nuevo es la fuente de verdad.

- [ ] **Paso 2: borrar.**

```bash
git rm -r -q mini-erp .agents
rm -rf mini-erp .agents   # restos sin versionar, si quedaron
```

- [ ] **Paso 3: sacar los ignores.** En `eslint.config.js`, borrar la línea `      'mini-erp/**',`
  (dentro de `ignores`, entre `'dev-orchestrator.mjs',` y el comentario del sitio publicado). En
  `vite.config.ts`, borrar la línea `      'mini-erp/**',` del `exclude` de `test` (entre
  `'demo-backend/**',` y `'.claude/**',`). El comentario de arriba del `exclude` no nombra al
  mini-erp, así que queda igual.

- [ ] **Paso 4: verificar** (PowerShell): `pnpm lint; pnpm typecheck; pnpm test; pnpm build`, todo
  en verde. Prettier sobre los dos archivos: `pnpm exec prettier --check eslint.config.js
  vite.config.ts`.

- [ ] **Paso 5: commit.**

```bash
git commit -F - <<'EOF'
chore: borrar mini-erp/ y .agents/ de offline-pos (#159)

El mini-erp vive en rauldiazsolis/mini-erp desde la Etapa 1 del epic #161
(rauldiazsolis/mini-erp#4). .agents/rules/mini-erp.md era el único archivo de
.agents/ y su contenido ya está en el AGENTS.md de ese repo. También salen sus
ignores de ESLint y de Vitest.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

### Tarea 2: lockfile sin el importer del mini-erp (#153)

**Archivos:** `pnpm-lock.yaml`.

- [ ] **Paso 1: regenerar** (PowerShell): `pnpm --version` (esperado `10.33.0`, el de
  `packageManager`), después `pnpm install` (sin `--frozen-lockfile`).

- [ ] **Paso 2: verificar que el diff solo quite.**

```bash
git diff --stat pnpm-lock.yaml                     # esperado: solo deleciones
git diff -U0 pnpm-lock.yaml | grep '^+[^+]' || echo "sin líneas agregadas"
git diff -U0 pnpm-lock.yaml | grep '^@@' | head    # el primer hunk empieza en el importer mini-erp:
grep -n '^  [a-z.-]*:$' pnpm-lock.yaml | head -3   # importers: solo '.' y 'demo-backend'
```

Criterio: ninguna línea agregada ni modificada; se va el bloque `mini-erp:` de `importers` y
paquetes enteros de `packages:` y `snapshots:`. Por cada paquete que se fue, pnpm ya garantiza que
ningún importer que queda lo usa; se confirma con una muestra (Tailwind, `@paralleldrive/cuid2`):
`grep -c 'tailwindcss\|cuid2' pnpm-lock.yaml` → `0`. **Si aparece cualquier línea agregada o
modificada** (por ejemplo, peers reescritos como en la Task 7 de #148), se frena y se consulta con el
usuario antes de commitear.

- [ ] **Paso 3: verificar** (PowerShell): `pnpm install --frozen-lockfile` (lo que corre el CI) y
  `pnpm lint; pnpm typecheck; pnpm test; pnpm build`.

- [ ] **Paso 4: commit.**

```bash
git add pnpm-lock.yaml
git commit -F - <<'EOF'
build: sacar el importer del mini-erp del lockfile de la raíz (#153)

pnpm install en la raíz, sin --frozen-lockfile: se van el importer mini-erp
(que había entrado en 993cf46 por un pnpm add corrido desde la raíz) y los
paquetes que solo usaba él. El diff solo borra líneas.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

### Tarea 3: reglas al día (`AGENTS.md` y `src/sync/AGENTS.md`)

**Archivos:** `AGENTS.md`, `src/sync/AGENTS.md`. Líneas de ~100 caracteres, a mano.

- [ ] **Paso 1: sección "POS y mini-erp: desarrollo separado"** (`AGENTS.md:84-93`). El título queda
  igual (lo citan otras secciones). El cuerpo entero se reemplaza por:

```markdown
El mini-erp (Express + SQLite multitenant) es un backend externo que implementa el Connector API: vive
en su propio repo, [`rauldiazsolis/mini-erp`](https://github.com/rauldiazsolis/mini-erp), con sus
propias reglas, desde el 2026-09-29 (epic #161). Un cambio de contrato en el POS se anuncia (qué rompe
en los backends) con un issue allá; nunca se adapta el mini-erp desde acá.
```

- [ ] **Paso 2: estructura de proyecto** (`AGENTS.md:135`): se borra la línea
  `mini-erp/          # backend propio, desarrollo separado (ver "POS y mini-erp")`.

- [ ] **Paso 3: Connector API.**
  - `AGENTS.md:267`: `Un backend 4.2 (Sheets, el mini-erp)` → `Un backend 4.2 (Sheets, o uno externo
    que todavía no se actualizó)`.
  - `AGENTS.md:275-276`: `El mini-erp no (ver "POS y mini-erp: desarrollo separado").` → `Los
    backends externos, como el mini-erp, no (ver "POS y mini-erp: desarrollo separado").`

- [ ] **Paso 4: "Estado del proyecto".**
  - Fila nueva en la tabla, al final:
    `| Epic #161, Etapas 1 y 2 | El mini-erp se muda a rauldiazsolis/mini-erp; offline-pos queda sin
    `mini-erp/` ni `.agents/` y con el lockfile limpio | rauldiazsolis/mini-erp#4, PR #162, PR #<N> |`
    (`<N>` se completa en la Tarea 5, con un commit aparte, en cuanto exista el PR).
  - "Siguiente" (`AGENTS.md:534`): `la demo pública, con el mini-erp, queda para después (#147,
    \`backlog\`)` → `la demo pública, con el mini-erp, queda para después (#147, \`backlog\`; se
    publica con rauldiazsolis/mini-erp#3)`.
  - "Siguiente" (`AGENTS.md:537`): `En paralelo, sin bloquear nada: separar el mini-erp (#153 se
    resuelve con eso), #135 y el brainstorming de #138.` → `En paralelo, sin bloquear nada: #135 y el
    brainstorming de #138.`

- [ ] **Paso 5: "Issues abiertas".**
  - "Transversal": sale `, #153 (lockfile de la raíz con entradas viejas de mini-erp)` (queda `#142
    (…) y #135 (…)`, con la conjunción ajustada).
  - "Otros": sale `Mini-erp, fuera del flujo del POS: #122, #144 (contrato 4.4.0 y el onboarding
    nuevo).` y se reemplaza por `Los del mini-erp están en su repo.`

- [ ] **Paso 6: `src/sync/AGENTS.md`.**
  - Línea 184: `Un backend 4.2 (Sheets, mini-erp)` → `Un backend 4.2 (como Sheets)`.
  - Líneas 211-213: `Sheets (congelado, #127; camino para retomarlo: #138) y el mini-erp (desarrollo
    separado) quedan en 4.2` → `Sheets (congelado, #127; camino para retomarlo: #138) y los backends
    externos que no se actualizaron quedan en 4.2`.
  - Líneas 223-224: sale la oración `(El mini-erp se adaptó a 4.2.0 dentro de esta etapa, antes de
    separar los dos desarrollos.)` (ya está en `docs/historia.md`, Etapa 6 de #94).
  - Líneas 229-231: `y el mini-erp (adaptado en esta etapa, antes de la separación) hablan 4.1.0` →
    la enumeración queda `el minibackend y el puente de Sheets (…) hablan 4.1.0`.

- [ ] **Paso 7: verificar.** `grep -rn -i 'mini-erp\|\.agents' --exclude-dir=node_modules
  --exclude-dir=.git --exclude-dir=.claude --exclude-dir=superpowers . | grep -v docs/historia.md`
  → solo las menciones nuevas de los pasos 1, 3 y 4 (y ninguna a `.agents`). Releer las dos
  secciones tocadas enteras para chequear que se lean bien.

- [ ] **Paso 8: commit.**

```bash
git add AGENTS.md src/sync/AGENTS.md
git commit -F - <<'EOF'
docs: el mini-erp como backend externo en las reglas (#159)

AGENTS.md: "POS y mini-erp" queda en cuatro líneas (repo propio, un cambio de
contrato se anuncia con un issue allá); salen mini-erp/ de la estructura, #153
y los issues transferidos de "Issues abiertas", y la separación de
"Siguiente". src/sync/AGENTS.md habla de backends externos.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

### Tarea 4: entrada en `docs/historia.md`

**Archivos:** `docs/historia.md` (después de la entrada "Publicación del MVP", antes de
"**Issues marcados `backlog` en GitHub**").

- [ ] **Paso 1: agregar la entrada.**

```markdown
- Separación del mini-erp (epic #161; spec
  `docs/superpowers/specs/2026-09-29-separar-mini-erp-design.md`, planes
  `docs/superpowers/plans/2026-09-29-separar-mini-erp.md` y
  `docs/superpowers/plans/2026-09-29-limpiar-offline-pos.md`): el mini-erp se mudó a su propio repo
  público, `rauldiazsolis/mini-erp`, con su historia (`git subtree split`, 37 commits), un
  `AGENTS.md` que fusiona `mini-erp/AGENTS.md` con `.agents/rules/mini-erp.md`, dependencias propias,
  una copia fijada del OpenAPI bajada de una carpeta publicada y CI propio (rauldiazsolis/mini-erp#4).
  Sus issues se transfirieron: #122, #144 y #160 son rauldiazsolis/mini-erp#1 a #3; #131 se cerró con
  la Etapa 1. En la Etapa 2 (#159) offline-pos borró `mini-erp/` y `.agents/` (el usuario también
  usa Antigravity IDE con offline-pos, pero le alcanza el `AGENTS.md` de la raíz), sacó sus ignores
  de ESLint y Vitest y regeneró el lockfile sin el importer viejo (#153). Desde entonces el mini-erp
  es un backend externo más: un cambio de contrato se anuncia con un issue en su repo.
```

- [ ] **Paso 2: commit.**

```bash
git add docs/historia.md
git commit -F - <<'EOF'
docs: la separación del mini-erp en la historia (#159)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

### Tarea 5: verificación final, revisión, PR e issues

- [ ] **Paso 1: suite completa** (PowerShell): `pnpm lint; pnpm typecheck; pnpm test; pnpm build;
  pnpm test:e2e`, todo en verde (flakes #142 y #155: se reintenta antes de investigar).

- [ ] **Paso 2: grep final** (el del paso 7 de la Tarea 3): solo las menciones nuevas.

- [ ] **Paso 3: desvíos.** Si hubo, se anotan en una sección "Desvíos aprobados durante la
  implementación" al final de este plan, con commit `docs: desvíos de la Etapa 2 en el plan (#159)`.

- [ ] **Paso 4: informe al usuario y revisión.** Informe con qué se hizo y la prueba manual (abajo);
  se espera su revisión y sus cambios pedidos **antes** de pushear y abrir el PR.

- [ ] **Paso 5: push y PR** (después de la revisión).

```bash
git push -u origin claude/recursing-mccarthy-89ec5b
gh pr create -R rauldiazsolis/offline-pos --base main --title "Etapa 2 del epic #161: limpiar offline-pos después de separar el mini-erp" --body-file <archivo>
```

  Cuerpo: resumen, verificación corrida, `Closes #159` y `Closes #153` (en líneas propias; "Cierra"
  no lo reconoce GitHub), y la línea de Claude Code. Con el número del PR, un commit
  `docs: número del PR de la Etapa 2 en AGENTS.md (#159)` completa `<N>` en la tabla de "Estado del
  proyecto" y se pushea. Merge con **merge commit** cuando el usuario lo apruebe.

- [ ] **Paso 6: después del merge.**
  - Verificar que #159 y #153 se cerraron (`gh api .../issues/159 --jq .state`); si no, cerrarlos
    con un comentario que apunte al PR. Comentario en #159 apuntando al PR.
  - Epic #161: tildar `- [ ] rauldiazsolis/offline-pos#159: Etapa 2…` con `— PR
    rauldiazsolis/offline-pos#<N>` al final.
  - #134: tildar la línea "Separar el mini-erp en su propio repo y publicarlo: epic …#161 …" con
    `— etapas en offline-pos hechas (PR rauldiazsolis/offline-pos#<N>); sigue en
    rauldiazsolis/mini-erp` al final, y sacar "Separar el mini-erp (su propia sesión, con sus
    reglas); " de la fila "En cualquier momento, en paralelo" de la tabla "Cómo seguir".
  - Borrar la etiqueta: `gh label delete feature:mini-erp -R rauldiazsolis/offline-pos --yes`
    (antes, `gh api "repos/rauldiazsolis/offline-pos/issues?labels=feature:mini-erp&state=all" --jq length`
    para saber cuántos issues cerrados la pierden; se anota en el informe).
  - Los cuerpos se editan bajándolos a un archivo del scratchpad y subiéndolos con `gh api -X PATCH`.

## Prueba manual (para el informe final)

No hay cambios de comportamiento: la prueba es de humo.

1. `git pull` en `main` y `pnpm install --frozen-lockfile`: termina sin errores ni cambios en el
   lockfile.
2. `pnpm dev`, abrir el POS: la venta y `/CONFIG` se ven igual que antes.
3. En el explorador del repo: ya no están `mini-erp/` ni `.agents/`.
4. Antigravity IDE abierto sobre offline-pos: sigue leyendo el `AGENTS.md` de la raíz (sin reglas de
   `.agents/`).

## Desvíos aprobados durante la implementación

- **Al aprobar el plan**: el usuario pidió borrar también la etiqueta `feature:mini-erp` de GitHub
  (sumado a la Tarea 5, paso 6).
- **Tarea 2**: `pnpm install` a secas sumaba 62 líneas: reusaba restos del mini-erp (`jiti`,
  `@noble/hashes`, `esbuild` y `rollup`, con sus binarios por plataforma) como peers opcionales del
  importer de la raíz; una resolución desde cero en un directorio aparte confirmó que la raíz no los
  necesita. Borrar a mano solo el bloque del importer tampoco alcanzaba (pnpm da el lock por al día y
  no poda los huérfanos). Lo que anduvo: sacar a mano el importer y esas entradas, y correr
  `pnpm dedupe`. Resultado verificado por contenido: ninguna línea que no estuviera en el lockfile
  anterior y los importers `.` y `demo-backend` idénticos (las 18 inserciones que muestra `git diff`
  son realineaciones).
- **Tarea 3**: los párrafos tocados de `AGENTS.md` y `src/sync/AGENTS.md` se reacomodaron enteros a
  ~100 caracteres por línea, así que el diff muestra más líneas que las del cambio.
