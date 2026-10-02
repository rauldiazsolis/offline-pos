# Una sola pestaña del POS por instancia del navegador

Fecha: 2026-10-02
Estado: diseño aprobado en el brainstorming del 2026-10-02; plan en `docs/superpowers/plans/2026-10-02-una-sola-pestana.md`.
Issues: #175 (etapa P2 del epic #182, MVP de mini contax, antes del hito 1). Spec del MVP:
`docs/superpowers/specs/2026-10-01-mvp-mini-contax-design.md` en rauldiazsolis/mini-erp, sección
"POS (offline-pos)".

## Contexto

Dos pestañas del POS que comparten almacenamiento (mismo origen y misma carpeta, ver
"Almacenamiento por carpeta" en `src/storage/AGENTS.md`) hoy corren las dos completas: dos motores de
sync con cerrojos en memoria que no se ven entre sí, dos ventas en curso que se pisan en `draftCart`,
dos contadores de tickets leyendo y escribiendo el mismo `localStorage`. Nada lo impide. El MVP pide,
como WhatsApp Web, que la segunda muestre un aviso y no opere y, si los navegadores lo permiten, un
link a la pestaña original.

## Lo verificado en Chromium

Spike del 2026-10-02 con Chrome estable (no el Chromium de Playwright), dos pestañas en la misma
ventana, manejado por CDP crudo: con Playwright conectado, su emulación de foco hace que las dos
pestañas digan `visible`, así que la medición no servía.

| Mecanismo | Resultado |
|---|---|
| `navigator.locks.request(nombre, { ifAvailable: true })` | La segunda ve el cerrojo tomado |
| `navigator.locks.request(nombre)` en espera | Al cerrarse la primera, la segunda lo recibe sola |
| `window.focus()` en la original, pedido por `BroadcastChannel` justo después de un click real en la segunda (con activación de usuario) | La original sigue `hidden`: Chrome no la trae al frente |
| `window.open('', nombre)` con `window.name` puesto en la original | Abre una pestaña en blanco nueva: no la encuentra (contextos sin relación de `opener`) |
| `alert()` en la original | El diálogo se abre pero la pestaña sigue en segundo plano, y le bloquea el JS |

