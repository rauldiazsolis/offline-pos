# src/storage — Dexie y persistencia

Detalle de persistencia. Los principios (ULID con `storage/ids.ts::newId`, `try/catch` solo en
adaptadores, puertos de búsqueda) están en el [`AGENTS.md` de la raíz](../../AGENTS.md). Otras reglas
que rigen archivos de esta carpeta viven donde está el grueso del tema:

- `apply-pull.ts`, `reconcile.ts`, `local-cleanup.ts`, `local-data.ts` (pull, foto completa,
  limpieza, lista de pendientes): [`src/sync/AGENTS.md`](../sync/AGENTS.md).
- `sale-repository.ts` (venta y anulación): el outbox en [`src/sync/AGENTS.md`](../sync/AGENTS.md) y
  la anulación en [`src/domain/AGENTS.md`](../domain/AGENTS.md).
- `demo-reset.ts`: [`src/connectors/AGENTS.md`](../connectors/AGENTS.md).
- `cash-summary-repository.ts` (`/RESUMEN`) y `void-repository.ts` (candidatos de `/ANULAR`):
  [`src/ui/AGENTS.md`](../ui/AGENTS.md).
- Tests de Dexie con `fake-indexeddb`: "Testing" en la raíz.

## Almacenamiento por carpeta (#148)

