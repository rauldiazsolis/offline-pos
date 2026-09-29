# Separar el mini-erp a su propio repo y publicarlo

Fecha: 2026-09-29
Estado: diseño aprobado; plan de la Etapa 1 en `docs/superpowers/plans/2026-09-29-separar-mini-erp.md`.
Issues: epic #161; etapas #158 (separar), #159 (limpiar offline-pos), #122 (estrictez), #144
(contrato 4.4.0), #160 (publicar). Relacionados: #131 (se cierra en la Etapa 1), #147 y #153 (se
cierran en las Etapas 5 y 2), #134 (su línea "En paralelo" apunta al epic). Fuera de alcance: los
`.gs` de Google Sheets (#138).

Autorización del usuario para este epic: tocar `mini-erp/` y el resto de offline-pos. Para todo lo
demás sigue valiendo "POS y mini-erp: desarrollo separado" de `AGENTS.md`.

## Contexto

`mini-erp/` es un backend propio (Express + `node:sqlite`, DB por tenant, admin en Preact) que
implementa el Connector API. Desde el 2026-09-28 se desarrolla por separado del POS, pero sigue
viviendo en el repo de offline-pos, y eso trae fricción:

- Claude no carga sus reglas (#131): el repo tiene `CLAUDE.md` en la raíz, así que
  `mini-erp/AGENTS.md` no se lee solo, y `.agents/rules/mini-erp.md` no se lee nunca.
- Resuelve `eslint`, `typescript-eslint`, `@eslint/js` y `eslint-config-prettier` del `node_modules`
  de la raíz sin declararlos (#122, punto 4).
- El `pnpm-lock.yaml` de la raíz arrastra un importer `mini-erp` viejo (#153).
- Sus reglas contradicen las del repo: "el agente nunca commitea", "todo en la rama `mini-erp`",
  "prohibido tocar fuera de `mini-erp/`".

Estado de partida (en `origin/main` = `b28ac8f`): 37 commits tocan `mini-erp/`, todos del usuario;
ningún `.sqlite` commiteado (lo ignora `mini-erp/.gitignore`) y ninguna API key `mpos_…` en los diffs.
Fuera de `mini-erp/` lo mencionan `eslint.config.js` y `vite.config.ts` (exclusiones),
`pnpm-lock.yaml`, `.agents/rules/mini-erp.md`, `AGENTS.md`, `src/sync/AGENTS.md`, `docs/historia.md`
y specs/planes viejos. El mini-erp implementa el contrato **4.2.0**; no lee el OpenAPI en ningún lado
(el contrato vive como texto en sus reglas y en el código). El POS publicado `0.1.0` declara contrato
**4.4.0** con piso 4.0.0 (`https://offline-pos.pages.dev/0.1.0/version.json`), así que el mini-erp ya
es compatible.

## Decisiones

Tomadas en el brainstorming del 2026-09-29:

1. **Repo `rauldiazsolis/mini-erp`, público.** Mismo dueño y el nombre de la carpeta actual: no hay
   que renombrar nada. Público como offline-pos: sirve de ejemplo para integradores y Actions no
   tiene límite de minutos.
2. **Historia conservada con `git subtree split`** (viene con git; `filter-repo` pediría instalar
   Python). Los 37 commits pasan con las rutas en la raíz (`mini-erp/src` → `src`).
3. **Contrato: copia fijada desde lo publicado.** El repo guarda `docs/connector-api.openapi.yaml`
   bajado de una carpeta **inmutable** de `https://offline-pos.pages.dev/<versión>/docs/`, nunca de
   `main` de offline-pos (que puede tener cambios sin publicar). La procedencia queda en
   `contract.json`. Los agentes lo leen sin red y el diff muestra qué cambió al subir de versión.
4. **Reglas de offline-pos.** Un `AGENTS.md` en la raíz del repo nuevo que fusiona
   `mini-erp/AGENTS.md` y `.agents/rules/mini-erp.md`, sin límite territorial, sin rama `mini-erp` y
   sin "el agente nunca commitea", con el proceso de offline-pos ("Cómo trabajamos"). `CLAUDE.md` =
   `@AGENTS.md`. `.agents/` desaparece (no se usa otro agente con el mini-erp).
5. **Issues**: se transfieren al repo nuevo #122, #144 y #160; #131 se cierra en offline-pos con la
   Etapa 1 (lo resuelve el `AGENTS.md` de raíz); #147 y #153 quedan en offline-pos (son del POS).
6. **Limpieza de offline-pos: reglas al día, historia intacta.** `AGENTS.md` y `src/sync/AGENTS.md`
   se reescriben; `docs/historia.md` suma una entrada; los specs y planes viejos no se tocan.
7. **Orden: #144 antes de publicar.** Se publica una sola vez, ya útil para `/versions`.
8. **Hosting: se decide en la Etapa 5.** La idea es algo gratis por un tiempo y después Amazon. Las
   opciones relevadas están en #160; la restricción es un proceso Node siempre corriendo con disco
   persistente (Cloudflare Pages/Workers no sirve sin reescribirlo).

## Etapas

| # | Dónde | Etapa | Issue |
|---|---|---|---|
| 1 | repo nuevo | Separar: split, reglas, dependencias propias, contrato fijado, CI, issues | #158 |
| 2 | offline-pos | Limpiar: borrar `mini-erp/` y `.agents/`, lockfile, reglas al día | #159 |
| 3 | mini-erp | Estrictez de TypeScript y Zod | #122 |
| 4 | mini-erp | Contrato 4.4.0 con `/demo-sessions` y demos aisladas | #144 |
| 5 | los dos | Publicar: hosting, alta cerrada, deploy, fila en `site/backends.json` | #160 |

**La Etapa 2 arranca solo con la Etapa 1 mergeada** y el CI del repo nuevo en verde: offline-pos no
borra nada hasta que el mini-erp exista completo en otro lado. Las Etapas 3 a 5 viven en el repo
nuevo (salvo la fila de `/versions`, que es un PR de offline-pos) y se planifican cada una en su
sesión con las reglas de ese repo. Este spec detalla la Etapa 1 y deja la 2 lista para planificar;
de la 3 a la 5, el detalle está en sus issues.

## Etapa 1: separar (#158)

### 1.1 Split y creación del repo

Desde este worktree, sobre `origin/main`:

```bash
git subtree split --prefix=mini-erp -b mini-erp-split origin/main
gh repo create rauldiazsolis/mini-erp --public \
  --description "Backend multitenant (Express + SQLite) que implementa el Connector API de offline-pos"
git push https://github.com/rauldiazsolis/mini-erp.git mini-erp-split:main
git branch -D mini-erp-split
```

Verificación antes del push: `git diff --stat mini-erp-split origin/main:mini-erp` vacío (mismo
árbol) y `git rev-list --count mini-erp-split` igual a 37. Crear el repo es la única acción sin PR:
el `main` inicial es exactamente lo que ya estaba en offline-pos.

Inmediatamente después se crean las etiquetas y se transfieren los issues (1.5), así el
`AGENTS.md` y el README del repo nuevo ya citan los números definitivos.

Después, el repo se clona en `C:\dev\mini-erp`, **fuera** del árbol de offline-pos. No es un detalle:
ahí no hay un `node_modules` padre, así que cualquier dependencia prestada falla, que es justo lo que
esta etapa tiene que detectar.

### 1.2 Rama y commits en el repo nuevo

Rama `claude/separar-de-offline-pos`, con commits chicos y verificados:

1. **Dependencias propias** (`build:`). `devDependencies`: `eslint`, `@eslint/js`,
   `typescript-eslint` y `eslint-config-prettier`, en las mismas versiones que la raíz de
   offline-pos. `packageManager: "pnpm@10.33.0"` y `engines.node: ">=24"`, igual que offline-pos. El
   lockfile se regenera. Actualizar TypeScript **no** entra: es la Etapa 3 (#122).
   `typescript-eslint` 8 acepta el TypeScript 5.7 del mini-erp. Verificación desde un clon limpio:
   `pnpm install --frozen-lockfile && pnpm lint && pnpm typecheck && pnpm test && pnpm build`.
2. **Reglas** (`docs:`). `AGENTS.md` en la raíz; estructura en 1.3. `CLAUDE.md` con una sola línea,
   `@AGENTS.md`. `PLAN.md` queda como está: es la historia de las fases del mini-erp, y `AGENTS.md` lo
   referencia.
3. **Contrato fijado** (`feat:`). Detalle en 1.4.
4. **CI** (`ci:`). `.github/workflows/ci.yml` como el de offline-pos: en `push` a `main` y en
   `pull_request`, con `actions/checkout@v7`, `pnpm/action-setup@v5` (toma la versión de
   `packageManager`), `actions/setup-node@v7` con Node 24 y caché de pnpm, y después
   `pnpm install --frozen-lockfile`, `lint`, `typecheck`, `test` y `build`. Sin e2e: el mini-erp no
   tiene.
5. **README** (`docs:`). Qué es (un backend del Connector API de offline-pos), cómo levantarlo
   (`pnpm install`, `pnpm dev`, puerto 4100), qué contrato implementa (4.2.0, con piso del POS 4.0.0)
   y dónde está el contrato (`docs/`, `contract.json`).

Cada commit pasa `pnpm lint && pnpm typecheck && pnpm test` (y `pnpm build` si toca el cliente o la
config). Node 24 corre `.ts` sin flags; si algún test o script dependía de un comportamiento de Node
22, se ve en el primer commit.

### 1.3 `AGENTS.md` del repo nuevo

En español, como offline-pos. Secciones:

1. **Qué es esto**: backend multitenant que implementa el Connector API de
   [offline-pos](https://github.com/rauldiazsolis/offline-pos); es **un backend más**, el POS no lo
   conoce.
2. **Relación con offline-pos**: el contrato lo define y lo publica offline-pos; acá nunca se cambia.
   Si el mini-erp necesita algo del contrato, se abre un issue en offline-pos. Contrato **publicado**
   (la copia de `docs/`) frente a **implementado** (hoy 4.2.0; #144 cierra la diferencia). Cómo
   actualizar la copia (1.4).
3. **Cómo trabajamos**: el de offline-pos adaptado. Idioma; plan antes de codear, ejecutado inline;
   informe final con prueba manual; revisión sin cambios; ramas por etapa con commits verificados y
   PR con merge commit; no esperar el CI; issues en GitHub con etiquetas `feature:<slug>` y
   `backlog`; Claude mantiene los issues ("Closes #N"); dependencias con menos dependencias propias.
   Sale "el agente nunca commitea".
4. **Stack y convenciones técnicas**: la sección 4 del `AGENTS.md` actual, con Node 24 en vez de 22
   (sigue valiendo la regla de strip-only: sin parameter properties, imports con extensión) y
   `--watch-path`. Sale `--ignore-workspace`: ya no hay workspace padre.
5. **Arquitectura del producto**: la sección 5 actual (multitenant, auth, frontend admin, temas), más
   Hardwired e IoC del archivo de `.agents/rules`, que hoy solo está ahí.
6. **Datos semilla y fidelidad de contrato**: la sección 6 actual, con la referencia al OpenAPI en
   `docs/connector-api.openapi.yaml`.
7. **Verificación**: `pnpm lint && pnpm typecheck && pnpm test`, y `pnpm build` si se toca el
   cliente.
8. **Estado e issues abiertas**: fases 1 a 7 hechas (detalle en `PLAN.md`); siguen #122, #144 y #160
   con sus números nuevos del repo.

Salen: el límite territorial, la rama `mini-erp`, la excepción de lectura de `src/` de la Fase 5 (el
POS ya no está al lado: la referencia es el contrato) y las menciones a "Connector API v4.0.0" (hay
una sola versión, la de la sección 2).

### 1.4 El contrato fijado

Archivos:

- `docs/connector-api.openapi.yaml`: copia **byte a byte** de la publicada, sin editar.
- `contract.json`:
  ```json
  {
    "posVersion": "0.1.0",
    "contract": "4.4.0",
    "minBackendContract": "4.0.0",
    "source": "https://offline-pos.pages.dev/0.1.0/"
  }
  ```
- `scripts/contract-update.ts`: `pnpm contract:update <versión del POS>`. Node 24 lo corre sin
  compilar (`node scripts/contract-update.ts`).

El script:

1. Valida que el argumento tenga forma `x.y.z` y arma
   `https://offline-pos.pages.dev/<versión>/`.
2. Baja `version.json` y lo valida con Zod (`{ version, contract, minBackendContract }`, los tres
   `x.y.z`, y `version` igual al argumento).
3. Baja `docs/connector-api.openapi.yaml` y verifica que su `info.version` sea el `contract` de
   `version.json` (con una búsqueda de la línea, sin sumar un parser de YAML).
4. Escribe los dos archivos y muestra el cambio (`contract` anterior → nuevo).

Cualquier falla (HTTP que no sea 200, Zod o una versión que no coincide) corta con un mensaje y sin
escribir nada. Es tooling, no dominio: puede lanzar, igual que `site/` en offline-pos. La parte
pura (armar la URL, validar `version.json`, extraer `info.version`) va en
`scripts/contract-source.ts`, con tests en `test/contract-source.test.ts`; la parte con red y disco no
se testea (es un comando a mano). `tsconfig.json` suma `scripts/**/*` al `include`.

Siempre de una carpeta publicada: `main` de offline-pos puede tener un contrato a medio hacer, y una
carpeta publicada nunca cambia.

### 1.5 Issues

En el repo nuevo, antes de transferir (una transferencia solo conserva las etiquetas que ya existen
en el destino): `feature:contrato`, `feature:transversal`, `feature:publicacion`, `backlog`,
`documentation` y `bug`. Después:

```bash
gh issue transfer 122 rauldiazsolis/mini-erp -R rauldiazsolis/offline-pos
gh issue transfer 144 rauldiazsolis/mini-erp -R rauldiazsolis/offline-pos
gh issue transfer 160 rauldiazsolis/mini-erp -R rauldiazsolis/offline-pos
```

Reetiquetado: #122 → `feature:transversal`; #144 → `feature:contrato`; #160 →
`feature:publicacion`. `feature:mini-erp` no significa nada en su propio repo. GitHub deja una
redirección desde los números viejos. Al transferir, se actualizan los números en el epic #161 (como
`rauldiazsolis/mini-erp#N`, que es lo que GitHub linkea entre repos).

La transferencia va **al principio de la etapa**, apenas existe el repo (1.1): así el `AGENTS.md` y el
README nacen con los números definitivos. Que los issues vivan unas horas en un repo todavía sin CI
no molesta a nadie.

### 1.6 Cierre

- PR en `rauldiazsolis/mini-erp` desde `claude/separar-de-offline-pos`, con
  "Closes rauldiazsolis/offline-pos#158" y "Closes rauldiazsolis/offline-pos#131" (GitHub cierra
  issues de otro repo si el autor tiene permiso de escritura en los dos). Merge commit.
- Después del merge: CI verde en `main` (esta vez sí se mira, porque es el primero de un repo nuevo y
  la Etapa 2 depende de eso); se verifica que #158 y #131 se hayan cerrado (si no, se cierran a mano
  con un comentario que apunta al PR) y se tilda el epic #161.
- En offline-pos: PR de esta rama (`claude/mini-erp-separate-repo-5a8aac`) con este spec y el plan,
  solo docs, "Parte de #161" (no cierra nada). Con eso mergeado, la Etapa 2 arranca desde `main`.

## Etapa 2: limpiar offline-pos (#159)

Se planifica en su sesión; lo decidido:

- Borrar `mini-erp/` y `.agents/` (verificar antes que `.agents/rules/mini-erp.md` sea lo único).
- Sacar `'mini-erp/**'` de `eslint.config.js` y `vite.config.ts`.
- `pnpm install` en la raíz y commitear el lockfile, verificando que el diff solo quite el importer
  `mini-erp` y paquetes que nadie más usa (cierra #153).
- `AGENTS.md` de la raíz: "POS y mini-erp: desarrollo separado" queda en dos o tres líneas (backend
  externo en `rauldiazsolis/mini-erp`; un cambio de contrato se anuncia con un issue allá y nunca se
  adapta desde acá). También se actualizan la estructura de proyecto, "Estado del proyecto" e
  "Issues abiertas", y las menciones de "Connector API" pasan a hablar de un backend externo.
- `src/sync/AGENTS.md`: igual. `docs/historia.md`: una entrada con la mudanza.
- Los specs y planes viejos no se tocan (ya están en `.prettierignore`).
- Verificación: `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm test:e2e`, y un
  `grep -r mini-erp` fuera de `docs/superpowers/` y `docs/historia.md` que solo encuentre lo nuevo.
- PR con "Closes #159" y "Closes #153"; se tilda la línea del epic y la de #134.

## Riesgos

- **`git subtree split` en Windows**: con 37 commits es rápido. Si falla, el plan B es
  `git filter-repo` desde un clon aparte (pide instalar Python).
- **Node 22 → 24 en el mini-erp**: `node:sqlite` y el strip de tipos son estables en 24. Si algo se
  rompe, aparece en el primer commit de la rama, antes de tocar las reglas.
- **pnpm 10 fuera del workspace**: el `pnpm-lock.yaml` actual de `mini-erp/` se generó con
  `--ignore-workspace`; en el repo nuevo se regenera sin ese flag. El diff del lockfile se revisa
  para confirmar que solo cambian las dependencias de lint.
- **Un repo público expone la historia**: revisado; sin secretos. Se vuelve a revisar sobre el split
  antes del push.

## Tests

- `test/contract-source.test.ts`: URL a partir de la versión (`0.1.0` → la carpeta; `v0.1.0` o `0.1`
  se rechazan), `version.json` válido e inválido, `version` que no coincide con el argumento, y
  extracción de `info.version` de un YAML de ejemplo (presente, ausente, con comillas).
- El resto de la etapa se verifica con la suite existente del mini-erp (lint, typecheck, test y
  build) desde un clon limpio y en el CI.
