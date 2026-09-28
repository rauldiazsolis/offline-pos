# Cobranza sin venta y saldo del cliente

Fecha: 2026-09-27
Estado: implementado (plan `docs/superpowers/plans/2026-09-27-cobranza-y-saldo-del-cliente.md`;
desvíos al final).
Issues: #101 (Etapa 6 del epic #94; cierra #51 y #59, ya cerrados como duplicados). Depende de las
Etapas 1 a 5 (#96–#100, #120). Siguiente paso previsto, fuera de esta etapa: #125 (anular
cobranzas con el mismo criterio que las ventas, desde `/ANULAR`).

## Contexto

La Etapa 6 le da UI a la cobranza sin venta (un cliente paga a cuenta sin comprar nada) y lleva en
el POS el saldo de cada cliente, tenga o no cuenta corriente, siempre informativo.

Lo que el código hace hoy y hay que cambiar:

1. `domain/customer-payment.ts` (`CustomerPayment`, `buildCustomerPayment`) y el evento
   `customer-payment` existen desde el contrato v3 en el outbox, los conectores, el minibackend y el
   mini-erp, pero **sin UI y sin tabla local**. Enter con la barra vacía, sin líneas y con cliente
   muestra "Cobranza sin venta: llega en una próxima versión."
   (`command-bar-controller.ts::submitEmptyCommandBar`).
