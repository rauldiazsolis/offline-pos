# El portal en el POS: comando y botón

Fecha: 2026-10-04
Estado: diseño aprobado en el brainstorming del 2026-10-04; plan en
`docs/superpowers/plans/2026-10-04-portal-en-el-pos.md`.
Issue: #179 (etapa P6 del epic #182). Usa lo que trajo P5 (#178, contrato 4.6.0, spec
`docs/superpowers/specs/2026-10-04-contrato-4-6-portal-design.md`).

## Contexto

- Desde 4.6.0, un backend puede declarar la capacidad `portal` en `GET /info` junto con
  `portal: { command, label }`, y `POST /portal-links` (con la key, sin cuerpo) devuelve
  `201 { url, expiresAt? }`: la URL que el backend decide para esa credencial. El POS todavía no lo
  usa.
- El demo-backend ya la implementa con `/PANEL` ("Panel del backend"): link de un solo uso de 60 s,
  `GET /_demo/portal/<token>`, que muestra quién entró (sucursal y caja).
- Criterio de aceptación de #179: contra el demo-backend con la capacidad, el comando y el botón
  abren el backend en la caja correcta; contra un backend sin la capacidad no aparecen.

## Decisiones

### 1. Datos y estado

- `sync/connector.ts::backendInfoSchema` suma
  `portal: z.object({ command: /^[A-Z0-9_]{2,16}$/, label: z.string().trim().min(1) }).optional().catch(undefined)`:
  mal formado cuenta como ausente, sin tirar la `/info`. `BackendInfo.portal?` y
  `ProbeSnapshot.portal?`.
- `sync/backend-portal.ts`, calcado de `backend-company.ts`: `restoreBackendPortal`,
  `saveBackendPortal(portal | undefined)`, en `storageKey('backend-portal')` y
  `backendPortalSignal`. Lo escriben `applyConnection` (de la prueba) y `refreshBackendStatus` (cada
  `/info` exitosa; si el backend deja de mandarlo, se borra); lo restaura `bootstrap`. Estado
  operativo best-effort: una terminal que arranca sin red sigue mostrando el botón.
- Función pura `portalOffer(capabilities, portal)` → `{ command, label } | null`: `null` sin
  `"portal"` en `capabilities` o sin el objeto (las dos condiciones, como pide el contrato). Si
  `command` choca con un nombre del POS, usa `PORTAL`. Los nombres reservados son una lista fija en
  `ui/keyboard/commands.ts`, aunque el comando no esté disponible en ese momento: los del núcleo,
  `ACTUALIZAR`, `ALTA`, `DEMO_NUEVA` y los comandos de todos los conectores del registro
  (`DEMO_RESET`).
- **Visibilidad**: el comando y el botón aparecen siempre que haya oferta, también sin red, con el
  backend en mantenimiento o incompatible (al usarlos, el error explica por qué no abre). Única
  excepción: con la demo revocada se ocultan (la key ya no sirve y el encabezado ofrece
  `/DEMO_NUEVA`).
- `availableCommands()` suma `{ name: <command>, description: <label> }`; `runCommand` lo resuelve
  en el `default`, antes que los comandos del conector.
- `/DIAGNOSTICO`: una línea "Portal: /PANEL (Panel del backend)" o "Portal: no ofrecido".

### 2. El pedido y los errores (`sync/portal-link.ts`)

`requestPortalLink(config: RestConnectionConfig): Promise<Result<PortalLink>>`, con
`PortalLink = { url: string; expiresAt?: string }`. No pasa por el puerto `Connector` (como ya fija
`AGENTS.md`: solo existe en backends REST). Adaptador HTTP: los únicos `try/catch` son `fetch` y
`json()`.

- `POST <baseUrl>/portal-links` con `Authorization` y `X-POS-Contract-Version`, sin cuerpo. Los
  headers salen del mismo armado que usa el conector REST (se exporta, no se copia).
- **201** → se valida con Zod: `url` con `isAllowedBackendUrl` (`https:`, o `http:` a localhost);
  inválida → `sync/invalid-payload`. `expiresAt` opcional, con `.catch(undefined)`: es informativo.
- **401/403** → `sync/request-failed` con su status. Con la terminal en demo
  (`isDemoRevokedFailure`), además `markDemoRevoked(now)`: frena el sync y el encabezado pasa a
  "Empezar una demo nueva (/DEMO_NUEVA)", como si lo hubiera descubierto un ciclo. Lo marca el
  controller, no el adaptador.
- **404** → código nuevo `portal/not-offered` ("este backend no ofrece el portal"). No toca las
  capacidades guardadas: la próxima `/info` las corrige.
- **409** → `sync/incompatible-contract`, con el mismo parseo que el conector REST.
- **503** → `sync/backend-maintenance` con el `message` del `ErrorBody` si vino.
- **Sin red** → `sync/request-failed` sin status.
- El parseo de `ErrorBody` y la lectura del JSON que hoy están en `sync/demo-session.ts` pasan a un
  módulo compartido (`sync/http-body.ts`) en vez de copiarse.
