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
de un puente Apps Script (`bridge.gs`, ver su README). Sus dos archivos (`bridge.gs` y
`columnas.gs`) se pegan en el mismo proyecto de Apps Script: `columnas.gs` solo tiene los textos
visibles (etiquetas de columna y de valor, en español), `bridge.gs` trabaja con claves internas y
encuentra cada columna por su encabezado, no por posición (Etapa 2d, #80); se prueban en Vitest con
una planilla falsa (`src/test/fake-spreadsheet.ts`). Desde la Etapa 2 de #87, `bridge.gs` expone
solo `pushBatch`/`pullBatch` (las acciones por evento/recurso de antes quedan como funciones
internas que esas dos llaman) y resuelve el lock del script puertas adentro — antes cada evento
pendiente era un request HTTP propio, cada uno tomando el lock de punta a punta. `pullBatch` ofrece
cursor real para Productos/Clientes pese a que Sheets no trackea "última modificación" por fila:
compara el contenido de cada fila contra un fingerprint guardado en una hoja oculta (`_Snapshot`) en
vez de depender de un trigger `onEdit` (más difícil de probar y que no cubriría las escrituras del
propio bridge de todos modos) — ver el README del conector, sección "Cursor de pull". Contrato v3
(#96): pestañas nuevas `MovimientosCaja` y `Cobranzas`; columnas de identidad (Dispositivo, Sucursal,
Punto de venta) en lo que escribe, Alta/Bloqueado/Motivo del bloqueo en Productos y Clientes (Alta se
completa sola la primera vez que se lee la fila); `CuentaCorriente` pasa a ser el libro completo
(holds confirmados, pagos a cuenta sin hold con su signo, cobranzas en negativo); `Turnos` sale del
schema. Una planilla anterior se actualiza sola al redesplegar el puente: `ensureColumns` agrega al
final de cada pestaña existente las columnas **opcionales** que le faltan (una requerida que falta
sigue siendo el error de siempre — agregarla vacía haría viajar productos a $0). Sheets procesa cada
lote dentro del request: nunca informa `queued`/`processing`. Desde 4.6.0 (#180) el puente declara
`customer-payment-void` y `portal` (comando `PLANILLA`) y la planilla como empresa; su acción liviana
`portalLink` devuelve la URL de la planilla, y una cobranza anulada marca la original con Estado =
Anulada, como una venta. Cada conector es dueño de su schema de config
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
