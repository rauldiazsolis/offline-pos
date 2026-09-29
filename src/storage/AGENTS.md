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

Carpetas del mismo origen comparten IndexedDB y `localStorage`, y cada versión publicada vive en la
suya (`/0.1.0/`), así que el nombre del almacenamiento sale de la ruta. `storage-namespace.ts` lo
calcula **una vez al cargar**, desde `location.pathname` (la carpeta es todo hasta la última `/`):

- En `/`: la base de Dexie es `offline-pos` y el prefijo de `localStorage`, `offline-pos:`, como
  antes de #148 (las terminales servidas en la raíz no se enteran).
- En `/0.1.0/`: `offline-pos@/0.1.0/` y `offline-pos@/0.1.0/:`. El `:` final del prefijo evita que
  una carpeta abarque las claves de otra.

`db.ts` abre `new Dexie(STORAGE_NAMESPACE)`. Toda clave de `localStorage` pasa por
`storageKey('<nombre>')`, nunca un literal con el prefijo escrito a mano: lo vigila
`storage-keys.test.ts`, que además fija los nombres de antes de #148. El borrado y el volcado por
prefijo (`pos.reset()`, `pos.export()`, `LOCAL_STORAGE_PREFIX`) nunca tocan otra carpeta. Sin barra
final (`/0.1.0`) los assets relativos dan 404 y la app no arranca: nunca abre con el almacenamiento de
la carpeta de arriba.

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
