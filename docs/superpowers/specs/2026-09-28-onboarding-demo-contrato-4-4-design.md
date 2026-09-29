# Onboarding de demo del POS genérico y contrato 4.4.0

Fecha: 2026-09-28
Estado: diseño aprobado, pendiente de plan.
Issues: #128 (etapa del epic #134, MVP publicado; decisiones en los comentarios "Decisiones del
2026-09-28" y "Alcance ampliado del contrato 4.4.0"). Entra también #115 (foto completa con stock
vacío). Fuera de alcance: el mini-erp (desarrollo separado) y Google Sheets (#127, #133, #138).

## Contexto

El onboarding es la puerta de entrada del producto: el POS no sirve sin un backend. Hoy existe una
primera versión sin diseño (`docs/url-autoconfig-handshake.md`, `sync/url-auto-config.ts`,
`ui/state/demo-mode.ts`) con cuatro problemas (#128):

1. El POS conoce un backend puntual: `http://localhost:4100`, `preset=kiosco` y "Conectar Mini-ERP"
   están fijos en el código.
2. La API key vuelve en la query string (llega a los logs del servidor que sirve el POS).
3. El borrado automático al volver del onboarding es una excepción no escrita a "cambiar la
   conexión nunca borra datos automáticamente".
4. `sync/url-auto-config.ts` importa de `ui/` (controller de config, signals del carrito) y usa
   `try/catch` + `console.warn` fuera de un adaptador; el tipo de conector queda fijo en `rest`.

Además, esta etapa cierra el contrato: **4.4.0 es la última versión antes del MVP**. Después de
publicar, el contrato casi no cambia de forma y los agregados entran como capacidades opcionales.
Hoy el POS exige que el backend esté en su mismo minor o uno mayor
(`domain/contract-version.ts::isCompatibleContract`): cada agregado obliga a todos los backends a
actualizarse o quedan incompatibles (hoy el mini-erp y Sheets, en 4.2, no sincronizan con un POS 4.3).

## Decisiones

Del 2026-09-28, en #128 y en el brainstorming de esta etapa:

- **POS estático y genérico**, que no conoce ningún backend. Tiene que poder embeberse en el deploy
  de un backend (nada fijo en el código), pero eso no es parte del MVP: no se cambia `base` de Vite.
- **Piso de versión 4.0.0** más dos capacidades, `demo-sessions` y `customer-payment-void`. El
  mini-erp y Sheets (4.2) vuelven a ser compatibles sin tocarlos; simplemente no anulan cobranzas.
  Las capacidades se leen solo de la lista explícita, nunca se deducen de la versión.
- **`notices`**: la lista vigente del backend, completa en cada pull, sin acuse ni descarte local.
- **Paginación de la foto completa**: no ahora. Queda escrito que una foto completa nunca se
  trunca y que una paginación futura solo se usa con un POS que la anuncie (header de versión).
- **#115** entra como última tarea de código.
- Una terminal en demo usa el conector **`rest`** con `SyncConfig.demo`; `rest-demo` y `/DEMO_RESET`
  quedan para quien configure a mano el minibackend.
- El comando del call-to-action es **`/ALTA`**.
- **Template desconocido (422)**: el POS reintenta sin template y avisa.

## 1. Contrato 4.4.0

Todo aditivo. `POS_CONTRACT_VERSION = '4.4.0'`; el header `X-POS-Contract-Version` no cambia.

### Compatibilidad por piso

`domain/contract-version.ts`: `MIN_BACKEND_CONTRACT = '4.0.0'`. Compatible = mismo major que el POS y
minor ≥ el del piso (`isCompatibleContract(backend)` compara contra el piso, no contra
`POS_CONTRACT_VERSION`). `contractRequirement` dice "4.0 o posterior". El 409
`incompatible-contract` sigue igual (un backend que no habla el major).

### Capacidades

`GET /info` suma `capabilities?: string[]` (ausente = `[]`). Definidas en 4.4.0:

| Capacidad | Qué habilita en el POS | Sin ella |
|---|---|---|
| `demo-sessions` | El backend implementa `POST /demo-sessions` | El POS no la consulta antes: un link de demo prueba directo y el 404 es la respuesta |
| `customer-payment-void` | `/ANULAR` anula cobranzas (`voidsPaymentId`, 4.3.0) | La cobranza se ve en `/ANULAR` pero no se anula, y dice por qué |

Un nombre de capacidad desconocido se ignora.

### `POST /demo-sessions`

Único endpoint sin autenticación (no lleva API key; sí el header de versión).

```
POST /demo-sessions   { template?: string }
→ 201 { apiKey, branch, pointOfSale, template, onboarding: { url, label }, baseUrl? }
→ 422 { code: 'unknown-template', templates: string[] }
→ 404  el backend no ofrece demos
```

- `baseUrl` opcional: la URL del Connector API para esa demo; ausente = la misma del link.
- `template`: el que usó (el pedido o el default).
- `onboarding.url`: página del backend a la que el POS manda al usuario para darse de alta;
  `onboarding.label`: el texto del call-to-action (ej. "Crear mi comercio").

### `notices` en el pull

`POST /sync/pull` suma `notices?: { id, severity, message, ref?: { type, id } }[]`: la lista
**vigente y completa** de avisos del backend para esta terminal (como el stock, sin cursor). Ausente =
`[]`. Un aviso desaparece cuando el backend deja de mandarlo. `severity`: `info | warning |
critical`. Cubre la notificación asíncrona de discrepancias (#13) y avisos de cuota o contrato (#103,
versión informativa); esos issues pasan a ser trabajo solo del POS.

### Vuelta del onboarding

El backend devuelve al usuario al `return_url` que recibió, con la config en el **fragmento**
(el navegador nunca lo manda al servidor que sirve el POS), nunca en la query string:

```
<return_url>#connect=<base64url de JSON>
JSON: { baseUrl, apiKey, branch, pointOfSale, wipeKey? }
```

`wipeKey` es el `wipe_key` que recibió en la ida, sin modificar.

### Reglas de evolución (sección nueva del OpenAPI)

- **Campos desconocidos**: los dos lados los ignoran. Ningún schema Zod del POS sobre datos del
  backend es `.strict` (hay un test que lo fija).
- **Enums desconocidos, del lado del POS**: `/info.status` desconocido se trata como `ok` (se
  muestra el `message`); estado de lote desconocido como `processing`; `severity` desconocida como
  `info`.
- **Del lado del backend**:
  - Registra un **tipo de evento** que no conoce sin rechazar el lote (coherente con "el backend
    nunca rechaza").
  - Registra un `Payment.method` que no conoce y lo trata como "otro". Los pagos viajan solo del POS
    al backend (dentro de `sale.payments` y `customer-payment.methods`, incluidas las anulaciones de
    tickets y recibos); el pull nunca trae pagos, así que la regla es solo del backend: un POS más
    nuevo puede sumar un medio sin romper a los backends existentes.
  - **Nunca trunca una foto completa** (pull sin cursor). Si algún día hay paginación, el backend la
    usa solo con un POS que la anuncie en su versión de contrato.
  - **No espera números contiguos** en tickets (`Sale.ticket`) ni en recibos
    (`CustomerPayment.receipt`): puede haber huecos (#139).

### Aclaraciones de significado (no cambian la forma)

- **Evento `customer`**: alta **o actualización** por `id`, con `updatedAt` (#37; la pantalla para
  editar viene después del MVP).
- **Stock**: un backend que no maneja stock manda sus productos con `tracksStock: false`. En una
  foto completa, `stock: []` significa "el backend no mandó información de stock", no "todo el stock
  es 0": el POS conserva el local (#115, ver sección 4).

## 2. El onboarding en el POS

### Capas

| Módulo | Qué hace |
|---|---|
| `sync/demo-link.ts` (puro, Zod) | `readDemoEntry(url)`: lee `?demo=true&backend=…&template=…`; `backend` debe ser `https:`, salvo `http:` a `localhost`/`127.0.0.1`. `readConnectReturn(url)`: decodifica `#connect=…`. `buildOnboardingUrl(onboarding, returnUrl, wipeKey)`: arma la ida. Todos devuelven `Result`; el único `try/catch` es el decodificado base64/`JSON.parse` (borde). |
| `sync/demo-session.ts` (adaptador HTTP) | `requestDemoSession(baseUrl, template?)`: `POST /demo-sessions` con `fetch`, respuesta validada con Zod, a `Result` (`demo/unknown-template` con la lista, `demo/not-offered` en 404, y los errores de red existentes). No pasa por el puerto `Connector`: no es sync y solo existe en backends REST. |
| `sync/wipe-key.ts` | `issueWipeKey(now)` y `consumeWipeKey(key, now)`: token de un solo uso en `localStorage` (`offline-pos:pending-wipe-key`, con su fecha), vence a las 2 h. |
| `ui/onboarding.ts` | La orquestación desde `bootstrap`: decide si aplica, llama a `requestDemoSession`, `probeConnection`, `applyConnection`, limpia la URL (`history.replaceState`), vacía los signals del carrito y precarga el wizard. |

`SyncConfig` suma `demo?: { template, onboarding: { url, label }, startedAt }` (fuera de la unión por
`type`, como `branch`/`locale`). Reemplaza las claves sueltas de `localStorage` y el atajo de
`import.meta.env.DEV`.

Se borran: `sync/url-auto-config.ts` (y su test), `ui/state/demo-mode.ts`, las claves
`offline-pos:demo-mode`/`pending-wipe-*` viejas, `localhost:4100`, `preset=kiosco`, "Conectar
Mini-ERP" y `docs/url-autoconfig-handshake.md`.

### La entrada: `?demo=true&backend=…&template=…`

1. **Cuándo se aplica**: solo si la terminal no tiene config, o si su config tiene `demo`. Con una
   conexión real, o sin config pero con datos del usuario (`storage/local-data.ts::hasUserData`),
   el link se ignora y la barra de comandos avisa "Esta terminal ya está conectada: se ignoró el
   link de demo." (o "…tiene datos locales: …"). No se borra nada.
2. **Sesión**: `requestDemoSession(backend, template)`. Con `demo/unknown-template` reintenta sin
   template y avisa "La plantilla X no existe; se usó Y.". Con 404, red caída o un `backend`
   inválido, la terminal queda como estaba (sin config: el wizard requerido con "No se pudo iniciar
   la demo: <motivo>." arriba).
3. **Conexión**: config `{ type: 'rest', baseUrl, apiKey, branch, pointOfSale, demo }`, se prueba
   (`probeConnection`) y se aplica con `local: 'wipe'`. Entra directo a la venta.
4. **URL**: se limpia siempre (se sacan `demo`, `backend`, `template`).

Mientras `bootstrap` espera (corre antes del primer render), `index.html` muestra "Preparando…"
dentro de `#app`; el render de Preact lo reemplaza.

### La terminal en demo

- La barra de estado muestra una marca **DEMO** y un botón `<onboarding.label> (/ALTA)`.
- `/ALTA`: comando del núcleo, visible solo con `demo` en la config. El comando y el click llaman a
  la misma función: emiten el `wipe_key`, arman `return_url = origin + pathname` (sin nada fijo,
  anda en una subruta) y navegan a `onboarding.url?return_url=…&wipe_key=…`.
- Volver a abrir un link de demo reinicia la demo (la terminal está en demo, así que se aplica).
- Salir de la demo sin onboarding: aplicar otra conexión desde `/CONFIG`, que guarda la config sin
  `demo`.

### La vuelta: `#connect=…`

- Con un `wipe_key` válido y sin consumir, **o** sin datos del usuario: prueba, aplica con `wipe` y
  guarda la config **sin `demo`**. Entra a la venta.
- Si no: precarga el wizard de `/CONFIG` con la conexión (`rest`, URL, clave, sucursal, punto de
  venta), sin borrar nada — el operador elige Mantener o Borrar como en cualquier cambio de conexión.
- Si la prueba falla: precarga el wizard y muestra el motivo.
- El fragmento se limpia siempre.

**Excepción de borrado automático** (queda escrita en el `AGENTS.md` de la raíz y en
`src/sync/AGENTS.md`): cambiar la conexión nunca borra datos locales solo, salvo en el onboarding:
(a) un link de demo en una terminal sin config y sin datos del usuario, o ya en demo; (b) la vuelta
del onboarding con un `wipe_key` válido emitido por esta terminal, o sin datos del usuario.

## 3. Capacidades y `notices` en el POS

### Capacidades

- Las del último `getInfo` exitoso se guardan en `localStorage` (`offline-pos:backend-capabilities`,
  estado operativo best-effort, como los cursores) y en un signal: una terminal que arranca sin red
  las sabe igual. Las escriben la prueba de conexión y `refreshBackendStatus`; se borran al aplicar
  otra conexión.
- **`/ANULAR`**: una cobranza anulable sin `customer-payment-void` se sigue viendo y navegando;
  Enter dice "El backend no permite anular cobranzas." Si nunca se supo (terminal previa a esta
  versión que arranca sin red): "Todavía no se sabe si el backend permite anular cobranzas: probá
  /SINCRONIZAR." Las ventas no cambian.
- **`/DIAGNOSTICO`**: el estado del backend muestra la versión de contrato y las capacidades.
- **Tolerancias** en `sync/connector.ts` (con tests): `status` de `/info` desconocido → `ok`; estado
  de lote desconocido → `processing`; `severity` desconocida → `info`.

### `notices`

- El pull los valida uno por uno: un aviso mal formado se descarta sin tirar el pull.
- Cada pull exitoso reemplaza la lista entera en `localStorage` (`offline-pos:backend-notices`) y en
  `backendNoticesSignal`; se borra al aplicar otra conexión.
- **Barra de estado**: "Avisos (N)" con el color del más grave (`critical` → error, `warning` →
  advertencia, `info` → neutro); el click abre `/DIAGNOSTICO`. Sin avisos no se muestra.
- **`/DIAGNOSTICO`**: sección "Avisos del backend" con severidad, mensaje y `ref` como "tipo id".
- Nunca bloquea nada. El conector de Sheets no manda `notices` (siempre `[]`); solo se toca lo
  mínimo mecánico para compilar, si hiciera falta.

## 4. #115: foto completa con stock vacío

En `storage/apply-pull.ts` / `sync/pull-adjust.ts`: si en una foto completa el backend mandó
`stock: []` (lo que mandó, no el stock ya ajustado), no se reconcilia ni se reaplica stock: el
local queda intacto, como antes de #98. Test del caso del issue en `storage/apply-pull.test.ts`. El
PR cierra #115.

## 5. Demo-backend (4.4.0)

- `GET /info`: `capabilities: ['demo-sessions', 'customer-payment-void']`.
- **Templates**: `kiosco` (default, los fixtures actuales) y `almacen` (otro juego, más chico y con
  otros productos: alcanza para ver que el template cambia algo).
- `POST /demo-sessions`: re-siembra la base con el template (la base es única y de un solo comercio:
  cada demo pisa la anterior) y devuelve la API key fija actual, `branch: 'CENTRAL'`,
  `pointOfSale: 'Caja 1'`, el template y `onboarding: { url: '<origin>/_demo/onboarding',
  label: 'Crear mi comercio' }`. 422 con la lista si el template no existe.
- `GET /_demo/onboarding`: página falsa en HTML plano que muestra lo que recibió (`return_url`,
  `wipe_key`) y ofrece "Crear comercio y volver al POS" (redirige a `return_url#connect=…` con la
  misma config y el `wipe_key`) y "Volver sin wipe_key" (para probar el camino del wizard).
- Panel `/_demo`: un campo para prender/apagar un aviso de prueba que el pull devuelve en `notices`.
- Un `Payment.method` desconocido se guarda tal cual (hoy ya no valida contra una lista; un test lo
  fija).

## 6. Tests

- Unitarios: `demo-link`, `demo-session`, `wipe-key`, `ui/onboarding`, compatibilidad por piso,
  capacidades (persistencia y `/ANULAR`), `notices` (validación, persistencia, barra, diagnóstico),
  tolerancias, "ningún schema estricto", #115. Demo-backend: `/demo-sessions`, templates, onboarding
  falso, `notices`, `method` desconocido.
- e2e nuevo `e2e/demo-onboarding.spec.ts` contra el demo-backend real (ya en el `webServer` de
  Playwright): link de demo → venta con DEMO y "Crear mi comercio (/ALTA)" → `/ALTA` → página falsa
  → "Crear y volver" → terminal configurada sin `demo` y con lo local borrado. Además: template
  desconocido (aviso), link con conexión real (se ignora), vuelta sin `wipe_key` con datos (wizard
  precargado). Otro caso para "Avisos (N)" y `/DIAGNOSTICO`.

## 7. Documentación

- `docs/connector-api.openapi.yaml` a 4.4.0: `POST /demo-sessions`, `capabilities`, `notices`, la
  vuelta con `#connect`, la sección "Reglas de evolución" y las aclaraciones de `customer`, stock y
  numeración.
- `AGENTS.md` de la raíz (onboarding, excepción de borrado, compatibilidad por piso y capacidades,
  estado del proyecto), `src/sync/AGENTS.md` ("Contrato 4.4.0", excepción de borrado, capacidades y
  `notices`), `src/ui/AGENTS.md` (DEMO, `/ALTA`, avisos, `/ANULAR` sin capacidad),
  `e2e/AGENTS.md`. `docs/historia.md` con la etapa.
- Comentario en #127: con el piso 4.0, Sheets vuelve a ser compatible sin tocarlo.
- Issue nuevo `feature:mini-erp` con lo que tendría que implementar el mini-erp
  (`/demo-sessions`, capacidades, la vuelta con `#connect`), sin tocarlo.

## Orden de implementación

1. Contrato y compatibilidad por piso. 2. Tolerancias. 3. Capacidades y `/ANULAR`. 4. `notices`.
5. Demo-backend. 6. Onboarding del POS. 7. Limpieza del código viejo. 8. e2e. 9. #115. 10. Docs.

## Desvíos aprobados durante la implementación

- **Estado de lote que el POS no entiende (Tarea 2, 2026-09-28)**: la spec decía tratar un estado
  desconocido como `processing`; se cambió a **terminado con aviso**. Qué significa cada estado para
  el POS: `ok` e `issues` = el lote terminó y está aplicado (los problemas los resuelve el backend con
  bloqueos de productos, clientes, stock o saldos; los avisos son informativos); `queued` y
  `processing` son de paso y el backend no debería dejarlos mucho tiempo. Como `processing` nunca
  puede quedar colgado, lo que el POS no entiende se trata como `issues` con un aviso: un `issues` con
  los avisos mal armados ("El backend informó problemas con este lote en un formato que el POS no
  entiende."), un estado desconocido ("El backend informó el estado «X», que este POS no conoce.") o
  algo que ni siquiera tiene estado. Un estado futuro que pida otra cosa (por ejemplo, un error grave
  que desaliente seguir vendiendo, otra etapa) llega con una versión del POS que lo anuncie, así que
  un POS de hoy nunca lo recibe.
