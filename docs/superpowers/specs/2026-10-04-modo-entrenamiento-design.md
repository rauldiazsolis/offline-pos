# Modo entrenamiento

Fecha: 2026-10-04
Estado: implementada (diseño aprobado en el brainstorming del 2026-10-04; el plan quedó en el
historial de git).
Issue: #177 (etapa P4 del epic #182, la última del MVP de mini contax; spec del MVP en
rauldiazsolis/mini-erp, `docs/superpowers/specs/2026-10-01-mvp-mini-contax-design.md`).

## Contexto

- El operador nuevo necesita practicar con el catálogo, el stock y los clientes reales sin que nada
  llegue al backend (en mini, sin generar cargos). No toca el contrato y se prueba sin el mini-erp.
- Criterio de aceptación de #177: en entrenamiento, una venta descuenta stock localmente y se imprime
  con la marca; no aparece en ningún push; al salir, el stock y el `/RESUMEN` vuelven al estado real y
  las ventas pendientes reales de antes siguen ahí.
- Contra el riesgo de olvidarlo prendido: franja inconfundible, "ENTRENAMIENTO" en el ticket y aviso
  al salir con lo que se descarta.

## Decisiones

### 1. Dónde vive: una base de Dexie aparte, con recarga

Se eligió entre tres opciones: (A) una base aparte y recargar al entrar y al salir, (B) una marca
`training` en las mismas tablas, (C) una base aparte cambiada en caliente. Se eligió **A**: todo lo
que ya existe (venta, cobro, `/CAJA`, `/RESUMEN`, `/ANULAR`, numeración, reaplicación del pull) anda
sin tocarlo sobre datos que no son los reales, y salir es borrar esa base. B obligaba a filtrar en
cada consulta (un filtro olvidado mezcla o deja viajar algo) y a revertir stock y saldos a mano; C
obligaba a reinicializar signals, índices y motor, que es lo que ya hace `bootstrap` al recargar.

- **`storage/training-mode.ts`** (nuevo): la marca `storageKey('training')` con `{ startedAt }`,
  validada con Zod (rota = apagada). Se lee **una vez al cargar**, como `STORAGE_NAMESPACE`:
  `TRAINING_MODE` (`{ startedAt } | null`). Funciones `trainingDatabaseName(namespace)` =
  `${namespace}#entrenamiento` y `operationalKey(name)` = `storageKey(name)` en modo real y
  `storageKey('training:' + name)` en entrenamiento.
- **`db.ts`**: `PosDatabase` recibe el nombre; `db` abre `trainingDatabaseName(STORAGE_NAMESPACE)`
  con la marca y `STORAGE_NAMESPACE` sin ella. Mismo esquema y mismas migraciones.
