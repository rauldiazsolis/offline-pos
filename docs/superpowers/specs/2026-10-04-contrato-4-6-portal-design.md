# Contrato 4.6.0: capacidad `portal`, 429 y 503

Fecha: 2026-10-04
Estado: diseño aprobado en el brainstorming del 2026-10-04; plan en
`docs/superpowers/plans/2026-10-04-contrato-4-6-portal.md`.
Issues: #178 (etapa P5 del epic #182), #173 y el punto 2 de #187. Lo usan P6 (#179, el comando y el
botón en el POS) y M10 en el mini-erp (rauldiazsolis/mini-erp#26).

## Contexto

- El MVP de mini contax (spec en el repo del mini-erp, "Accesos anónimos" y "POS (offline-pos)" →
  Portal) quiere que el cajero entre al backend desde el POS sin contraseña: un comando que el
  backend nombra (por ejemplo `/MINI`) abre el backend en una pestaña nueva, en la sesión que
  corresponde a esa caja. La key de la terminal nunca puede viajar en una URL.
- Hoy `GET /info.capabilities` es una lista de strings: no alcanza para mandar el nombre del comando
  ni el texto del botón.
- `POST /demo-sessions` documenta solo `201`, `404` y `422`. Un backend público necesita frenar
  pedidos (`429`) y avisar que llegó a su tope de demos (`503 demo-capacity`); mini ya los responde.
  `sync/demo-session.ts::requestDemoSession` los convierte en un `sync/request-failed` genérico.
- mini responde `503 { code: 'maintenance' }` con `Retry-After` en push, pull, holds y demo-sessions
  mientras migra (rauldiazsolis/mini-erp#47). El POS ya lo maneja bien en el sync (#187): no es un
  fallo de red, consulta `/info`, ve `maintenance` y frena. Falta documentarlo. El demo-backend en
  mantenimiento solo lo dice en `/info`.

## Decisiones

### 1. Capacidad `portal` (contrato)

- `GET /info` la declara en `capabilities` y suma el objeto que la describe:

  ```json
  "capabilities": ["demo-sessions", "portal"],
  "portal": { "command": "MINI", "label": "Abrir mini" }
  ```

  - `command`: mayúsculas, dígitos y `_`, de 2 a 16 caracteres, sin `/` (el POS la agrega). Si choca
    con un comando del POS (`COBRAR`, `CAJA`, …), el POS usa `/PORTAL`.
  - `label`: el texto del botón; el POS lo muestra como `<label> (/<command>)`, como `/ALTA`.
  - Con el string y sin el objeto, o con el objeto mal formado, cuenta como **sin la capacidad**. Un
    backend sin ella no muestra nada en el POS.
- **Un solo endpoint**, `POST /portal-links`: autenticado con la key como el resto (`Authorization`)
  y con el header de versión, sin cuerpo. Responde `201 { url, expiresAt? }`.
  - **El backend decide la URL según la credencial**, en cada pedido: un link con autorización (de un
    solo uso o de varios) o directamente su página de login para un usuario real. El POS no distingue
    modalidades: abre lo que le den. Se descartó declarar una URL fija en `/info`: es una respuesta
    posible de este mismo endpoint.
  - `url`: `https:` (o `http:` a `localhost`, `127.0.0.1` o `[::1]`), la misma regla que
    `onboarding.url`. **Nunca lleva la key**: si lleva autorización, es un token opaco del backend.
  - `expiresAt` (ISO 8601) opcional e informativo: lo manda si el link vence.
  - Recomendación del contrato: un solo uso y vencimiento corto (mini: 60 s).
  - La sesión que abre el canje la decide el backend según la key (en mini, `member` limitado a esa
    caja en un comercio real, o `admin` del comercio demo en una demo). El contrato no define roles.
  - Errores: `401` (key inválida o revocada; con la terminal en demo, "la demo terminó", como en el
    sync), `404` (no implementado), `409` (contrato incompatible) y `503` (mantenimiento).
- **Nunca en el pull**: un link con autorización guardado en la terminal es un secreto en reposo, y
  si vence o es de un uso ya no sirve cuando se usa. Abrir el backend necesita red igual, así que
  pedirlo al usarlo no le quita nada al offline. El POS no guarda la URL.
- Nota para P6: abrir la pestaña en el gesto del usuario (en blanco) y cargarle la URL al llegar la
  respuesta, por el bloqueador de pop-ups.

### 2. Errores comunes (contrato)

- Esquema nuevo `ErrorBody { code, message? }` y el header `Retry-After` (segundos enteros)
  documentado como componente. El backend tiene que exponerlo por CORS
  (`Access-Control-Expose-Headers: Retry-After`): no es un header que el navegador deje leer desde
  otro origen sin eso, y el POS siempre corre en otro origen (detalle encontrado al planificar).
- **`503 Maintenance`** (`code: maintenance`, con `Retry-After`) en `/sync/push`, `/sync/pull`,
  `/account-holds`, `/demo-sessions` y `/portal-links`: "backend en mantenimiento, consultá
  `/info`". El POS no procesó nada y no hubo ack: el lote sigue congelado. El POS no adelanta nada
  por el `Retry-After`: sigue su cadencia de `/info`.
- En `/demo-sessions`, además:
  - `429` con `code: rate-limited` y `Retry-After`: demasiados pedidos desde esa IP.
  - `503` con `code: demo-capacity`: el backend llegó a su tope de demos abiertas.
- La guía recomienda a todo backend que ofrezca demos un límite por IP y un tope global de demos
  abiertas.
- `/info` sigue sin responder 503: en mantenimiento responde `200` con `status: maintenance`.

### 3. El POS

- `POS_CONTRACT_VERSION` = `4.6.0` (header y textos). El piso sigue en 4.0.0.
- `requestDemoSession` lee `{ code, message? }` y `Retry-After`:
  - `429` → `demo/rate-limited` con `{ retryAfterSeconds?: number }` (solo segundos enteros; una
    fecha HTTP o un valor inválido cuentan como ausente).
  - `503` con `code: demo-capacity` → `demo/capacity`.
  - `503` con `maintenance`, otro código o sin cuerpo → `sync/backend-maintenance` con su `message`.
- `ui/errors.ts` traduce los dos códigos nuevos; quedan dentro de "No se pudo iniciar la demo: …", así
  que se ven igual al abrir el link, en "Abrir una demo" y en `/DEMO_NUEVA`:
  - `demo/rate-limited`: "se pidieron demasiadas demos desde esta conexión; probá de nuevo en N
    minutos" (N redondeado hacia arriba; sin `Retry-After`, "en unos minutos").
  - `demo/capacity`: "hay demasiadas demos abiertas en este momento; probá de nuevo en unos minutos".
- Sin reintentos automáticos.
- **Nada del portal en el POS**: leer la declaración, el comando y el botón son de P6 (#179).
- Lo de `/account-holds` con 503 cayendo a la evaluación offline queda en #187 (punto 1).

### 4. El demo-backend (referencia ejecutable)

- Contrato 4.6.0 y `portal` en `CAPABILITIES`, con `portal: { command: 'PANEL', label: 'Panel del
  backend' }` en `/info`.
- `POST /portal-links`: emite un token aleatorio de un solo uso que vence a los 60 s, en una tabla
  `portal_links` (token, key, emitido, vence, usado), fuera de lo que re-siembra `resetToSeed`.
  Devuelve `{ url: <origin>/_demo/portal/<token>, expiresAt }`.
- `GET /_demo/portal/<token>` (sin autenticación): válido → lo marca usado y muestra una página con
  quién entró (caja de demo o del comercio, sucursal y caja) y un link al panel `/_demo`. Usado,
  vencido o inexistente → `410` con "El link ya se usó o venció". No hay sesiones de verdad: el panel
  no tiene login; la sesión real es de mini.
- Una key revocada da `401` en `/portal-links`, como en el resto.
- Con el mantenimiento prendido (panel), los cinco endpoints del punto 2 responden
  `503 { code: 'maintenance', message }` con `Retry-After: 30`, y los CORS exponen `Retry-After`.
- Control nuevo en el panel para `POST /demo-sessions`: normal, `429` (`Retry-After: 600`) o
  `503 demo-capacity`. El límite real por IP no se implementa (es de un backend público).

### 5. Lo que no acompaña

El puente de Google Sheets: sigue compatible por el piso, sin portal ni 503. Los backends externos
se enteran por el issue de aviso en rauldiazsolis/mini-erp.

## Docs

- OpenAPI: versión 4.6.0, nota "4.6.0 respecto de 4.5.0", la capacidad en la tabla de capacidades,
  `portal` en `BackendInfo`, `POST /portal-links`, `ErrorBody`, `Retry-After`, las respuestas `503`
  y `429`. Sin referencias internas (lo vigila `site/docs.test.ts`).
- `docs/integradores/guia.md` y `llms.txt`: el portal, los errores y la recomendación de límites.
- `src/sync/AGENTS.md`: entrada "Contrato 4.6.0". `AGENTS.md` raíz: la versión y la tabla de estado.

## Tests

- `sync/demo-session.test.ts`: 429 con y sin `Retry-After` (y con una fecha HTTP), 503
  `demo-capacity`, 503 `maintenance` con `message`, 503 sin cuerpo.
- `ui/errors.test.ts` (o donde se prueben las traducciones) y `ui/onboarding.test.ts`: el mensaje
  llega.
- demo-backend: el portal (canje válido, segundo uso, vencido, key revocada, en mantenimiento), el
  503 en los cinco endpoints y el control de demos; `/info` con `portal`.
- Sin e2e nuevo: lo cubren los unitarios y la prueba manual usa el panel.

## Cierre

- Issue de aviso en rauldiazsolis/mini-erp: la capacidad `portal`, `POST /portal-links`, `ErrorBody`,
  el 429 y los 503, versión 4.6.0.
- PR con "Closes #178" y "Closes #173"; #187 queda abierto con un comentario: su punto 2 se resolvió.