- Config activa que no es `rest` ni `rest-demo` → `portal/not-offered` (no debería pasar: el puente
  de Sheets no declara la capacidad).
- Sin reintentos. La URL no se guarda ni se registra en el log de sync: si lleva autorización, es un
  secreto de un uso.

### 3. Abrir la pestaña y la UI

`ui/keyboard/portal-controller.ts::openPortal`, con dependencias inyectadas (abrir la pestaña, el
pedido, si el gesto sigue vigente, la hora). La usan el comando y el botón; el comando limpia la
barra antes.

**Cambio de la prueba manual**: el diseño aprobado abría la pestaña en blanco en el gesto y le
cargaba la URL al llegar la respuesta (la nota de P5 por el bloqueador de pop-ups). Con el backend
detenido o en mantenimiento, la pestaña se abría y se cerraba enseguida: la pantalla parpadeaba. Se
cambió a pedir el link primero y abrir la pestaña recién con él, aprovechando que el navegador
considera vigente el gesto durante unos segundos (en Chromium, 5 s).

1. Con un pedido en curso, no hace nada: un doble click o un Enter repetido no piden dos links.
2. Pide el link, sin abrir nada.
3. Éxito, con el gesto todavía vigente (`navigator.userActivation.isActive`; sin esa API se intenta
   igual) → `window.open(url, '_blank', 'noopener')`: la página del backend no puede tocar la
   pestaña del POS.
4. Éxito con el gesto vencido (el backend tardó más de lo que el navegador espera) → no se intenta
   (el bloqueador la frenaría sin avisar) y la barra dice "No se pudo abrir <label>: el backend tardó
   en contestar; probá de nuevo." Ese link de un solo uso se pierde; el próximo intento pide otro.
5. Fallo → ninguna pestaña, y `commandBarErrorSignal` = "No se pudo abrir <label>: <motivo>.", con
   el motivo de `ui/errors.ts`. Con 401/403 en demo, el motivo es "la demo terminó".
6. Todo mensaje reabre el overlay de la barra (`overlayDismissedSignal = false`): el `mousedown` del
   botón del encabezado cuenta como un click fuera del overlay y lo cierra (#28), y el error quedaba
   oculto (prueba manual; el mismo caso que `/CAJA` abierto desde la barra de estado).

El foco nunca sale de la barra del POS.

**Botón** en `TerminalHeader`, a la derecha: `.btn` (secundario) con `<label> (/<command>)`,
`tabIndex={-1}` y `keepFocusOnMouseDown`, como el de `/ALTA`. Con la demo activa queda a la
izquierda del de `/ALTA`, que sigue siendo el primario. Nunca parte su etiqueta: si falta lugar, se
recorta el título.

### 4. Lo que no cambia

El contrato (sigue 4.6.0), el demo-backend, el puente de Google Sheets y la versión del POS (la
decide el release aparte).

## Tests

- `sync/connector.test.ts`: `portal` válido, ausente y mal formado (minúsculas, con `/`, de 1 o 17
  caracteres, `label` vacío) → ausente sin tirar la `/info`.
- `sync/backend-portal.test.ts`: guardar, restaurar y borrar; `portalOffer` sin capacidad, sin
  objeto, con choque (→ `PORTAL`) y con un nombre libre.
- `sync/portal-link.test.ts` (`vi.stubGlobal('fetch')`): 201 válido, URL `http:` remota, 401, 404,
  409, 503 con y sin `message`, sin red; los headers y que no manda cuerpo.
- `ui/keyboard/portal-controller.test.ts`: éxito abre la URL; un fallo no abre nada y deja el
  mensaje, aunque el overlay estuviera cerrado; 401 en demo marca la demo revocada; gesto vencido;
  doble uso ignorado.
- Comandos y `TerminalHeader`: aparecen con la oferta, no sin ella ni con la demo revocada; el botón
  y el comando llaman a lo mismo.
- `apply-connection` y `backend-status`: guardan y borran el portal.
- E2E en `e2e/demo-onboarding.spec.ts` (va en serie contra el demo-backend del `4001`): abrir una
  demo, usar `/PANEL` y después el botón; cada uno abre una pestaña que muestra la sucursal y la caja
  de esta terminal. Con el backend en mantenimiento, el botón no abre ninguna pestaña y el motivo se
  ve en la barra. "Sin la capacidad no aparecen" queda en los unitarios: el demo-backend siempre la
  declara y no se le agrega un interruptor solo para esto.

## Docs

- `src/sync/AGENTS.md`: en "Contrato 4.6.0", los módulos nuevos en vez de "el POS todavía no la usa".
- `src/ui/AGENTS.md`: el comando, el botón, cuándo se abre la pestaña y los errores.
- `AGENTS.md` raíz: el comando del portal en la tabla de comandos, la fila de #179 en "Estado del
  proyecto", #179 fuera de "Siguiente" y de "Issues abiertas", y #205 (flake de
  `e2e/mouse.spec.ts`) en "Transversal".

## Cierre

PR con "Closes #179"; comentario en el issue apuntando al PR y #179 tildado en el epic #182.