Lo único que enfoca otra pestaña en Chromium es `WindowClient.focus()` desde un service worker
dentro de un `notificationclick`: necesita el service worker (#54) y permiso de notificaciones. Queda
afuera de esta etapa. **No hay "ir a la pestaña original"**: la segunda lo indica con texto y con su
título, y ofrece usarla a ella.

## Decisiones

Tomadas en el brainstorming del 2026-10-02:

- **`navigator.locks` decide qué pestaña manda; `BroadcastChannel` solo lleva el pedido de traspaso.**
  Descartados: un latido por `BroadcastChannel` o `localStorage` (no detecta bien un cierre ni una
  pestaña congelada) y `navigator.locks` con `steal` como único mecanismo (la original pierde el
  cerrojo de golpe, sin poder terminar lo que estaba haciendo).
- **La segunda nunca toma el control sola**: un botón "Usar esta pestaña", como WhatsApp Web. Una
  toma automática al liberarse el cerrojo haría que un F5 en la original, `pos.reset()` (que recarga)
  o la ida al alta de la demo le pasaran el control a otra pestaña sin que nadie lo pida.
- **La original suelta siempre, sin cortar a medias**: espera a que termine lo que no se puede cortar
  y se recarga como segunda. Lo que solo estaba en pantalla (Cobro sin confirmar, campos del wizard)
  se pierde; la venta en curso no, porque ya está en `draftCart`.

## Nombre del cerrojo y del canal

`storage/storage-namespace.ts::TAB_LOCK_NAME = \`${STORAGE_NAMESPACE}:tab\``, el mismo nombre para
el cerrojo y el `BroadcastChannel`. Los dos ya están separados por origen; con el namespace, además,
`/0.1.0/` y `/0.2.0/` del mismo origen nunca se bloquean entre sí, y la raíz (`offline-pos:tab`)
tampoco con ninguna carpeta.

## Arranque

`main.tsx`, antes que todo lo demás (consola `pos.*` incluida), llama a
`ui/tab-leadership.ts::claimTab()`:

- **Consigue el cerrojo** (`ifAvailable`): lo retiene mientras viva la página (el callback devuelve
  una promesa que nunca se resuelve), empieza a escuchar el canal y sigue como hoy: consola `pos.*`,
  `bootstrap()`, render.
- **No lo consigue**: no corre `bootstrap()` ni instala la consola, así que no hay identidad,
  onboarding, repositorios, sync ni persistencia del carrito. Muestra la pantalla de la segunda
  pestaña. La URL queda intacta: un `?demo=…` o un `#connect=…` se procesa recién cuando esta pestaña
  toma el control, con las reglas de siempre.
- **Sin `navigator.locks`** (contexto no seguro o navegador viejo; el POS se sirve por `https:` o
  `localhost`): arranca como hoy, sin restricción. No se bloquea la venta por falta de una API.

`ui/tab-leadership.ts` recibe `locks`, el canal, `reload` y los tiempos inyectados (como el
`Connector` falso del motor): es lógica de coordinación testeable sin navegador.

## Traspaso: "Usar esta pestaña"

En la segunda:

1. Manda `{ type: 'release-request' }` por el canal y pide el cerrojo **en espera**.
2. Si en `STEAL_AFTER_MS` (5 s) no lo recibió (la original está colgada, congelada o con un `alert`
   abierto), lo pide con `steal: true`.
3. Con el cerrojo, corre el mismo arranque que una pestaña que lo consiguió de entrada (`bootstrap()`
   y render), sin recargar. Ya tiene el cerrojo, y como nunca arrancó no hay estado previo que
   limpiar.

En la original, al recibir `release-request` (una sola vez; los pedidos repetidos se ignoran):

1. Pausa el sync (`syncPausedSignal`).
2. Espera el cerrojo de sync (`acquireSyncLockWaiting`) y lo retiene: así no corta un push o un
   pull, ni aplicar una conexión, ni `pos.reset()` (los tres lo toman), y no arranca ningún ciclo nuevo.
3. Espera a que no quede ninguna transacción de IndexedDB abierta (ver más abajo): así no corta un
   cobro, una anulación o un movimiento de caja que se está guardando, ni ninguna escritura futura.
4. Todo con un tope de `RELEASE_WAIT_MS` (4 s, menos que el de la segunda), y después marca en
   `sessionStorage` que la desplazaron y hace `location.reload()`. Al descargarse suelta el cerrojo; al
   recargar queda como segunda pestaña, con el aviso.

Si a la original le quitan el cerrojo con `steal`, la promesa de su `request` se rechaza
(`AbortError`): marca que la desplazaron y se recarga igual.

**Contador de transacciones**: un middleware de Dexie (`db.use`, capa `dbcore`, en `storage/`) cuenta
las transacciones abiertas (suma al crearlas, resta en `complete`, `abort` o `error`) y expone
`waitForIdleTransactions(timeoutMs)`. Es genérico a propósito: una tabla o un repositorio futuro queda
cubierto sin acordarse.

**Riesgo aceptado**: el cobro con cuenta corriente pide la reserva por red antes de abrir la
transacción. Si el traspaso cae justo en esa espera, la reserva queda aprobada en el backend sin venta
y se libera sola al vencer, como cualquier reserva sin usar.

## La segunda pestaña

`ui/screens/secondary-tab-screen.tsx`: Preact con los tokens de `tokens.css`, sin signals de la app
(nada de la app está inicializado).

- Título "El POS está abierto en otra pestaña" y el texto "Este navegador ya lo está usando en otra
  pestaña o ventana. Volvé a esa, o usalo acá: la otra se recarga y queda sin usar."
- Si quedó así porque la desplazaron (la marca de `sessionStorage`, por pestaña, que sobrevive a su
  propio reload, con clave `storageKey('tab-displaced')`; se borra al leerla), arriba: "Se empezó a
  usar el POS en otra pestaña."
- `document.title` = "POS en otra pestaña", para distinguirla en la barra de pestañas (la que manda
  conserva el título de siempre).
- Botón `.btn-primary` "Usar esta pestaña (Enter)", con foco al cargar. Enter y click llaman a la
  misma función, con el patrón de "Teclado y mouse". Mientras traspasa dice "Tomando el control…" y
  no responde a nada más.
- Sin barra de comandos, venta ni sync: no hay nada más que hacer en esta pantalla.

La original no avisa nada cuando se abre una segunda: está en segundo plano y nadie la mira.

## Convivencia con lo que ya existe

- **Cerrojo de sync** (`sync/engine.ts`): no cambia. Sigue en memoria y por pestaña: solo la que
  manda tiene motor. El traspaso lo usa para no cortar un ciclo.
- **`pos.reset()`, F5, `/ALTA`** (la original navega al alta y vuelve con `#connect`): la original
  suelta el cerrojo al descargarse y lo vuelve a tomar al cargar, porque ninguna segunda espera en
  silencio. Si en el medio alguien tocó "Usar esta pestaña", la que vuelve queda como segunda con su
  `#connect=…` intacto, y se procesa cuando tome el control. El `wipe_key` vive en `localStorage`, así
  que sigue valiendo.
- **Wizard de `/CONFIG`**: probar y aplicar toman el cerrojo de sync, así que el traspaso los espera.
  Lo cargado en el formulario se pierde.
- **Arranque fallido**: el canal se escucha desde `claimTab()`, antes de `bootstrap()`, así que una
  original con la pantalla fatal suelta igual (sin sync en vuelo ni transacciones). Si no contesta,
  se le quita con `steal`.
- **Link de demo en una segunda pestaña**: no se aplica ni se ignora; espera a que esa pestaña tome el
  control. Que el link avise que el POS tiene datos queda para P3 (#176).
- **e2e existentes**: cada test abre su propio contexto y ninguno abre dos páginas en el mismo, así
  que no se cruzan.

## Tests

- **Unit** (`ui/tab-leadership.test.ts`, con `locks` y canal falsos hechos a mano): consigue o no el
  cerrojo; traspaso cooperativo (pausa, espera el cerrojo de sync y las transacciones, recarga y marca);
  pedido repetido ignorado; tope de espera en la original; `steal` al vencer el tope en la segunda;
  desplazada por `steal`; sin `navigator.locks`.
- **Contador de transacciones** (`storage/`, con `fake-indexeddb`): cuenta una transacción abierta,
  vuelve a 0 al terminar o al abortar, y `waitForIdleTransactions` resuelve o vence.
- **Pantalla** (Testing Library): textos, el aviso de desplazada, foco en el botón, Enter y click
  llaman a lo mismo, estado "Tomando el control…".
- **e2e** `e2e/single-tab.spec.ts`, dos páginas en el mismo contexto:
  1. La segunda muestra el aviso y no tiene barra de comandos.
  2. Con una línea en la venta de la primera, "Usar esta pestaña" en la segunda: la segunda vende con
     esa línea, y la primera queda como segunda con "Se empezó a usar el POS en otra pestaña".
  3. Con la original cerrada, el botón toma el control enseguida.
  4. Una tercera página **en otra carpeta del mismo origen** arranca con su propio almacenamiento
     (`/CONFIG` requerido) y no ve el aviso. El sitio de `site:preview` tiene una sola carpeta de
     versión, así que no alcanza: se sirve el build real en otra ruta con `page.route`
     (`/otra-carpeta/*` → el mismo `dist` de 4173). Funciona porque la app usa rutas relativas.

## Fuera de alcance

- Enfocar la pestaña original (service worker y notificaciones, después de #54).
- Avisarle a la original que se abrió una segunda.
- Un link de demo abierto en una segunda pestaña con aviso propio (P3, #176).