- **Claves operativas** (pasan a `operationalKey`): `sync-cursor:products`,
  `sync-cursor:customers`, `sync:last-full`, `sync:push-lot`, `sync:push-lot-awaiting`,
  `cleanup:last-run`, `ticket-counter` y `receipt-counter`. Así la numeración real no se consume ni
  se desordena (el entrenamiento arranca en el Ticket #1 y el Recibo #1 del día), el cursor real no
  avanza y el pull de entrenamiento no ve ningún lote real.
- **Claves compartidas** (sin cambios): config, device-id, capacidades, empresa, avisos, portal, demo
  revocada, impresora, `wipe_key` y las de la pestaña. Son datos del backend o del equipo.

### 2. Entrar y salir

**Entrar** (`ui/keyboard/training-controller.ts`, dependencias inyectadas):

1. Último envío de lo real pendiente, como `flushPendingBeforeWipe` (ignora el backoff, toma el
   cerrojo, con tope). Si falla o no hay red, se entra igual: lo real espera a la salida.
2. Si existe una base de entrenamiento vieja, se borra.
3. Se abre una segunda instancia de `PosDatabase` con el nombre de entrenamiento y se copian, en una
   transacción, `products`, `stock`, `customers`, `customerAccounts`, `customerBalances` y
   `cashConcepts` (`storage/training-copy.ts`). Ventas, cobranzas, movimientos de stock, de cuenta y
   de caja, arqueos, outbox y venta en curso arrancan vacíos.
4. Se copian los cursores reales y `sync:last-full` a sus claves de entrenamiento: el primer pull es
   un delta.
5. Se prende la marca y se recarga.

**Salir**: se borran la marca y todas las claves `training:*` y se recarga; una marca en
`sessionStorage` hace que la venta muestre "Saliste del entrenamiento." en el slot de avisos de la
barra. Al arrancar **sin** la marca, `bootstrap` borra la base de entrenamiento si existe
(`Dexie.delete`). Eso cubre un corte a mitad de entrar (base sin marca) o de salir: lo colgado lo
limpia el próximo arranque.

### 3. Sync en entrenamiento

- **Push cortado**: `sync/engine.ts::pushPendingLot` no hace nada con `TRAINING_MODE`. Es el único
  que llama a `connector.pushBatch` (también lo usan `runPushCycle`, `syncNow` y el flush), así que es
  un solo punto de corte; además el outbox real no está abierto.
- **Pull como siempre**, sobre la base de entrenamiento y con sus cursores. Lo de entrenamiento queda
  `pending` en su outbox para siempre, así que la reaplicación lo descuenta del stock y del saldo en
  cada pull: el stock que se ve es el del backend menos lo de entrenamiento. Lo real pendiente que no
  se pudo enviar al entrar no se descuenta ahí (aceptado: es práctica).
- **Sin limpieza a 7 días** (`maybeRunCleanup` no corre): la base es efímera.
- **Reserva de crédito**: es una escritura síncrona en el backend, así que en entrenamiento no se pide
  (`requestAccountHoldNow`): se evalúa siempre offline (`canChargeOffline`).
- **Pendientes**: la barra de estado muestra 0 (nada se va a enviar).

### 4. La UI

- **`/ENTRENAMIENTO`** (comando core): apagado, "Practicar sin enviar nada al backend"; prendido,
  "Salir del entrenamiento". Con una venta en curso (lo que vacía `/DESCARTAR`) no entra y avisa
  "Terminá o descartá la venta para entrar al entrenamiento." (como `/ACTUALIZAR`). Salir con una
  venta de entrenamiento en curso sí se puede: se descarta y figura en el aviso.
- **Pantalla de entrenamiento** (`ui/screens/training-screen.tsx`, estado en
  `ui/state/training.ts`, patrón de "Abrir una demo"), dos modos:
  - **Entrar**: qué es (se vende, se cobra y se usa la caja con el catálogo y los clientes reales;
    nada se envía al backend; al salir se borra todo lo hecho). Con pendientes reales, contados como
    en "Abrir una demo" (ventas aparte, el resto como movimientos): "Sin enviar: 1 venta y 1
    movimiento más. Se intenta mandarlo ahora; si no se puede, sale al terminar el entrenamiento.".
    Enter = "Entrar al entrenamiento" (`.btn-primary`), Esc = "Cancelar". Mientras
    envía y copia, "Preparando…" y los botones deshabilitados.
  - **Salir**: lo que se descarta, contado sobre la base de entrenamiento ("N ventas, M cobranzas, K
    movimientos de caja y arqueos", y si hay, "la venta en curso" y "N clientes creados") y lo que
    vuelve ("Vuelven el stock, los saldos y el resumen reales; lo pendiente real sigue guardado.").
    Enter = "Descartar y salir" (`.btn-danger`), Esc = "Seguir entrenando".
- **Franja** (`ui/components/TrainingBanner.tsx`): arriba de **todas** las pantallas, dentro de
  `.app-zoom-wrapper`; la pantalla activa toma el alto restante (`--app-height` menos la franja).
  Alto fijo, rayas diagonales ámbar y negro (tokens `--color-training-*`), distinta del chrome y de
  las advertencias. Texto en negrita: "MODO ENTRENAMIENTO · nada se envía al backend · todo se borra
  al salir". A la derecha, "Salir del entrenamiento (/ENTRENAMIENTO)", que llama a lo mismo que el
  comando (`tabIndex={-1}`, `keepFocusOnMouseDown`); no parte su etiqueta.
- **Título de la pestaña**: prefijo "ENTRENAMIENTO · ".
- **`/DIAGNOSTICO` y `pos.status()`**: "Modo entrenamiento desde HH:MM" (`collectDiagnostics`).
- **Ticket**: con `TRAINING_MODE`, todo comprobante suma la marca "ENTRENAMIENTO" en `marks`
  (`ui/print/receipt-document.ts`): venta, cobranza, copia desde `/RESUMEN` y prueba de
  `/IMPRESORA`; también en el comprobante en pantalla.
- **Caja**: arranca sin arqueos (saldo base 0) y el aviso "Sin arqueo en 24 h" no se muestra.
- **`/RESUMEN` y `/ANULAR`**: sin cambios; durante el entrenamiento ven solo lo de entrenamiento y
  al salir, solo lo real.

### 5. Bordes

- **Deshabilitados en entrenamiento** (`CommandInfo.availability`, fila atenuada con el motivo):
  `/CONFIG`, `/ALTA`, `/DEMO_NUEVA` y `/DEMO_RESET`, con el motivo "en entrenamiento; salí con
  /ENTRENAMIENTO" ("/CONFIG no está disponible: en entrenamiento; salí con /ENTRENAMIENTO."). El
  botón del encabezado (alta o demo nueva) muestra el mismo mensaje en la barra en vez de navegar.
- **Link de demo o `#connect` al arrancar en entrenamiento**: no se procesan; la URL se limpia como
  siempre y la barra avisa "Salí del entrenamiento y volvé a abrir el link.".
- **`/ACTUALIZAR`**: se permite; la marca sigue y se vuelve al entrenamiento con la versión nueva
  (Dexie migra la base de entrenamiento).
- **`/SINCRONIZAR`**: solo el pull. **Portal**: se permite (el POS no escribe nada).
- **Cliente nuevo (`@nombre`)**: queda en la base de entrenamiento con su evento sin enviar; se
  descarta al salir.
- **Identidad perdida** (sin device-id) con la marca: antes de generar un id, se apaga la marca y se
  recarga; el borrado de siempre corre sobre la base real.
- **`pos.reset()`**: borra también la base de entrenamiento (la marca ya cae con el prefijo; en
  entrenamiento la base abierta es la de práctica y la borra el próximo arranque).
  **`pos.export()`**: indica `training: true` y exporta la base abierta.
- **Una sola pestaña (#175)**: sin cambios; la marca es por almacenamiento, como todo.

### 6. Lo que no cambia

El contrato (sigue 4.6.0), el demo-backend, el puente de Google Sheets y la versión del POS (la
decide el release aparte).

## Tests

- `storage/training-mode.test.ts`: marca ausente, válida y rota; nombre de la base; `operationalKey`
  en los dos modos.
- `storage/training-copy.test.ts`: copia lo maestro, nunca ventas, outbox, caja ni venta en curso;
  borra una base vieja antes.
- `sync/engine.test.ts`: con `TRAINING_MODE`, el conector falso no recibe ningún `pushBatch` (ciclo,
  `syncNow` y flush) y el pull corre.
- `sync/account-hold.test.ts`: en entrenamiento no llama al conector.
- `ui/print/resolve-receipt.test.ts`: la marca en venta, cobranza, copia y prueba.
- `ui/keyboard/commands.test.ts`: disponibilidad de los comandos en entrenamiento; descripción de
  `/ENTRENAMIENTO`.
- `ui/keyboard/training-controller.test.ts`: no entra con venta en curso; orden de entrar (flush,
  copia, marca, recarga) y que un flush fallido no impide entrar; los conteos de la salida.
- `ui/bootstrap`: sin la marca borra la base de entrenamiento; con la marca no procesa links.
- **E2E** `e2e/training.spec.ts` (contra el demo-backend): una venta real pendiente sin red; entrar
  (franja y título); una venta de entrenamiento descuenta stock y el comprobante dice ENTRENAMIENTO;
  con red, `/SINCRONIZAR` hace pull y **ningún request a `/sync/push`** (ruta interceptada); salir (el
  aviso lista 1 venta); stock y `/RESUMEN` reales y la venta real todavía pendiente en el outbox real
  (IndexedDB); al volver la red, la venta real sale en el push.

## Docs

- `AGENTS.md` raíz: sección "Modo entrenamiento (#177)" con el principio, fila en el índice,
  `/ENTRENAMIENTO` en la tabla de comandos, la fila de #177 en "Estado del proyecto", #177 fuera de
  "Siguiente" y de "Issues abiertas", y #207 (concurrency del CI) en "Transversal".
- `src/storage/AGENTS.md`: la base y las claves operativas. `src/sync/AGENTS.md`: el push cortado,
  la reserva y la limpieza. `src/ui/AGENTS.md`: comando, pantallas, franja, ticket y bordes.

## Cierre

PR con "Closes #177"; comentario en el issue apuntando al PR y #177 tildado en el epic #182.
