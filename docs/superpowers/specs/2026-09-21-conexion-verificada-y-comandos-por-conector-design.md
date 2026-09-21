# Conexión verificada y comandos por conector (Etapas 2b y 2c)

Fecha: 2026-09-21
Estado: diseño aprobado por secciones por el usuario en sesión de brainstorming; pendiente de revisión
del spec escrito y de plan de implementación etapa por etapa.
Relacionado: epic #66 (conectores plugin), #68 (Etapa 2, ya implementada), #53 (bug de sync que esta
etapa absorbe), #56 (cerrado por la Etapa 2).

## Contexto

El usuario probó la Etapa 2 (registro de conectores + `/CONFIG` como modal) contra el minibackend real
y contra una planilla de Google Sheets. Funciona, pero al cambiar de conector aparecieron cuatro
problemas de interacción:

1. Al cambiar de conector no hay forma de saber si ya sincronizó, y en algún caso parecía mezclar
   clientes y productos de ambos conectores. Pidió: chequear la conexión, sincronizar clientes y
   productos, y borrar los datos de ventas y caja **advirtiendo** que se van a borrar, para que quede
   claro cómo empieza la caja.
2. `/DEMO_RESET` con el conector REST falló con "Failed to fetch".
3. No se debería asumir ninguna configuración por omisión ni permitir ninguna operación hasta que la
   configuración esté hecha **y probada**: sin config, la app debe entrar sí o sí a la pantalla de
   configuración.
4. `/DEMO_RESET` (y otros comandos que se agreguen más adelante) podrían ser inyectados por cada
   conector.

### Hallazgos verificados en el código (no supuestos)

- **Mezcla de datos: confirmada.** `sync/engine.ts::pullCatalog` y `pullCustomers` hacen `bulkPut`
  (agregan sin borrar); los cursores de pull (`sync/cursor.ts`) viven en `localStorage` y sobreviven
  al cambio de conector; y el **outbox pendiente** del conector viejo se empujaría al nuevo. Además de
  productos y clientes quedarían mezclados stock, cuentas, ventas y turnos.
- **`/DEMO_RESET`: no se reprodujo un bug del minibackend.** Con el backend corriendo,
  `POST /_demo/reset` responde `200` con CORS correcto (`Access-Control-Allow-Origin: *`); si el
  handler explotara, el router (`demo-backend/src/router.ts::handleRequest`) devolvería un `500` con
  otro mensaje. `Failed to fetch` es un error de red del navegador: lo más probable es que el backend
  no estuviera corriendo en ese momento. El defecto real es que el mensaje no dice nada útil.
- **"No sé si ya sincronizó" es el issue #53**, abierto: `syncOnce` ignora el resultado de los pulls y
  marca "Sincronizado" igual.
- **Arranque:** la app abre en la pantalla de venta aunque no haya config (solo la barra de estado
  dice "Sin configurar"), y `/CONFIG` precarga `http://localhost:4000` y `demo-token`
  (`ui/state/sync-config.ts`).
- **Comandos:** hoy son una lista estática (`ui/keyboard/commands.ts::AVAILABLE_COMMANDS`) más un
  `switch` en `ui/keyboard/command-bar-controller.ts::runCommand`.

## Decisiones acordadas con el usuario

| Decisión | Resolución |
|---|---|
| Ventas y turnos sin enviar al cambiar de conector | **Advertir con conteos e intentar enviar antes de borrar**: si hay red, un último intento de enviar el outbox al conector *actual*; la advertencia dice cuánto se pierde y destaca lo no enviado. Enter confirma, Esc vuelve a editar. |
| Enfoque del ciclo de vida de la conexión | **"Aplicar conexión" transaccional**: probar sin tocar nada local, y recién si la prueba pasa (y el usuario confirma el borrado, si corresponde) limpiar, cargar y guardar como una unidad. Se descartó guardar-primero-y-sincronizar-después (deja estados a medias) y una base de datos por conexión (complejidad no justificada: el usuario pidió que la caja *empiece limpia*). |
| Mecanismo de comandos por conector | **Declarativo con acciones tipadas**: cada tipo de conector declara `{ name, description, action }[]`; la UI resuelve `action` en un mapa exhaustivo. `connectors/` sigue sin conocer la UI. |
| Cómo se distingue el minibackend de demo | **Tipo de conector propio `'rest-demo'`** ("REST (minibackend de demo)"): mismos campos e implementación que REST, pero su propio `type` y su propia lista de comandos. |
| División en PRs | **La Etapa 2 se mergea tal como está** (rama `claude/sheets-connector-stage-2`); 2b y 2c van en PRs propios. Se acepta que, entre el merge de la Etapa 2 y el de 2b, `main` tenga conectores seleccionables con el riesgo de mezclar datos al cambiar. |

