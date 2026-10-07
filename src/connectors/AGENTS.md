# src/connectors — implementaciones del contrato

Detalle de los conectores. El contrato y sus principios (el backend nunca rechaza, compatibilidad,
qué backends acompañan un cambio, el puente de Sheets mantenido con piso, permisos mínimos) están en el
[`AGENTS.md` de la raíz](../../AGENTS.md); el puerto `Connector`, los schemas Zod compartidos y qué
trajo cada versión del contrato (incluidas las columnas nuevas del puente de Sheets), en
[`src/sync/AGENTS.md`](../sync/AGENTS.md). El registro vive en `sync/connector-registry.ts`, pero sus
reglas están acá.

## Implementaciones y registro

`connectors/rest/rest-fetch-connector.ts` es la implementación de referencia sobre `fetch`;
`connectors/google-sheets/` implementa el mismo puerto contra una planilla de Google Sheets a través
de un puente Apps Script (`bridge.gs`; lo que ve quien lo usa, en la guía pública
`docs/integradores/google-sheets.md`, y el desarrollo, en el README del conector). Sus archivos
(`apps-script-files.ts` tiene la lista y el orden) se publican juntos en `pos-sheets.gs`, que se pega
en el `Código.gs` de la planilla (#219): `columnas.gs` solo tiene
los textos visibles (etiquetas de columna y de valor, en español), `bridge.gs` trabaja con claves
internas y encuentra cada columna por su encabezado, no por posición (Etapa 2d, #80); se prueban en
Vitest con una planilla falsa (`src/test/fake-spreadsheet.ts`). Desde la Etapa 2 de #87, `bridge.gs` expone
solo `pushBatch`/`pullBatch` (las acciones por evento/recurso de antes quedan como funciones
internas que esas dos llaman) y resuelve el lock del script puertas adentro — antes cada evento
pendiente era un request HTTP propio, cada uno tomando el lock de punta a punta. `pullBatch` ofrece
cursor real para Productos/Clientes pese a que Sheets no trackea "última modificación" por fila:
compara el contenido de cada fila contra un fingerprint guardado en una hoja oculta (`_Snapshot`) en
vez de depender de un trigger `onEdit` (más difícil de probar y que no cubriría las escrituras del
propio bridge de todos modos) — ver la guía del puente, "Cursor del pull". Contrato v3
(#96): pestañas nuevas `MovimientosCaja` y `Cobranzas`; columnas de identidad (Dispositivo, Sucursal,
Punto de venta) en lo que escribe, Alta/Bloqueado/Motivo del bloqueo en Productos y Clientes (Alta se
completa sola la primera vez que se lee la fila); `CuentaCorriente` pasa a ser el libro completo
(holds confirmados, pagos a cuenta sin hold con su signo, cobranzas en negativo); `Turnos` sale del
schema. Una planilla anterior se actualiza sola al redesplegar el puente: `ensureColumns_` agrega al
final de cada pestaña existente las columnas **opcionales** que le faltan (una requerida que falta
sigue siendo el error de siempre — agregarla vacía haría viajar productos a $0). Sheets procesa cada
lote dentro del request: nunca informa `queued`/`processing`. Desde 4.6.0 (#180) el puente declara
`customer-payment-void` y `portal` (comando `PLANILLA`) y la planilla como empresa; su acción liviana
`portalLink` devuelve la URL de la planilla, y una cobranza anulada marca la original con Estado =
Anulada, como una venta. **Funciones públicas**: `doGet`, `doPost` y las tres que llama la home (`posInicializar`,
`posReiniciar`, `posAgregarTablero`); todo lo demás termina en `_`. Desde la
página del Web App (`HtmlService`), `google.script.run` llama a cualquier función cuyo nombre no
termine en `_`, con los permisos del dueño y sin el secreto: lo vigila `bridge.test.ts` (#219). **Preparar la planilla** (#219, spec `docs/superpowers/specs/2026-10-07-sheets-planilla-lista-design.md`):
`inicio.gs::posInicializar` crea las pestañas vacías (la primera hoja vacía pasa a ser el Tablero),
le pone a la planilla el nombre del comercio, guarda comercio, sucursal y caja en Configuración
(`CONFIG_LABELS`) y carga los datos de prueba del rubro elegido (`datos-*.gs`, uno por rubro) con una
historia de 10 días hasta ayer, relativa a hoy y siempre igual para un rubro (semilla fija);
`posReiniciar` la vuelve a cero solo con "Permitir reiniciar" = Sí. El **Tablero** (`tablero.gs`)
son fórmulas vivas armadas con las columnas que `headerMap_` encuentra al crearlo (Sheets las ajusta
si después se mueven); los nombres de función van en inglés, pero el separador depende del idioma de
la planilla (`;` y `\` en español, `,` en inglés): `usaComa_` prueba `=SUM(1,2)` en una celda y la
borra. `posAgregarTablero` lo suma a una planilla preparada antes, sin tocar nada más. Las tres son
públicas (las llama la home) y se cuidan solas. Una línea de producto viaja sin descripción (contrato): `pushSale_` escribe
en Descripción el nombre que tiene en Productos al registrarse (`productNames_`, una lectura por
request; un id que no está queda vacío, #212). **La home** (`home.gs::doGet`, #133 y #219): una página (`HtmlService`) que se dibuja en el
navegador con `estadoDeLaHome_` y se redibuja con el estado que devuelve cada acción. Sin preparar,
el formulario (comercio, sucursal, caja y rubro, que llama a `posInicializar`); preparada, "Abrir la
planilla" (con el `#gid=` del Tablero) y "Abrir el POS", que arma en el navegador
`<URL del POS>#connect=<base64url>` con `{ type: 'google-sheets', webAppUrl, branch, pointOfSale }`
y la caja tipeada; sin Tablero, "Agregar el tablero"; con "Permitir reiniciar" = Sí, "Reiniciar la
planilla". `webAppUrl` sale de `ScriptApp.getService().getUrl()` (la de esa implementación: una
copia nunca conecta a la original) y nunca viaja el secreto: la página es pública. La URL del POS
sale de la pestaña Configuración (`ensureConfigSheet_`: se crea al final con el índice explícito,
solo si no existe; claves por texto con `readConfigValue_`; con la celda vacía o algo que no sea
`http(s)://`, `DEFAULT_POS_URL`); sus textos, en `columnas.gs` (`CONFIG_SHEET`, `CONFIG_LABELS`,
`CONFIG_STEPS`). **Publicados tal cual** (etapa C de #180, #219): el canal sirve
`pos-sheets.gs` (`site/sheets-bundle.ts`: una cabecera con `@OnlyCurrentDoc` en el primer comentario
y las instrucciones, y los `.gs` en orden) con la guía y "Copiar el código" en
`/v4/docs/google-sheets/`, así que sus comentarios no citan issues ni archivos del repo (la versión
del contrato sí: "4.0.0: …"); lo vigila `site/docs.test.ts`. Los `.gs` están en `.prettierignore`
(se pegan tal cual): se formatean con `prettier --ignore-path /dev/null --parser babel`.
Un cambio del puente que se ve desde afuera va también a la guía. Cada conector es dueño de su schema de config
y de la lista ordenada de campos que `/CONFIG` muestra (`configFields`); `sync/connector-registry.ts`
arma la unión discriminada por `type` y expone `createConnector(config)`, el único punto que elige
implementación (`sync/engine.ts::runPushCycle`/`runPullCycleNow` y
`sync/account-hold.ts::requestAccountHoldNow` ya no instancian ninguno directo). "Plugin" acá
significa un registro cerrado de conectores compilados, no
carga de código de terceros en runtime (descartada: ejecución de código arbitrario en una app que
maneja ventas y pagos) — un conector nuevo es un PR al repo. Todo `POST` de eventos de negocio es
idempotente vía `Idempotency-Key`.

## Comandos por conector y `/DEMO_RESET`

**Comandos por conector y `/DEMO_RESET` (#77)**: cada tipo de conector declara sus comandos
(`commands: ConnectorCommand[]` en `CONNECTOR_TYPES`, `connectors/connector-command.ts`, con `action`
de un union cerrado `ConnectorActionId`); la UI mapea cada acción en
`ui/keyboard/connector-actions.ts` (un `Record` exhaustivo: una acción sin implementar no compila).
`availableCommands()` = `CORE_COMMANDS` + los del conector activo (`activeConnectorTypeSignal`,
`ui/state/sync.ts`, que fijan `bootstrap` con la conexión `active` y `applyConnection`). Hoy el único
es `/DEMO_RESET`, del tipo `rest-demo` ("REST (minibackend de demo)", la misma implementación REST:
`createConnector` agrupa `rest` y `rest-demo`); con otro conector tipearlo da "Comando desconocido", y
`demoReset()` igual tiene una guarda (`demo/unavailable-for-connector`). Pantalla de confirmación de un
paso (`ui/screens/demo-reset-screen.tsx`); `storage/demo-reset.ts::demoReset` primero pide
`POST /_demo/reset` al backend (si falla, no toca nada local: dejar la terminal vacía sin poder
repoblarla sería peor), después borra todo lo local (`clearAllTables`), los cursores
(`sync/cursor.ts::clearSyncCursors`) y el estado de lotes (`sync/push-lot.ts::clearPushLotState`), y
dispara un push y un pull completo para repoblar. **No** toca la config de `/CONFIG` (decisión del
usuario: es la conexión de la terminal, no un dato de demo). La app nunca siembra datos al arrancar:
los fixtures (`storage/fixtures/`, `seedCatalogIfEmpty`/`seedCustomersIfEmpty`) son para los tests, y
una terminal nueva arranca en `/CONFIG`.