Carpetas del mismo origen comparten IndexedDB y `localStorage`, y cada canal publicado vive en la
suya (`/v4/`, #54; antes, una carpeta por versión), así que el nombre del almacenamiento sale de la
ruta. `storage-namespace.ts` lo calcula **una vez al cargar**, desde `location.pathname` (la carpeta
es todo hasta la última `/`), con las reglas puras de `namespace-rules.ts` (`storageNamespaceFor`,
`localStoragePrefixFor`): sin `window`, porque también las usa el service worker.

- En `/`: la base de Dexie es `offline-pos` y el prefijo de `localStorage`, `offline-pos:`, como
  antes de #148 (las terminales servidas en la raíz no se enteran).
- En `/v4/`: `offline-pos@/v4/` y `offline-pos@/v4/:`. El `:` final del prefijo evita que una
  carpeta abarque las claves de otra.

`db.ts` abre la base `STORAGE_NAMESPACE` (o la de entrenamiento, ver abajo). Toda clave de
`localStorage` pasa por `storageKey('<nombre>')`, nunca un literal con el prefijo escrito a mano: lo
vigila `storage-keys.test.ts`, que además fija los nombres de antes de #148. El borrado y el volcado por
prefijo (`pos.reset()`, `pos.export()`, `LOCAL_STORAGE_PREFIX`) nunca tocan otra carpeta. Sin barra
final (`/v4`) los assets relativos dan 404 y la app no arranca: nunca abre con el almacenamiento de
la carpeta de arriba.

**Cachés del service worker (#54)**: la Cache Storage también es una sola por origen, así que el
service worker nombra la suya con el mismo criterio, `<namespace>:sw:<hash del build>`
(`offline-pos@/v4/:sw:…`; `offline-pos:sw:…` en `/`; `workers/sw-logic.ts::swCachePrefix`). Al
activarse borra solo las de su prefijo que no son la actual. `pos.reset()` borra, de cada cosa, lo
de esta carpeta: las tablas de su base, las claves de su prefijo, el registro del service worker
cuyo `scope` es **exactamente** esta carpeta (nunca el de una de arriba) y las cachés de su prefijo
(`ui/service-worker.ts::removeOwnServiceWorker`).

**Una sola pestaña (#175)**: el cerrojo de `navigator.locks` y el `BroadcastChannel` de la pestaña que
manda se llaman `TAB_LOCK_NAME` (`storageKey('tab')`: `offline-pos:tab` en `/`,
`offline-pos@/v4/:tab` en `/v4/`), así dos carpetas del mismo origen nunca se bloquean entre sí.
La marca de pestaña desplazada (`tab-displaced.ts`) va en `sessionStorage`, que es de la pestaña y
sobrevive a su propio reload, con la clave `storageKey('tab-displaced')`. El resto, en
[`src/ui/AGENTS.md`](../ui/AGENTS.md).

## Modo entrenamiento (#177)

Spec: `docs/superpowers/specs/2026-10-04-modo-entrenamiento-design.md`; el principio, en la raíz.

- **La marca** (`training-mode.ts`): `storageKey('training')` con `{ startedAt }`, validada con Zod
  (rota = apagada), que se lee **una vez al cargar**, como el namespace (`isTrainingMode`,
  `trainingMark`; en los tests, `setTrainingModeForTests`). Con ella, `db.ts` abre
  `trainingDatabaseName(STORAGE_NAMESPACE)` = `<namespace>#entrenamiento` (`PosDatabase` recibe el
  nombre; mismo esquema y mismas migraciones).
- **Claves operativas**: el estado del motor que no se puede mezclar con el real pasa por
  `operationalKey('<nombre>')`, que en entrenamiento es `storageKey('training:<nombre>')`: los
  cursores, `sync:last-full`, el estado de lotes, `cleanup:last-run` y los contadores de ticket y
  recibo (así la numeración real no se consume). Lo demás (config, device-id, capacidades, empresa,
  avisos, portal, demo revocada, impresora) se comparte. `storage-keys.test.ts` acepta las dos formas.
- **Entrar y salir** (`training-copy.ts`): `prepareTrainingDatabase` borra una base de entrenamiento
  vieja y copia, en una transacción, `TRAINING_COPIED_TABLES` (catálogo, stock, clientes, cuentas,
  saldos y conceptos; nunca ventas, cobranzas, movimientos, caja, outbox ni venta en curso);
  `copyOperationalStateToTraining` copia los cursores (el primer pull es un delta);
  `clearTrainingKeys` borra la marca y las `training:*`. El arranque fuera del modo borra la base de
  entrenamiento si quedó (`deleteTrainingDatabase`): cubre un corte a mitad de entrar o de salir.

## Contador de escrituras (#175)

`transaction-tracker.ts` es un middleware de Dexie (capa `dbcore`, instalado en `db.ts`) que cuenta
las transacciones `readwrite` abiertas de esta pestaña: suma al crearlas y resta en `complete` o
`abort`. Antes de soltar el control, la pestaña que manda espera a que lleguen a 0
(`waitForIdleWriteTransactions`, con tope), así un cobro que se está guardando nunca se corta a medias.
Las lecturas no cuentan. Es genérico a propósito: una tabla o un repositorio nuevo queda cubierto solo.

## Borrado de lo local

Un solo lugar borra lo local: `clearAllTables` (`db.tables`, así una tabla futura queda incluida sola),
compartido con `/DEMO_RESET`.

## Tipo de inserción explícito en Dexie

- **Tipo de inserción explícito en Dexie para tablas con unión discriminada**: el `EntityTable<T, PK>`
  por defecto usa `Omit<T, PK>`, que colapsa la unión; para tablas así (`outbox`, `storage/db.ts`) va
  `EntityTable<T, PK, T>` cuando el `id` siempre lo genera la app.

## Caja: modelo local (Etapa 5, #100)

- **Modelo local**: `cashMovements` (los `CashMovement` del contrato, cada uno con su evento
  `cash-movement`), `cashCounts` (`domain/cash-count.ts::CashCount`: cada arqueo, **aunque no tenga
  diferencia**, que no viaja pero es la base del saldo) y `cashConcepts` (estadística de conceptos),
  Dexie versión 7 (que además borra `cashSessions`). `storage/cash-repository.ts` hace cada operación
  en una transacción.

## Cobranza: persistencia (Etapa 6, #101)

- **Persistencia** (`storage/customer-payment-repository.ts::collectAndPersist`): en **una**
  transacción el número de recibo, la cobranza (`customerPayments`, Dexie v8), su `AccountMovement`
  (`type: 'payment'`, `paymentId`), el saldo (crea la fila si no existía) y el evento
  `customer-payment` (armado adentro, viaja con el número). Recibos numerados por día como los
  tickets (`domain/ticket-number.ts::nextDailyNumber`, `DailyNumber`), con su propio contador
  best-effort (`offline-pos:receipt-counter`, `sync/receipt-counter.ts`; `sync/daily-counter.ts` es el
  lector/escritor compartido con el de tickets).
- **Anulación** (`voidCollectionAndPersist`, #125): la misma transacción (`persistCollectionDocument`,
  que comparte con `collectAndPersist`) con la cobranza negativa — consume número de recibo, su
  `AccountMovement` es positivo y el saldo sube. Índice `voidsPaymentId` en Dexie v9 ("¿ya tiene
  anulación?" sin recorrer la tabla); `loadVoidedPaymentIds` y `loadPaymentVoidOriginals` los usan
  `/ANULAR` y `/RESUMEN`.

## Fixtures

- **Clientes de ejemplo** (`storage/fixtures/customers.json`, unos 22, con documento y teléfono
  variados y dos "Juan Pérez" a propósito para probar la desambiguación).