2. El saldo vive **solo** en `CustomerAccount.balance`, y una cuenta existe solo si el backend manda
   `creditLimit` + `margin` + `balance` (o `unrestricted: true`). Un cliente sin crédito no tiene
   saldo en el POS: una devolución a "Cuenta corriente" de ese cliente (acreditación sin hold, #99)
   hoy no deja rastro de saldo.
3. El minibackend ignora el saldo de un cliente sin cuenta (`adjustBalance` sale sin hacer nada si
   `balance` es `undefined`); el puente de Sheets no manda saldo de nadie, aunque el libro
   `CuentaCorriente` ya tiene cada movimiento; el mini-erp ya lleva y manda saldo para todos (el POS
   lo descarta sin los campos de crédito).
4. El saldo de efectivo (`domain/cash-count.ts::calculateCashBalance`) y `/RESUMEN`
   (`domain/day-summary.ts`) no suman cobranzas.
5. La limpieza a 7 días (`domain/local-cleanup.ts`) conserva los `accountMovement` sin venta "hasta
   que la Etapa 6 defina su regla".

Principio que aplica (epic #94): el POS registra y pushea; el backend informa. El saldo es
informativo: nunca bloquea una venta ni una cobranza.

## 1. Flujo y pantallas

### Cómo se entra

Con la barra vacía, **sin líneas y con cliente adjunto**, Enter abre Cobro en modo **cobranza**.
`/COBRAR` y Ctrl+Enter en ese mismo estado hacen lo mismo (`/COBRAR` ya está habilitado con cliente
y sin artículos, #97): los tres caminos coinciden. Sale el aviso "llega en una próxima versión". Con
líneas, todo sigue igual (cobro de la venta).

### Cobro en modo cobranza

Un tercer modo de la misma pantalla y el mismo controller (`ui/screens/checkout-screen.tsx`,
`ui/keyboard/checkout-controller.ts`), junto a `charge` y `refund`:

- Título "Cobranza a Juan Pérez". Cliente bloqueado: advertencia en ámbar, sin bloquear.
- **Cinco medios, sin Cuenta corriente** (no tiene sentido pagar cuenta corriente con cuenta
  corriente). Todos vacíos, sin precarga. Solo importes positivos.
- **Sin vuelto**: lo tipeado es lo acreditado. El total de la cobranza es la suma de los medios;
  tiene que ser mayor que 0 para confirmar ("Ingresá al menos un monto"). No hay tope: pagar más de
  lo que se debe deja saldo a favor.
- Bloque de saldo en vivo: "Saldo actual: debe $1.500 → después: debe $500" (o "a favor $200"). Sin
  saldo conocido, el actual es "sin saldo".
- Teclado y mouse como Cobro: Enter y ↓ avanzan, ↑ retrocede (sin ciclar), Ctrl+Enter confirma, Esc
  cancela y vuelve a la venta; botones "Cancelar (Esc)" y "Confirmar cobranza (Ctrl+Enter)"; click
  en un campo lo enfoca.

### Comprobante

La misma pantalla de comprobante (`ui/screens/receipt-screen.tsx`) con otro contenido: "Recibo #3",
fecha y hora, cliente, pagos por medio, total y "Saldo anterior → Saldo nuevo"; imprimible. El
comprobante recibe una unión (`{ kind: 'sale' } | { kind: 'collection' }`) en vez de solo una venta.
Al cerrarlo vuelve a la venta con el cliente **desadjuntado** ("Consumidor Final"), igual que
después de cobrar una venta.

### Saldo en la venta

- **Tarjeta de Cliente** (`CartView.tsx::CustomerCard`): una quinta fila fija, "Saldo", con "Debe
  $X", "A favor $X" o "Sin saldo". Con "Consumidor Final" queda vacía: ninguna posición se mueve
  (mismo criterio que documento y teléfono, Ciclo 7). El alto fijo de la tarjeta crece una fila.
- **Cobro de una venta**: cuando Cuenta corriente tiene monto (o en una devolución a cuenta
  corriente), se muestra "Saldo: debe $X → debe $Y" con el efecto de ese pago.
- `attachedCustomerBalanceSignal` (`ui/state/customer.ts`) se lee al adjuntar el cliente y se
  refresca después de un pull, de una venta y de una cobranza.
- La lista de `@` **no** muestra saldo, a propósito: agrega ruido a la búsqueda.

## 2. Dominio

### Entidades

```typescript
// domain/customer-payment.ts
export type CustomerPayment = {
  id: string; // ULID
  customerId: string;
  payments: Payment[];
  total: number;
  createdAt: string;
  /** Número de recibo del día local (#101). Una cobranza anterior no tiene y nunca se le inventa. */
  receipt?: DailyNumber;
};

// domain/customer-balance.ts
export type CustomerBalance = {
  customerId: string;
  /** Positivo: debe. Negativo: a favor. */
  balance: number;
  updatedAt: string;
};

// domain/customer.ts
export type CustomerAccount = {
  customerId: string;
  creditLimit: number;
  margin: number;
  updatedAt: string;
  unrestricted?: boolean;
}; // sin `balance`: el saldo es un dato aparte

export type AccountMovement = {
  // …igual que hoy, más:
  paymentId?: string; // la cobranza que lo generó (type: 'payment')
};
```

`Customer` es identificación, `CustomerAccount` son las condiciones de crédito y `CustomerBalance`
es el saldo: un saldo a favor nunca se puede confundir con crédito. Se descartaron una cuenta "solo
saldo" (`CustomerAccount` con crédito opcional: cambia el significado de "tiene cuenta" en todos los
lugares que hoy leen `account === undefined` como "sin crédito", `canChargeOffline` incluido) y un
`balance` dentro de `Customer` (el `bulkPut` del pull pisaría el saldo local de los clientes que
vienen sin saldo, y mezcla identificación con plata).

### Funciones puras

- `domain/customer-payment.ts::resolveCollection(tendered)`: de lo tipeado por medio (sin
  `account`) a `Payment[]` positivos, en el orden de los medios; suma 0 →
  `customer-payment/invalid` (`reason: 'empty'`). Vive acá y no en `tender.ts` porque su regla es
  otra: sin vuelto, sin tope, suma mayor que 0. `buildCustomerPayment` sigue con sus reglas (sin
  `account`, montos positivos) y suma `receipt`.
- `domain/ticket-number.ts` se generaliza: `DailyNumber = { date, number }` (`TicketNumber` queda
  como alias), `lastDailyNumberOn(numbers, date)` y `nextDailyNumber` (hoy `nextTicketNumber`, misma
  regla). Tickets y recibos comparten la regla y tienen contadores independientes.
- `domain/customer-balance.ts`: `describeBalance(balance | undefined)` → `{ kind: 'owes' |
  'in-favor' | 'none', amount }` (0 y desconocido son `none`) y `applyBalanceDelta`.
- `availableCredit(account, balance)` y `canChargeOffline(account, balance, amount)`: la misma regla
  de hoy con el saldo pasado aparte; sin saldo conocido cuenta como 0. Sin `CustomerAccount` se
  sigue rechazando el fiado offline como siempre: un saldo a favor **no** habilita fiado.
- `splitConnectorCustomer` devuelve `{ customer, account?, balance? }`: un `balance` solo arma el
  saldo; la cuenta sigue exigiendo los tres campos de crédito o `unrestricted`. `creditLimit` y
  `margin` sin `balance` (hoy "no hay cuenta") siguen sin cuenta.
- `reapplyEffects` no cambia: ya cuenta `customer-payment` (resta su total) y los pagos `account` de
  las ventas.

## 3. Almacenamiento

### Dexie versión 8

- Tablas nuevas: `customerBalances` (clave `customerId`) y `customerPayments` (`id`, índices
  `createdAt` y `customerId`).
- La migración copia `customerAccounts.balance` a `customerBalances` y lo saca de cada cuenta.

### Cobranza (`storage/customer-payment-repository.ts::collectAndPersist`)

En **una** transacción: número de recibo (`max(contador de la misma fecha, último local de esa
fecha) + 1`, leyendo las cobranzas de ±1 día como las ventas), la cobranza, su `AccountMovement`
(`type: 'payment'`, monto `-total`, `paymentId`), el saldo (crea la fila en 0 si no existía) y el
evento `customer-payment` (armado adentro, así viaja con el número). El contador
`offline-pos:receipt-counter` (`sync/receipt-counter.ts`, mismo criterio best-effort que
`sync/ticket-counter.ts`) se escribe después del commit. Error: `customer-payment/persist-failed`.

### Ventas

`sale-repository.ts::applyAccountMovements` actualiza `customerBalances` en vez de
`customerAccounts.balance` y crea la fila si no existe: una devolución a cuenta de un cliente sin
cuenta deja saldo a favor (hoy no deja nada). El hold y `canChargeOffline` leen el saldo de
`customerBalances`.

### Pull

`adjustPull` y `applyPull` trabajan sobre `customerBalances` con la regla de la Etapa 3: cliente que
vino con `balance` → backend + efectos a reaplicar; cliente que vino sin `balance` → se conserva el
local; con retención → los locales. Delta: `bulkPut` de los saldos que vinieron. Foto completa
(`storage/reconcile.ts::applySnapshotReconciled`): se borra el saldo de los clientes que ya no
existen, se conserva el de los que vinieron sin saldo. Las cuentas se reconcilian como hoy, sin
saldo.

## 4. Contrato 4.2.0 y backends

### Contrato (`docs/connector-api.openapi.yaml`, 4.1.0 → 4.2.0, aditivo)

- `CustomerPayment.receipt?: { date, number }`: número de recibo en el día local de la terminal,
  misma forma que `Sale.ticket`.
- `ConnectorCustomer.balance` es **el saldo del cliente, tenga o no crédito** (positivo debe,
  negativo a favor). Un `balance` sin `creditLimit`/`margin` es válido: saldo sin cuenta corriente.
  Un backend que no lleva saldo lo omite y el POS conserva el local. El backend mueve el saldo de
  cualquier cliente con cobranzas, ventas a cuenta y acreditaciones.
- Se elimina `GET /account-balance/{customerId}` (`documented-not-implemented`): el saldo viaja en el
  pull y no hay código fuera de este repo que lo use, así que se considera compatible.
- Compatibilidad: un POS 4.2.0 ve incompatible a un backend 4.1 ("se necesita 4.2 o posterior",
  `domain/contract-version.ts`).
- `sync/connector.ts` no cambia de forma (`balance` ya es opcional); cambia su interpretación
  (§2).

### Minibackend (`demo-backend/`)

- Contrato 4.2.0.
- `adjustBalance` arranca en 0 si el cliente no tenía saldo, en vez de ignorar el movimiento: desde
  ahí el cliente viaja con `balance`.
- El panel `/_demo` muestra el número de recibo en la lista de cobranzas y el saldo de todos los
  clientes. Sin columnas nuevas (el payload ya se guarda entero como JSON).

### Puente de Sheets (hay que redesplegar `bridge.gs` y `columnas.gs`)

- `Cobranzas` suma dos columnas opcionales, "Fecha del recibo" y "N° de recibo" (`ensureColumns`
  las agrega solas).
- `pullCustomers` suma `balance` por cliente desde el libro `CuentaCorriente` (una lectura por pull,
  0 sin movimientos). Entra en la fila, así que cambia el fingerprint de `_Snapshot` y viaja en el
  delta.
- Versión de contrato 4.2.0.

### Mini-erp (`mini-erp/`)

Excepción puntual a su `AGENTS.md`, la misma que en la Etapa 5: se modifica y commitea desde el
branch de la etapa. Contrato 4.2.0; el Zod de `customer-payment` acepta `receipt` y lo guarda. Ya
lleva y manda saldo para todos los clientes: solo tests.

## 5. Caja, `/RESUMEN`, limpieza y diagnóstico

### Saldo de efectivo

`calculateCashBalance({ lastCount, sales, movements, collections })` suma los pagos `cash` de las
cobranzas posteriores al último arqueo (mismo "posterior estricto"). El esperado del arqueo
(`recordCashCount`, recalculado en su transacción), `/CAJA` y el aviso de egreso mayor que el saldo
lo incluyen.

### `/RESUMEN`

- `getDaySummary` lee también las cobranzas del día (por `receipt.date` si lo tienen, si no por hora
  local) y los nombres de sus clientes (tabla `customers`). El día más viejo navegable considera las
  cobranzas.
- `DaySummary` suma `collections: { total, count }`, `cash.collections` y `collectionsByMethod`;
  `totalsByMethod` queda solo para ventas. Total vendido y tickets no cambian: una cobranza no es
  una venta.
- Panel lateral: "Cobranzas: $X (N recibos)" y, en el efectivo del día, la fila "cobranzas".
- Movimientos: `DayEntry` suma `{ kind: 'collection' }`, "Recibo #3 · Juan Pérez · $X" con los medios
  en el detalle; el buscador encuentra "3", "#3" y el nombre del cliente.
- Medios de pago: columnas Ventas | Cobranzas | Total por medio.

### Limpieza a 7 días

- `customerPayments`: misma regla que las ventas. Se borra por su propia edad y su propio evento
  (nunca pendiente); sin ningún arqueo no se borra (base del saldo de efectivo); con ancla se
  conserva todo desde el último arqueo.
- `accountMovements`: regla unificada. Se borra por edad, si el evento que lo lleva (`saleId` o
  `paymentId`) no está pendiente y respetando el ancla. Sale la excepción "sin venta se conserva". Un
  movimiento sin ninguno de los dos no existe hoy; si apareciera, se borra por edad.
- `customerBalances` nunca se borra (es estado, como las cuentas).
- `CleanupCounts` y `offline-pos:cleanup:last-run` suman `customerPayments`; un registro anterior sin
  ese campo se lee con 0 en vez de invalidarse.

### Diagnóstico, consola y wizard

`/DIAGNOSTICO` muestra las cobranzas borradas en la última limpieza. `storage/local-data.ts::hasUserData`
cuenta las cobranzas (datos del usuario para el paso "Datos locales" de `/CONFIG`). `clearAllTables`
(`db.tables`) y `pos.reset()` (prefijo `offline-pos:*`) incluyen solos las tablas nuevas y el contador
de recibos.

### Errores

`customer-payment/persist-failed` nuevo; `customer-payment/invalid` con mensaje por motivo en
`ui/errors.ts` (vacío → "Ingresá al menos un monto").

## 6. Pruebas

- **Dominio**: `resolveCollection`; `nextDailyNumber`/`lastDailyNumberOn` con tickets y recibos
  independientes; `describeBalance`; `availableCredit`/`canChargeOffline` con el saldo aparte (los
  casos de hoy más "saldo a favor sin cuenta no habilita fiado"); `splitConnectorCustomer` con
  `balance` solo; `calculateCashBalance` con cobranzas; `calculateDaySummary`/`buildDayEntries` con
  cobranzas; `planLocalCleanup` con la regla unificada; `adjustPull` sobre saldos.
- **Storage** (fake-indexeddb): migración a la versión 8; `collectAndPersist` atómico y numeración
  por día; `applyAccountMovements` crea saldo sin cuenta; `applyPull` y foto completa con saldos;
  limpieza real; `getDaySummary` con cobranzas.
- **UI**: Enter, `/COBRAR` y Ctrl+Enter abren la cobranza; pantalla sin Cuenta corriente con el
  saldo en vivo; error sin monto; comprobante de la cobranza; fila Saldo de la tarjeta de Cliente;
  saldo en Cobro con cuenta corriente; `/RESUMEN` (panel, Movimientos, Medios de pago); `/CAJA` con el
  esperado actualizado.
- **Backends**: el minibackend mueve el saldo de un cliente sin cuenta y guarda el recibo; el puente
  de Sheets calcula el saldo desde `CuentaCorriente` y escribe las columnas nuevas (planilla falsa);
  el mini-erp acepta `receipt` y habla 4.2.0.
- **e2e**: cobranza offline de punta a punta (adjuntar cliente → Enter → efectivo + transferencia →
  "Recibo #1" con el saldo → la tarjeta muestra el saldo nuevo → `/CAJA` con el esperado → `/RESUMEN`
  la lista → el evento en el outbox), y la auditoría de teclado en `keyboard-only.spec.ts`.
- **Prueba manual**: la app con el minibackend y pasos para el navegador.

## Fuera de alcance

- Anular o corregir una cobranza desde el POS: #125 (con el mismo criterio que las ventas, desde
  `/ANULAR`). Hasta entonces, una cobranza equivocada se corrige del lado del backend (en el mini-erp,
  con su ajuste de saldo).
- Saldo en la lista de `@`.
- Margen de cuenta corriente sin hold (#104), usabilidad de `/CAJA` (#57) y de `/ANULAR` (#58, #110).

## Desvíos de la implementación

Aprobados con el plan:

1. **Pantalla de cobranza propia** en vez de un tercer modo de Cobro (§1): `checkout-screen.tsx` ya
   ramificaba por `charge`/`refund` en casi todo lo que la cobranza no comparte. Los campos de medio
   de pago son un componente compartido (`ui/components/PaymentFields.tsx`) y los estilos del diálogo
   viven en `ui/screens/dialog-styles.ts`; para el usuario es el mismo diálogo.
2. **Comprobante con un signal propio** (`receiptCollectionSignal`) en vez de una unión (§1); la
   pantalla comparte el marco (`ReceiptFrame`) y muestra el que esté puesto.
3. **Saldos en memoria como el stock** (`customerBalancesSignal`, la tabla entera) en vez de
   `attachedCustomerBalanceSignal` (§1): cubre sin código extra el cliente restaurado con la venta en
   curso y el que cambia de saldo por un pull con el cliente adjunto.
4. **Mini-erp sin Zod para `customer-payment`** (§4): la cobranza se guarda entera en el payload, así
   que `receipt` ya llega; la validación queda en #122.

Al ejecutarlo:

5. Los importes del saldo usan el formato de `/CAJA` (`Debe $1.500,00`), no `$ 1.500,00`.
6. El minibackend **acepta** un POS 4.1 (mismo major; el backend es el del minor mayor, que es lo que
   pide la regla de compatibilidad) — el plan pedía un 409, que la contradecía.
7. El panel `/_demo` suma una tabla "Saldos de clientes" (`GET /_demo/api/customer-balances`) en vez
   de cambiar la lista de clientes creados desde el POS.
