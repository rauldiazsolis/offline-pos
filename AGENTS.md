# AGENTS.md

Guía de convenciones para trabajar en este repo. El diseño completo vive en
[`pos-web-diseno-arquitectura.md`](./pos-web-diseno-arquitectura.md) — este archivo es un resumen
operativo para no tener que releerlo entero en cada sesión; ante cualquier duda o contradicción,
el documento de diseño manda. Acá van las reglas vigentes; cómo se llegó a cada una (bugs
encontrados, decisiones reabiertas) está en [`docs/historia.md`](./docs/historia.md), que no hace
falta leer para trabajar.

## Cómo están organizadas estas instrucciones

Las reglas del POS están en cascada (#130): este archivo tiene lo transversal y todo lo necesario
para **planificar** una etapa; cada carpeta de `src/` (y `e2e/`) tiene su propio `AGENTS.md` con el
detalle de implementación (nombres de funciones, signals, mecánica). Cada regla vive en **un solo**
archivo: los demás la referencian, nunca la copian. Un agente carga el `AGENTS.md` de una carpeta
recién cuando lee un archivo de ahí, así que **antes de planificar o tocar un tema, leé el archivo
que indica el índice**, aunque el código que vas a tocar esté en otra carpeta. Cada carpeta tiene
además un `CLAUDE.md` de una línea (`@AGENTS.md`) para que Claude Code los cargue igual (ver #130).

| Tema | Dónde está el detalle |
|---|---|
| Outbox: identidad de eventos y del dispositivo, push y pull por lotes, reaplicación, limpieza a 7 días, cadencias, foto completa, log de sync y `/DIAGNOSTICO` | [`src/sync/AGENTS.md`](./src/sync/AGENTS.md) (también rige su código en `domain/` y `storage/`) |
| Cuenta corriente: la reserva de crédito síncrona | [`src/sync/AGENTS.md`](./src/sync/AGENTS.md) |
| Contrato: qué trajo cada versión (v3, 4.0.0 a 4.4.0), estado del backend, capacidades y avisos del backend, puerto `Connector`, config en `localStorage` | [`src/sync/AGENTS.md`](./src/sync/AGENTS.md) |
| Onboarding de demo: link de demo, `POST /demo-sessions`, `wipe_key`, vuelta con `#connect`, excepción de borrado | [`src/sync/AGENTS.md`](./src/sync/AGENTS.md); marca DEMO, `/ALTA` y el wizard precargado en [`src/ui/AGENTS.md`](./src/ui/AGENTS.md) |
| Ciclo de vida de la conexión: aplicar, sin sync con `/CONFIG` abierto | [`src/sync/AGENTS.md`](./src/sync/AGENTS.md); el wizard en [`src/ui/AGENTS.md`](./src/ui/AGENTS.md) |
| Conectores: REST, Google Sheets (puente, fingerprint, `ensureColumns`), registro, comandos por conector y `/DEMO_RESET` | [`src/connectors/AGENTS.md`](./src/connectors/AGENTS.md) |
| Venta: cantidades y redondeo, tickets en 0 o negativos, anulación de ventas y de cobranzas | [`src/domain/AGENTS.md`](./src/domain/AGENTS.md); Cobro y advertencias en [`src/ui/AGENTS.md`](./src/ui/AGENTS.md) |
| Caja: saldo de efectivo, conceptos, numeración de tickets | [`src/domain/AGENTS.md`](./src/domain/AGENTS.md); modelo local en [`src/storage/AGENTS.md`](./src/storage/AGENTS.md); `/CAJA`, aviso y `/RESUMEN` en [`src/ui/AGENTS.md`](./src/ui/AGENTS.md) |
| Cobranza y saldo del cliente | Persistencia en [`src/storage/AGENTS.md`](./src/storage/AGENTS.md); pantalla, comprobante, saldo en la venta y `/RESUMEN` en [`src/ui/AGENTS.md`](./src/ui/AGENTS.md) |
| Dexie: borrado de lo local, tablas con unión discriminada, fixtures | [`src/storage/AGENTS.md`](./src/storage/AGENTS.md) |
| Almacenamiento por carpeta: base de Dexie y claves de `localStorage` según la ruta (#148) | [`src/storage/AGENTS.md`](./src/storage/AGENTS.md); la publicación, en "Publicación" más abajo |
| Barra de comandos, overlays, selección, scroll, barra de estado, `pos.*`, diseño visual, patrones de UI | [`src/ui/AGENTS.md`](./src/ui/AGENTS.md) |
| Playwright: `fixtures.ts`, `helpers.ts`, `keyboard-only.spec.ts` | [`e2e/AGENTS.md`](./e2e/AGENTS.md) |

## Qué es esto

POS web offline-first para retail (kiosco/tienda), pensado para instalarse como PWA (pendiente, #54),
100% operable con teclado y también con mouse (ver "Teclado y mouse"), que se integra con cualquier
backend externo (ERP, e-commerce, facturación) vía un contrato de API propio versionado — el POS no
conoce ningún backend específico.

Fuera de alcance por ahora: facturación fiscal de un país específico (idea en #73), pasarelas de pago
(un pago es medio + monto, con 6 medios fijos y sin integración con ningún procesador) y hardware
(impresora, cajón: Fase 5, pospuesta a v2).

## Cómo trabajamos

Convenciones de proceso acordadas con el usuario (antes vivían en la memoria local de Claude, #117).

- **Idioma**: todo en español — respuestas, resúmenes, informes, preguntas, specs, planes, commits y
  comentarios —, aunque el pedido o las instrucciones de un skill vengan en inglés.
- **Plan antes de codear**: un trabajo de varios pasos (una etapa, un ciclo) arranca con un plan que el
  usuario revisa y aprueba; solo se saltea si él lo dice para ese trabajo puntual. El plan se ejecuta
  **inline** (`superpowers:executing-plans`, tarea por tarea con checkpoints), no con un subagente por
  tarea: el ritmo pausado le da tiempo de revisar cada paso.
- **Informe final con prueba manual**: al terminar, un informe más instrucciones paso a paso de qué
  hacer en la UI y qué se debería ver — la prueba en el navegador la hace el usuario.
- **Revisión sin cambios**: en una revisión (entre etapas, o una tanda de observaciones) no se toca
  código salvo pedido explícito en el momento; las observaciones se anotan como issues. Contestar una
  pregunta de alcance ("¿esto lo resolvemos ahora?") **no** es la luz verde para implementar: esa es
  aparte y explícita ("dale, implementá").
- **Ramas y PR**: cada etapa en su propia rama, con commits chicos verificados localmente
  (`pnpm lint && pnpm typecheck && pnpm test && pnpm build`, y `pnpm test:e2e` cuando aplica). El PR
  se abre recién al terminar la etapa, después de la revisión y de sus cambios pedidos (el CI remoto
  solo corre en PR y en `main`, así corre una vez por etapa), y se mergea con **merge commit**, nunca
  squash: el historial commit por commit sirve para revisar y hacer bisect.
- **CI**: después de un push no se espera ni se lee el CI de GitHub (hacerlo enlentece los comandos
  locales); alcanzan los chequeos locales. Si el CI falla, el usuario avisa.
- **Issues en GitHub**, nunca en un markdown del repo. "Anotá: …" crea un issue y se sigue con lo que
  se estaba haciendo. Se agrupan por **feature** (slice vertical de dominio a UI) con etiquetas
  `feature:<slug>` (`feature:transversal` para lo que cruza todo; los bugs también llevan la suya); un
  issue que junta varias pantallas se parte en uno por feature al planificarlo y queda como tracking
  con checklist. El cuerpo tiene que alcanzar para arrancar una sesión nueva sin más contexto
  (contexto, causa o hueco, archivos, preguntas abiertas). Etiqueta `backlog`: se prioriza después de
  lo ya diseñado.
- **Claude mantiene los issues** (el usuario no los edita a mano): al mergear una etapa, cierra su
  issue con un comentario que apunta al PR y tilda el epic ("— PR #N"). En el cuerpo del PR va
  **"Closes #N"** — GitHub no reconoce "Cierra #N" — y después del merge se verifica que se haya cerrado.
- **Dependencias**: con varias opciones equivalentes, la librería va detrás de un puerto (ver
  "Patrones establecidos") y se prefiere la que tenga menos dependencias propias
  (`npm view <paquete> dependencies`), aunque sea menos popular.

## POS y mini-erp: desarrollo separado

`mini-erp/` es un backend propio (Express + SQLite multitenant) que implementa el Connector API: uno
más de los backends que usan el POS, no parte del POS. Desde el 2026-09-28 los dos se desarrollan por
separado: **ningún cambio del POS dispara cambios en el mini-erp, ni al revés, sin autorización
explícita del usuario en ese momento**. Un cambio de contrato en el POS se anuncia (qué rompe en los
backends) y, a lo sumo, se propone un issue `feature:mini-erp`; no se adapta el mini-erp en el mismo
trabajo. Trabajando en el mini-erp rigen su `mini-erp/AGENTS.md` y `.agents/rules/mini-erp.md`, que no
permiten tocar el resto del repo. Hasta la Etapa 6 de #94 el mini-erp se adaptó dentro de las etapas
del POS (Etapas 5 y 6); eso quedó atrás.

## Stack

| Capa | Elección |
|---|---|
| UI | Preact + `@preact/signals` |
| Sync y cache | `fetch` + Dexie directo, con un motor propio (ver nota) |
| Almacenamiento local | Dexie.js (sobre IndexedDB) |
| Búsqueda local | FlexSearch, detrás de puertos del dominio (ver "Patrones establecidos") |
| Validación de contrato | Zod |
| Build | Vite |
| Testing | Vitest + Testing Library (preact) + Playwright |
| PWA / service worker | `vite-plugin-pwa` (Workbox) — **pendiente** (#54) |
| Impresión / hardware | Web Serial / WebUSB — **pendiente** (Fase 5, v2) |

Navegador de referencia: Chromium (Chrome/Edge). La app anda en Firefox/Safari; el hardware, cuando
exista, va a depender de Web Serial/WebUSB (solo Chromium).

**Nota (Fase 2)**: el doc de diseño original elegía TanStack Query + persister para el pull de
catálogo. Se decidió no sumarla: el motor de sync ya necesita reintentos/backoff para el push del
outbox, y esa misma lógica se reusa para el pull (`sync/engine.ts`) — traer una librería aparte para
algo que el propio motor ya resuelve no se justificaba, dado que se prefiere minimizar dependencias.

## Estructura de proyecto

```
src/
  domain/          # entidades y lógica de negocio pura (Sale, Product, etc.)
  storage/         # Dexie (schema, repositorios, transacciones), adaptadores de FlexSearch, fixtures de tests
  sync/            # motor de sincronización, config de la terminal, registro de conectores (connector-registry.ts)
  connectors/      # un subdirectorio por conector (rest/, rest-demo/, google-sheets/): su config, sus campos para /CONFIG y su factory
  ui/
    screens/       # una por pantalla: venta, cobro, cobranza, comprobante, /ANULAR, /CAJA, /RESUMEN, /CONFIG (config-wizard/), /DIAGNOSTICO, /DEMO_RESET
    components/    # barra de comandos, carrito, barra de estado, campos de pago, indicador de scroll
    keyboard/      # un controller por pantalla (teclado y mouse) y modelos puros de formularios
    state/         # signals agrupados por concern
    hooks/         # foco, selección, scroll
    console/       # utilidades `pos.*` de DevTools
  workers/         # vacío: el service worker llega con la PWA (#54)
  test/            # helpers compartidos de tests (connector falso, planilla falsa, setup)
demo-backend/      # minibackend de demo (Node + SQLite): la referencia ejecutable del contrato (`pnpm backend`)
mini-erp/          # backend propio, desarrollo separado (ver "POS y mini-erp")
site/              # publicación (#148): carpeta por versión, /versions, docs; no es parte de la app
e2e/               # Playwright
docs/              # connector-api.openapi.yaml, integradores/ (guía y llms.txt), publicacion.md, specs y planes (superpowers/), historia.md
```

`domain/` no importa nada de `ui/`, `storage/` ni `sync/` — es lógica pura, testeable sin DOM ni
IndexedDB. Los adaptadores (Dexie, fetch, service worker) viven en sus propias carpetas y son los
únicos lugares donde se permite `try/catch` real (ver más abajo).

## TypeScript estricto

- `any` prohibido sin excepción (`no-explicit-any` en modo error de lint).
- `unknown` solo puede aparecer en la firma de una función que recibe algo externo **y lo valida
  con Zod en la línea siguiente** — nunca se propaga `unknown` hacia el dominio.
- Toda función de negocio devuelve `Result<T>`, nunca lanza.

## Manejo de errores: `Result<T>`, nunca excepciones en el dominio

Regla general: **las funciones de negocio nunca lanzan**. Dos clases de error:

- **Error de negocio anticipado** (stock insuficiente, hold rechazado, payload de un conector mal
  formado, cualquier dato externo con forma incierta) → siempre `Result<T>`, nunca excepción.
- **Todo lo demás** (invariante rota, bug) → se deja explotar como excepción real hasta un único
  manejador global (error boundary de Preact + `window.onerror` / `unhandledrejection`). Por ahora
  ese manejador siempre muestra una pantalla bloqueante, sin retry silencioso. Única excepción, y no
  es de negocio sino del propio navegador: "ResizeObserver loop completed with undelivered
  notifications." (y su variante vieja "ResizeObserver loop limit exceeded") es una advertencia
  benigna de Chromium, no un bug de la app — puede llegar con `event.error === null` (bug real
  reportado por el usuario, issue #42: pantalla de error fatal mostrando literalmente "null" al abrir
  DevTools o hacer zoom fuerte del navegador, que son justo los gestos que más fácil la disparan).
  `ui/fatal-error.ts::isBenignResizeObserverLoopError` filtra este mensaje puntual antes de llegar a
  `renderFatalError` — no es una excepción general al "nunca silenciar", es reconocer que esta en
  particular nunca es un error real de la app.

`try/catch` queda limitado a los adaptadores que envuelven algo que sí lanza por naturaleza (fetch,
Dexie, `JSON.parse`) y lo convierten a `Result` en el borde — nunca como manejo de flujo de negocio.

Forma del `Result` casero — error como código string con metadata tipada por código, en un solo
registro central (`ErrorMeta`) para mantener exhaustividad en los `switch` de la UI:

```typescript
type ErrorMeta = {
  'sale/refund-amount-mismatch': { total: number; tendered: number };
  'sale/no-line-to-reduce': undefined;
  'account/hold-rejected': { reasonCode: string };
  'account/offline-limit-exceeded': { missing: number };
  'sync/invalid-payload': { issues: { path: string; message: string }[] };
  // se va extendiendo acá, un solo registro central
};

type ErrorCode = keyof ErrorMeta;
type Failure = { [C in ErrorCode]: { ok: false; error: C; meta: ErrorMeta[C] } }[ErrorCode];
type Result<T> = { ok: true; value: T } | Failure;
```

Si un `ErrorCode` no necesita datos extra, `meta` es `undefined` sin costo. Si un código deja de
usarse, se saca. `neverthrow` es la alternativa a considerar solo si el encadenamiento manual de
`Result`s se vuelve incómodo — por ahora se prefiere el casero (sin dependencia extra, dominio chico).

## Modelo de dominio

Los IDs de todo lo que crea la terminal (ventas, movimientos, holds, cobranzas, arqueos, clientes
locales) son **ULID**, siempre — así una venta existe y es identificable aunque nunca haya habido red.
`storage/ids.ts::newId` es el único lugar que llama a `ulid()`; `domain/` recibe el id ya generado.

Entidades: `Product`, `StockItem`, `Sale`/`SaleLine` (con su número de ticket), `Payment`,
`StockMovement`, `CashMovement` (ingreso, egreso o ajuste de arqueo), `CashCount` (arqueo, local),
`Customer` (pura identificación), `CustomerAccount` (crédito, módulo aparte y opcional — un
`Customer` puede no tener una asociada), `CustomerBalance` (el saldo, aparte del crédito desde #101:
cualquier cliente puede tener saldo, tenga o no cuenta corriente, así un saldo a favor nunca se
confunde con crédito), `CustomerPayment` (cobranza sin venta, con su número de recibo), `AccountHold`,
`AccountMovement`. Detalle completo de campos en §4 del documento de diseño (que todavía no conoce
los agregados de #94).

Dos categorías de dato, porque cambian la estrategia de sync:

- **Eventos, sin conflicto posible** (`Sale`, `Payment`, `StockMovement`, `AccountMovement`,
  `CashMovement`, `CustomerPayment`): siempre seguros de crear offline vía outbox. Ninguno se modifica:
  se corrige con otro registro (RNF-07; una anulación es otra venta).
- **Recursos con límite, conflicto posible** (`StockItem.quantity`, el saldo contra el crédito de
  `CustomerAccount`): offline es operar sobre una foto que puede estar desactualizada. Se resuelven
  con margen configurable por el backend, y el POS solo advierte, nunca bloquea (ver "Venta de la
  Etapa 4").

## Patrón outbox (offline-first) — implementado en Fase 2, rediseñado a lotes en la Etapa 1 de #87

Toda mutación relevante (`closeSaleAndPersist`, `voidSaleAndPersist`) escribe **primero** en la
tabla local `outbox` (`domain/outbox.ts::OutboxEvent`, unión discriminada por `type` — nunca
`payload: unknown`), en la misma transacción Dexie que el registro de negocio. La venta/anulación
ya está cerrada y operativa localmente sin importar el resultado del sync.

El detalle (identidad de cada evento y del dispositivo, push de un solo lote con un solo ack, pull con
eventos reaplicados, limpieza a 7 días, cadencias, foto completa) está en `src/sync/AGENTS.md`. Cuenta
corriente es el único flujo que a propósito puede requerir red síncrona (la reserva de crédito, también
en `src/sync/AGENTS.md`).

**Distinto de la venta en curso (ciclo de mejoras post-Fase 4)**: `outbox` es para eventos ya
cerrados que necesitan viajar a un backend — la venta en curso, mientras se está armando, no es
ninguna de las dos cosas (no está cerrada, no tiene por qué sincronizarse). Su persistencia vive en
una tabla propia (`draftCart`, ver "Patrones de UI" en `src/ui/AGENTS.md`) con un criterio totalmente distinto:
sobrevivir a un refresh/crash de esta terminal, nunca viajar a ningún lado.

## Connector API

El POS no tiene lógica de ningún backend particular, solo del contrato (REST/JSON versionado,
documentado en `docs/connector-api.openapi.yaml`, **versión 4.4.0** desde #128, la última antes
del MVP (spec `docs/superpowers/specs/2026-09-28-onboarding-demo-contrato-4-4-design.md`); la 4.3.0
es de #125 (spec `docs/superpowers/specs/2026-09-28-anular-cobranzas-design.md`); la 4.2.0 es de la Etapa 6 del epic #94 —
#101, spec `docs/superpowers/specs/2026-09-27-cobranza-y-saldo-del-cliente-design.md`; la 4.1.0 es de
la Etapa 5, #120, spec `docs/superpowers/specs/2026-09-24-caja-sin-turnos-y-numeracion-design.md`; la 4.0.0 es de la
Etapa 4, #99, spec `docs/superpowers/specs/2026-09-24-venta-enter-cantidades-advertencias-design.md`; la v3 es de
la Etapa 1, #96, spec `docs/superpowers/specs/2026-09-23-contrato-connector-api-v3-design.md`). **Desde la Etapa 1 del rediseño de sync (#87,
"el backend nunca rechaza") el contrato pasó de 10 endpoints por recurso/evento a dos operaciones
batch** (`POST /sync/push`, `POST /sync/pull`) más una excepción síncrona, la reserva de crédito
(`POST /account-holds`, sin cambios), y `GET /info` desde 4.0.0 (4.2.0 eliminó
`GET /account-balance/{customerId}`, que nunca se implementó: el saldo viaja en el pull). `sync/connector.ts::Connector` tiene, en
consecuencia, cuatro métodos: `getInfo`, `pushBatch`, `pullBatch` y `requestAccountHold`. 4.4.0 suma
`POST /demo-sessions`, opcional y sin autenticación, que a propósito no pasa por el puerto (no es
sync y solo existe en backends REST: `sync/demo-session.ts`). Principio central del contrato: **el backend nunca
evalúa el contenido de lo que el POS manda** — no hay forma de que una venta, un cliente, un
movimiento de stock o un cierre de caja sea "rechazado" de forma síncrona; el backend registra todo
y audita, y cualquier inconsistencia se resuelve de su lado o a mano. Para avisarle al humano de una
discrepancia, una cuota o el contrato, desde 4.4.0 el pull trae `notices`, la lista vigente de avisos
(informativos, nunca bloquean): #13 y #103 pasan a ser trabajo solo del POS. El backend sí puede, por motivos propios (cuota,
contrato), dejar de aceptar lotes de una terminal — el POS nunca hace cumplir eso por su cuenta, solo
se lo muestra al humano vía la barra de estado (ver "Patrón outbox" más arriba).

**Compatibilidad por piso y capacidades (4.4.0, #128)**: compatible = mismo major que el POS y minor
≥ el del **piso 4.0.0** (`domain/contract-version.ts::MIN_BACKEND_CONTRACT`), ya no el minor del POS:
un agregado nuevo no obliga a todos los backends a actualizarse. Lo que un backend hace más allá del
piso lo declara como **capacidad** en `GET /info` (`demo-sessions`, `customer-payment-void`); el POS
nunca la deduce de la versión e ignora un nombre que no conoce. Un backend 4.2 (Sheets, el mini-erp)
vuelve a ser compatible sin tocarlo: simplemente no anula cobranzas. Las **reglas de evolución**
(campos y enums desconocidos, foto completa nunca truncada, numeración con huecos) están en el
OpenAPI. Qué trajo cada versión (v3, 4.0.0 a 4.4.0), cómo el POS sigue el estado del backend, las
capacidades y los avisos (`notices`) están en `src/sync/AGENTS.md`; las implementaciones y el
registro de conectores, en `src/connectors/AGENTS.md`.

**Qué backends acompañan un cambio de contrato**: el minibackend de demo (`demo-backend/`) sí, en el
mismo trabajo — es la referencia ejecutable del contrato. El mini-erp no (ver "POS y mini-erp:
desarrollo separado"). El conector de Google Sheets tampoco: **congelado en 4.2.0** desde el
2026-09-28 (#127) — un cambio de contrato o de la interfaz `Connector` no lo hace evolucionar; solo se
hace el mínimo mecánico para compilar y mantener sus tests en verde, y si eso deja de ser mecánico se
frena y se consulta (adaptarlo o sacarlo del registro). Con el piso 4.0.0 (#128) vuelve a ser
compatible sin tocarlo: no declara capacidades, así que no anula cobranzas. La red de seguridad ya
existe: el puente informa su versión (`bridge.gs::CONTRACT_VERSION`), así que con un POS de otro major
la terminal lo ve incompatible, no sincroniza y sigue vendiendo sin perder nada. Cada cambio de contrato suma en #127
lo que haría falta para retomarlo; `/CONFIG` lo muestra como "Sin mantenimiento". El camino decidido
para retomarlo es #138 (el conector en el POS, con la API del puente especificada).

**Permisos mínimos en integraciones de terceros**: un conector pide el scope más chico que funcione
(el puente de Sheets usa `@OnlyCurrentDoc`). Si una función más linda necesita un scope más amplio, se
descarta o se ofrece como decisión explícita del usuario — nunca se amplía por defecto (caso real: las
tablas nativas de Sheets, que pedían acceso a todo Drive, se descartaron en la Etapa 2d).

Un integrador nuevo implementa el contrato — un backend que ya habla el
contrato REST no requiere tocar código del POS (RNF-06); un backend con otro formato (como la planilla
de Sheets) entra como un conector nuevo del registro.

## Ciclo de vida de la conexión (Etapa 2b, #76; wizard desde la Etapa 2 de #94, #97)

Una conexión (conector + config) solo se activa después de **probarla**. `SyncConfig` guarda
`verifiedAt` (fecha de la última prueba exitosa); `sync/connection-state.ts::connectionState` deriva
`unconfigured` (sin config), `unverified` (config sin `verifiedAt`, incluidas las guardadas antes de
2b), `incomplete` (probada pero sin sucursal o punto de venta — una config de la Etapa 1 de #94 cae
acá; `hasTerminalIdentity`) o `active`. Si no es `active`, `ui/app.tsx` muestra **solo** `/CONFIG` en
**modo requerido** — ni venta ni barra de comandos, sin "Cancelar", Esc no sale — y ningún ciclo de
sync corre (el wizard pausa el sync). El bloqueo depende únicamente de lo guardado, nunca de la
conectividad: una terminal `active` abre y opera offline como siempre; solo el primer arranque y el
cambio de conexión necesitan red, porque probar es hacer un pull.

**Cambiar la conexión nunca borra datos locales automáticamente**, con una sola excepción, el
onboarding de demo (#128): (a) un link de demo en una terminal sin config y sin datos del usuario, o
que ya está en demo; (b) la vuelta del alta con un `wipe_key` válido emitido por esta terminal, o sin
datos del usuario. En cualquier otro caso decide el operador en el wizard (Mantener o Borrar).

No hay valores por omisión: los
campos arrancan vacíos y los ejemplos son `placeholder`s (`ConfigField.placeholder`) con el formato
"ej. …" y en gris claro (`--color-placeholder`), para que nunca pasen por un dato cargado.

El wizard de `/CONFIG` está en `src/ui/AGENTS.md`; cómo se aplica una conexión y por qué no hay sync
de fondo con `/CONFIG` abierto, en `src/sync/AGENTS.md`.

## Onboarding de demo (#128)

El POS es **estático y genérico**: no conoce ningún backend (nada fijo en el código; el build usa
`base: './'` desde #148, así el mismo `dist/` anda en cualquier carpeta, incluido el deploy de un
backend). Spec:
`docs/superpowers/specs/2026-09-28-onboarding-demo-contrato-4-4-design.md`.

1. **Link de demo**: `<pos>/?demo=true&backend=<base URL>&template=<opcional>` (`backend` `https:`, o
   `http:` a localhost). En una terminal sin config y sin datos del usuario, o ya en demo, el POS pide
   `POST /demo-sessions`, prueba y aplica la conexión (`rest` con `SyncConfig.demo`) borrando lo local,
   y entra a la venta. Con una conexión real o con datos, el link se ignora y lo avisa. Template
   desconocido: reintenta sin template y avisa cuál usó.
2. **Terminal en demo**: marca **DEMO** y botón `<onboarding.label> (/ALTA)` en la barra de estado.
   `/ALTA` lleva a `onboarding.url` con `return_url` (origin + pathname) y un `wipe_key` de un solo uso
   (vence a las 2 h).
3. **Vuelta**: `<return_url>#connect=<base64url>` — la config viaja en el **fragmento**, nunca en la
   query string. Con el `wipe_key` válido o sin datos del usuario, prueba, aplica borrando y guarda la
   config **sin `demo`**; si no (o si la prueba falla), precarga el wizard de `/CONFIG` sin borrar nada.

Es la única excepción a "cambiar la conexión nunca borra solo" (ver "Ciclo de vida de la conexión").
Los módulos están en `src/sync/AGENTS.md` y la UI en `src/ui/AGENTS.md`. Pasar de demo a producción
sin repetir el onboarding queda para después (#143, backlog). Preferencia del usuario sobre quién
sirve el POS: estático e instalaciones independientes, sin mezclar `localStorage` ni IndexedDB.

## Publicación (#148)

Spec: `docs/superpowers/specs/2026-09-29-deploy-mvp-design.md`; guía del mantenedor (tag, Cloudflare,
qué hacer si falla) en `docs/publicacion.md`.

- **Carpetas inmutables** `/<x.y.z>/` en Cloudflare Pages, que sirve la rama huérfana `publish`. La
  escribe solo la Action `publish.yml`: con un tag `vX.Y.Z` (que tiene que coincidir con
  `package.json`) arma la carpeta, su `version.json` (hechos del POS: versión, contrato y piso), sus
  docs y un zip; una carpeta ya publicada nunca se pisa. Primera versión: `0.1.0` (el `1.0.0` queda
  para el primer comercio real).
- **Almacenamiento por carpeta** (`storage/storage-namespace.ts`): cada carpeta tiene su base de
  IndexedDB y su prefijo de `localStorage`; en `/` sigue siendo `offline-pos` (detalle en
  `src/storage/AGENTS.md`). Cambiar de carpeta, de versión o de dominio es una instalación nueva (un
  canal estable llega con #54). `/DIAGNOSTICO` muestra la versión y el almacenamiento.
- **`/versions`** cruza todas las carpetas publicadas con `site/backends.json`, que es un dato del
  **sitio** (la app nunca lo lee) y cambia por PR. El contrato y las capacidades de cada backend se
  consultan en vivo (`POST /demo-sessions` → `GET /info`, sin cambio de contrato; `/info` público
  quedó en #151), así que la lista solo admite backends con demo. Se regenera con el tag, con un push
  a `main` que toca `site/`, todos los días y a mano; si un backend no contesta, no se publica nada.
- **`site/`** es tooling de publicación en TypeScript que Node 24 corre sin compilar; puede importar
  módulos puros de `src/`, nunca al revés. Sus errores se lanzan (una publicación con datos malos
  corta la Action), pero todo dato externo se valida con Zod. `pnpm site:build` y `pnpm site:preview`
  arman y sirven el sitio en local (`4174`).
- **Docs para integradores** en `docs/integradores/` (guía y `llms.txt`), publicadas con el OpenAPI en
  cada `/<versión>/docs/`. El OpenAPI no lleva referencias internas (issues, specs, `AGENTS.md`): lo
  vigila `site/docs.test.ts`.

## UX keyboard-first

Principio central: **un único input siempre enfocado** (la barra de comandos) — se elimina el
problema de foco competido en vez de gestionarlo. Nunca agregar un segundo elemento que pueda robar
foco durante la operación normal.

Prioridad de interpretación de la barra de comandos (orden fijo, ver §7 del diseño para el detalle
completo de cada regla y los casos de ambigüedad cantidad-vs-código-de-barras):

1. `/` → modo comando, filtrado por prefijo (detalle en `src/ui/AGENTS.md`).
2. `@` → búsqueda/alta de cliente.
3. `<signo><número>%` → recargo/descuento global sobre el total (RF-03, detalle en `src/ui/AGENTS.md`).
4. `cualquier cosa$monto` → línea libre de venta (con `<n>*` de prefijo, `n` es el precio unitario
   — detalle en `src/ui/AGENTS.md`).
5. `<n>*` o `-<n>*` de prefijo → cantidad antes de cualquier búsqueda.
6. Un número → cantidad o código, **nunca** búsqueda por nombre (prueba manual de la Etapa 4, #99).
   Con decimales no es código: con una línea seleccionada es su cantidad; si no, "Falta el
   artículo". Solo dígitos: desde 4 (`CODE_SEARCH_MIN_DIGITS`) lista los productos cuyo SKU o
   código de barras **empieza o termina** así (`CatalogRepository.searchByCode`), sin preseleccionar
   — Enter sin elegir busca el código exacto (un lector con un código inexistente nunca agrega una
   coincidencia parcial); ↓ o click eligen una fila. Mismas reglas después de `<n>*`.
7. Cualquier otro texto → búsqueda difusa por nombre **o por una línea libre ya en este ticket**
   (detalle en `src/ui/AGENTS.md`).

El detalle de cada regla (Enter con la barra vacía, menú de "/", overlays, recargo global, línea libre,
clientes, selección y scroll) está en `src/ui/AGENTS.md`.

**Venta de la Etapa 4 (#99)** — el POS nunca se autobloquea: stock insuficiente y productos o
clientes bloqueados se advierten, nunca impiden vender. Cantidades con signo y redondeo, tickets en 0
o negativos y la anulación como ticket propio están en `src/domain/AGENTS.md`; Cobro y las
advertencias en vez de bloqueos, en `src/ui/AGENTS.md`.

**Comandos** (`ui/keyboard/commands.ts::CORE_COMMANDS`, más los del conector activo):

| Comando | Qué hace |
|---|---|
| `/COBRAR` | Cobro (con líneas) o cobranza sin venta (sin líneas y con cliente). También Ctrl+Enter, o Enter con la barra vacía |
| `/CAJA` | Arqueo, ingreso o egreso de caja (ver "Caja sin turnos") |
| `/RESUMEN` | Un día calendario: movimientos, productos y medios de pago |
| `/ANULAR` | Anula un ticket o una cobranza de las últimas 24 h con otro documento |
| `/DESCARTAR` | Vacía la venta en curso (líneas, cliente y ajuste global) con `domain/cart.ts::discardCart`, sin confirmación |
| `/CONFIG` | Wizard de la terminal y su conexión (ver "Ciclo de vida de la conexión"); config en `localStorage`, no hay variables de entorno |
| `/SINCRONIZAR` | Push y pull ya (RF-12); no cambia de pantalla, el feedback es la barra de estado |
| `/DIAGNOSTICO` | Estado de sincronización, de solo lectura (también con un click en la barra de estado) |
| `/ALTA` | Solo con la terminal en demo: va al alta del backend (ver "Onboarding de demo") |
| `/DEMO_RESET` | Solo con el conector `rest-demo`: reinicia la demo (ver `src/connectors/AGENTS.md`) |

`/DESCARTAR` es a propósito distinto de `/ANULAR`, que anula una venta ya cerrada (con auditoría), y
no pide confirmación: decisión explícita del usuario, perder un carrito no guardado es barato de
rehacer. Cuenta corriente no es un comando: es un campo del diálogo de Cobro.

**Caja sin turnos y numeración de tickets (Etapa 5 de #94, #100 y #120)** — se vende sin apertura
ni cierre (`triggerCheckout` y `closeSaleAndPersist` ya no piden turno; los turnos, su tabla y sus
errores se eliminaron: un turno abierto al actualizar se pierde, no hay terminales en producción).

El saldo de efectivo, los conceptos sugeridos y la numeración están en `src/domain/AGENTS.md`; el
modelo local en `src/storage/AGENTS.md`; `/CAJA`, el aviso "Sin arqueo en 24 h" y `/RESUMEN` en
`src/ui/AGENTS.md`.

**Cobranza sin venta y saldo del cliente (Etapa 6 de #94, #101)** — un cliente paga a cuenta sin
comprar nada, y el POS lleva el saldo de cada cliente, siempre informativo (nunca bloquea nada).

La pantalla, el comprobante, el saldo en la venta y `/RESUMEN` están en `src/ui/AGENTS.md`; la
persistencia, en `src/storage/AGENTS.md`.

Una cobranza se anula desde `/ANULAR` con otra cobranza negativa (#125): detalle en
`src/domain/AGENTS.md` y `src/ui/AGENTS.md`.

Otros principios no negociables: todo alcanzable en ≤2 pasos sin mouse (RNF-04), foco siempre
visible (nunca depender de `:hover`), locale configurable por terminal para `Intl.NumberFormat`
(Fase 4 — campo opcional de `/CONFIG`, `ui/format.ts` lo lee en cada llamada, default
`navigator.language`). "Login de terminal 100% teclado" (PIN + Enter) es un principio del doc de
diseño que **todavía no está implementado ni asignado a ninguna fase** — no hay modelo de
usuario/terminal en el dominio (§4); no asumir que existe ningún tipo de autenticación.

## Teclado y mouse (Etapa 2 de #94)

La app sigue siendo 100% operable con teclado, y desde la Etapa 2 de #94 también con mouse, con un
patrón único (sacado de `/RESUMEN`, Ciclo 10):

- `ui/hooks/use-mouse-keeps-focus.ts::keepFocusOnMouseDown` va en el `onMouseDown` del contenedor de
  cada pantalla: con el **botón izquierdo**, cancela el `mousedown` salvo sobre controles de texto
  (`input`, `textarea`, `select`) — el foco se queda en el "hogar" de la pantalla (la barra, el
  contenedor), incluso al clickear un botón, y el `click` se dispara igual. Con cualquier otro botón
  no hace nada: la rueda y el autoscroll con el botón del medio siguen andando.
- Todo lo clickeable es un `<button>` o una fila con `onClick` que llama a **la misma función del
  controller** que su tecla. Todo atajo visible tiene su botón, con el atajo en la etiqueta ("Cerrar
  (Esc)", "Anular (Enter)"), y viceversa.
- El hover es decorativo: nunca mueve la selección.
- La acción principal de cada estado (la que dispara Enter) se ve destacada: clases `.btn` (secundario),
  `.btn-primary` (acento) y `.btn-danger` (destructiva: "Borrar y cambiar", "Anular", "Reiniciar
  demo") en `tokens.css`.
- Cursor: la flecha por defecto en toda la app (`body { cursor: default }`), el de texto solo en los
  campos editables, la mano en lo clickeable — nunca el cursor de texto sobre algo que no se edita.
- Un grupo de opciones (Tipo de conexión, Datos locales del wizard) se comporta como un radio: el foco
  está en la opción elegida y la sigue con ↑/↓, nunca en un contenedor invisible.
- Un botón enfocado con Tab se activa con Enter de forma nativa: el `onKeyDown` del contenedor no
  vuelve a ejecutar su atajo de Enter (si no, "Volver" enfocado + Enter en `/ANULAR` anulaba igual).

Dónde se aplica, pantalla por pantalla: `src/ui/AGENTS.md`.

## Testing

Vitest + Testing Library para unit/componentes (sin `@testing-library/jest-dom`: su tipado no tiene
una versión compatible a la vez con Vitest 5 y con el `@testing-library/dom` que trae
`@testing-library/preact` — los tests de componentes usan aserciones planas de DOM,
`expect(x).not.toBeNull()` en vez de `toBeInTheDocument()`). Los tests de `storage/` que tocan Dexie
importan `'fake-indexeddb/auto'` al principio del archivo para darle IndexedDB a Vitest/jsdom.

Playwright (`e2e/`, config en `playwright.config.ts`, solo Chromium) para el flujo end-to-end,
corriendo contra el build real (`pnpm build && pnpm preview`, no el dev server) — en particular para
simular offline real (`context.setOffline(true)`, siempre **después** de cargar la app una vez, no
antes). `vite.config.ts` excluye `e2e/**` de Vitest para que sus `*.spec.ts` no colisionen con el
`include` por defecto. Los specs leen el estado persistido directo de IndexedDB
(`indexedDB.open('offline-pos')`) en vez de importar módulos de la app, para no acoplar el test al
código interno.

El motor de sync y el conector REST se testean sin backend real ni librería de mocking HTTP nueva:
`vi.stubGlobal('fetch', vi.fn())` para el conector, y un `Connector` fake hecho a mano (objeto
literal con los métodos del puerto) para `sync/engine.ts` — así `pushPendingLot`/`runPullCycle` se
testean contra el puerto, no contra HTTP.

Los helpers y fixtures de Playwright están en `e2e/AGENTS.md`.

## Patrones establecidos

Los transversales; los de UI están en `src/ui/AGENTS.md`, el de Dexie en `src/storage/AGENTS.md` y el
de config frente a estado operativo en `src/sync/AGENTS.md`.

- **Puerto + adaptador para dependencias reemplazables**: el dominio define la interfaz y la
  implementación concreta vive en `storage/` — `domain/catalog-search.ts` con
  `flexsearch-catalog-search.ts`, `domain/customer-search.ts` con `flexsearch-customer-search.ts`,
  `domain/concept-search.ts`. Inversión de dependencias, no una excepción a "domain/ no importa
  infraestructura". Las búsquedas de productos y de clientes son puertos **separados a propósito**
  aunque las dos usen FlexSearch: una interfaz genérica acoplaría dominios que no tienen por qué
  evolucionar juntos. Mismo criterio para no generalizar `adjustFreeformLineQuantity` (línea libre,
  identidad por descripción exacta) con `addProductLine` (producto, identidad por `productId`).
- **Traductor de errores exhaustivo**: `ui/errors.ts` tiene un único `switch` sobre `ErrorCode` con
  chequeo `never` en el `default` — un código nuevo en `ErrorMeta` sin traducir no compila. La UI
  muestra errores de negocio solo a través de esta función.
- **`toZodIssues` centralizado** (`domain/zod-issues.ts`): toda validación nueva en el borde lo reusa.
- **No inventar datos que no llegaron del backend**: por ejemplo, un pago a cuenta corriente aprobado
  para un cliente sin `CustomerAccount` cacheada no crea una cuenta con crédito en 0 — el próximo pull
  trae la real. El POS no fabrica información que le pertenece al sistema externo.

## Estado del proyecto

La historia completa (qué trajo cada fase, ciclo y etapa, desvíos de los planes y bugs encontrados)
está en `docs/historia.md`; cada etapa desde #87 tiene su spec y su plan en `docs/superpowers/`.

| Trabajo | Qué trajo | Referencia |
|---|---|---|
| Fases 1 a 4 | Venta offline, motor de sync, clientes y cuenta corriente, keyboard-first | — |
| Ciclos post-Fase 4 a 10 | Mejoras de UI sobre el uso real; Cobro con 6 medios (Ciclo 9), `/RESUMEN` (Ciclo 10) | PR #65 y anteriores |
| Fase 6 | Multi-terminal y turnos de caja (los turnos se eliminaron en la Etapa 5 de #94) | — |
| Fase 7 (parcial) | Minibackend de demo; el resto en #54 | PR #47 |
| Epic #66 | Conectores: Google Sheets, registro cerrado, conexión verificada, comandos por conector, crédito ilimitado | #67, #68, #76, #77, #80, #69 |
| #87 | Sync por lotes (`pushBatch`/`pullBatch`) y `/DIAGNOSTICO` | PR #89 |
| Epic #94, Etapas 0 a 6 | Consola `pos.*`, contrato v3, identidad y wizard, pull con reaplicación y limpieza, venta (4.0.0), caja sin turnos (4.1.0), cobranza y saldo (4.2.0) | PR #105, #107, #109, #116, #118, #123, #126 |
| Epic #134 | #124, #125: `/RESUMEN` más nuevo primero, anular cobranzas (4.3.0) y `/ANULAR` como `/RESUMEN`; #128 y #115: onboarding de demo y contrato 4.4.0 (piso, capacidades, avisos); #148: publicación del MVP (carpetas por versión, almacenamiento por ruta, `/versions`, docs, Cloudflare Pages) | PR #136, PR #141, PR #145, PR de #148 |
| #152 | La barra no pierde lo tipeado durante el alta de un cliente (era el flake de `account-sale.spec.ts`) | PR #154 |

**Siguiente**: la primera publicación (`v0.1.0`, siguiendo `docs/publicacion.md`) y su verificación
con Local Network Access; con eso se cierra #148 y el MVP del epic #134. El lanzamiento es para
developers con el demo-backend en `localhost:4000`: la demo pública, con el mini-erp, queda para
después (#147, `backlog`). Después del MVP: #112 + #111 y #102 (comandos de consulta, antes la
Etapa 7 de #94); antes del primer comercio real: service worker (#54) y dominio propio (#150). Fase 5 (hardware) pospuesta a v2: depende de dispositivos reales y nada depende de
ella (§11 del diseño).

**Issues abiertas**, por feature. `backlog` = se prioriza después de lo ya diseñado; revisar la
etiqueta antes de tomar un issue.

- Venta y barra de comandos: #119 (revisión de cantidades, precios y búsquedas), #23 (scanner por
  velocidad de tecleo), #24 (instrucciones en la barra), #45 (idea: `?<texto>` asistido por IA).
- Anulación: #137 (comprobante de la anulación).
- Caja: #57 (usabilidad del modal de `/CAJA`).
- Clientes y cuenta corriente: #102 (comandos de consulta); `backlog`: #37 (documento y teléfono),
  #104.
- Sync: #155 (flake de "Avisos (1)" en `demo-onboarding.spec.ts`); `backlog`: #113, #103, #13 (los
  dos últimos, sobre `notices` de 4.4.0).
- Config y accesibilidad: #112 (prioritario: foco y selección del wizard), #111 (tipografía con zoom),
  #41 (resize en DevTools).
- Pantallas y publicación: #148 (deploy del MVP: falta la primera publicación), #49 (tracking de
  modales), #54 (service worker, PWA y lanzamiento); `backlog`: #147 (backend para la demo pública),
  #150 (dominio propio), #151 (`GET /info` sin autenticación), #52 (Historial), #143 (pasar de demo a
  producción sin repetir el onboarding).
- Conectores (`backlog`): #127 (Sheets congelado), #138 (Sheets en el POS), #70 a #73 (CSV, Tiendanube, Mercado Libre, AFIP).
- Transversal: #142 (flake de `DatabaseClosedError` en `pnpm test`), #135 (fines de línea:
  `.gitattributes` con `eol=lf`), #153 (lockfile de la raíz con entradas viejas de mini-erp).
- Otros (`backlog`): #60 (vuelto vs. billetes), #62 (typescript-eslint). Mini-erp, fuera del flujo del
  POS: #122, #144 (contrato 4.4.0 y el onboarding nuevo).
