# Anular cobranzas desde `/ANULAR`, con `/ANULAR` como `/RESUMEN`

Fecha: 2026-09-28
Estado: implementado (plan `docs/superpowers/plans/2026-09-28-anular-cobranzas.md`; desvíos al final).
Issues: #125 (etapa del epic #134, MVP publicado); en la misma etapa entran #110 (búsqueda y
documento completo en `/ANULAR`) y #58 (confirmación como modal). Surgieron en el brainstorming,
fuera de esta etapa: #137 (comprobante de la anulación) y #138 (conector de Sheets en el POS con la
API del puente especificada).

## Contexto

Desde la Etapa 6 del epic #94 (#101) una cobranza sin venta no se puede anular: el contrato dice
"se corrige con otro registro" y la única corrección posible es del lado del backend. Esta etapa
anula cobranzas con **el mismo criterio que las ventas** (#99) y en la misma pantalla, y de paso
rehace `/ANULAR` para que se vea como la pestaña Movimientos de `/RESUMEN`.

Lo que el código hace hoy:

1. `/ANULAR` (`ui/screens/void-sale-screen.tsx`, `ui/keyboard/void-controller.ts`,
   `storage/sale-repository.ts::listVoidCandidates`) lista solo **ventas**: los últimos 20 tickets
   de las últimas 24 h, cada fila con número, `toLocaleString()` y total. La confirmación reemplaza
   la lista y muestra `Venta <ULID> — $total`.
2. `/RESUMEN` (`ui/screens/cash-summary-screen.tsx`, 1013 líneas) ya dibuja ventas (con líneas,
   cliente, medios, total y la marca "· Anulada" / "· Anulación del #1") y cobranzas ("Recibo #1 ·
   Carlos Pérez", medios con monto, total), con un buscador (`filterEntries`, FlexSearch) que
   encuentra por número, cliente, producto, SKU y código.
3. `domain/customer-payment.ts::buildCustomerPayment` exige montos > 0 y sin cuenta corriente.
4. Lo que suma cobranzas ya lo hace **con signo**: el saldo de efectivo
   (`domain/cash-count.ts::calculateCashBalance`), la reaplicación del pull
   (`domain/reapply.ts`: `-payment.total` al saldo), `/RESUMEN` (`domain/day-summary.ts`) y el
   demo-backend (`adjustBalance(db, customerId, -payment.total)`). Una cobranza con total negativo se
   revierte sola en todos ellos.

Decisiones tomadas con el usuario (2026-09-28):

- Contrato **4.3.0, aditivo**. Lo acompaña solo el demo-backend. El mini-erp no se toca (desarrollo
  separado) y no se abre issue para él. Google Sheets sigue congelado en 4.2.0 (#127) y queda
  incompatible, lo que es aceptable (está fuera del MVP).
- La anulación es **una cobranza propia**: pagos invertidos, referencia a la original y su propio
  número de recibo. Ventana de 24 h móviles, no se anula dos veces ni se anula una anulación, y la
  original queda intacta (RNF-07).
- Revierte el saldo del cliente y el saldo de efectivo. `/RESUMEN` la muestra como anulación.
- `/ANULAR` se ve como Movimientos de `/RESUMEN`: ventas y cobranzas mezcladas, **todas las de las
  últimas 24 h** (sin el tope de 20), lo más nuevo primero, con buscador. La original anulada y la
  anulación no son seleccionables. La confirmación es un **modal chico**. Nunca se muestra un ULID.
- Al confirmar, vuelve a la venta con un aviso en el slot de la barra. El comprobante de la
  anulación queda en #137.

## 1. Contrato 4.3.0

### `docs/connector-api.openapi.yaml` (4.2.0 → 4.3.0, aditivo)

- `CustomerPayment.voidsPaymentId?: string`: solo en la anulación de una cobranza, el id de la
  cobranza que anula. La anulación es un documento propio: mismos medios con `amount` **negativo**,
  `total` negativo (la suma), mismo `customerId`, su propio `receipt` (consume número de recibo) y
  su propio `createdAt`. La original nunca se modifica.
- La descripción de `CustomerPayment` deja de decir "No se anula": el backend trata la anulación
  como cualquier cobranza (el saldo se mueve por `-total`, así que sube) y puede usar
  `voidsPaymentId` para auditoría o para marcar la original.
- `payments`: `method != account`; `amount > 0`, salvo con `voidsPaymentId`, donde todos son `< 0`.
- Entrada "**4.3.0 respecto de 4.2.0**" en la descripción del `info`, con la regla de
  compatibilidad: un POS 4.3.0 considera incompatible a un backend 4.2 (podría rechazar o
  malinterpretar una cobranza negativa).
- Sin endpoints nuevos ni tipos de evento nuevos: la anulación viaja como un evento
  `customer-payment` más.

### POS

`domain/contract-version.ts::POS_CONTRACT_VERSION = '4.3.0'`. El mensaje de la barra de estado
queda "se necesita 4.3 o posterior" (sale solo de `contractRequirement`).

## 2. Dominio

### `domain/customer-payment.ts`

```typescript
export type CustomerPayment = {
  id: string;
  customerId: string;
  payments: Payment[];
  total: number;
  createdAt: string;
  receipt?: DailyNumber;
  /** Solo en la anulación de una cobranza (4.3.0, #125): la cobranza que anula. */
  voidsPaymentId?: string;
};
```

- `buildVoidCustomerPayment(original, { id, now, isAlreadyVoided }): Result<CustomerPayment>`,
  espejo de `buildVoidSale`:
  - `original.voidsPaymentId !== undefined` → `customer-payment/cannot-void-a-void`.
  - `isAlreadyVoided` → `customer-payment/already-voided`.
  - Fuera de la ventana (`isWithinVoidWindow`, que ya es genérica sobre `createdAt`) →
    `customer-payment/void-window-expired` (`{ createdAt }`).
  - Si no: `{ id, customerId, payments: original.payments.map(negar), total: -original.total,
    createdAt: now, voidsPaymentId: original.id }`. Sin `receipt`: lo asigna storage dentro de la
    transacción, como con cualquier cobranza.
- `buildCustomerPayment` no cambia: una cobranza común sigue exigiendo montos > 0. La anulación es
  el único camino a una cobranza negativa.
- `isVoidedPayment(payment, voidedPaymentIds)`: anulada si hay una cobranza que la anula (sin
  estado legado, a diferencia de las ventas).

### Errores (`domain/result.ts::ErrorMeta` y `ui/errors.ts`)

| Código | Meta | Texto |
|---|---|---|
| `customer-payment/cannot-void-a-void` | `undefined` | "Esta cobranza ya es una anulación: no se puede anular." |
| `customer-payment/already-voided` | `undefined` | "Esa cobranza ya estaba anulada." |
| `customer-payment/void-window-expired` | `{ createdAt }` | "Solo se pueden anular cobranzas de las últimas 24 horas." |
| `customer-payment/not-found` | `{ paymentId }` | "No se encontró esa cobranza." |

Los textos son los de venta equivalentes (`sale/already-voided`, …) con "cobranza".

### Etiquetas (`ui/format-ticket.ts`)

`voidOfLabel` se generaliza para ticket o recibo (mismo formato): "Anulación del #1", "Anulación
del #1 del 27/09" si la original es de otra fecha de numeración, "Anulación de HH:MM" si la
original no tiene número, "Anulación" si la original ya no está en la base. Para un recibo, la
fecha de numeración es `receipt.date`.

## 3. Almacenamiento

### Dexie versión 9

`customerPayments: 'id, createdAt, customerId, voidsPaymentId'`. Solo agrega el índice: no hay
migración de datos (ninguna cobranza existente tiene `voidsPaymentId`).

### `storage/customer-payment-repository.ts::voidCollectionAndPersist(paymentId)`

Espejo de `voidSaleAndPersist`:

1. Lee la original (`customer-payment/not-found` si no está) y si ya tiene anulación
   (`where('voidsPaymentId').equals(paymentId).count() > 0`). Arma la anulación con
   `buildVoidCustomerPayment`.
2. En **una** transacción (`customerPayments`, `accountMovements`, `customerBalances`, `outbox`),
   lo mismo que `collectAndPersist`: número de recibo del día (`nextDailyNumber` con el contador de
   recibos), la anulación en `customerPayments`, su `AccountMovement` (`type: 'payment'`,
   `amount: -anulación.total`, es decir positivo, `paymentId`: el id de la anulación), el saldo del
   cliente con `applyBalanceDelta` (sube) y el evento `customer-payment` con el recibo ya numerado.
3. Después del commit, el contador de recibos en `localStorage` (`setReceiptCounter`).
4. Devuelve el mismo `CollectionRecord` (documento, saldo antes y después), que usa el aviso de la
   barra.

Para no duplicar, los pasos de la transacción salen de `collectAndPersist` a un helper interno
(`persistCollectionDocument(built, { now, origin })`) que usan las dos funciones, igual que
`sale-repository.ts::persistSaleDocument` sirve a la venta y a su anulación.

### Candidatos de `/ANULAR` (`storage/void-repository.ts`, nuevo)

`listVoidCandidates(now)` sale de `sale-repository.ts` a un módulo propio, porque ya no es solo de
ventas:

```typescript
export type VoidCandidate =
  | { kind: 'sale'; sale: Sale; state: VoidState; original?: Sale }
  | { kind: 'collection'; payment: CustomerPayment; state: VoidState; original?: CustomerPayment };
type VoidState = 'voidable' | 'voided' | 'void-document';
```

- Todas las ventas y cobranzas con `createdAt` dentro de las últimas 24 h (`VOID_WINDOW_MS`), sin
  tope (sale `VOID_CANDIDATES_LIMIT`), ordenadas de lo más nuevo a lo más viejo por `createdAt`.
- `state`: `void-document` si anula a otro (`voidsSaleId` / `voidsPaymentId`), con su `original` si
  sigue en la base; `voided` si tiene una anulación (`isVoided` / `isVoidedPayment`); si no,
  `voidable`.
- Una original que quedó fuera de la ventana no aparece, pero su anulación sí (con su `original`
  cargada aparte para la etiqueta, igual que `loadVoidOriginals` hoy).

### Nada nuevo en sync, limpieza ni saldo de efectivo

La anulación es una fila más de `customerPayments` con su evento: el push, la reaplicación
(`-total`), la limpieza a 7 días (misma regla que cualquier cobranza) y `calculateCashBalance` (los
pagos `cash` con signo) ya la cubren. Los tests de cada uno suman un caso con una cobranza negativa
para dejarlo fijado.

## 4. UI

### Filas compartidas (`ui/components/document-rows.tsx`, nuevo)

Salen de `cash-summary-screen.tsx`, sin cambiar cómo se ven en `/RESUMEN`: `SaleEntryRow`,
`CollectionEntryRow`, `lineLabel`, la marca de anulada o anulación, y el buscador (`filterEntries`
y el texto de búsqueda de ventas y cobranzas). Las filas reciben lo que necesitan como props
(marca ya resuelta, nombre del cliente, `dimmed`), para que no dependan del `DayView` de
`/RESUMEN`. Movimientos de caja y arqueos quedan en `/RESUMEN`: no se anulan.

`CollectionEntryRow` suma la marca, igual que los tickets: "Recibo #1 · Carlos Pérez · Anulada" y
"Recibo #2 · Carlos Pérez · Anulación del #1", con los montos en negativo.

### `/ANULAR` (`ui/screens/void-screen.tsx`, reemplaza a `void-sale-screen.tsx`)

- **Layout de Movimientos de `/RESUMEN`**: franja oscura arriba con el título "Anular", el buscador
  y "Volver a la venta (Esc)", y abajo la lista con las filas compartidas. No hay pestañas, panel
  lateral ni navegación por día.
- **Qué lista**: los `VoidCandidate` de §3. Las filas `voided` y `void-document` se ven atenuadas y
  con su marca; ↑/↓ y el click las saltean.
- **Foco y teclas**: el buscador es el único input y está siempre enfocado (patrón de `/RESUMEN`).
  Tipear filtra; la selección pasa a la primera fila anulable del resultado. ↑/↓ mueven la
  selección entre las anulables, sin ciclar, con el hook de lista de `/RESUMEN`
  (`useTicketListNavigation`), que ya hace el scroll de una fila de varias líneas. Enter abre la confirmación sobre la seleccionada. Esc limpia el
  buscador si tiene texto; si no, sale a la venta. Un click en una fila anulable = seleccionarla +
  Enter (`activateVoidRow`).
- **Mensajes**: sin nada anulable en las 24 h, "No hay ventas ni cobranzas de las últimas 24 horas
  para anular."; con filtro sin coincidencias, "Ningún documento coincide con la búsqueda.".
- **Selección inicial**: la anulable más nueva.

### Modal de confirmación

- Tarjeta chica centrada sobre un overlay semitransparente, encima de la lista (que sigue a la
  vista detrás). El foco pasa al contenedor del modal; al cerrarlo, vuelve al buscador.
- Texto: "¿Anular el Ticket #1?" o "¿Anular el Recibo #1 de Carlos Pérez?", el total con signo, y
  en una cobranza el efecto sobre el saldo: "Saldo de Carlos Pérez: A favor $500,00 → Sin saldo"
  (`ui/format-balance.ts`, desde `customerBalancesSignal`; sin saldo conocido, se omite la línea).
  Un documento sin número (anterior a la numeración) se nombra por su hora: "¿Anular el ticket de
  las 17:20?".
- Botones "Volver (Esc)" (`.btn`) y "Anular (Enter)" (`.btn-danger`). Enter anula, Esc vuelve a la
  lista con la misma selección y el mismo filtro. Un error de negocio se muestra dentro del modal,
  con `describeError`.

### Después de anular

Vuelve a la venta con un aviso en el slot de la barra (`commandBarNoticeSignal`, como `/CAJA`):
"Anulado el Ticket #1 con el Ticket #3" o "Anulado el Recibo #1 con el Recibo #2" (con documentos
sin número, "Anulado el ticket de las 17:20"). Recarga el stock y los saldos
(`refreshStockSnapshot`, `refreshCustomerBalances`), como hoy.

### Controller y estado

`ui/keyboard/void-controller.ts` y `ui/state/void-sale.ts` se adaptan a la unión `VoidCandidate` (se
renombran a `void-*` sin "sale" si el cambio es mecánico): candidatos, filtro, índice seleccionado
(sobre la lista filtrada), modal abierto y error. `confirmVoid` llama a `voidSaleAndPersist` o
`voidCollectionAndPersist` según `kind`.

### `/RESUMEN`

- Usa las filas compartidas (misma apariencia que hoy) y marca las cobranzas anuladas y las
  anulaciones.
- `DayView` suma los ids de cobranzas anuladas y las originales de las anulaciones del día (igual
  que `voidedSaleIds` / `voidOriginals`).
- `domain/day-summary.ts`: `collections.voidedCount` (originales anuladas). El panel dice
  "Cobranzas $X (N recibos, M anulados)" (sin anuladas, como hoy: "(N recibos)"); N cuenta todos
  los recibos, anulaciones incluidas, igual que los tickets. El total, Medios de pago y el efectivo
  del día ya son netos por el signo.

## 5. Demo-backend (`demo-backend/`)

- `settings.ts::CONTRACT_VERSION = '4.3.0'`.
- `lots.ts`: sin cambios de lógica — el `customer-payment` ya guarda el payload entero (con
  `voidsPaymentId`) y mueve el saldo por `-total`. Un test fija que una anulación devuelve el saldo
  del cliente al valor anterior a la cobranza.
- **Panel `/_demo`** (`routes/panel.ts`, `panel.html`):
  - **Cobranzas**: el cliente por nombre (no el id), y columnas "anula a" (el recibo que anula,
    "#1 · 28/09", o el id si la original no está) y "anulada por" (en la original, el recibo que la
    anula).
  - **Ventas**: "anula a" con el número de ticket ("#1 · 28/09", o el id si la original no está) en
    lugar del ULID, y una columna "anulada por".
  - Se resuelve en el listado del backend, cruzando `voidsPaymentId` / `voidsSaleId` dentro de la
    misma tabla. **Saldos de clientes** no cambia: es donde se ve que la anulación revirtió el saldo.
  - Test en `test/routes/panel.test.ts`.

## 6. Google Sheets y mini-erp

- **Sheets**: congelado en 4.2.0 (#127). Con un POS 4.3.0 la terminal lo ve incompatible, no
  sincroniza y sigue vendiendo. Solo se hace el mínimo mecánico para que sus tests existentes sigan
  en verde si alguno falla por la versión; no se agregan tests ni se tocan los `.gs`. En #127 se
  anota que el camino para retomarlo es #138 (conector en el POS, API del puente especificada).
- **Mini-erp**: no se toca ni se abre issue (desarrollo separado). Queda incompatible con el POS
  4.3.0 hasta que se adapte.

## 7. Documentación

- `AGENTS.md` (raíz): contrato 4.3.0 en "Connector API" y en la tabla de estado; la cobranza deja
  de estar "fuera de alcance" para anular; `/ANULAR` en la tabla de comandos ("Anula un ticket o
  una cobranza de las últimas 24 h"); issues abiertas.
- `src/sync/AGENTS.md`: "Contrato 4.3.0 (#125)" en "qué trajo cada versión".
- `src/domain/AGENTS.md`: la anulación de una cobranza junto a la de venta.
- `src/storage/AGENTS.md`: Dexie v9 y `voidCollectionAndPersist`.
- `src/ui/AGENTS.md`: `/ANULAR` (layout, buscador, modal, aviso) y la fila de cobranza anulada en
  `/RESUMEN`; filas compartidas en "Patrones de UI".
- `demo-backend` README si documenta las columnas del panel.

## 8. Pruebas

- **Dominio**: `buildVoidCustomerPayment` (pagos y total invertidos, `voidsPaymentId`, los tres
  errores); `calculateCashBalance`, `reapplyEffects` y `calculateDaySummary` con una cobranza
  negativa; `voidOfLabel` con recibos.
- **Storage**: `voidCollectionAndPersist` (recibo siguiente, movimiento de cuenta positivo, saldo
  que vuelve, evento en el outbox con recibo, no anula dos veces, no anula una anulación);
  `listVoidCandidates` (mezcla, orden, 24 h sin tope, estados, original fuera de la ventana); Dexie
  v9 (índice).
- **UI**: controller de `/ANULAR` (filtro, selección que saltea, Enter/Esc en lista y modal,
  confirmación por `kind`, aviso); pantalla (filas, marcas, modal, mensajes); `/RESUMEN` sigue
  igual con las filas extraídas y marca las cobranzas anuladas; panel "(N recibos, M anulados)".
- **E2E**: `void-sale.spec.ts` suma anular una cobranza (el saldo de la tarjeta de Cliente vuelve,
  la lista marca las dos filas, `/RESUMEN` la muestra) y el buscador; `keyboard-only.spec.ts` si
  cambian las teclas de `/ANULAR`; `mouse.spec.ts` para el modal.
- **Demo-backend**: sync (anulación revierte el saldo), panel (columnas nuevas), versión 4.3.0.

## Fuera de alcance

- El comprobante de la anulación (#137).
- Conector de Sheets en el POS y API del puente (#138); adaptar el mini-erp.
- Anular movimientos de caja o arqueos (se compensan con otro movimiento, como hasta ahora).
- Motivo de anulación (`voidReason`): las ventas lo admiten en el dominio pero la UI no lo pide; la
  cobranza no lo suma.

## Desvíos de la implementación

- **Filas sin acción navegables** (§4, decidido en la prueba manual): ↑/↓ y el click recorren también
  la original anulada y la anulación, como en `/RESUMEN`, con `useTicketListNavigation` (el plan
  había cambiado a selección por índice para poder saltearlas; con este cambio ya no hace falta). La
  selección arranca en la fila más nueva. Enter o click sobre una fila sin acción no abre el modal:
  un mensaje debajo del buscador dice que ya está anulada (y con qué documento) o que es una
  anulación.
- **Foco con el modal abierto** (§4, "Modal de confirmación"): el foco se queda en el buscador en vez
  de pasar al contenedor del modal, y mientras el modal está abierto el buscador no recibe texto
  (Enter anula, Esc vuelve, Tab llega a los botones). Mantiene "un único input siempre enfocado".
- **Filas compartidas** (§4): `/RESUMEN` conserva `SaleEntryRow` y `CollectionEntryRow` como
  envoltorios finos de las filas de `ui/components/document-rows.tsx`, para leer `nav.ticketRef(index)`
  en el nivel superior del render (`react-hooks/refs`).
- **Limpieza a 7 días** (§3): no suma test — no depende del signo, borra por edad y por evento.
- **Tests fuera de la lista del plan**: subir a 4.3.0 obligó a actualizar más expectativas de versión
  de las previstas (sync, config, conectores y los mocks de backend de tres e2e), y `e2e/cash.spec.ts`
  también se adaptó a la pantalla nueva. El caso de la venta con `status: 'voided'` legado pasó al test
  de `void-repository.ts`.