## Etapas

- **Etapa 2b — Conexión verificada** (Parte 1): estados de conexión y bloqueo de arranque, sin
  valores por omisión, prueba + aplicación transaccional de la conexión, estado de sync honesto
  (cierra #53), errores de red legibles.
- **Etapa 2c — Comandos por conector** (Parte 2): tipo `rest-demo` y comandos declarados por
  conector. Chica; va después de 2b.
- La Etapa 3 (#69, crédito ilimitado) y el backlog (#70 a #73, otros conectores) no cambian. La prueba
  de conexión se diseña sin depender de ningún conector concreto, así que también les sirve.

---

## Parte 1 — Etapa 2b: Conexión verificada

### 1.1 Estados de conexión

`SyncConfig` suma `verifiedAt?: string` (ISO 8601): la fecha de la última prueba exitosa. Lo escribe
únicamente la aplicación de la conexión (1.4); el formulario nunca lo edita. Un módulo puro deriva el
estado:

| Estado | Condición |
|---|---|
| `unconfigured` | no hay config guardada |
| `unverified` | hay config pero sin `verifiedAt` (incluye las configs guardadas antes de 2b) |
| `active` | hay config con `verifiedAt` |

Una config inválida (`sync/config-invalid`) se trata como `unconfigured`.

Las terminales ya configuradas (config sin `verifiedAt`) quedan `unverified` y pasan **una vez** por
la pantalla de configuración, ya precargada con lo guardado. Ctrl+Enter prueba y listo: el origen no
cambió, así que no hay borrado y no pierden datos.

### 1.2 Bloqueo de arranque

Si el estado no es `active`, `ui/app.tsx` muestra `ConfigScreen` en **modo requerido** *en lugar de*
cualquier otra pantalla: no hay pantalla de venta ni barra de comandos, así que no es posible ninguna
operación. En este modo:

- no hay botón "Cancelar" y Esc no hace nada;
- el texto dice "Configurá y probá la conexión para empezar";
- la única salida es una prueba exitosa.

`sync/engine.ts::runSyncCycle` no corre ciclos con una config que no esté `active`.

**Offline-first intacto.** El bloqueo depende solo del estado de la config, nunca de la conectividad.
Una terminal `active` abre y opera sin internet como hoy. Solo necesitan red el primer arranque y el
cambio de conector, porque probar es hacer un pull. Con la conexión `active`, `/CONFIG` sigue
disponible desde la barra de comandos en **modo normal** (Esc cancela).

### 1.3 Sin valores por omisión

- Se eliminan `DEFAULT_BASE_URL` y `DEFAULT_API_KEY` (`ui/state/sync-config.ts`). Los campos arrancan
  vacíos. El `demo-token` deja de ser necesario: se había precargado para evitar un 401 silencioso
  (hallazgo de la revisión final de Fase 7), y la prueba de conexión ahora muestra ese 401 de forma
  legible.
- `ConfigField` (`connectors/config-field.ts`) suma `placeholder: string` (ejemplo de ayuda, no un
  valor): `https://api.miempresa.com`, `https://script.google.com/macros/s/…/exec`, etc.
- El selector de tipo arranca en una opción vacía "Elegí un tipo de conexión…" y no se muestra ningún
  campo hasta elegir uno (`configTypeSignal: ConnectorType | null`). Ctrl+Enter sin elegir muestra
  "Elegí un tipo de conexión". Con una config guardada, el formulario abre precargado con esos valores
  (comportamiento de la Etapa 2, sin cambios).

### 1.4 Aplicar conexión

Módulo nuevo `sync/connection.ts`, sin dependencias de UI. Confirmar en `/CONFIG` (Ctrl+Enter) recorre:

1. **Validar** el formulario (como hoy).
2. **Probar** — `probeConnection(config, { timeoutMs })`:
   - arma el conector con `createConnector` y hace el pull completo de productos, stock y clientes
     **en memoria**, todo o nada; devuelve un `ProbeSnapshot { products, stock, customers, cursors }`;
   - no toca IndexedDB, ni los cursores, ni la config guardada;
   - lleva un tiempo máximo (`Promise.race`, sin cambiar el puerto `Connector`): al vencer devuelve
     `sync/timeout`;
   - si falla, el modal queda abierto con todo lo tipeado y un mensaje legible (1.6); no cambió nada.
3. **Planear** — `planConnectionChange({ current, candidate, localData })`, función pura:
   - **origen** = el endpoint normalizado (`baseUrl` o `webAppUrl`: sin barra final, host en
     minúsculas). El `type` **no** forma parte del origen: `rest` y `rest-demo` son el mismo backend.
     Cambiar solo la API key, el secreto o el locale es el mismo origen;
   - `wipe` = el origen cambió, o no hay config actual pero sí datos locales. Este segundo caso es
     deliberadamente conservador: si la config guardada se perdió o quedó inválida no se puede saber
     de qué origen son los datos, así que se los trata como ajenos y se pide confirmación antes de
     borrar (nunca se descartan ventas locales en silencio);
   - `needsConfirmation` = `wipe` y hay **datos del usuario**: ventas, turnos de caja, eventos
     pendientes del outbox o líneas en la venta en curso. Un catálogo o clientes sin nada del usuario
     se reemplaza sin preguntar.
4. **Confirmar** (solo si `needsConfirmation`), dentro del mismo modal:
   - antes, si hay red, `flushPendingBeforeWipe`: un último intento de enviar el outbox al conector
     **actual**, best-effort y con tiempo máximo — si falla o vence, se sigue y el conteo se muestra
     como "sin enviar";
   - la pantalla muestra los conteos de `LocalDataSummary` ("Se borrarán 12 ventas, 2 turnos y la
     venta en curso. **3 ventas sin enviar** al backend actual"), con lo no enviado destacado. Enter
     confirma y borra; Esc vuelve a editar.
5. **Aplicar** — `applyConnection({ candidate, snapshot, wipe })`:
   - toma el mismo cerrojo que `syncOnce` (`syncInProgress`), así que ningún ciclo de sync se
     intercala; el intervalo espera;
   - **una sola transacción Dexie** sobre todas las tablas: si `wipe`, limpia todas (la lista que
     hoy usa `storage/demo-reset.ts`, extraída a `storage/clear-local-data.ts::clearLocalData`) y carga
     el snapshot. La transformación de clientes (`splitConnectorCustomer`) se comparte con el pull del
     motor, extraída a una función común para no duplicarla;
   - tras el commit: reinicia los cursores y fija los del snapshot, reconstruye los repositorios en
     memoria (`setCatalogRepository`, `setCustomerRepository`) y **al final** guarda la config con
     `verifiedAt` (`setSyncConfigured(true)`);
   - si algo falla antes del commit de Dexie, no cambia nada.

**Riesgo residual aceptado:** el guardado de la config va en `localStorage`, que no puede formar parte
de la transacción de Dexie. Si `saveSyncConfig` fallara *después* del commit (un `setItem` de un
string chico: cuota llena o modo privado), el usuario ve el error y el próximo arranque encontraría
la config anterior con datos nuevos. Es mucho menos probable que una falla de la transacción y no
justifica una segunda capa de deshacer.

**Estados del modal** (`configPhaseSignal`): `editing → probing → confirming → applying`.
- Durante `probing`, Esc cancela: el resultado de la prueba en vuelo se descarta con un token de
  cancelación (no cancela el `fetch`, solo ignora su resultado).
- Durante `applying` (corto, sin red), Esc se ignora.
- Al terminar bien, vuelve a la venta y dispara un ciclo normal de sync.

`storage/demo-reset.ts::demoReset` pasa a reutilizar `clearLocalData`.

### 1.5 Estado de sync honesto (absorbe #53)

- `pullCatalog` y `pullCustomers` devuelven `Result<void>` en vez de tragar el error, y `syncOnce`
  devuelve un `SyncReport { push: { attempted, failed }, pulls: { products, stock, customers } }`.
- **`sync-error` si falla cualquier pull** o si el outbox está atascado (`isSyncStruggling`, como
  hoy). `online-idle` significa que todo salió bien, y `lastSyncedAt` solo se actualiza en un ciclo
  completamente exitoso. El estado `offline` sigue dependiendo únicamente de `navigator.onLine`.
- Señal nueva `lastSyncErrorSignal: string | null` con el motivo del último fallo, ya traducido con
  `describeError`, y `localCatalogCountsSignal: { products, customers }` calculado **contando la base
  local** (no lo que trajo el pull, que en un delta son solo los cambios).
- `StatusBar` muestra el motivo ("Error de sync: el backend rechazó las credenciales (401) · última
  sync OK 10:32") y, tras una sync buena, el contenido local ("Sincronizado 10:32 · 120 productos ·
  22 clientes").
- `/SINCRONIZAR` sigue sin cambiar de pantalla; el resultado, bueno o malo, queda a la vista en la
  barra.

### 1.6 Errores de red legibles

Un solo lugar, `ui/errors.ts`, reutilizado por la prueba, el sync y `/DEMO_RESET`:

| Origen | Mensaje |
|---|---|
| `sync/request-failed` sin `status` (conectividad) | "No se pudo conectar con el servidor (`<mensaje crudo>`). ¿Está en línea y corriendo?" |
| `sync/request-failed` con 401/403 | "El servidor rechazó las credenciales (`<status>`)." |
| `sync/request-failed` con 404 | "El servidor no encontró el recurso (404). ¿La URL es correcta?" |
| `sync/request-failed` con otro `status` | "El servidor respondió con un error (`<status>`)." |
| `sync/timeout` (`ErrorCode` nuevo, meta `{ seconds: number }`) | "El servidor no respondió en `<n>` segundos." |
| `demo/backend-reset-failed` | mismo criterio que la conectividad. |

El mensaje crudo del navegador varía (`Failed to fetch` en Chromium, otro en Firefox), por eso se
trata como conectividad todo fallo sin `status` y se conserva el crudo entre paréntesis para depurar.

### 1.7 Impacto en lo existente

- Los e2e que venden offline sin backend (`offline-sale`, `account-sale`, `void-sale`,
  `cart-persistence`, `cash-session`, `keyboard-only`) hoy no configuran nada y caerían en la pantalla
  forzada. Se agrega un helper en `e2e/helpers.ts` que siembra una config `active` (con `verifiedAt`)
  apuntando a un backend inalcanzable, además del catálogo que ya siembran en IndexedDB. Con el fix
  de #53, ese sync fallido pasa a verse como `sync-error`: hay que confirmar que ningún spec asserta
  el estado de la barra.
- Los tests unitarios que siembran config con `saveSyncConfig` suman `verifiedAt` donde el
  comportamiento dependa del estado `active`.
- `e2e/minibackend-sync.spec.ts` y `e2e/config-connector.spec.ts` se adaptan al selector vacío inicial
  y a los campos sin valores por omisión.

---

## Parte 2 — Etapa 2c: Comandos por conector

### 2.1 Declaración

`connectors/connector-command.ts` define:

```typescript
export type ConnectorActionId = 'demo-reset';
export type ConnectorCommand = { name: string; description: string; action: ConnectorActionId };
```

Cada tipo de conector suma `commands: ConnectorCommand[]` a su entrada de `CONNECTOR_TYPES`
(`sync/connector-registry.ts`). `connectors/` no importa nada de `ui/`.

### 2.2 El tipo `rest-demo`

- `connectors/rest-demo/config.ts`: `restDemoConfigSchema` con `type: z.literal('rest-demo')` y los
  mismos campos que REST (`baseUrl`, `apiKey?`); reusa `restConfigFields`. La factory reusa
  `createRestFetchConnector` (que ya no conoce el `type`).
- Etiqueta "REST (minibackend de demo)"; es el único que declara `{ name: 'DEMO_RESET', action:
  'demo-reset' }`. `rest` ("REST genérico") y `google-sheets` no declaran comandos.
- El selector muestra tres entradas. El type-ahead ya no alcanza para distinguir "REST genérico" de
  "REST (minibackend…)": los e2e eligen con `selectOption`.

### 2.3 UI

- `ui/keyboard/commands.ts` separa `CORE_COMMANDS` (COBRAR, CAJA, RESUMEN, ANULAR, DESCARTAR, CONFIG,
  SINCRONIZAR) de los del conector; `availableCommands()` devuelve los del núcleo más los del
  conector activo, según una señal `activeConnectorTypeSignal` que se fija al arrancar (desde la
  config guardada) y al aplicar una conexión.
- `ui/keyboard/connector-actions.ts`: `Record<ConnectorActionId, () => void>` — por ahora
  `{ 'demo-reset': enterDemoResetScreen }`. TypeScript obliga a completarlo si un conector declara una
  acción nueva.
- `runCommand` resuelve primero los comandos del núcleo y luego los del conector activo; un comando
  que no está en ninguna de las dos listas da "Comando desconocido", igual que hoy.

### 2.4 Lo que se simplifica de la Etapa 2

Como `/DEMO_RESET` ya no se ofrece donde no aplica, sobran el aviso al abrir la pantalla
(`enterDemoResetScreen` con `checkDemoResetAvailable`) y sus tests. `demoReset()` conserva la
verificación de fondo (`type === 'rest-demo'`), que además necesita para tipar `baseUrl`; el
`ErrorCode` `demo/unavailable-for-connector` queda como esa defensa.

### 2.5 Impacto

La terminal de demo del usuario tiene hoy una config `rest` (la migrada de antes de la Etapa 2):
pierde `/DEMO_RESET` hasta que la reconfigure como "REST (minibackend de demo)". Como el origen no
cambia, la reconfiguración no borra nada.

---

## Testing

- **Unitarias puras:** `planConnectionChange` (mismo origen, origen distinto, sin config actual, con
  y sin datos del usuario, normalización del endpoint); `probeConnection` con un conector falso
  (éxito, todo-o-nada ante el fallo de cada pull, cada tipo de error, tiempo máximo); estado de la
  conexión (`unconfigured`/`unverified`/`active`, incluida la config migrada sin `verifiedAt`).
- **Aplicación transaccional con `fake-indexeddb`** (la prueba más importante): si falla a mitad no
  cambia nada; si sale bien, las tablas quedan limpias y cargadas, los cursores reiniciados y la
  config guardada al final con `verifiedAt`; el cerrojo impide que un ciclo se intercale.
- **Sync (#53):** el estado y el motivo del error ante cada combinación de fallos; `lastSyncedAt` solo
  se actualiza en un ciclo exitoso; los conteos salen de la base local.
- **Errores:** cada fila de la tabla de 1.6 en `ui/errors.ts`.
- **Componentes:** el modal en cada fase (probando, error, confirmación con conteos, modo requerido
  sin Esc ni Cancelar); el bloqueo de `App`; la barra de estado.
- **Comandos (2c):** el menú ofrece `/DEMO_RESET` solo con `rest-demo`; los comandos del núcleo
  siempre; la consistencia entre `ConnectorActionId` y `connector-actions.ts`.
- **e2e:** primer arranque forzado sin salida posible; una prueba fallida deja el modal abierto con lo
  tipeado; cambio REST→Sheets con datos (advertencia y borrado) con el endpoint de Sheets simulado
  con `page.route`; flujo real contra el minibackend con `rest-demo`, incluido `/DEMO_RESET`. Lo que
  toque tiempos se repite con `--repeat-each`.

## Riesgos

- Un ciclo de sync intercalado durante la aplicación: lo evita el cerrojo compartido con `syncOnce`.
- El envío previo de pendientes no puede colgar el cambio: tiene tope de tiempo y su fallo solo cambia
  el conteo mostrado.
- Un catálogo grande en memoria durante la prueba: aceptado (un comercio, no un catálogo masivo); la
  prueba usa el mismo pull completo que el primer sync.
- El riesgo residual de `localStorage` descrito en 1.4.

## Fuera de alcance

- Una base de datos por conexión (recuperar datos al volver a un conector anterior).
- Re-verificar la config de forma periódica o automática: `verifiedAt` registra la última prueba
  exitosa y no caduca.
- Nuevos comandos concretos por conector (Google Sheets no declara ninguno todavía): el mecanismo
  queda listo, el contenido es de etapas futuras.
- Cargar comandos desde código de terceros: siguen siendo un registro cerrado de conectores
  compilados (mismo criterio que #66).

## Issues

- Crear un issue por etapa (2b y 2c) bajo el epic #66, con las etiquetas `feature:conectores-plugin`
  y `feature:sync` (2b) / `feature:config` (2c).
- 2b cierra #53.
- La Etapa 2 cierra #68 y #56 al mergearse.
