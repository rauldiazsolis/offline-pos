# Sincronización por lotes — Etapa 2: batch real en Google Sheets (#87)

Etapa 1 (PR #89, mergeado) dejó el contrato batch (`pushBatch`/`pullBatch`) funcionando de punta a
punta contra REST/`demo-backend`. El conector de Google Sheets quedó con un adaptador **mecánico**:
habla el puerto nuevo hacia `sync/engine.ts`, pero adentro sigue haciendo N llamadas HTTP sueltas
contra las acciones viejas de `bridge.gs` (una por evento de push, dos para pull). Esta etapa le da
batch real: una sola llamada de push con el lote entero, una sola llamada de pull, y estado de lote
consultable — resolviendo el lock del script puertas adentro en vez de exponerlo como error al POS.

Decisiones ya confirmadas con el usuario (AskUserQuestion, 2026-09-22):

1. **Fallo de un evento dentro de un lote** (ej. `sale-void` de una venta que esa fila de `Ventas`
   todavía no tiene): se captura, se agrega a `issues` del lote, el resto de los eventos del lote se
   sigue aplicando. El ack HTTP sigue siendo `ok: true` — nunca se rechaza el lote completo. El humano
   lo resuelve a mano en la planilla si hace falta.
2. **`_Idempotency` (por evento) se retira**, reemplazada por `_PushLots` (por lote): cubre
   idempotencia (no reprocesar un lote repetido) y estado consultable (`ok`/`issues`) en el mismo
   lugar. Ninguna otra acción necesita idempotencia por evento (las demás son no-ops del lado de
   Sheets).
3. **Las acciones viejas del bridge se sacan del `ACTIONS` map** (`pullProducts`, `pullCustomers`,
   `pushSale`, `pushSaleVoid`, `pushCustomer`, `pushAccountHoldConfirm`, `pushCashSession` quedan
   como funciones internas, llamadas solo desde `pushBatch`/`pullBatch`). El bridge expone solo las
   dos operaciones del contrato nuevo, igual que REST. Un merchant que actualice el script simplemente
   re-pega el `bridge.gs` nuevo (mismo criterio que la Etapa 2d).
4. **Cursor real para Productos/Clientes**: se agrega en esta etapa (el usuario lo pidió
   explícitamente, contra mi recomendación inicial de dejarlo para después).

## Diseño del cursor (resuelto en esta sesión, no estaba en el spec)

Sheets no tiene una noción nativa de "última modificación" por fila. Dos formas de conseguirla:

- **Trigger `onEdit`**: instala un simple trigger que registra cuándo cambió cada fila editada a
  mano. Se descartó: necesita simular `e.range`/`getSheet()` en el arnés de test (la planilla falsa
  no lo soporta hoy), su comportamiento real depende de detalles de Apps Script difíciles de probar
  fuera de un despliegue real (qué dispara y qué no un simple trigger), y no cubre las escrituras que
  ya hace el propio bridge (`pushCustomer`) sin lógica aparte.
- **Fingerprint por fila, calculado al leer** (elegido): cada `pullBatch` ya tiene que leer la
  pestaña completa (Sheets no permite leer solo "lo que cambió" de otra forma) — se aprovecha esa
  lectura para comparar el contenido de cada fila contra lo que se vio la última vez
  (`_Snapshot`, pestaña oculta: `resource`, `id`, `fingerprint` = JSON de la fila, `updatedAt`).
  Fila nueva o con fingerprint distinto → `updatedAt = ahora`, se persiste. Sin cambios → conserva su
  `updatedAt` anterior. El cursor devuelto (`nextCursor`) es el máximo `updatedAt` entre todas las
  filas actuales de ese recurso (`undefined` si no hay ninguna, igual que `demo-backend`). Cubre por
  igual ediciones manuales del comerciante y escrituras del propio bridge, sin trigger, y es
  trivialmente testeable con la planilla falsa que ya existe (llamar dos veces, mutar la celda entre
  medio, verificar qué trae el segundo pull).

Limitación aceptada, documentada en el README: una fila borrada no genera un "tombstone" — una baja
solo se refleja en la próxima foto completa (cada 2h/al configurar/a pedido), igual que ya documenta
CLAUDE.md para el mecanismo de reconciliación en general.

## Tareas (TDD: red → green → verificar → commit)

1. `bridge.gs`: SCHEMA — sacar `_Idempotency`, agregar `_PushLots` (`id`, `status`, `issues`, `at`)
   y `_Snapshot` (`resource`, `id`, `fingerprint`, `updatedAt`). Sacar `idempotent()`/`hasKey()` (ya
   sin uso).
2. `bridge.gs`: `applyBatchEvent(event)` — dispatcher sobre los 7 tipos de outbox, reusando
   `pushSale`/`pushSaleVoid`/`pushCustomer`/`pushAccountHoldConfirm`/`pushCashSession` tal cual están
   (mismo payload shape); `stock-movement`/`account-hold-release` no-ops. `pushBatchAction(payload,
   idempotencyKey)`: si el lote ya está en `_PushLots`, devuelve `{}` sin reprocesar; si no, aplica
   cada evento con try/catch (issues acumuladas, nunca aborta el lote), registra el resultado en
   `_PushLots`. `ACTIONS.pushBatch = pushBatchAction`; sacar las acciones de push individuales del
   map.
3. `bridge.gs`: `trackChanges(resource, items)` (fingerprint + `_Snapshot`, ver diseño arriba);
   `pullProducts()`/`pullCustomers()` pasan a devolver solo el array de items (sin `{items}`);
   `pullResource(resource, since, items)` genérico (diffing + filtro + `nextCursor`).
   `pullBatchAction(payload)`: arma `products`/`customers` vía `pullResource`, busca en `_PushLots`
   cada id de `payload.pendingLotIds` (ausente si el backend no lo reconoce — igual semántica que
   "pending" del lado del POS). `ACTIONS.pullBatch = pullBatchAction`; sacar `pullProducts`/
   `pullCustomers` del map.
4. `bridge.test.ts`: reescribir la sección de push (un `pushBatch` con varios eventos, idempotencia
   por lote, un evento que falla queda en `issues` sin tumbar el resto) y pull (cursor: primer pull
   sin cursor trae todo + `nextCursor`; segundo pull con ese cursor y sin cambios trae `items: []`;
   modificar una fila a mano entre medio y el siguiente pull la vuelve a traer; estado de lote en
   pull: `ok`, `issues`, ausente si no se reconoce el id).
5. `src/connectors/google-sheets/google-sheets-connector.ts`: reemplazar el loop de `pushOne` por una
   sola llamada `action: 'pushBatch'`; `pullBatch` por una sola llamada `action: 'pullBatch'` pasando
   `cursors`/`pendingLotIds` y devolviendo `nextCursor` real (antes ninguno) y `lots` reales (antes
   siempre `ok`).
6. `google-sheets-connector.test.ts`: actualizar para la nueva forma (una sola invocación de
   `callBridge` por lote, no una por evento; cursores pasados y devueltos; `lots` reflejando la
   respuesta del bridge en vez de hardcodear `ok`).
7. `README.md` del conector: reescribir la sección "Qué hace cada operación" y el contrato del
   puente (`pushBatch`/`pullBatch`), sacar la tabla vieja de acciones, reescribir el checklist manual
   (idempotencia de lote, issues parciales, cursor real) y notar la limitación de bajas sin tombstone.
8. `CLAUDE.md`: cerrar la mención de "Etapa 2 (pendiente)" en "Connector API" y "Estado del
   proyecto", documentar el mecanismo de fingerprint/cursor.
9. Verificación completa: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, e2e (revisar
   puertos 4000/4173 libres antes). Commit final, push, PR (base `main`, merge commit, sin squash,
   "Closes #87" — con esta etapa el epic completo queda cerrado).
