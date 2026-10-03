# Link de demo con confirmación y demo revocada

Fecha: 2026-10-02
Estado: diseño aprobado en el brainstorming del 2026-10-02; plan en
`docs/superpowers/plans/2026-10-02-link-de-demo-con-confirmacion.md`.
Issues: #176 (etapa P3 del epic #182, MVP de mini contax, antes de M8 del mini-erp,
rauldiazsolis/mini-erp#24). Relacionado: #143. Spec del MVP:
`docs/superpowers/specs/2026-10-01-mvp-mini-contax-design.md` en rauldiazsolis/mini-erp, secciones
"Demos" y "POS (offline-pos)".

## Contexto

El onboarding de demo (#128, `ui/onboarding.ts::handleEntry`) decide solo qué hacer con un link de
demo:

- Terminal sin config y sin datos del usuario, o ya en demo: aplica directo **borrando todo**, aunque
  haya ventas de práctica sin enviar o una venta en curso.
- Terminal con una conexión real (con o sin datos), o sin config pero con datos: **ignora** el link y
  lo avisa.

El MVP pide lo contrario: si el POS tiene datos, mostrar qué se pierde y dejar decidir al usuario.

Además, en M8 las demos de mini pasan a ser un comercio compartido por rubro donde cada visitante
tiene una caja (una key), que se revoca con el reinicio nocturno o a las 24 h sin uso. Hoy un POS con
la key revocada queda en `sync-error` con "credenciales" para siempre; tiene que ofrecer una demo
nueva.

Dos huecos del código actual:

- `SyncConfig.demo` guarda `template`, `onboarding` y `startedAt`, pero **no el `backend` del link**:
  si `POST /demo-sessions` devolvió otra `baseUrl`, el POS no sabe a quién pedirle una demo nueva.
- Un 401 es `sync/request-failed` con `status: 401`, igual que una key mal cargada. El demo-backend
  acepta cualquier token: nunca da 401 con una key.

## Decisiones

Tomadas en el brainstorming del 2026-10-02:

1. **Una sola regla**: un link de demo válido **aplica directo solo si no se pierde nada** (sin
   config, o ya en demo, y en los dos casos sin datos del usuario); en cualquier otro caso **pide
   confirmación**. Nunca se ignora: una terminal con una conexión real también confirma (siempre,
   aunque no tenga datos, porque pierde la conexión).

   | Terminal | Antes | Ahora |
   |---|---|---|
   | Sin config, sin datos del usuario | Aplica directo | Aplica directo |
   | En demo, sin datos del usuario | Aplica directo | Aplica directo |
   | En demo, con datos del usuario | Aplica directo y borra | Confirmación |
   | Sin config, con datos del usuario | Ignora y avisa | Confirmación |
   | Con conexión real (con o sin datos) | Ignora y avisa | Confirmación |

   "Datos del usuario" sigue siendo `storage/local-data.ts::hasUserData` (ventas, arqueos,
   movimientos de caja, cobranzas, pendientes del outbox, venta en curso). "Sin config" es
   `sync/config-missing`; una config ilegible cuenta como conexión (confirma).
2. **Envío previo**: antes de mostrar qué se pierde, un último envío de lo pendiente a la conexión
   actual (`sync/apply-connection.ts::flushPendingBeforeWipe`, el de "Borrar" del wizard: con red,
   ignorando el backoff, con tope `FLUSH_TIMEOUT_MS`). Así "sin enviar" es lo que de verdad queda.
3. **Pantalla propia** ("Abrir una demo"), no el wizard de `/CONFIG`: no hay nada que elegir, la
   conexión la trae la demo.
4. **Primero se confirma, después se pide la demo**: cancelar nunca crea una caja de demo en el
   backend.
5. **Enter = "Borrar y abrir la demo"** (`.btn-danger`), Esc = "Cancelar", como la confirmación de
   borrado del wizard: la pantalla ya es la confirmación, con lo que se pierde en rojo.
6. **Demo revocada = un 401 o 403 con la terminal en demo** (opción A). La key de una demo nunca la
   tipea nadie: la dio `POST /demo-sessions` y se probó con un pull, así que en demo un 401 no es una
   key mal cargada. Sin cambio de forma del contrato: una aclaración en el OpenAPI, sigue 4.4.0. Se
   descartaron un código propio en el 401 (agregado al contrato que gana poco) y un `notice` (después
   de revocar, el pull ya da 401 y no llega ningún aviso).
7. **La demo revocada se ofrece, nunca se reemplaza sola**: barra de estado con "La demo terminó" y
   el botón "Empezar una demo nueva (/DEMO_NUEVA)". La venta sigue andando.
8. **`/DEMO_NUEVA`** es un comando core visible siempre que la terminal esté en demo (revocada o no):
   navega al link de demo armado con lo guardado y todo sigue por el camino del arranque.
9. **`SyncConfig.demo.backend?`**: el `backend` del link. Sin él (demo anterior a esta etapa) se usa
   `baseUrl`.

## Flujo del link de demo

```
link ?demo=true&backend=…&template=…
 └─ bootstrap → runOnboardingFromUrl(href, { config, hasUserData })
     ├─ link inválido                           → failed (como hoy)
     ├─ no se pierde nada                       → aplica directo (como hoy) → applied
     └─ se pierde algo                          → { kind: 'confirm', entry }
          bootstrap: URL limpia, sync pausado, pantalla 'demo-confirm'
          DemoConfirmScreen
            1. "Revisando los datos de esta terminal…"
               flushPendingBeforeWipe(config actual)   (solo con config legible y con red)
               summarizeLocalData()
            2. Qué se pierde (ver abajo)
               Esc   → cancelar: sync reanudado, vuelve a la venta o al wizard requerido
               Enter → "Abriendo la demo…": requestDemoSession → probe → applyConnection(wipe)
                         ok    → venta vacía en memoria, aviso de plantilla si hubo, runPushThenPull
                         falla → nada borrado; vuelve a donde estaba con
                                 "No se pudo iniciar la demo: <motivo>."
```

- `OnboardingOutcome` suma `{ kind: 'confirm'; entry: DemoEntry }` y pierde `ignored`.
  `OnboardingContext` sigue igual (`config`, `hasUserData`).
- La parte de `handleEntry` que pide la sesión, reintenta sin template, arma el candidato, prueba y
  aplica se separa en una función exportada (`startDemo(entry, config, deps)` en `ui/onboarding.ts`)
  que usan el arranque (camino directo) y la pantalla (después de confirmar). Devuelve `applied` (con
  el aviso de plantilla opcional) o `failed`.
- `bootstrap`, con `confirm`: termina de inicializar como siempre (repositorios, venta en curso,
  estado de la conexión), limpia la URL, pone `syncPausedSignal` y abre la pantalla, que recibe la
  entrada y a dónde volver. Con `applied` desde la pantalla hace lo mismo que hoy hace `bootstrap`
  tras aplicar: vacía la venta en curso, el cliente adjunto y la selección del carrito, apaga
  `identityResetSignal` y vuelve a leer el último arqueo (`lastCashCountAtSignal`).
- **Volver**: a la venta si la conexión es `active`; si no, al wizard requerido
  (`openRequiredWizard`). El aviso de un fallo va donde va hoy: `commandBarWarningSignal` con la
  terminal `active`, `configNoticeSignal` en el wizard.

## La pantalla "Abrir una demo"

`ui/screens/demo-confirm-screen.tsx`, controller `ui/keyboard/demo-confirm-controller.ts`, estado en
`ui/state/demo-confirm.ts` (`demoConfirmSignal`: `checking` → `confirming` → `starting`, con el
resumen y la entrada). Ocupa toda la pantalla, como `/CONFIG` en modo requerido. Patrón de teclado y
mouse de la app: `keepFocusOnMouseDown` en el contenedor, el foco en el contenedor, Enter y Esc
llaman a lo mismo que los botones.

Título: "Abrir una demo". Bajada: "Se abrió un link de demo de <host del backend>." Después, en
este orden y solo lo que aplique:

1. **Sin enviar al backend** (destacado como error): "N ventas y M movimientos más que nunca
   llegaron a <host actual>. Se pierden para siempre." (`pendingSales`, `pendingOutbox -
   pendingSales`; sin host si no hay config legible).
2. **Venta en curso**: "La venta en curso (N líneas)."
3. **Historial de esta terminal** (ventas, cobranzas, movimientos de caja y arqueos): "Se borra de
   esta terminal; lo ya enviado queda en <host actual>."
4. **Conexión actual**: "Conexión a <host> · Sucursal X · Punto de venta Y", o "Demo de <plantilla>
   en <host>" con la terminal en demo. "Se reemplaza por la de la demo."
5. **Qué no se pierde**: "Se conservan el formato de impresión (/IMPRESORA) y el formato de números."

El catálogo y los clientes no se listan: vuelven con cualquier pull. Botones: "Cancelar (Esc)" y
"Borrar y abrir la demo (Enter)" (`.btn-danger`). Mientras revisa o abre la demo, los botones están
deshabilitados y Esc no hace nada; el texto dice qué espera ("Revisando los datos de esta
terminal…", "Abriendo la demo…").

## Demo revocada

- **Detección**: `sync/backend-status.ts::noteSyncFailure` (por donde ya pasa cualquier fallo de
  sync: `getInfo`, push y pull) marca la demo revocada si la config guardada tiene `demo` y el fallo
  es `sync/request-failed` con status 401 o 403. Fuera de demo, un 401 sigue siendo lo de hoy.
- **Estado** (`sync/demo-revoked.ts`): `markDemoRevoked(now)`, `clearDemoRevoked()`,
  `restoreDemoRevoked()`. Se guarda best-effort en `storageKey('demo-revoked')` (`{ at }`, validado
  con Zod al leer) y en `demoRevokedSignal` (`ui/state/sync.ts`), así un F5 sin red la sigue
  mostrando. Lo restaura `bootstrap`; lo borra `applyConnection` (cualquier conexión aplicada) y
  `syncNow`.
- **Motor**: con la demo revocada, `withConnectorCycle` no corre nada (ni `getInfo`): no se golpea al
  backend con 401 cada ciclo. `/SINCRONIZAR` borra la marca y prueba de nuevo; si vuelve a dar 401,
  se marca otra vez.
- **Barra de estado**: delante de todo, la marca **DEMO**, "La demo terminó" con estilo de error y
  el botón "Empezar una demo nueva (/DEMO_NUEVA)" en lugar del botón del alta. `/ALTA` sigue en el
  menú de "/".
- **`/DIAGNOSTICO`**: en la conexión, "Demo de <plantilla>" y, si está revocada, "revocada desde
  <hora>".

## `/DEMO_NUEVA`

- Comando core en `CORE_COMMANDS`, visible en `availableCommands` solo con la terminal en demo (como
  `/ALTA`).
- `ui/keyboard/onboarding-controller.ts::startNewDemo(navigate)`: arma el link con
  `sync/demo-link.ts::buildDemoLink(href, backend, template)` (función pura: origin + pathname de la
  URL actual, más `demo=true`, `backend` y `template`; anda en una carpeta de versión) y navega. El
  backend es `demo.backend ?? baseUrl`.
- De ahí en adelante, el flujo del link: sin datos del usuario aplica directo (otra caja); con datos,
  la confirmación. Con la demo revocada el envío previo da 401 y lo pendiente aparece como "sin
  enviar", que es lo que de verdad pasa.

## Convivencia con lo que ya existe

- **Excepción de borrado** ("Ciclo de vida de la conexión" en `AGENTS.md`): (a) pasa a ser "un link
  de demo **cuando no se pierde nada, o con la confirmación del operador**"; (b), la vuelta del alta,
  no cambia.
- **Vuelta con `#connect`** y **`wipe_key`**: sin cambios. Aplicar la conexión del alta borra la marca
  de demo revocada (la borra `applyConnection`).
- **Una sola pestaña (P2)**: nada nuevo. Una segunda pestaña no procesa la URL hasta tomar el
  control; ahí corre `bootstrap` y aparece la confirmación. `/DEMO_NUEVA` navega en la misma
  pestaña: la recarga suelta el cerrojo y lo vuelve a tomar (una segunda pestaña nunca lo pide
  sola).
- **Aviso "Esta terminal ya está conectada / tiene datos locales: se ignoró el link de demo."**: se
  elimina, junto con el caso `ignored`.
- **#143** (pasar de demo a producción): no cambia; esta etapa no toca el `dataEpoch`.

## Contrato, demo-backend y mini-erp

- **OpenAPI** (sigue 4.4.0, aclaración de significado): en `POST /demo-sessions` y en "Vuelta del
  onboarding", "un backend que revoca una demo responde 401 a todo request con esa key; el POS en
  demo lo toma como demo terminada y ofrece empezar una nueva (otro `POST /demo-sessions`)". También
  en la guía para integradores si menciona las demos. Sin referencias internas (lo vigila
  `site/docs.test.ts`).
- **demo-backend**:
  - Tabla `demo_keys` (`key`, `created_at`, `revoked_at`), que `resetToSeed` **no** borra.
  - `POST /demo-sessions` emite una key propia `demo-<aleatorio>` (`crypto.randomUUID`) y la guarda.
  - El router responde 401 a una key revocada (`{ error: 'La demo terminó' }`); cualquier otra key
    se acepta como hoy (la fija `demo-api-key` de los e2e y de quien lo configure a mano sigue
    andando).
  - Panel `/_demo`: botón "Revocar las demos" (`POST /_demo/revoke-demos`, sin autenticación como el
    resto del panel), que marca `revoked_at` en todas las keys emitidas.
  - La página falsa de alta sigue devolviendo la key fija `demo-api-key`: es la del comercio "real"
    que nace del alta, no la de la demo, así que nunca se revoca.
- **mini-erp**: un comentario en rauldiazsolis/mini-erp#24 (M8) con lo que el POS espera: 401 a la
  key revocada, y el mismo `POST /demo-sessions` para la demo nueva. Se publica con el ok del
  usuario.

## Tests

- **Unit**:
  - `ui/onboarding.test.ts`: la matriz de la decisión 1; `startDemo` (reintento sin template, falla
    sin borrar, aviso de plantilla); `demo.backend` guardado.
  - El controller de la confirmación: cancelar no toca nada y reanuda el sync; confirmar con una demo
    que falla no borra y vuelve con el aviso; confirmar con éxito vacía la venta en curso.
  - La pantalla: qué muestra con cada combinación de conteos y de conexión.
  - `noteSyncFailure`: 401/403 en demo marca; fuera de demo, no; otro status, no.
  - `sync/demo-revoked.ts`, `buildDemoLink`, `withConnectorCycle` con la demo revocada, `syncNow`
    borra la marca, `applyConnection` la borra.
  - Barra de estado (revocada) y `availableCommands` (`/DEMO_NUEVA` solo en demo).
  - demo-backend: keys propias, revocación, 401, `resetToSeed` no borra `demo_keys`, y que
    `demo-api-key` sigue andando.
- **e2e** (`e2e/demo-onboarding.spec.ts`, demo-backend en memoria de 4001):
  1. **Con datos sin sincronizar**: conexión real inalcanzable (`fixtures.ts`) y una venta offline;
     abrir el link muestra "1 venta … sin enviar". Esc: URL limpia, la venta sigue en IndexedDB y la
     pantalla es la venta. Abrir el link otra vez y Enter: la terminal queda en demo y `sales` vacía.
  2. **Demo revocada**: demo por link, `POST /_demo/revoke-demos`, `/SINCRONIZAR` → "La demo
     terminó"; click en "Empezar una demo nueva" → sin datos aplica directo, sin "La demo terminó",
     con una key distinta de la anterior.
  3. Los tests actuales de "conexión real ignora el link" pasan a esperar la confirmación, y la
     aserción de `apiKey: 'demo-api-key'` pasa a `demo-…`.

## Fuera de alcance

- Pasar de demo a producción sin repetir el onboarding (#143).
- Un código propio para la revocación en el contrato.
- Arrancar una demo nueva sola al detectar la revocación.
