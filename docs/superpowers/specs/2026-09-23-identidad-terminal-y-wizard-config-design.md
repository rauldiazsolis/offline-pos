# Identidad de terminal, `/CONFIG` como wizard y teclado + mouse en todas las pantallas

Fecha: 2026-09-23
Estado: diseño aprobado por el usuario en la sesión de brainstorming, pendiente de plan.
Issue: #97 (Etapa 2 del epic #94). Depende de la Etapa 1 (#96, PR #107, contrato v3).

## Contexto

La Etapa 1 dejó el id de dispositivo generado y reusado (`sync/terminal-identity.ts`, clave
`offline-pos:device-id`) y "Sucursal"/"Punto de venta" como campos **opcionales** de `/CONFIG`,
estampados en cada evento al encolarlo. El contrato v3 los declara obligatorios, "tolerados ausentes
hasta #97". Esta etapa:

1. Implementa el **ciclo de vida del id** (sin id, la terminal arranca de cero).
2. Vuelve **obligatorios** sucursal y punto de venta.
3. Hace que cambiar la conexión **nunca borre datos automáticamente**: el usuario elige mantener o
   borrar lo local.
4. Rehace `/CONFIG` como **wizard de instalación** con resumen visible y vuelta a cualquier paso
   (reemplaza para `/CONFIG` el criterio de #49, "no un wizard secuencial que oculta lo ya cargado").
5. Fija el patrón **teclado + mouse** (referencia: `/RESUMEN`) y lo aplica a `/CONFIG`, a la pantalla
   de venta (barra de comandos y sus overlays), `/ANULAR`, comprobante, `/DIAGNOSTICO`, `/DEMO_RESET` y
   `/RESUMEN`.

Principio rector del epic: con una configuración registrada, la app nunca le impide trabajar al
usuario.

## 1. Identidad y modelo de config

### Ciclo de vida del id de dispositivo

- `sync/terminal-identity.ts::resolveDeviceIdentity()` se llama **una sola vez, al principio de
  `bootstrap()`** (antes de cargar repositorios). Resultado:
  - Hay id guardado → se cachea en memoria del módulo.
  - **No hay id** → la terminal perdió su identidad:
    1. `clearAllTables()` (todas las tablas de Dexie), `clearSyncCursors()`, `clearPushLotState()`;
    2. la config de `/CONFIG` se **conserva como precarga, sin `verifiedAt`** (obliga a volver a
       probar la conexión, pero no a retipear URL/tipo/sucursal);
    3. se genera (`crypto.randomUUID()`) y guarda un id nuevo;
    4. si se borró algo (había datos locales o una config), se prende `identityResetSignal`
       (`ui/state/sync.ts` o `ui/state/sync-config.ts`) para que el paso 1 del wizard lo avise:
       "Esta terminal no tenía identidad: se reinició con datos vacíos". Una instalación nueva pasa
       por el mismo camino sin aviso.
- `getDeviceId()` devuelve el id cacheado y **nunca crea uno**. Si alguien borra la clave desde
  DevTools a mitad de sesión, la terminal sigue con su id hasta recargar; recién ahí se aplica el
  ciclo de vida. Nunca pushea datos viejos con un id nuevo.
- `pos.deviceId()` antes de `bootstrap()` devuelve `null`.
- El fallback en memoria si `localStorage` lanza se mantiene (best-effort, como hoy).
- `pos.reset()` no cambia: borra todo, config incluida (es el "dejar como nueva" deliberado).
- Riesgo aceptado (epic #94): al desplegar, una terminal sin id pierde lo local una vez, incluidos
  pendientes sin enviar.

### Sucursal y punto de venta obligatorios

- `syncConfigSchema` los sigue **tolerando ausentes al leer** (una config de la Etapa 1 se lee y sirve
  de precarga). Lo obligatorio lo imponen el estado de conexión y la validación del wizard (texto no
  vacío tras `trim`).
- `sync/connection-state.ts::ConnectionState` suma **`incomplete`**:
  `unconfigured` | `unverified` | `incomplete` (con `verifiedAt` pero sin sucursal o punto de venta) |
  `active`. Todo lo que no sea `active` muestra solo el wizard (modo requerido), como hoy.
- Con `incomplete`, el wizard abre en el paso 1; completar los dos campos guarda **sin volver a
  probar** y conserva `verifiedAt` (ver §3, camino 1).
- Cambiar sucursal/punto de venta no toca lo ya encolado: los eventos nuevos se estampan con los
  valores nuevos, los pendientes conservan su `origin` (auditoría).
- `currentEventOrigin()` sigue igual; con `active` siempre trae los dos valores.

### Contrato

- El POS manda siempre `origin` completo y `deviceId`. En `docs/connector-api.openapi.yaml` la nota
  "tolerados ausentes hasta #97" pasa a: "el POS los manda siempre; un evento encolado antes de la
  Etapa 2 puede llegar sin ellos". Versión del contrato sin cambios (3.0.0).
- Minibackend y puente de Sheets **no cambian**: siguen guardando vacío lo que falte.

## 2. `/CONFIG` como wizard

### Modelo puro

`ui/keyboard/config-wizard-model.ts` — sin DOM ni async, testeable con tablas. Entradas:

- formulario: terminal (`branch`, `pointOfSale`, `locale`), tipo elegido, valores de campos por tipo;
- config guardada (o ninguna);
- última prueba: resultado + clave de la conexión con la que se hizo;
- resumen de datos locales (`LocalDataSummary`);
- elección de datos locales (`keep` | `wipe`, default `keep`).

Salidas:

- los 6 pasos, cada uno con estado `pending` | `complete` | `error` | `skipped` (con motivo) y un
  texto de resumen para la columna lateral (credenciales como `•••`);
- `connectionChanged`: el tipo o algún campo del conector (normalizados, tras `trim`) difiere de la
  config guardada **y verificada** (sin config verificada = cambiada);
- `probeValid`: hay una prueba exitosa hecha exactamente con la conexión cargada ahora;
- `applyAction`: `save-terminal` (la conexión no cambió) | `apply-connection` con `keep`/`wipe`;
- pasos alcanzables: cualquiera hasta el primer paso no completo, nunca más allá.

Reglas de salteo:

- **Probar** se saltea si `!connectionChanged` ("Ya probada el <fecha de verifiedAt>").
- **Datos locales** se saltea si `!connectionChanged` o si no hay datos del usuario
  (`hasUserData`: ventas, turnos, pendientes del outbox, venta en curso). Catálogo/clientes solos no
  cuentan: con cualquiera de las dos opciones terminan reemplazados por la foto nueva.

### Pasos

1. **Terminal** — Sucursal, Punto de venta (obligatorios), Locale (opcional). Muestra el aviso de
   identidad perdida si `identityResetSignal` está prendido.
2. **Tipo de conexión** — las opciones de `CONNECTOR_TYPES` como lista: ↑/↓ + Enter, o click, eligen y
   avanzan. Cada una con una descripción corta (campo nuevo `description` en `CONNECTOR_TYPES`).
   Cambiar de tipo conserva lo tipeado en el otro (como hoy).
3. **Datos del conector** — los campos del tipo (`configFields`) más un bloque de instrucciones del
   tipo (campo nuevo `setupHelp: string[]` en `CONNECTOR_TYPES`, pasos numerados):
   - Google Sheets: pegar `bridge.gs` y `columnas.gs` en un proyecto de Apps Script de la planilla,
     desplegar como Web App (Ejecutar como: yo; Quién tiene acceso: cualquiera), copiar la URL que
     termina en `/exec`; detalle en `src/connectors/google-sheets/README.md`.
   - REST genérico: el backend tiene que implementar el contrato v3
     (`docs/connector-api.openapi.yaml`); URL base y API key si el backend la pide.
   - REST (minibackend de demo): levantarlo con `pnpm dev` (Vite + minibackend) o solo el minibackend con `pnpm --filter demo-backend start`, URL
     `http://localhost:4000`.
4. **Probar** — arranca solo al entrar al paso (y con "Reintentar"). Mientras espera:
   - **spinner** animado (estático con `prefers-reduced-motion`);
   - qué se está haciendo, vía un parámetro nuevo opcional de `probeConnection`,
     `onProgress(stage)` con `stage` `'waiting-lock'` ("Esperando que termine una sincronización en
     curso…") | `'pulling'` ("Pidiendo productos, stock y clientes a `<host>`…");
   - segundos transcurridos y el tope ("máx. 20 s", `PROBE_TIMEOUT_MS`);
   - con Google Sheets, pasados 3 s: "Google Sheets suele tardar entre 5 y 20 segundos".

   Éxito: "Conexión OK: N productos, M clientes"; Enter sigue. Falla: mensaje de `describeError` con
   "Reintentar (Enter)" y "Corregir datos (Alt+3)".
5. **Datos locales** — "Mantener" (preseleccionada) o "Borrar" (↑/↓ o click; Enter avanza). Con
   Mantener y origen cambiado, avisa: "N eventos sin enviar se van a mandar a la conexión nueva". Con
   Borrar: envío previo a la conexión actual y segunda confirmación (ver §3, camino 3).
6. **Revisar** — todo lo cargado y qué va a pasar al aplicar ("Se guarda la sucursal y el punto de
   venta" / "Se conecta a `<host>` y se conservan N ventas" / "Se conecta a `<host>` y se borran los
   datos locales"). "Aplicar (Enter)" con spinner; al terminar vuelve a la venta.

### Navegación

- **Arranque**: en instalación, `unverified`, `incomplete` o tras perder la identidad, en el primer
  paso no completo. Con la terminal `active` (entrando por `/CONFIG`), en **Revisar**.
- **Enter**: valida el paso actual y avanza al siguiente no salteado. Un error deja el campo afectado
  enfocado y seleccionado (como hoy, `useLayoutEffect`).
- **Alt+1…6** o click en un paso de la columna lateral: saltan a ese paso si es alcanzable.
- **Alt+←** / botón "Atrás": paso anterior no salteado.
- **Ctrl+Enter** desde cualquier paso: avanza validando hasta donde haga falta el usuario — se frena
  en el primer paso con error, en Probar (lanzando la prueba si no está vigente), en Datos locales si
  corresponde, o en Revisar.
- **Esc**: probando → cancela la prueba (queda en el paso 4, "Prueba cancelada"; el token descarta el
  resultado, como hoy); en la confirmación de borrado → vuelve a las opciones; aplicando → se ignora;
  resto → sale sin guardar si la terminal está `active`, nada en modo requerido. Solo en el primer caso
  hay botón "Cancelar (Esc)".
- Tab/Shift+Tab: nativo, entre los controles del paso.
- El sync de fondo sigue en pausa mientras el wizard está abierto (`syncPausedSignal`, como hoy).

### Layout

- Diálogo de hasta ~860px de ancho lógico: columna izquierda con los pasos (número, título, estado,
  resumen), a la derecha el paso actual, pie con la ayuda de atajos y los botones.
- Vive dentro de `.app-zoom-wrapper`: ancho lógico ≥ 1024px siempre, así que el diálogo entra; entre
  600 y 1024px reales se ve achicado igual que el resto de la app. Ningún texto por debajo de
  `--font-size-sm`. El contenido del paso scrollea por dentro; columna de pasos y pie quedan fijos (el
  alto también se achica con el zoom). Verificación con capturas a 600, 1024 y 1440px.

### Estado y controller

- `ui/state/sync-config.ts`: se reemplaza `configPhaseSignal` por el paso actual y el estado async
  (`idle` | `probing` | `flushing` | `confirming-wipe` | `applying`), más prueba, progreso, elección de
  datos locales e `identityResetSignal`.
- `ui/keyboard/config-controller.ts`: solo orquesta lo async (probar, enviar antes de borrar,
  aplicar) consultando el modelo; mantiene el token de cancelación.
- `ui/screens/config-screen.tsx`: se reescribe; componentes por paso en el mismo archivo o en
  `ui/screens/config-wizard/` si crece.

## 3. Aplicar

`applyConnection` pasa de `wipe: boolean` a `local: 'keep' | 'wipe'` más `originChanged: boolean`.
Tres caminos según `applyAction`:

### Camino 1 — solo terminal (`save-terminal`)

Guarda la config con `branch`/`pointOfSale`/`locale` nuevos, conservando `verifiedAt`. Sin prueba,
sin cerrojo, sin tocar IndexedDB. Si el estado era `incomplete`, pasa a `active`. Reanuda el sync y
vuelve a la venta.

### Camino 2 — conexión cambiada, Mantener (`keep`)

- En la transacción Dexie de siempre (`db.tables`), la foto se aplica con la lógica de
  `reconcileSnapshot` en vez de `bulkPut`: se refactoriza su cuerpo a una función interna invocable
  dentro de una transacción ya abierta. Borra productos/clientes/stock/cuentas que la foto no trae,
  conserva clientes creados acá con alta pendiente.
- Ventas, turnos, movimientos, venta en curso y outbox quedan intactos.
- **Origen cambiado**: se descarta el estado de lotes del backend viejo (lote congelado con su
  `idempotency_id` y lotes en espera) — los pendientes salen en un lote nuevo al backend nuevo. Lo ya
  enviado al viejo no se reenvía. La salvaguarda "tabla que llega vacía no borra" **no** aplica (un
  backend nuevo vacío es legítimo).
- **Mismo origen** (p. ej. cambió la API key): el estado de lotes se **conserva** (corrige un riesgo
  actual: `applyConnection` lo borraba siempre y un lote congelado cuyo ack se perdió se reenviaría con
  otro `idempotency_id` al mismo backend). La salvaguarda de tabla vacía sigue activa.

### Camino 3 — conexión cambiada, Borrar (`wipe`)

- Al elegir Borrar y avanzar: `flushPendingBeforeWipe(current)` a la conexión **actual** (solo si hay
  config actual y `navigator.onLine`), con spinner y "Enviando N eventos pendientes a
  `<host actual>`…", con su tope de tiempo de siempre.
- Luego la confirmación con los conteos (`LocalDataSummary`, lo no enviado destacado): Enter o "Borrar
  y cambiar" aplica, Esc o "Volver" regresa a las opciones.
- Aplicar: `clearAllTables` + carga de la foto en una transacción (como hoy); en memoria se vacían
  venta en curso y cliente adjunto.

### Paso 5 salteado

Sin datos del usuario: origen cambiado → `wipe` (lo que queda es catálogo ajeno), mismo origen →
`keep`. Incluye la identidad perdida (ya no queda nada local).

### Común a los caminos 2 y 3

Toma el cerrojo de sync, reinicia cursores y fija los de la foto, reconstruye repositorios en memoria
y guarda la config con `verifiedAt` **al final** (mismo riesgo residual aceptado que hoy). Cualquier
falla deja el wizard en Revisar con el error y sin cambios. Al terminar: vuelve a la venta, reanuda el
sync, `runPushThenPull()`.

`planConnectionChange` y el borrado automático por cambio de origen desaparecen; `originKey` se
mantiene (lo usa el modelo para `originChanged`).

## 4. Teclado y mouse

### Patrón

`ui/hooks/use-mouse-keeps-focus.ts` — devuelve el `onMouseDown` para el contenedor de una pantalla:

- Con el **botón izquierdo** (`event.button === 0`) cancela el `mousedown` salvo sobre controles de
  texto (`input`, `textarea`, `select`): el foco se queda donde estaba, incluso al clickear un botón, y
  el `click` se dispara igual.
- Con cualquier otro botón no hace nada: la rueda y el autoscroll con el botón del medio siguen
  andando (hoy `/RESUMEN` cancela todos los botones — se corrige al migrar).

Convención (sección nueva "Teclado y mouse" en CLAUDE.md):

- Todo lo clickeable es un `<button>` o una fila con `onClick` que llama a la **misma función del
  controller** que su tecla.
- Todo atajo visible tiene su botón, con el atajo en la etiqueta ("Cerrar (Esc)"), y viceversa.
- El hover es decorativo: nunca mueve la selección.

### Venta y barra de comandos

- **Click en una fila de un overlay** (comandos, clientes incluyendo "Consumidor Final" y "+ Crear
  cliente…", artículos incluyendo líneas libres): `command-bar-controller.ts::activateCommandBarRow(
  list, index)` fija la selección real en el signal de esa lista y llama a `submitCommandBar()` — mismo
  camino que Enter (incluye `pendingBarOperation`). Ejecuta de una.
- **Click fuera del overlay** (carrito, tarjetas, barra de estado): `dismissCommandBarOverlay()`, sin
  tocar el buffer (igual que Esc, #28). El input nunca pierde el foco (el hook, con la barra de comandos
  como único control de texto).
- Hover: resaltado tenue, distinto del de selección.
- Filas del carrito sin click (Etapa 4).

### Comandos habilitados

- `CommandInfo` suma `availability?: () => { enabled: true } | { enabled: false; reason: string }`,
  derivada de signals (se recalcula dentro de `commandResultsSignal`).
- `/COBRAR`: deshabilitado sin artículos y sin cliente adjunto, motivo "sin artículos ni cliente". Con
  cliente y sin artículos, sin cambios respecto de hoy.
- Filas deshabilitadas: atenuadas, con el motivo; las flechas las saltean; el click no hace nada.
- Preselección: la fila 0 solo si está habilitada; si no, nada seleccionado (el render deja de usar
  `?? 0` a secas; `moveSelectionOver`/`assumeFirstSelected` se adapta).
- Enter sin selección: si el nombre tipeado coincide exactamente con un comando deshabilitado, muestra
  su motivo en el slot de error; si no, no hace nada.
- Ctrl+Enter / `/COBRAR` deshabilitado: `triggerCheckout` muestra el motivo en el slot de error (el
  chequeo de turno abierto sigue igual, hasta la Etapa 5).

### Pantallas que se revisan

- `/ANULAR`: filas clickeables (click = seleccionar + Enter, abre la confirmación); en la confirmación
  "Anular (Enter)" y "Volver (Esc)"; fuera de ella "Volver a la venta (Esc)". Hook.
- Comprobante: hook (los botones ya existen).
- `/DIAGNOSTICO`: hook y "Cerrar (Esc)".
- `/DEMO_RESET`: hook y botones de confirmar y cancelar con su atajo.
- `/RESUMEN`: migra al hook compartido, sin cambio de comportamiento salvo el botón del medio.
- `/CONFIG`: nace con el patrón (pasos, opciones y botones clickeables).

Fuera de esta etapa: cobro (Etapa 4), `/CAJA` (Etapa 5), click en el carrito (Etapa 4).

## 5. Pruebas

### Vitest

- Modelo del wizard (tablas): salteos, `connectionChanged`, `probeValid`, `applyAction`, pasos
  alcanzables, resúmenes con credenciales ocultas.
- Identidad: con id, sin id con datos (borra, conserva config sin `verifiedAt`, aviso), instalación
  nueva (sin aviso), `getDeviceId` no crea.
- `connectionState` con `incomplete`.
- `applyConnection`: camino 1 (conserva `verifiedAt`), camino 2 con origen cambiado (reconcilia,
  descarta lotes, tabla vacía borra) y mismo origen (conserva lotes, salvaguarda activa), camino 3.
- `probeConnection` con `onProgress`.
- Controller: orquestación de prueba, cancelación, envío previo al borrado, aplicar.
- Pantalla del wizard: Enter, Alt+N, Alt+←, Ctrl+Enter, click en pasos y opciones, Esc por estado,
  spinner y textos de progreso.
- Comandos: disponibilidad, preselección, flechas que saltean, Enter sin selección, click en filas de
  los tres overlays, click fuera cierra.
- Hook de mouse: botón izquierdo sobre no-texto cancela, sobre input no, botón del medio no.
- Botones nuevos de `/ANULAR`, `/DIAGNOSTICO`, `/DEMO_RESET`.

### e2e (Playwright)

- `e2e/fixtures.ts::ACTIVE_CONFIG` suma `branch` y `pointOfSale`.
- `connection-lifecycle.spec.ts` y `config-connector.spec.ts` reescritos sobre el wizard.
- Nuevo: identidad perdida (borrar `offline-pos:device-id`, recargar, ver el wizard con aviso y sin
  datos, config precargada).
- Nuevo: mouse — recorrer el wizard solo con clicks; agregar un producto clickeando el overlay sin que
  la barra pierda el foco.
- `keyboard-only.spec.ts` actualizado.

### Prueba en navegador (cierre)

App + minibackend de demo, con pasos y resultado esperado para: instalación desde cero; cambiar solo
la sucursal; cambiar de conexión con Mantener (pendientes que viajan al backend nuevo) y con Borrar;
config de la Etapa 1 sin sucursal (`incomplete`); identidad perdida; mouse en venta (overlays,
`/COBRAR` deshabilitado) y en el wizard; `/ANULAR`, `/DIAGNOSTICO`, comprobante con mouse; ventana a
600px.

## 6. Documentación

- `docs/connector-api.openapi.yaml`: nota de identidad (§1).
- `CLAUDE.md`: "Ciclo de vida de la conexión" (wizard, mantener/borrar, `incomplete`, identidad),
  sección nueva "Teclado y mouse", `/CONFIG` en "UX keyboard-first", menú de "/" (comandos
  habilitados), Ciclo 10 ("las demás pantallas sin mouse" deja de ser cierto), "Utilidades de consola"
  (`pos.deviceId()` antes del arranque), "Estado del proyecto".

## Fuera de alcance

- Motor de sync con eventos reaplicados y limpieza a 1 semana (Etapa 3, #98).
- Venta: cobro, carrito clickeable, bloqueos y decimales en la UI (Etapa 4, #99).
- Caja sin turnos, `/CAJA` y `/RESUMEN` por fecha (Etapa 5, #100).
- Cobranza sin venta; qué hace `/COBRAR` con cliente y sin artículos (Etapa 6, #101).
- Cambios en minibackend o puente de Sheets (siguen tolerando `origin` vacío).
- Prueba manual del conector de Sheets contra una planilla real (pendiente de la Etapa 1, la hace el
  usuario).
