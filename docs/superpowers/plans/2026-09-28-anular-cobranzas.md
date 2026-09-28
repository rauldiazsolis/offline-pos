# Anular cobranzas desde `/ANULAR` — plan de implementación

> **Para agentes:** SUB-SKILL REQUERIDO: `superpowers:executing-plans` (inline, tarea por tarea con
> checkpoints — convención del repo, ver `AGENTS.md` "Cómo trabajamos"). Los pasos usan checkboxes
> (`- [ ]`).

**Objetivo:** anular una cobranza con el mismo criterio que una venta (una cobranza negativa con
`voidsPaymentId` y su propio recibo), y rehacer `/ANULAR` como la pestaña Movimientos de `/RESUMEN`
(ventas y cobranzas de 24 h, buscador, modal de confirmación, aviso en la barra).

**Arquitectura:** contrato 4.3.0 aditivo (`CustomerPayment.voidsPaymentId`). Dominio espejo de
`buildVoidSale`; storage espejo de `voidSaleAndPersist` compartiendo la transacción con
`collectAndPersist`; `/ANULAR` y `/RESUMEN` comparten las filas (`ui/components/document-rows.tsx`)
y el buscador (`ui/document-search.ts`). Lo que ya suma con signo (saldo de efectivo, reaplicación,
limpieza, demo-backend) no cambia: se fija con tests.

**Stack:** Preact + `@preact/signals`, Dexie, FlexSearch, Vitest + Testing Library, Playwright;
demo-backend Node + `node:sqlite`.

**Spec:** `docs/superpowers/specs/2026-09-28-anular-cobranzas-design.md`.

## Restricciones globales

- Todo en español: código nuevo con nombres en inglés como el resto, comentarios, commits y textos de UI en español.
- `any` prohibido; funciones de negocio devuelven `Result<T>`; `try/catch` solo en storage.
- Un solo input enfocado por pantalla; foco con `useFocusOnMount`/`useLayoutEffect`, nunca `autoFocus`.
- Teclado + mouse: todo botón muestra su atajo; `keepFocusOnMouseDown` en el contenedor; el hover no mueve la selección.
- Nunca se muestra un ULID en la UI.
- Contrato `4.3.0`; `POS_CONTRACT_VERSION = '4.3.0'`; demo-backend `CONTRACT_VERSION = '4.3.0'`.
- No tocar `mini-erp/` ni los `.gs` de Sheets; en Sheets solo el mínimo mecánico para que los tests existentes pasen; no se agregan tests del puente.
- Verificación local antes de cada commit: `pnpm lint && pnpm typecheck && pnpm test` (y `pnpm build` al cerrar tareas de UI); demo-backend: `pnpm --dir demo-backend test && pnpm --dir demo-backend typecheck`; `pnpm test:e2e` en la Tarea 8.
- Commits chicos, en español, terminando con `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Decisión del plan que ajusta la spec

La spec (§4) dice que `/ANULAR` usa `useTicketListNavigation`. Ese hook elige la fila por
geometría del scroll y no puede saltear filas no seleccionables. `/ANULAR` usa selección por índice
que saltea (la lógica actual de `moveVoidSelection`) más `useScrollSelectedIntoView`. La Tarea 10
corrige esa línea de la spec y lo anota como desvío.

## Mapa de archivos

| Archivo | Responsabilidad |
|---|---|
| `docs/connector-api.openapi.yaml` | 4.3.0: `voidsPaymentId`, montos negativos |
| `src/domain/contract-version.ts` | `POS_CONTRACT_VERSION` |
| `src/domain/customer-payment.ts` | `voidsPaymentId`, `buildVoidCustomerPayment`, `isVoidedPayment` |
| `src/domain/result.ts`, `src/ui/errors.ts` | 4 códigos de error nuevos |
| `src/storage/db.ts` | Dexie v9: índice `voidsPaymentId` |
| `src/storage/customer-payment-repository.ts` | `persistCollectionDocument`, `voidCollectionAndPersist`, `loadVoidedPaymentIds`, `loadPaymentVoidOriginals` |
| `src/storage/void-repository.ts` (nuevo) | `VoidCandidate`, `listVoidCandidates` (sale de `sale-repository.ts`) |
| `src/ui/format-ticket.ts` | etiquetas de anulación de recibo, nombres de documento |
| `src/domain/day-summary.ts`, `src/storage/cash-summary-repository.ts` | cobranzas anuladas en `/RESUMEN` |
| `src/ui/document-search.ts` (nuevo) | texto de búsqueda y filtro FlexSearch compartidos |
| `src/ui/components/document-rows.tsx` (nuevo) | `SaleDocumentRow`, `CollectionDocumentRow`, `lineLabel` |
| `src/ui/screens/cash-summary-screen.tsx` | usa las filas compartidas; marca de cobranzas |
| `src/ui/state/void.ts` (reemplaza `void-sale.ts`) | signals de `/ANULAR` |
| `src/ui/keyboard/void-controller.ts` | lógica de `/ANULAR` |
| `src/ui/screens/void-screen.tsx` (reemplaza `void-sale-screen.tsx`) | pantalla y modal |
| `e2e/void-sale.spec.ts`, `keyboard-only.spec.ts`, `sale-stage-4.spec.ts` | textos nuevos y anulación de cobranza |
| `demo-backend/src/settings.ts`, `routes/panel.ts`, `panel.html` | 4.3.0 y columnas del panel |
| `AGENTS.md` y los de `src/*` | documentación |

---

### Tarea 1: Contrato 4.3.0

**Archivos:**
- Modificar: `docs/connector-api.openapi.yaml` (encabezado y schema `CustomerPayment`, ~líneas 1-20 y 520-545)
- Modificar: `src/domain/contract-version.ts:1-6`
- Modificar: `src/domain/contract-version.test.ts` (si fija `'4.2.0'` o "4.2 o posterior")
- Modificar (mecánico): `src/connectors/google-sheets/bridge-client.test.ts:51,67,190`, `src/connectors/google-sheets/google-sheets-connector.test.ts:108`

**Interfaces:** Produce: `POS_CONTRACT_VERSION === '4.3.0'`.

- [ ] **Paso 1: tests que fijan la versión.** Buscar las apariciones de la versión del POS en tests:

Run: `rg -n "'4\.2\.0'|4\.2 o posterior" src --glob '*.test.ts*'`

Cambiar a `'4.3.0'` / `'4.3 o posterior'` **solo** donde el valor es el que manda o exige el POS (lo
que sale de `POS_CONTRACT_VERSION`). No cambiar las que representan la versión que responde el
puente (`bridge.test.ts:943-969`, `version: '4.2.0'` del puente) ni fixtures de un backend 4.2.

- [ ] **Paso 2: correr y ver fallar.** Run: `pnpm test -- contract-version google-sheets` → FAIL (el POS todavía dice 4.2.0).

- [ ] **Paso 3: subir la versión.** En `src/domain/contract-version.ts` agregar al comentario de la línea 3 "4.3.0 desde #125 (`CustomerPayment.voidsPaymentId`: anular cobranzas)" y:

```typescript
export const POS_CONTRACT_VERSION = '4.3.0';
```

- [ ] **Paso 4: OpenAPI.** En `docs/connector-api.openapi.yaml`:
  - `version: '4.3.0'`; sumar el spec `docs/superpowers/specs/2026-09-28-anular-cobranzas-design.md, issue #125` a la lista de specs.
  - Antes de "**4.2.0 respecto de 4.1.0**", insertar:

```yaml
    **4.3.0 respecto de 4.2.0** (aditivo, #125):
      - `CustomerPayment.voidsPaymentId` opcional: la anulación de una
        cobranza es otra cobranza, con los mismos medios en negativo, `total`
        negativo, el mismo `customerId`, su propio `receipt` y
        `voidsPaymentId` apuntando a la que anula. Viaja como un evento
        `customer-payment` más. La original nunca se modifica. El backend la
        trata como cualquier cobranza (el saldo se mueve por `-total`, así que
        sube) y puede usar `voidsPaymentId` para auditoría o para marcar la
        original.
      - Un POS 4.3.0 considera incompatible a un backend 4.2: podría rechazar
        o malinterpretar una cobranza negativa.

```

  - En el schema `CustomerPayment`: la descripción termina en "Se anula con otra cobranza (4.3.0): ver `voidsPaymentId`." (en lugar de "No se anula: se corrige con otro registro."); `payments.description: 'method != account; amount > 0, salvo en una anulación (voidsPaymentId), donde todos son < 0.'`; y después de `receipt` agregar:

```yaml
        voidsPaymentId:
          type: string
          description: |
            Solo en la anulación de una cobranza (4.3.0, #125): el id de la
            cobranza que anula. Mismos medios con `amount` negativo, `total`
            negativo, mismo `customerId` y su propio `receipt`. El original
            nunca se modifica.
```

  - En la línea de v3 que dice "Cobranzas y movimientos de caja no se anulan." no se toca (es historia).

- [ ] **Paso 5: verificar.** Run: `pnpm lint && pnpm typecheck && pnpm test` → PASS.

- [ ] **Paso 6: commit.**

```bash
git add docs/connector-api.openapi.yaml src/domain/contract-version.ts src/domain/contract-version.test.ts src/connectors/google-sheets/*.test.ts
git commit -m "feat(contrato): 4.3.0 con CustomerPayment.voidsPaymentId (#125)"
```

---

### Tarea 2: Dominio de la anulación de una cobranza

**Archivos:**
- Modificar: `src/domain/customer-payment.ts`
- Modificar: `src/domain/result.ts:90-94`, `src/ui/errors.ts:121-130`
- Test: `src/domain/customer-payment.test.ts`, `src/domain/cash-count.test.ts`, `src/domain/reapply.test.ts`, `src/ui/errors.test.ts` (si existe un test por código)

**Interfaces:**
- Produce: `CustomerPayment.voidsPaymentId?: string`; `buildVoidCustomerPayment(original: CustomerPayment, params: { id: string; now: string; isAlreadyVoided: boolean }): Result<CustomerPayment>`; `isVoidedPayment(payment: Pick<CustomerPayment, 'id'>, voidedPaymentIds: ReadonlySet<string>): boolean`; códigos `customer-payment/cannot-void-a-void` (`undefined`), `customer-payment/already-voided` (`undefined`), `customer-payment/void-window-expired` (`{ createdAt: string }`), `customer-payment/not-found` (`{ paymentId: string }`).

- [ ] **Paso 1: tests que fallan** en `src/domain/customer-payment.test.ts` (importar `buildVoidCustomerPayment`, `isVoidedPayment` y `type CustomerPayment`):

```typescript
describe('buildVoidCustomerPayment (#125)', () => {
  const original: CustomerPayment = {
    id: 'cp1',
    customerId: 'c1',
    payments: [
      { method: 'cash', amount: 200 },
      { method: 'transfer', amount: 300 },
    ],
    total: 500,
    createdAt: '2026-09-28T09:00:00.000Z',
    receipt: { date: '2026-09-28', number: 1 },
  };
  const params = { id: 'cp2', now: '2026-09-28T10:00:00.000Z', isAlreadyVoided: false };

  it('invierte pagos y total, apunta a la original y no trae recibo', () => {
    expect(buildVoidCustomerPayment(original, params)).toEqual({
      ok: true,
      value: {
        id: 'cp2',
        customerId: 'c1',
        payments: [
          { method: 'cash', amount: -200 },
          { method: 'transfer', amount: -300 },
        ],
        total: -500,
        createdAt: params.now,
        voidsPaymentId: 'cp1',
      },
    });
  });

  it('no anula una anulación', () => {
    expect(
      buildVoidCustomerPayment({ ...original, voidsPaymentId: 'cp0' }, params),
    ).toMatchObject({ ok: false, error: 'customer-payment/cannot-void-a-void' });
  });

  it('no anula dos veces', () => {
    expect(buildVoidCustomerPayment(original, { ...params, isAlreadyVoided: true })).toMatchObject({
      ok: false,
      error: 'customer-payment/already-voided',
    });
  });

  it('fuera de las 24 h móviles no se anula', () => {
    expect(
      buildVoidCustomerPayment(original, { ...params, now: '2026-09-29T09:00:00.000Z' }),
    ).toEqual({
      ok: false,
      error: 'customer-payment/void-window-expired',
      meta: { createdAt: original.createdAt },
    });
  });
});

describe('isVoidedPayment', () => {
  it('anulada si hay una cobranza que la anula', () => {
    expect(isVoidedPayment({ id: 'cp1' }, new Set(['cp1']))).toBe(true);
    expect(isVoidedPayment({ id: 'cp2' }, new Set(['cp1']))).toBe(false);
  });
});
```

En `src/domain/cash-count.test.ts`, dentro de `describe('calculateCashBalance con cobranzas (#101)'`:

```typescript
  it('una anulación de cobranza resta su efectivo (#125)', () => {
    expect(
      calculateCashBalance({
        lastCount: undefined,
        sales: [],
        movements: [],
        collections: [
          { createdAt: '2026-09-28T09:00:00.000Z', payments: [{ method: 'cash', amount: 200 }] },
          { createdAt: '2026-09-28T10:00:00.000Z', payments: [{ method: 'cash', amount: -200 }] },
        ],
      }),
    ).toBe(0);
  });
```

En `src/domain/reapply.test.ts`, junto a "una cobranza resta su total del saldo del cliente":

```typescript
  it('la anulación de una cobranza devuelve el saldo (#125)', () => {
    const payment = (id: string, total: number, voidsPaymentId?: string): OutboxEvent => ({
      ...envelope,
      id,
      type: 'customer-payment',
      payment: {
        id,
        customerId: 'c1',
        payments: [{ method: 'cash', amount: total }],
        total,
        createdAt: now,
        ...(voidsPaymentId !== undefined ? { voidsPaymentId } : {}),
      },
    });
    expect(reapplyEffects([payment('cp1', 40), payment('cp2', -40, 'cp1')]).balance).toEqual(
      new Map([['c1', 0]]),
    );
  });
```

- [ ] **Paso 2: ver fallar.** Run: `pnpm test -- customer-payment cash-count reapply` → FAIL (`buildVoidCustomerPayment` no existe). Los de cash-count y reapply pueden pasar ya: es lo esperado (fijan el comportamiento con signo); si alguno falla, investigar antes de seguir.

- [ ] **Paso 3: implementar.** En `src/domain/customer-payment.ts`: cambiar el comentario del tipo ("No se anula (RNF-07)" → "Se anula con otra cobranza negativa (#125); la original no se toca (RNF-07)"), sumar el campo y las funciones:

```typescript
  /** Solo en la anulación de una cobranza (4.3.0, #125): la cobranza que anula. */
  voidsPaymentId?: string;
```

```typescript
import { isWithinVoidWindow } from './sale-lifecycle.ts';

/**
 * La anulación de una cobranza como documento propio (#125), espejo de `buildVoidSale`: los mismos
 * medios en negativo, el total invertido y `voidsPaymentId` a la original, que no se toca (RNF-07).
 * Sin `receipt`: el número lo asigna storage dentro de la transacción, como a cualquier cobranza.
 */
export function buildVoidCustomerPayment(
  original: CustomerPayment,
  params: { id: string; now: string; isAlreadyVoided: boolean },
): Result<CustomerPayment> {
  if (original.voidsPaymentId !== undefined) {
    return err('customer-payment/cannot-void-a-void', undefined);
  }
  if (params.isAlreadyVoided) {
    return err('customer-payment/already-voided', undefined);
  }
  if (!isWithinVoidWindow(original, params.now)) {
    return err('customer-payment/void-window-expired', { createdAt: original.createdAt });
  }
  return ok({
    id: params.id,
    customerId: original.customerId,
    payments: original.payments.map((payment) => ({
      method: payment.method,
      amount: -payment.amount,
    })),
    total: -original.total,
    createdAt: params.now,
    voidsPaymentId: original.id,
  });
}

/** Anulada: hay una cobranza que la anula (#125). */
export function isVoidedPayment(
  payment: Pick<CustomerPayment, 'id'>,
  voidedPaymentIds: ReadonlySet<string>,
): boolean {
  return voidedPaymentIds.has(payment.id);
}
```

Verificar que `sale-lifecycle.ts` no importe de `customer-payment.ts` (evita un ciclo): `rg -n "customer-payment" src/domain/sale-lifecycle.ts` → sin resultados.

En `src/domain/result.ts`, después de `'customer-payment/persist-failed'`:

```typescript
  // customer-payment.ts y storage (anular cobranzas, #125)
  'customer-payment/cannot-void-a-void': undefined;
  'customer-payment/already-voided': undefined;
  'customer-payment/void-window-expired': { createdAt: string };
  'customer-payment/not-found': { paymentId: string };
```

En `src/ui/errors.ts`, junto a los `customer-payment/*`:

```typescript
    case 'customer-payment/cannot-void-a-void':
      return 'Esta cobranza ya es una anulación: no se puede anular.';
    case 'customer-payment/already-voided':
      return 'Esa cobranza ya estaba anulada.';
    case 'customer-payment/void-window-expired':
      return 'Solo se pueden anular cobranzas de las últimas 24 horas.';
    case 'customer-payment/not-found':
      return 'No se encontró esa cobranza.';
```

Si `src/ui/errors.test.ts` recorre cada código con su texto, sumar los cuatro.

- [ ] **Paso 4: verificar.** Run: `pnpm lint && pnpm typecheck && pnpm test` → PASS.

- [ ] **Paso 5: commit.**

```bash
git add src/domain src/ui/errors.ts src/ui/errors.test.ts
git commit -m "feat(cobranza): anulación de una cobranza en el dominio (#125)"
```

---

### Tarea 3: Persistir la anulación de una cobranza

**Archivos:**
- Modificar: `src/storage/db.ts` (versión 9)
- Modificar: `src/storage/customer-payment-repository.ts`
- Test: `src/storage/customer-payment-repository.test.ts`, `src/storage/db.test.ts` (o `db-migration.test.ts`, el que ya pruebe índices de versiones)

**Interfaces:**
- Consume: `buildVoidCustomerPayment` (Tarea 2).
- Produce: `voidCollectionAndPersist(paymentId: string): Promise<Result<CollectionRecord>>`; `loadVoidedPaymentIds(paymentIds: readonly string[]): Promise<Set<string>>`; `loadPaymentVoidOriginals(payments: readonly CustomerPayment[]): Promise<Map<string, CustomerPayment>>`.

- [ ] **Paso 1: tests que fallan** en `src/storage/customer-payment-repository.test.ts` (importar las tres funciones nuevas):

```typescript
describe('voidCollectionAndPersist (#125)', () => {
  async function voidIt(paymentId: string) {
    const result = await voidCollectionAndPersist(paymentId);
    if (!result.ok) throw new Error(`esperaba ok: ${result.error}`);
    return result.value;
  }

  it('guarda una cobranza negativa con el recibo siguiente, devuelve el saldo y encola el evento', async () => {
    const original = await collect();

    const record = await voidIt(original.payment.id);

    expect(record.payment).toMatchObject({
      customerId: 'c1',
      total: -700,
      voidsPaymentId: original.payment.id,
      receipt: { date: original.payment.receipt.date, number: 2 },
      payments: [
        { method: 'cash', amount: -500 },
        { method: 'transfer', amount: -200 },
      ],
    });
    expect(record.balanceBefore).toBe(-700);
    expect(record.balanceAfter).toBe(0);
    expect((await db.customerBalances.get('c1'))?.balance).toBe(0);
    expect(await db.customerPayments.get(original.payment.id)).toEqual(original.payment);
    expect(await db.accountMovements.where('paymentId').equals(record.payment.id).toArray()).toEqual(
      [expect.objectContaining({ type: 'payment', amount: 700, customerId: 'c1' })],
    );
    const event = await db.outbox.get(record.payment.id);
    expect(event).toMatchObject({ type: 'customer-payment', payment: record.payment });
    expect(getReceiptCounter()).toEqual({ date: record.payment.receipt.date, last: 2 });
  });

  it('no anula dos veces ni anula una anulación', async () => {
    const original = await collect();
    const voided = await voidIt(original.payment.id);

    expect(await voidCollectionAndPersist(original.payment.id)).toMatchObject({
      ok: false,
      error: 'customer-payment/already-voided',
    });
    expect(await voidCollectionAndPersist(voided.payment.id)).toMatchObject({
      ok: false,
      error: 'customer-payment/cannot-void-a-void',
    });
  });

  it('una cobranza que no está es not-found', async () => {
    expect(await voidCollectionAndPersist('nope')).toEqual({
      ok: false,
      error: 'customer-payment/not-found',
      meta: { paymentId: 'nope' },
    });
  });

  it('loadVoidedPaymentIds y loadPaymentVoidOriginals cruzan por voidsPaymentId', async () => {
    const original = await collect();
    const other = await collect();
    const voided = await voidIt(original.payment.id);

    expect(await loadVoidedPaymentIds([original.payment.id, other.payment.id])).toEqual(
      new Set([original.payment.id]),
    );
    expect(await loadPaymentVoidOriginals([voided.payment, other.payment])).toEqual(
      new Map([[original.payment.id, original.payment]]),
    );
  });
});
```

(Si `db.accountMovements` no tiene índice `paymentId`, usar `(await db.accountMovements.toArray()).filter((m) => m.paymentId === record.payment.id)`.)

- [ ] **Paso 2: ver fallar.** Run: `pnpm test -- customer-payment-repository` → FAIL (funciones inexistentes).

- [ ] **Paso 3: Dexie v9.** En `src/storage/db.ts`, después de la versión 8:

```typescript
    // #125: la anulación de una cobranza es otra cobranza que apunta a la original — el índice
    // responde "¿esta cobranza ya tiene anulación?" sin recorrer la tabla (como `voidsSaleId`, v6).
    this.version(9).stores({
      customerPayments: 'id, createdAt, customerId, voidsPaymentId',
    });
```

- [ ] **Paso 4: extraer la transacción y sumar la anulación.** En `src/storage/customer-payment-repository.ts`, mover el cuerpo desde `const stored = getReceiptCounter();` hasta el `return ok(record);` a:

```typescript
/**
 * La transacción de una cobranza o de su anulación (#101, #125): número de recibo del día, el
 * documento, su movimiento de cuenta (`-total`: una cobranza baja el saldo, su anulación lo sube),
 * el saldo del cliente (crea la fila si no existía) y su evento `customer-payment`, armado adentro
 * para que viaje con el número. El contador de `localStorage` se escribe después del commit.
 */
async function persistCollectionDocument(
  built: CustomerPayment,
  params: { now: string; origin: EventOrigin },
): Promise<Result<CollectionRecord>> {
  // … el cuerpo actual, usando `built` en lugar de `built.value`, `built.customerId` en lugar de
  // `params.customerId` y `params.now` / `params.origin` …
}
```

(`EventOrigin` es el tipo que devuelve `currentEventOrigin()`; importarlo de donde está declarado —
`rg -n "export type EventOrigin" src`.) `collectAndPersist` queda:

```typescript
  if (!built.ok) {
    return built;
  }
  return persistCollectionDocument(built.value, { now, origin });
```

Y agregar:

```typescript
/**
 * Anula una cobranza con otra (#125), espejo de `sale-repository.ts::voidSaleAndPersist`: una
 * cobranza negativa (`buildVoidCustomerPayment`) que consume número de recibo, sube de vuelta el
 * saldo del cliente y viaja como un `customer-payment` más. La original no se toca (RNF-07).
 */
export async function voidCollectionAndPersist(paymentId: string): Promise<Result<CollectionRecord>> {
  const now = new Date().toISOString();
  const origin = currentEventOrigin();
  const original = await db.customerPayments.get(paymentId);
  if (original === undefined) {
    return err('customer-payment/not-found', { paymentId });
  }
  const isAlreadyVoided =
    (await db.customerPayments.where('voidsPaymentId').equals(paymentId).count()) > 0;
  const built = buildVoidCustomerPayment(original, { id: newId(), now, isAlreadyVoided });
  if (!built.ok) {
    return built;
  }
  return persistCollectionDocument(built.value, { now, origin });
}

/** Ids de las cobranzas de `paymentIds` que tienen una anulación (#125). */
export async function loadVoidedPaymentIds(paymentIds: readonly string[]): Promise<Set<string>> {
  if (paymentIds.length === 0) {
    return new Set();
  }
  const voids = await db.customerPayments.where('voidsPaymentId').anyOf([...paymentIds]).toArray();
  return new Set(voids.flatMap((payment) => (payment.voidsPaymentId !== undefined ? [payment.voidsPaymentId] : [])));
}

/** Las cobranzas que anulan las anulaciones de `payments`, por id (#125). */
export async function loadPaymentVoidOriginals(
  payments: readonly CustomerPayment[],
): Promise<Map<string, CustomerPayment>> {
  const ids = [
    ...new Set(payments.flatMap((payment) => (payment.voidsPaymentId !== undefined ? [payment.voidsPaymentId] : []))),
  ];
  const originals = await db.customerPayments.bulkGet(ids);
  return new Map(originals.flatMap((payment) => (payment !== undefined ? [[payment.id, payment] as const] : [])));
}
```

Importar `buildVoidCustomerPayment`. El tipo `CollectionRecord.payment` queda `CustomerPayment & { receipt: DailyNumber }` (sin cambios).

- [ ] **Paso 5: test del índice.** En el test de Dexie que prueba versiones (`rg -n "voidsSaleId" src/storage/db*.test.ts`), sumar uno análogo: `await db.customerPayments.where('voidsPaymentId').equals('x').count()` resuelve `0` (sin índice, Dexie lanza `SchemaError`).

- [ ] **Paso 6: verificar.** Run: `pnpm lint && pnpm typecheck && pnpm test` → PASS (incluidos los tests de `collectAndPersist` sin cambios).

- [ ] **Paso 7: commit.**

```bash
git add src/storage
git commit -m "feat(cobranza): voidCollectionAndPersist y Dexie v9 con voidsPaymentId (#125)"
```

---

### Tarea 4: Candidatos de `/ANULAR`: ventas y cobranzas de 24 h

**Archivos:**
- Crear: `src/storage/void-repository.ts`, `src/storage/void-repository.test.ts`
- Modificar: `src/storage/sale-repository.ts` (sacar `VoidCandidate`, `VOID_CANDIDATES_LIMIT`, `listVoidCandidates`) y su test (mover los casos de `listVoidCandidates` al nuevo test)
- Modificar (import): `src/ui/state/void-sale.ts`, `src/ui/keyboard/void-controller.ts`, `src/ui/screens/void-sale-screen.tsx` — solo el import de `VoidCandidate`/`listVoidCandidates` para que compile; el rediseño es la Tarea 7. En esta tarea el controller adapta la forma nueva con el mínimo cambio: filtra `kind === 'sale'`.

**Interfaces:**
- Consume: `loadVoidedSaleIds`, `loadVoidOriginals` (`sale-repository.ts`), `loadVoidedPaymentIds`, `loadPaymentVoidOriginals` (Tarea 3).
- Produce:

```typescript
export type VoidState = 'voidable' | 'voided' | 'void-document';
export type VoidCandidate =
  | { kind: 'sale'; sale: Sale; state: VoidState; original?: Sale }
  | { kind: 'collection'; payment: CustomerPayment; state: VoidState; original?: CustomerPayment };
export function candidateId(candidate: VoidCandidate): string;
export function listVoidCandidates(now: string): Promise<VoidCandidate[]>;
```

- [ ] **Paso 1: tests que fallan** en `src/storage/void-repository.test.ts` (mismo `beforeEach`/`afterEach` que `customer-payment-repository.test.ts`; `vi.useFakeTimers({ toFake: ['Date'] })` para fechar documentos):

```typescript
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Cart } from '../domain/cart.ts';
import { collectAndPersist, voidCollectionAndPersist } from './customer-payment-repository.ts';
import { db } from './db.ts';
import { closeSaleAndPersist, voidSaleAndPersist } from './sale-repository.ts';
import { listVoidCandidates } from './void-repository.ts';

const cart: Cart = { lines: [{ kind: 'freeform', description: 'x', qty: 1, unitPrice: 100 }] };

beforeEach(async () => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ['Date'] });
  await db.open();
});
afterEach(async () => {
  vi.useRealTimers();
  localStorage.clear();
  db.close();
  await db.delete();
});

async function saleAt(iso: string) {
  vi.setSystemTime(new Date(iso));
  const result = await closeSaleAndPersist({ cart, payments: [{ method: 'cash', amount: 100 }] });
  if (!result.ok) throw new Error(result.error);
  return result.value;
}
async function collectionAt(iso: string) {
  vi.setSystemTime(new Date(iso));
  const result = await collectAndPersist({ customerId: 'c1', payments: [{ method: 'cash', amount: 50 }] });
  if (!result.ok) throw new Error(result.error);
  return result.value.payment;
}

describe('listVoidCandidates (#125)', () => {
  it('mezcla ventas y cobranzas de las últimas 24 h, lo más nuevo primero, sin tope', async () => {
    await saleAt('2026-09-27T08:00:00.000Z'); // fuera de la ventana
    const sales = [];
    for (let i = 0; i < 21; i++) {
      sales.push(await saleAt(`2026-09-28T09:${String(i).padStart(2, '0')}:00.000Z`));
    }
    const payment = await collectionAt('2026-09-28T09:30:00.000Z');

    const now = '2026-09-28T10:00:00.000Z';
    const candidates = await listVoidCandidates(now);

    expect(candidates).toHaveLength(22);
    expect(candidates[0]).toMatchObject({ kind: 'collection', payment: { id: payment.id }, state: 'voidable' });
    expect(candidates[1]).toMatchObject({ kind: 'sale', sale: { id: sales[20]?.id }, state: 'voidable' });
  });

  it('marca la original anulada y la anulación, con su original', async () => {
    const sale = await saleAt('2026-09-28T09:00:00.000Z');
    const payment = await collectionAt('2026-09-28T09:10:00.000Z');
    vi.setSystemTime(new Date('2026-09-28T09:20:00.000Z'));
    await voidSaleAndPersist(sale.id);
    await voidCollectionAndPersist(payment.id);

    const candidates = await listVoidCandidates('2026-09-28T10:00:00.000Z');

    expect(candidates.map((c) => [c.kind, c.state])).toEqual([
      ['collection', 'void-document'],
      ['sale', 'void-document'],
      ['collection', 'voided'],
      ['sale', 'voided'],
    ]);
    expect(candidates[0]).toMatchObject({ original: { id: payment.id } });
    expect(candidates[1]).toMatchObject({ original: { id: sale.id } });
  });

  it('una anulación cuya original quedó fuera de la ventana trae la original igual', async () => {
    const payment = await collectionAt('2026-09-27T09:00:00.000Z');
    vi.setSystemTime(new Date('2026-09-28T08:59:00.000Z'));
    await voidCollectionAndPersist(payment.id);

    const candidates = await listVoidCandidates('2026-09-28T10:00:00.000Z');

    expect(candidates).toEqual([
      expect.objectContaining({ kind: 'collection', state: 'void-document', original: payment }),
    ]);
  });
});
```

(Si la venta y la anulación de las 09:20 empatan en `createdAt`, el orden entre ellas queda por `kind`; si el test resulta frágil, separar sus horas con `setSystemTime` entre las dos anulaciones y ajustar el orden esperado.)

- [ ] **Paso 2: ver fallar.** Run: `pnpm test -- void-repository` → FAIL.

- [ ] **Paso 3: implementar** `src/storage/void-repository.ts`:

```typescript
import type { CustomerPayment } from '../domain/customer-payment.ts';
import { isVoidedPayment } from '../domain/customer-payment.ts';
import type { Sale } from '../domain/sale.ts';
import { isVoided, VOID_WINDOW_MS } from '../domain/sale-lifecycle.ts';
import { loadPaymentVoidOriginals, loadVoidedPaymentIds } from './customer-payment-repository.ts';
import { db } from './db.ts';
import { loadVoidedSaleIds, loadVoidOriginals } from './sale-repository.ts';

/** Una fila de `/ANULAR` (#99, #125): anulable, original ya anulada, o el documento de una anulación. */
export type VoidState = 'voidable' | 'voided' | 'void-document';
export type VoidCandidate =
  | { kind: 'sale'; sale: Sale; state: VoidState; original?: Sale }
  | { kind: 'collection'; payment: CustomerPayment; state: VoidState; original?: CustomerPayment };

export function candidateId(candidate: VoidCandidate): string {
  return candidate.kind === 'sale' ? candidate.sale.id : candidate.payment.id;
}

function candidateCreatedAt(candidate: VoidCandidate): string {
  return candidate.kind === 'sale' ? candidate.sale.createdAt : candidate.payment.createdAt;
}

/**
 * Lo que muestra `/ANULAR` (#125): todas las ventas y cobranzas de las últimas 24 h móviles
 * (la ventana de anulación, sin tope), anulaciones incluidas, lo más nuevo primero.
 */
export async function listVoidCandidates(now: string): Promise<VoidCandidate[]> {
  const since = new Date(Date.parse(now) - VOID_WINDOW_MS).toISOString();
  const [sales, payments] = await Promise.all([
    db.sales.where('createdAt').above(since).toArray(),
    db.customerPayments.where('createdAt').above(since).toArray(),
  ]);
  const [voidedSaleIds, saleOriginals, voidedPaymentIds, paymentOriginals] = await Promise.all([
    loadVoidedSaleIds(sales.map((sale) => sale.id)),
    loadVoidOriginals(sales),
    loadVoidedPaymentIds(payments.map((payment) => payment.id)),
    loadPaymentVoidOriginals(payments),
  ]);
  const saleCandidates = sales.map((sale): VoidCandidate => {
    if (sale.voidsSaleId !== undefined) {
      const original = saleOriginals.get(sale.voidsSaleId);
      return { kind: 'sale', sale, state: 'void-document', ...(original !== undefined ? { original } : {}) };
    }
    return { kind: 'sale', sale, state: isVoided(sale, voidedSaleIds) ? 'voided' : 'voidable' };
  });
  const paymentCandidates = payments.map((payment): VoidCandidate => {
    if (payment.voidsPaymentId !== undefined) {
      const original = paymentOriginals.get(payment.voidsPaymentId);
      return {
        kind: 'collection',
        payment,
        state: 'void-document',
        ...(original !== undefined ? { original } : {}),
      };
    }
    return {
      kind: 'collection',
      payment,
      state: isVoidedPayment(payment, voidedPaymentIds) ? 'voided' : 'voidable',
    };
  });
  return [...saleCandidates, ...paymentCandidates].sort((a, b) =>
    candidateCreatedAt(b).localeCompare(candidateCreatedAt(a)),
  );
}
```

Borrar de `sale-repository.ts` `VoidCandidate`, `VOID_CANDIDATES_LIMIT` y `listVoidCandidates` (y el import de `VOID_WINDOW_MS` si queda sin uso); mover/borrar sus tests de `sale-repository.test.ts` (los casos nuevos los cubren).

Adaptación mínima para compilar: en `ui/state/void-sale.ts`, `import type { VoidCandidate } from '../../storage/void-repository.ts'` y el signal tipado como `Extract<VoidCandidate, { kind: 'sale' }>[]`; en `void-controller.ts`, `voidableSalesSignal.value = (await listVoidCandidates(now)).filter((c): c is Extract<VoidCandidate, { kind: 'sale' }> => c.kind === 'sale');` y `state === 'void-document'` donde decía `'void-ticket'` (también en `void-sale-screen.tsx` y sus tests). El test del controller que espera el tope de 20, si existe, se borra (ya no hay tope).

- [ ] **Paso 4: verificar.** Run: `pnpm lint && pnpm typecheck && pnpm test` → PASS.

- [ ] **Paso 5: commit.**

```bash
git add src/storage src/ui
git commit -m "feat(anular): candidatos de /ANULAR con ventas y cobranzas de 24 h, sin tope (#125)"
```

---

### Tarea 5: Etiquetas de documentos y anulaciones

**Archivos:**
- Modificar: `src/ui/format-ticket.ts`
- Test: `src/ui/format-ticket.test.ts`

**Interfaces:**
- Produce: `voidOfReceiptLabel(voidPayment: Pick<CustomerPayment, 'receipt' | 'createdAt'>, original: Pick<CustomerPayment, 'receipt' | 'createdAt'> | undefined): string`; `saleName(sale: Pick<Sale, 'ticket' | 'createdAt'>): string` ("Ticket #1" / "ticket de las 17:20"); `receiptName(payment: Pick<CustomerPayment, 'receipt' | 'createdAt'>): string` ("Recibo #1" / "recibo de las 17:20"). `voidOfLabel` mantiene su firma.

- [ ] **Paso 1: tests que fallan** en `src/ui/format-ticket.test.ts` (usar el mismo locale/zona que los tests actuales de `voidOfLabel`; `formatTime` da "HH:MM"):

```typescript
describe('voidOfReceiptLabel (#125)', () => {
  const at = '2026-09-28T12:00:00.000Z';
  it('misma fecha: "Anulación del #1"', () => {
    expect(
      voidOfReceiptLabel(
        { receipt: { date: '2026-09-28', number: 2 }, createdAt: at },
        { receipt: { date: '2026-09-28', number: 1 }, createdAt: at },
      ),
    ).toBe('Anulación del #1');
  });
  it('otra fecha: "Anulación del #1 del 27/09"', () => {
    expect(
      voidOfReceiptLabel(
        { receipt: { date: '2026-09-28', number: 2 }, createdAt: at },
        { receipt: { date: '2026-09-27', number: 1 }, createdAt: at },
      ),
    ).toBe('Anulación del #1 del 27/09');
  });
  it('sin original: "Anulación"; original sin número: por su hora', () => {
    expect(voidOfReceiptLabel({ createdAt: at }, undefined)).toBe('Anulación');
    expect(voidOfReceiptLabel({ createdAt: at }, { createdAt: at })).toBe(
      `Anulación de ${formatTime(at)}`,
    );
  });
});

describe('saleName y receiptName (#125)', () => {
  const at = '2026-09-28T12:00:00.000Z';
  it('con número, "Ticket #1" / "Recibo #1"; sin número, por la hora', () => {
    expect(saleName({ ticket: { date: '2026-09-28', number: 1 }, createdAt: at })).toBe('Ticket #1');
    expect(saleName({ createdAt: at })).toBe(`ticket de las ${formatTime(at)}`);
    expect(receiptName({ receipt: { date: '2026-09-28', number: 3 }, createdAt: at })).toBe('Recibo #3');
    expect(receiptName({ createdAt: at })).toBe(`recibo de las ${formatTime(at)}`);
  });
});
```

- [ ] **Paso 2: ver fallar.** Run: `pnpm test -- format-ticket` → FAIL.

- [ ] **Paso 3: implementar.** En `src/ui/format-ticket.ts`, extraer el cuerpo de `voidOfLabel` a una función interna y sumar las nuevas:

```typescript
type Numbered = { number?: DailyNumber; createdAt: string };

/** "Anulación del #12" / "… del 23/09" / "Anulación de HH:MM" / "Anulación" (ticket o recibo). */
function voidOf(voidDocument: Numbered, original: Numbered | undefined): string {
  if (original === undefined) {
    return 'Anulación';
  }
  if (original.number === undefined) {
    return `Anulación de ${formatTime(original.createdAt)}`;
  }
  const voidDate = voidDocument.number?.date ?? localDateKey(voidDocument.createdAt);
  const suffix =
    original.number.date === voidDate ? '' : ` del ${formatTicketDate(original.number.date)}`;
  return `Anulación del #${String(original.number.number)}${suffix}`;
}

export function voidOfLabel(
  voidTicket: Pick<Sale, 'ticket' | 'createdAt'>,
  original: Pick<Sale, 'ticket' | 'createdAt'> | undefined,
): string {
  return voidOf(
    { number: voidTicket.ticket, createdAt: voidTicket.createdAt },
    original !== undefined ? { number: original.ticket, createdAt: original.createdAt } : undefined,
  );
}

/** La marca de la anulación de un recibo (#125), mismo formato que la de un ticket. */
export function voidOfReceiptLabel(
  voidPayment: Pick<CustomerPayment, 'receipt' | 'createdAt'>,
  original: Pick<CustomerPayment, 'receipt' | 'createdAt'> | undefined,
): string {
  return voidOf(
    { number: voidPayment.receipt, createdAt: voidPayment.createdAt },
    original !== undefined ? { number: original.receipt, createdAt: original.createdAt } : undefined,
  );
}

/** Cómo se nombra un ticket en una frase (#125): "Ticket #1", o "ticket de las 17:20" sin número. */
export function saleName(sale: Pick<Sale, 'ticket' | 'createdAt'>): string {
  return sale.ticket !== undefined ? ticketLabel(sale) : `ticket de las ${formatTime(sale.createdAt)}`;
}

/** Cómo se nombra un recibo en una frase (#125): "Recibo #1", o "recibo de las 17:20" sin número. */
export function receiptName(payment: Pick<CustomerPayment, 'receipt' | 'createdAt'>): string {
  return payment.receipt !== undefined
    ? receiptLabel(payment)
    : `recibo de las ${formatTime(payment.createdAt)}`;
}
```

(Con `exactOptionalPropertyTypes`, si el typecheck se queja de `number: voidTicket.ticket` siendo `undefined`, declarar `Numbered.number?: DailyNumber | undefined`.) Importar `DailyNumber` de `../domain/ticket-number.ts`.

- [ ] **Paso 4: verificar.** Run: `pnpm lint && pnpm typecheck && pnpm test` → PASS (los tests viejos de `voidOfLabel` siguen pasando).

- [ ] **Paso 5: commit.**

```bash
git add src/ui/format-ticket.ts src/ui/format-ticket.test.ts
git commit -m "feat(anular): etiquetas de la anulación de un recibo y nombres de documento (#125)"
```

---

### Tarea 6: `/RESUMEN` con filas compartidas y cobranzas anuladas

**Archivos:**
- Crear: `src/ui/document-search.ts`, `src/ui/document-search.test.ts`, `src/ui/components/document-rows.tsx`
- Modificar: `src/domain/day-summary.ts` (+ test), `src/storage/cash-summary-repository.ts` (+ test), `src/ui/screens/cash-summary-screen.tsx` (+ test)

**Interfaces:**
- Consume: `voidOfReceiptLabel` (T5), `loadVoidedPaymentIds`, `loadPaymentVoidOriginals` (T3), `isVoidedPayment` (T2).
- Produce:

```typescript
// ui/document-search.ts
export function saleSearchText(sale: Sale): string;
export function collectionSearchText(payment: CustomerPayment, customerName: string): string;
export function filterByText<T>(items: readonly T[], query: string, text: (item: T) => string): T[];
// ui/components/document-rows.tsx
export function lineLabel(line: SaleLine): string;
export type DocumentRowProps = {
  index: number;
  query: string;
  selected: boolean;
  dimmed?: boolean;
  mark?: string;
  rowRef?: (el: HTMLDivElement | null) => void;
  onClick: () => void;
  testId?: string;
};
export function SaleDocumentRow(props: DocumentRowProps & { sale: Sale }): JSX.Element;
export function CollectionDocumentRow(props: DocumentRowProps & { payment: CustomerPayment; customerName: string }): JSX.Element;
// domain/day-summary.ts
DaySummary.collections: { total: number; count: number; voidedCount: number };
calculateDaySummary({ …, voidedPaymentIds: ReadonlySet<string> });
// storage/cash-summary-repository.ts
DayView.voidedPaymentIds: Set<string>; DayView.paymentVoidOriginals: Map<string, CustomerPayment>;
```

- [ ] **Paso 1: tests que fallan.**

`src/domain/day-summary.test.ts`: en todos los `calculateDaySummary({...})` existentes agregar `voidedPaymentIds: new Set()`; el `toEqual({ total: 800, count: 2 })` pasa a `{ total: 800, count: 2, voidedCount: 0 }`, y sumar:

```typescript
  it('una cobranza y su anulación: total 0, dos recibos, uno anulado (#125)', () => {
    const summary = calculateDaySummary({
      sales: [],
      movements: [],
      voidedSaleIds: noVoids,
      voidedPaymentIds: new Set(['cp1']),
      collections: [
        collection({ id: 'cp1', total: 100 }),
        collection({
          id: 'cp2',
          payments: [{ method: 'cash', amount: -100 }],
          total: -100,
          voidsPaymentId: 'cp1',
        }),
      ],
    });
    expect(summary.collections).toEqual({ total: 0, count: 2, voidedCount: 1 });
    expect(summary.cash.collections).toBe(0);
  });
```

`src/ui/document-search.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { filterByText } from './document-search.ts';

describe('filterByText', () => {
  const items = ['12 Ana arroz', '3 recibo cobranza Beto'];
  it('sin texto devuelve todo; con "#" lo ignora', () => {
    expect(filterByText(items, '  ', (x) => x)).toEqual(items);
    expect(filterByText(items, '#12', (x) => x)).toEqual(['12 Ana arroz']);
  });
  it('busca por prefijo de palabra', () => {
    expect(filterByText(items, 'bet', (x) => x)).toEqual(['3 recibo cobranza Beto']);
  });
});
```

`src/storage/cash-summary-repository.test.ts`: un caso que cobra, anula esa cobranza y verifica `view.voidedPaymentIds` contiene la original, `view.paymentVoidOriginals.get(original.id)` es la original y `view.summary.collections.voidedCount === 1`.

`src/ui/screens/cash-summary-screen.test.tsx`: un caso con una cobranza anulada en el día que espera los textos `"Recibo #1 · Ana · Anulada"` (o `"· Anulada"` junto a "Recibo #1"), `"Anulación del #1"` y `"(2 recibos, 1 anulados)"` en el panel. Tomar como modelo el test existente de cobranzas en `/RESUMEN` (`rg -n "recibos" src/ui/screens/cash-summary-screen.test.tsx`).

- [ ] **Paso 2: ver fallar.** Run: `pnpm test -- day-summary document-search cash-summary` → FAIL.

- [ ] **Paso 3: dominio.** En `src/domain/day-summary.ts`: parámetro `voidedPaymentIds: ReadonlySet<string>` en `calculateDaySummary`, tipo `collections: { total: number; count: number; voidedCount: number }` en `DaySummary`, y:

```typescript
    collections: {
      total: roundAmount(collectionsTotal),
      count: params.collections.length,
      voidedCount: params.collections.filter((payment) =>
        isVoidedPayment(payment, params.voidedPaymentIds),
      ).length,
    },
```

- [ ] **Paso 4: storage.** En `getDaySummary` (`cash-summary-repository.ts`), después de `voidedSaleIds`:

```typescript
  const voidedPaymentIds = await loadVoidedPaymentIds(collections.map((payment) => payment.id));
```

pasar `voidedPaymentIds` a `calculateDaySummary` y sumar al `view` `voidedPaymentIds` y `paymentVoidOriginals: await loadPaymentVoidOriginals(collections)` (con sus comentarios en `DayView`, como los de ventas).

- [ ] **Paso 5: buscador compartido.** Crear `src/ui/document-search.ts` moviendo desde `cash-summary-screen.tsx` el `case 'sale'` y el `case 'collection'` de `entrySearchText` y el cuerpo de `filterEntries`:

```typescript
import { Index } from 'flexsearch';
import type { CustomerPayment } from '../domain/customer-payment.ts';
import type { Sale } from '../domain/sale.ts';
import { lineLabel } from './components/document-rows.tsx';
import { getCatalogRepository } from './state/catalog.ts';
import { getCustomerRepository } from './state/customer-repository.ts';

/** Lo que encuentra el buscador en un ticket: número, cliente, productos, SKU y códigos. */
export function saleSearchText(sale: Sale): string {
  // … el `case 'sale'` actual de `entrySearchText`, sin cambios …
}

/** Lo que encuentra en una cobranza (#101): "3", "#3" y el nombre del cliente. */
export function collectionSearchText(payment: CustomerPayment, customerName: string): string {
  const number = payment.receipt?.number;
  return `${number !== undefined ? String(number) : ''} recibo cobranza ${customerName}`;
}

/** Filtro de `/RESUMEN` y `/ANULAR`: FlexSearch por prefijo; "#12" busca "12". */
export function filterByText<T>(items: readonly T[], query: string, text: (item: T) => string): T[] {
  const cleaned = query.trim().replace(/^#/, '');
  if (cleaned === '') return [...items];
  const index = new Index({ tokenize: 'forward' });
  items.forEach((item, position) => {
    index.add(position, text(item));
  });
  const positions = new Set(index.search(cleaned).map(Number));
  return items.filter((_, position) => positions.has(position));
}
```

En `cash-summary-screen.tsx`, `entrySearchText` delega (`case 'sale': return saleSearchText(entry.sale);`, `case 'collection': return collectionSearchText(entry.payment, customerNames.get(entry.payment.customerId) ?? '');`) y `filterEntries` pasa a `filterByText(entries, query, (entry) => entrySearchText(entry, customerNames))`.

- [ ] **Paso 6: filas compartidas.** Crear `src/ui/components/document-rows.tsx` moviendo `lineLabel`, `SaleEntryRow` → `SaleDocumentRow` y `CollectionEntryRow` → `CollectionDocumentRow` con estos cambios, y nada más:
  - Props `DocumentRowProps` (arriba) en lugar de `RowProps`: `selected` reemplaza a `index === selectedEntryIndexSignal.value`; `rowRef` reemplaza a `nav.ticketRef(index)`; `onClick` reemplaza a `onSelect(index)`; `mark` reemplaza a `voidMark(sale, view)`; `data-testid={testId}` en el contenedor.
  - `rowContainerStyle(index)` pasa a `rowContainerStyle(index, selected)` interno: el `borderTop` sigue decidiéndose con `index > 0` (la prop `index` es la posición en la lista que se dibuja).
  - `dimmed` → `opacity: 0.5` y `cursor: 'default'`.
  - `CollectionDocumentRow` muestra `mark` como el ticket: `<span …> · {mark}</span>` después de "Recibo #N · Nombre", con el mismo estilo muted.
  - Montos: `CollectionDocumentRow` ya usa `formatMoney(item.amount)` y `formatMoney(payment.total)`, que muestran el signo; no cambiar.

En `cash-summary-screen.tsx`, `MovementsTab` usa:

```tsx
      case 'sale':
        return (
          <SaleDocumentRow
            key={entryKey(entry)}
            sale={entry.sale}
            index={index}
            query={query}
            selected={index === selectedEntryIndexSignal.value}
            mark={saleMark(entry.sale, view)}
            rowRef={nav.ticketRef(index)}
            onClick={() => {
              onSelect(index);
            }}
          />
        );
      case 'collection':
        return (
          <CollectionDocumentRow
            key={entryKey(entry)}
            payment={entry.payment}
            customerName={view.customerNames.get(entry.payment.customerId) ?? ''}
            index={index}
            query={query}
            selected={index === selectedEntryIndexSignal.value}
            mark={collectionMark(entry.payment, view)}
            rowRef={nav.ticketRef(index)}
            onClick={() => {
              onSelect(index);
            }}
          />
        );
```

con `voidMark` renombrado a `saleMark` y:

```typescript
/** Marca de una cobranza anulada o de una anulación (#125), como la de los tickets. */
function collectionMark(payment: CustomerPayment, view: DayView): string | undefined {
  if (payment.voidsPaymentId !== undefined) {
    return voidOfReceiptLabel(payment, view.paymentVoidOriginals.get(payment.voidsPaymentId));
  }
  return isVoidedPayment(payment, view.voidedPaymentIds) ? 'Anulada' : undefined;
}
```

`MovementEntryRow` y `CountEntryRow` siguen en `/RESUMEN` sin cambios.

- [ ] **Paso 7: panel.** En `Sidebar`, la línea de cobranzas:

```tsx
              {`(${String(summary.collections.count)} recibos${
                summary.collections.voidedCount > 0
                  ? `, ${String(summary.collections.voidedCount)} anulados`
                  : ''
              })`}
```

- [ ] **Paso 8: verificar.** Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm build` → PASS. Los tests existentes de `/RESUMEN` pasan sin cambiar sus expectativas (salvo el `voidedPaymentIds`/`voidedCount` agregado): es la prueba de que la extracción no cambió nada visible.

- [ ] **Paso 9: commit.**

```bash
git add src/domain/day-summary* src/storage/cash-summary-repository* src/ui
git commit -m "feat(resumen): filas compartidas y cobranzas anuladas en /RESUMEN (#125)"
```

---

### Tarea 7: `/ANULAR` rediseñado: lista como `/RESUMEN`, buscador, modal y aviso

**Archivos:**
- Crear: `src/ui/state/void.ts` (borrar `void-sale.ts`), `src/ui/screens/void-screen.tsx` + `void-screen.test.tsx` (borrar `void-sale-screen.tsx` y su test)
- Modificar: `src/ui/keyboard/void-controller.ts` + test, `src/ui/app.tsx:12,31-32`, `src/ui/keyboard/commands.ts:49`, `src/ui/state/demo-reset.ts:3` (comentario), `src/ui/hooks/use-focus-on-mount.ts:11` (comentario)

**Interfaces:**
- Consume: `listVoidCandidates`, `VoidCandidate`, `candidateId` (T4); `voidCollectionAndPersist` (T3); `voidSaleAndPersist`; `saleName`, `receiptName`, `voidOfLabel`, `voidOfReceiptLabel` (T5); `SaleDocumentRow`, `CollectionDocumentRow` (T6); `saleSearchText`, `collectionSearchText`, `filterByText` (T6); `commandBarNoticeSignal`, `overlayDismissedSignal` (`ui/state/command-bar.ts`); `customerBalancesSignal` y `formatBalance`.
- Produce (controller): `loadVoidCandidates(): Promise<void>`, `updateVoidFilter(text: string): void`, `moveVoidSelection(direction: 1 | -1): void`, `selectForVoid(): void`, `activateVoidRow(index: number): void`, `cancelVoidConfirmation(): void`, `escapeVoidScreen(): void` (limpia el filtro o sale), `exitVoidScreen(): void`, `confirmVoid(): Promise<void>`, `candidateCustomerName(candidate: VoidCandidate): string`, `voidQuestion(candidate: VoidCandidate): string`, `voidBalancePreview(candidate: VoidCandidate): string | undefined`.
- Produce (estado, `ui/state/void.ts`): `voidCandidatesSignal`, `voidFilterSignal`, `filteredVoidCandidatesSignal` (computed), `voidSelectionIndexSignal` (índice en la lista filtrada), `voidConfirmingSignal`, `voidErrorSignal`, `voidLoadedSignal`.

- [ ] **Paso 1: estado.** `src/ui/state/void.ts`:

```typescript
import { computed, signal } from '@preact/signals';
import type { VoidCandidate } from '../../storage/void-repository.ts';
import { collectionSearchText, filterByText, saleSearchText } from '../document-search.ts';
import { getCustomerRepository } from './customer-repository.ts';

/** Ventas y cobranzas de las últimas 24 h con su estado (#125). */
export const voidCandidatesSignal = signal<VoidCandidate[]>([]);
export const voidFilterSignal = signal('');
/** Lo que se ve: los candidatos filtrados por el buscador, en el mismo orden. */
export const filteredVoidCandidatesSignal = computed(() =>
  filterByText(voidCandidatesSignal.value, voidFilterSignal.value, (candidate) =>
    candidate.kind === 'sale'
      ? saleSearchText(candidate.sale)
      : collectionSearchText(
          candidate.payment,
          getCustomerRepository().getCustomer(candidate.payment.customerId)?.name ?? '',
        ),
  ),
);
/** Índice en `filteredVoidCandidatesSignal`; `null` si no hay nada anulable a la vista. */
export const voidSelectionIndexSignal = signal<number | null>(null);
/** true = modal de confirmación abierto sobre la seleccionada. */
export const voidConfirmingSignal = signal(false);
export const voidErrorSignal = signal<string | null>(null);
/** true cuando terminó de cargar: el vacío se muestra recién ahí, sin parpadeo. */
export const voidLoadedSignal = signal(false);
```

- [ ] **Paso 2: tests del controller que fallan.** Reescribir `src/ui/keyboard/void-controller.test.ts` conservando su `beforeEach` (producto `p1`, stock) y sumando el reset de los signals nuevos (`voidFilterSignal.value = ''`, `voidCandidatesSignal.value = []`, `commandBarNoticeSignal.value = null`). Casos (los actuales de navegación/salto/click/confirmar se conservan adaptados a los nombres nuevos), más:

```typescript
async function collect(total = 500) {
  const result = await collectAndPersist({ customerId: 'c1', payments: [{ method: 'cash', amount: total }] });
  if (!result.ok) throw new Error(result.error);
  return result.value.payment;
}

describe('/ANULAR con cobranzas (#125)', () => {
  it('lista ventas y cobranzas, preselecciona la más nueva anulable', async () => {
    await closeSaleAndPersist({ cart, payments: [{ method: 'cash', amount: 100 }] });
    const payment = await collect();

    await loadVoidCandidates();

    expect(filteredVoidCandidatesSignal.value.map((c) => c.kind)).toEqual(['collection', 'sale']);
    expect(voidSelectionIndexSignal.value).toBe(0);
    expect(candidateId(filteredVoidCandidatesSignal.value[0]!)).toBe(payment.id);
  });

  it('el filtro reinicia la selección en la primera anulable del resultado', async () => {
    await closeSaleAndPersist({ cart, payments: [{ method: 'cash', amount: 100 }] });
    await collect();
    await loadVoidCandidates();

    updateVoidFilter('arroz');

    expect(filteredVoidCandidatesSignal.value.map((c) => c.kind)).toEqual(['sale']);
    expect(voidSelectionIndexSignal.value).toBe(0);
  });

  it('Esc con filtro lo limpia; sin filtro sale a la venta', async () => {
    await loadVoidCandidates();
    updateVoidFilter('x');
    escapeVoidScreen();
    expect(voidFilterSignal.value).toBe('');
    expect(activeScreenSignal.value).not.toBe('sale');
    escapeVoidScreen();
    expect(activeScreenSignal.value).toBe('sale');
  });

  it('confirmar una cobranza la anula, devuelve el saldo y avisa en la barra', async () => {
    const payment = await collect();
    await loadVoidCandidates();
    selectForVoid();

    await confirmVoid();

    const voids = await db.customerPayments.where('voidsPaymentId').equals(payment.id).toArray();
    expect(voids).toHaveLength(1);
    expect((await db.customerBalances.get('c1'))?.balance).toBe(0);
    expect(commandBarNoticeSignal.value).toBe('Anulado el Recibo #1 con el Recibo #2');
    expect(activeScreenSignal.value).toBe('sale');
  });

  it('confirmar una venta avisa con los dos números de ticket', async () => {
    await closeSaleAndPersist({ cart, payments: [{ method: 'cash', amount: 100 }] });
    await loadVoidCandidates();
    selectForVoid();

    await confirmVoid();

    expect(commandBarNoticeSignal.value).toBe('Anulado el Ticket #1 con el Ticket #2');
  });

  it('un error de negocio queda en el modal, sin salir', async () => {
    const payment = await collect();
    await loadVoidCandidates();
    await voidCollectionAndPersist(payment.id); // otra pestaña la anuló mientras tanto
    selectForVoid();

    await confirmVoid();

    expect(voidErrorSignal.value).toBe('Esa cobranza ya estaba anulada.');
    expect(voidConfirmingSignal.value).toBe(true);
  });

  it('la pregunta nombra el documento y, en una cobranza, al cliente y el saldo', async () => {
    const payment = await collect();
    customerBalancesSignal.value = new Map([['c1', -500]]);
    await loadVoidCandidates();
    const candidate = filteredVoidCandidatesSignal.value[0]!;

    expect(voidQuestion(candidate)).toBe('¿Anular el Recibo #1?'); // sin cliente en el repositorio
    expect(voidBalancePreview(candidate)).toBe('Saldo del cliente: A favor $500,00 → Sin saldo');
    expect(payment.receipt.number).toBe(1);
  });
});
```

(El nombre del cliente sale de `getCustomerRepository()`; con un cliente cargado ahí la pregunta es "¿Anular el Recibo #1 de Ana?" y el saldo "Saldo de Ana: …". Si los tests del controller ya tienen un helper para sembrar el repositorio de clientes — `rg -n "setCustomerRepository|seedCustomers" src/ui` —, usarlo en un caso más con nombre. `formatMoney` depende del locale: los tests existentes fijan cuál; ajustar el texto esperado al que dan.)

- [ ] **Paso 3: ver fallar.** Run: `pnpm test -- void-controller` → FAIL.

- [ ] **Paso 4: controller.** Reescribir `src/ui/keyboard/void-controller.ts`:

```typescript
import type { CustomerPayment } from '../../domain/customer-payment.ts';
import type { Sale } from '../../domain/sale.ts';
import { voidCollectionAndPersist } from '../../storage/customer-payment-repository.ts';
import { voidSaleAndPersist } from '../../storage/sale-repository.ts';
import { listVoidCandidates, type VoidCandidate } from '../../storage/void-repository.ts';
import { describeError } from '../errors.ts';
import { formatBalance } from '../format-balance.ts';
import { receiptName, saleName } from '../format-ticket.ts';
import { commandBarNoticeSignal, overlayDismissedSignal } from '../state/command-bar.ts';
import { customerBalancesSignal, refreshCustomerBalances } from '../state/customer-balance.ts';
import { getCustomerRepository } from '../state/customer-repository.ts';
import { activeScreenSignal } from '../state/screen.ts';
import { refreshStockSnapshot } from '../state/stock.ts';
import {
  filteredVoidCandidatesSignal,
  voidCandidatesSignal,
  voidConfirmingSignal,
  voidErrorSignal,
  voidFilterSignal,
  voidLoadedSignal,
  voidSelectionIndexSignal,
} from '../state/void.ts';

function isVoidable(index: number): boolean {
  return filteredVoidCandidatesSignal.value[index]?.state === 'voidable';
}

function selectFirstVoidable(): void {
  const first = filteredVoidCandidatesSignal.value.findIndex((c) => c.state === 'voidable');
  voidSelectionIndexSignal.value = first === -1 ? null : first;
}

/**
 * Ventas y cobranzas de las últimas 24 h (#125), lo más nuevo primero. La selección arranca en la
 * anulable más nueva: la original ya anulada y la anulación no tienen acción.
 */
export async function loadVoidCandidates(): Promise<void> {
  voidConfirmingSignal.value = false;
  voidErrorSignal.value = null;
  voidFilterSignal.value = '';
  voidLoadedSignal.value = false;
  voidCandidatesSignal.value = await listVoidCandidates(new Date().toISOString());
  voidLoadedSignal.value = true;
  selectFirstVoidable();
}

/** Cada tecla del buscador: filtra y vuelve a la primera anulable del resultado. */
export function updateVoidFilter(text: string): void {
  voidFilterSignal.value = text;
  selectFirstVoidable();
}

/** ↑/↓: al siguiente anulable en esa dirección, sin ciclar (saltea las filas sin acción). */
export function moveVoidSelection(direction: 1 | -1): void {
  const current = voidSelectionIndexSignal.value;
  if (current === null) {
    return;
  }
  const length = filteredVoidCandidatesSignal.value.length;
  for (let index = current + direction; index >= 0 && index < length; index += direction) {
    if (isVoidable(index)) {
      voidSelectionIndexSignal.value = index;
      return;
    }
  }
}

/** Enter sobre la lista: abre el modal de confirmación. */
export function selectForVoid(): void {
  const index = voidSelectionIndexSignal.value;
  if (index !== null && isVoidable(index)) {
    voidErrorSignal.value = null;
    voidConfirmingSignal.value = true;
  }
}

/** Click en una fila anulable: lo mismo que ↑/↓ hasta ella + Enter. */
export function activateVoidRow(index: number): void {
  if (!isVoidable(index)) {
    return;
  }
  voidSelectionIndexSignal.value = index;
  selectForVoid();
}

/** Esc en el modal: vuelve a la lista con la misma selección y el mismo filtro. */
export function cancelVoidConfirmation(): void {
  voidConfirmingSignal.value = false;
  voidErrorSignal.value = null;
}

/** Sale de `/ANULAR` a la venta, limpiando el estado. */
export function exitVoidScreen(): void {
  voidCandidatesSignal.value = [];
  voidFilterSignal.value = '';
  voidSelectionIndexSignal.value = null;
  voidConfirmingSignal.value = false;
  voidErrorSignal.value = null;
  voidLoadedSignal.value = false;
  activeScreenSignal.value = 'sale';
}

/** Esc en la lista: con texto en el buscador lo limpia; si no, sale. */
export function escapeVoidScreen(): void {
  if (voidFilterSignal.value !== '') {
    updateVoidFilter('');
    return;
  }
  exitVoidScreen();
}

export function candidateCustomerName(candidate: VoidCandidate): string {
  const customerId = candidate.kind === 'sale' ? candidate.sale.customerId : candidate.payment.customerId;
  return customerId !== undefined ? (getCustomerRepository().getCustomer(customerId)?.name ?? '') : '';
}

function documentName(candidate: VoidCandidate): string {
  return candidate.kind === 'sale' ? saleName(candidate.sale) : receiptName(candidate.payment);
}

/** "¿Anular el Ticket #1?" / "¿Anular el Recibo #1 de Ana?" (#125). */
export function voidQuestion(candidate: VoidCandidate): string {
  const name = candidateCustomerName(candidate);
  const who = candidate.kind === 'collection' && name !== '' ? ` de ${name}` : '';
  return `¿Anular el ${documentName(candidate)}${who}?`;
}

/** En una cobranza con saldo conocido: cómo queda el saldo del cliente después de anularla. */
export function voidBalancePreview(candidate: VoidCandidate): string | undefined {
  if (candidate.kind !== 'collection') {
    return undefined;
  }
  const balance = customerBalancesSignal.value.get(candidate.payment.customerId);
  if (balance === undefined) {
    return undefined;
  }
  const name = candidateCustomerName(candidate);
  const after = Math.round((balance + candidate.payment.total) * 100) / 100;
  return `Saldo ${name !== '' ? `de ${name}` : 'del cliente'}: ${formatBalance(balance)} → ${formatBalance(after)}`;
}

function finish(notice: string): void {
  exitVoidScreen();
  commandBarNoticeSignal.value = notice;
  // Mismo cuidado que `/CAJA`: si se llegó con un click, el overlay quedó cerrado y ocultaba el aviso.
  overlayDismissedSignal.value = false;
}

/** Enter en el modal: anula con un documento propio (#99, #125) y vuelve a la venta con un aviso. */
export async function confirmVoid(): Promise<void> {
  const index = voidSelectionIndexSignal.value;
  const candidate = index !== null ? filteredVoidCandidatesSignal.value[index] : undefined;
  if (candidate?.state !== 'voidable') {
    return;
  }
  let notice: string;
  if (candidate.kind === 'sale') {
    const result = await voidSaleAndPersist(candidate.sale.id);
    if (!result.ok) {
      voidErrorSignal.value = describeError(result);
      return;
    }
    notice = voidNotice(saleName(candidate.sale), saleName(result.value));
  } else {
    const result = await voidCollectionAndPersist(candidate.payment.id);
    if (!result.ok) {
      voidErrorSignal.value = describeError(result);
      return;
    }
    notice = voidNotice(receiptName(candidate.payment), receiptName(result.value.payment));
  }
  await refreshStockSnapshot();
  await refreshCustomerBalances();
  finish(notice);
}

/** "Anulado el Ticket #1 con el Ticket #3" (la anulación siempre tiene número). */
function voidNotice(original: string, voidDocument: string): string {
  return `Anulado el ${original} con el ${voidDocument}`;
}
```

Usar `roundAmount` de `../../domain/rounding.ts` en lugar del `Math.round` a mano en `voidBalancePreview`. Si `Sale`/`CustomerPayment` quedan sin uso en los imports, sacarlos.

- [ ] **Paso 5: tests del controller pasan.** Run: `pnpm test -- void-controller` → PASS.

- [ ] **Paso 6: tests de la pantalla que fallan.** `src/ui/screens/void-screen.test.tsx` adapta los casos de `void-sale-screen.test.tsx` (vacío, Esc, Enter+Enter, click + "Anular (Enter)", "Volver (Esc)", Enter con "Volver (Esc)" enfocado, "Volver a la venta (Esc)", mousedown no roba el foco, marcas) a los textos nuevos y suma:

```typescript
  it('el buscador es el único input, está enfocado y filtra la lista', async () => {
    // una venta de arroz y una cobranza
    render(<VoidScreen />);
    const search = await screen.findByLabelText('Buscar');
    expect(document.activeElement).toBe(search);
    fireEvent.input(search, { target: { value: 'arroz' } });
    expect(screen.getAllByTestId('void-row')).toHaveLength(1);
  });

  it('el modal muestra la pregunta sobre la lista, con los dos botones', async () => {
    render(<VoidScreen />);
    await screen.findAllByTestId('void-row');
    fireEvent.keyDown(screen.getByLabelText('Buscar'), { key: 'Enter' });
    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toContain('¿Anular el Recibo #1');
    expect(screen.getByRole('button', { name: 'Volver (Esc)' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Anular (Enter)' })).not.toBeNull();
    expect(screen.getAllByTestId('void-row').length).toBeGreaterThan(0); // la lista sigue detrás
  });

  it('con el modal abierto, tipear no cambia el buscador', async () => {
    render(<VoidScreen />);
    await screen.findAllByTestId('void-row');
    const search = screen.getByLabelText('Buscar');
    fireEvent.keyDown(search, { key: 'Enter' });
    fireEvent.keyDown(search, { key: 'a' });
    expect((search as HTMLInputElement).value).toBe('');
  });

  it('una cobranza anulada y su anulación se ven con su marca y atenuadas', async () => {
    // cobrar y anular la cobranza antes de montar
    render(<VoidScreen />);
    const rows = await screen.findAllByTestId('void-row');
    expect(rows[0]?.textContent).toContain('Anulación del #1');
    expect(rows[1]?.textContent).toContain('Anulada');
    expect(rows.every((row) => row.style.opacity === '0.5')).toBe(true);
    expect(screen.getByText('No hay ventas ni cobranzas de las últimas 24 horas para anular.')).not.toBeNull();
  });
```

(El último caso fija la regla: con filas pero ninguna anulable, se muestran las filas **y** el mensaje de vacío arriba de la lista. Las siembras usan `closeSaleAndPersist`/`collectAndPersist` como los tests actuales.)

- [ ] **Paso 7: ver fallar.** Run: `pnpm test -- void-screen` → FAIL (no existe).

- [ ] **Paso 8: pantalla.** `src/ui/screens/void-screen.tsx`:

```tsx
import type { TargetedEvent, TargetedKeyboardEvent } from 'preact';
import { useLayoutEffect } from 'preact/hooks';
import type { VoidCandidate } from '../../storage/void-repository.ts';
import { candidateId } from '../../storage/void-repository.ts';
import { CollectionDocumentRow, SaleDocumentRow } from '../components/document-rows.tsx';
import { formatMoney } from '../format.ts';
import { voidOfLabel, voidOfReceiptLabel } from '../format-ticket.ts';
import { useFocusOnMount } from '../hooks/use-focus-on-mount.ts';
import { keepFocusOnMouseDown } from '../hooks/use-mouse-keeps-focus.ts';
import { useScrollSelectedIntoView } from '../hooks/use-scroll-selected-into-view.ts';
import {
  activateVoidRow,
  cancelVoidConfirmation,
  candidateCustomerName,
  confirmVoid,
  escapeVoidScreen,
  exitVoidScreen,
  loadVoidCandidates,
  moveVoidSelection,
  selectForVoid,
  updateVoidFilter,
  voidBalancePreview,
  voidQuestion,
} from '../keyboard/void-controller.ts';
import {
  filteredVoidCandidatesSignal,
  voidCandidatesSignal,
  voidConfirmingSignal,
  voidErrorSignal,
  voidFilterSignal,
  voidLoadedSignal,
  voidSelectionIndexSignal,
} from '../state/void.ts';

/** Marca de una fila sin acción (#99, #125): la original anulada o el documento de una anulación. */
function candidateMark(candidate: VoidCandidate): string | undefined {
  if (candidate.state === 'voided') {
    return 'Anulada';
  }
  if (candidate.state !== 'void-document') {
    return undefined;
  }
  return candidate.kind === 'sale'
    ? voidOfLabel(candidate.sale, candidate.original)
    : voidOfReceiptLabel(candidate.payment, candidate.original);
}

function candidateTotal(candidate: VoidCandidate): number {
  return candidate.kind === 'sale' ? candidate.sale.total : candidate.payment.total;
}

/**
 * `/ANULAR` (#125, con #110 y #58): la lista de Movimientos de `/RESUMEN` con las ventas y las
 * cobranzas de las últimas 24 h y su buscador, que es el único input y nunca pierde el foco. La
 * original anulada y la anulación se ven atenuadas y sin acción. Enter abre un modal chico de
 * confirmación encima de la lista; anular no se puede deshacer. Teclado + mouse: click en una fila
 * anulable = seleccionarla + Enter; cada atajo tiene su botón.
 */
export function VoidScreen() {
  const searchRef = useFocusOnMount<HTMLInputElement>();
  const rowRef = useScrollSelectedIntoView(voidSelectionIndexSignal);

  // Cargar al montar, reseteando antes del primer `await` (lo hace `loadVoidCandidates`).
  useLayoutEffect(() => {
    void loadVoidCandidates();
  }, []);

  const confirming = voidConfirmingSignal.value;

  const handleKeyDown = (event: TargetedKeyboardEvent<HTMLDivElement>) => {
    // Un botón enfocado con Tab se activa solo con Enter (nativo): no duplicar la acción.
    if (event.key === 'Enter' && event.target instanceof HTMLButtonElement) {
      return;
    }
    if (voidConfirmingSignal.value) {
      if (event.key === 'Enter') {
        event.preventDefault();
        void confirmVoid();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        cancelVoidConfirmation();
      } else if (event.key !== 'Tab') {
        // Con el modal abierto, el buscador no recibe texto.
        event.preventDefault();
      }
      return;
    }
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      moveVoidSelection(event.key === 'ArrowUp' ? -1 : 1);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      selectForVoid();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      escapeVoidScreen();
    }
  };

  const handleInput = (event: TargetedEvent<HTMLInputElement>) => {
    updateVoidFilter(event.currentTarget.value);
  };

  const candidates = filteredVoidCandidatesSignal.value;
  const selectedIndex = voidSelectionIndexSignal.value;
  const selected = selectedIndex !== null ? candidates[selectedIndex] : undefined;
  const hasVoidable = voidCandidatesSignal.value.some((c) => c.state === 'voidable');
  const preview = selected !== undefined ? voidBalancePreview(selected) : undefined;

  return (
    <div
      onKeyDown={handleKeyDown}
      onMouseDown={keepFocusOnMouseDown}
      style={{
        height: 'var(--app-height)',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        background: 'var(--color-bg)',
        color: 'var(--color-text)',
        fontFamily: 'var(--font-sans)',
      }}
    >
      <div style={{ background: 'var(--color-chrome-bg)', color: 'var(--color-chrome-text)' }}>
        <div
          style={{
            padding: 'var(--space-3) var(--space-4) var(--space-2)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <h1 style={{ margin: 0, fontSize: 'var(--font-size-lg)' }}>Anular</h1>
          <button
            type="button"
            onClick={exitVoidScreen}
            style={{
              background: 'transparent',
              color: 'var(--color-chrome-text-muted)',
              border: 'none',
              cursor: 'pointer',
              fontSize: 'var(--font-size-sm)',
            }}
          >
            Volver a la venta (Esc)
          </button>
        </div>
        <div style={{ padding: '0 var(--space-4) var(--space-3)' }}>
          <input
            ref={searchRef}
            type="text"
            aria-label="Buscar"
            placeholder="Buscar ticket (#12), recibo, cliente o producto"
            value={voidFilterSignal.value}
            onInput={handleInput}
            style={{
              width: '100%',
              background: 'var(--color-chrome-surface)',
              color: 'var(--color-chrome-text)',
              border: '1px solid var(--color-chrome-border)',
              borderRadius: 'var(--radius-md)',
              padding: 'var(--space-1) var(--space-2)',
            }}
          />
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {voidLoadedSignal.value && !hasVoidable && (
          <p style={{ padding: 'var(--space-3)', color: 'var(--color-text-muted)', margin: 0 }}>
            No hay ventas ni cobranzas de las últimas 24 horas para anular.
          </p>
        )}
        {voidLoadedSignal.value && hasVoidable && candidates.length === 0 && (
          <p style={{ padding: 'var(--space-3)', color: 'var(--color-text-muted)', margin: 0 }}>
            Ningún documento coincide con la búsqueda.
          </p>
        )}
        {candidates.map((candidate, index) => {
          const common = {
            index,
            query: voidFilterSignal.value,
            selected: index === selectedIndex,
            dimmed: candidate.state !== 'voidable',
            mark: candidateMark(candidate),
            rowRef: rowRef(index),
            onClick: () => {
              activateVoidRow(index);
              searchRef.current?.focus();
            },
            testId: 'void-row',
          };
          return candidate.kind === 'sale' ? (
            <SaleDocumentRow key={candidateId(candidate)} sale={candidate.sale} {...common} />
          ) : (
            <CollectionDocumentRow
              key={candidateId(candidate)}
              payment={candidate.payment}
              customerName={candidateCustomerName(candidate)}
              {...common}
            />
          );
        })}
      </div>

      {confirming && selected !== undefined && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.35)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Confirmar anulación"
            style={{
              background: 'var(--color-bg)',
              borderRadius: 'var(--radius-md)',
              boxShadow: 'var(--shadow-card)',
              padding: 'var(--space-4)',
              width: 'min(420px, 90%)',
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-2)',
            }}
          >
            <p style={{ margin: 0, fontWeight: 600 }}>{voidQuestion(selected)}</p>
            <p style={{ margin: 0, fontFamily: 'var(--font-mono)' }}>
              Total {formatMoney(candidateTotal(selected))}
            </p>
            {preview !== undefined && <p style={{ margin: 0 }}>{preview}</p>}
            <div style={{ minHeight: 'var(--space-6)' }}>
              {voidErrorSignal.value !== null && (
                <p role="alert" style={{ margin: 0, color: 'var(--color-danger)' }}>
                  {voidErrorSignal.value}
                </p>
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)' }}>
              <button type="button" class="btn" onClick={cancelVoidConfirmation}>
                Volver (Esc)
              </button>
              <button type="button" class="btn btn-danger" onClick={() => void confirmVoid()}>
                Anular (Enter)
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

Notas: `useScrollSelectedIntoView` recibe `Signal<number | null>`, que es el tipo de `voidSelectionIndexSignal`; `rowRef` de las filas es `(el: HTMLDivElement | null) => void` y el del hook `(el: HTMLElement | null) => void` — compatible. Si `--space-6` no existe en `tokens.css`, usar el que exista más cercano (`rg -n "space-" src/ui/tokens.css`).

- [ ] **Paso 9: cableado.** `src/ui/app.tsx`: `import { VoidScreen } from './screens/void-screen.tsx';` y `case 'void': return <VoidScreen />;`. `commands.ts:49`: `description: 'Anular una venta o una cobranza de las últimas 24 h'`. Comentarios que nombran `VoidSaleScreen`/`void-sale.ts` (`use-focus-on-mount.ts:11`, `state/demo-reset.ts:3`) pasan a `VoidScreen`/`void.ts`. Borrar `void-sale-screen.tsx`, su test y `state/void-sale.ts`. Verificar que no quede nada: `rg -n "void-sale-screen|state/void-sale|VoidSaleScreen|voidableSalesSignal|loadVoidableSales" src` → vacío (el e2e se adapta en la Tarea 8).

- [ ] **Paso 10: verificar.** Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm build` → PASS.

- [ ] **Paso 11: commit.**

```bash
git add -A src/ui
git commit -m "feat(anular): /ANULAR como /RESUMEN, con cobranzas, buscador, modal y aviso (#125, #110, #58)"
```

---

### Tarea 8: E2E

**Archivos:**
- Modificar: `e2e/void-sale.spec.ts`, `e2e/keyboard-only.spec.ts:34,140`, `e2e/sale-stage-4.spec.ts:108-111`

**Interfaces:** Consume la UI de la Tarea 7: heading "Anular", filas `data-testid="void-row"`, `role="dialog"` con "¿Anular el Ticket #1?", botones "Volver (Esc)" / "Anular (Enter)", aviso "Anulado el …" en el slot de la barra.

- [ ] **Paso 1: adaptar los specs existentes.**
  - `heading { name: 'Anular venta' }` → `{ name: 'Anular' }` en los tres archivos.
  - `page.getByRole('listitem')` (en `/ANULAR`) → `page.getByTestId('void-row')` (`.first()` donde corresponda).
  - `'¿Anular esta venta? Enter confirma, Esc cancela.'` → `page.getByRole('dialog')` con `toContainText('¿Anular el Ticket #1?')` (en `sale-stage-4.spec.ts`, el número que corresponda a su escenario — leer el spec antes de cambiarlo).
  - En `void-sale.spec.ts`, después de confirmar: `await expect(page.getByText('Anulado el Ticket #1 con el Ticket #2')).toBeVisible();` y el vacío final: `'No hay ventas ni cobranzas de las últimas 24 horas para anular.'`.

- [ ] **Paso 2: test nuevo de cobranza** en `e2e/void-sale.spec.ts`, con el `beforeEach` de `collection.spec.ts` (config activa con `locale: 'es-AR'`, offline después de cargar) en su propio `test.describe`:

```typescript
test.describe('anular una cobranza (#125)', () => {
  test.beforeEach(async ({ page, context }) => {
    await page.addInitScript(
      ({ key, config }) => {
        localStorage.setItem(key, JSON.stringify(config));
      },
      { key: CONFIG_STORAGE_KEY, config: { ...ACTIVE_CONFIG, locale: 'es-AR' } },
    );
    await page.goto('/');
    await expect(page.getByLabel('Barra de comandos')).toBeVisible();
    await context.setOffline(true);
  });

  test('cobrar, anular desde /ANULAR con el buscador y ver el saldo y /RESUMEN', async ({ page }) => {
    const commandBar = page.getByLabel('Barra de comandos');
    const balanceRow = page.getByTestId('customer-balance');

    await commandBar.fill('@Ana Gómez');
    await expect(page.getByText('Crear cliente', { exact: false })).toBeVisible();
    await commandBar.press('Enter');
    await commandBar.press('Enter');
    await page.getByLabel('Efectivo').fill('500');
    await page.keyboard.press('Control+Enter');
    await expect(page.getByRole('heading', { name: 'Recibo de cobranza' })).toBeVisible();
    await page.keyboard.press('Escape');

    await commandBar.fill('@Ana Gómez');
    await commandBar.press('Enter');
    await expect(balanceRow).toHaveText('Saldo: A favor $500,00');

    await commandBar.fill('/anular');
    await commandBar.press('Enter');
    await expect(page.getByRole('heading', { name: 'Anular' })).toBeVisible();
    await page.keyboard.type('ana');
    await expect(page.getByTestId('void-row')).toHaveCount(1);
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('¿Anular el Recibo #1 de Ana Gómez?');
    await expect(dialog).toContainText('A favor $500,00 → Sin saldo');
    await page.keyboard.press('Enter');

    await expect(page.getByText('Anulado el Recibo #1 con el Recibo #2')).toBeVisible();
    await expect(balanceRow).toHaveText('Saldo: Sin saldo');

    const payments = await getAllFromStore<{ id: string; total: number; voidsPaymentId?: string }>(
      page,
      'customerPayments',
    );
    const original = payments.find((p) => p.voidsPaymentId === undefined);
    expect(payments.find((p) => p.voidsPaymentId === original?.id)?.total).toBe(-500);

    await commandBar.fill('/anular');
    await commandBar.press('Enter');
    await expect(page.getByText('No hay ventas ni cobranzas de las últimas 24 horas para anular.')).toBeVisible();
    const rows = page.getByTestId('void-row');
    await expect(rows.nth(0)).toContainText('Anulación del #1');
    await expect(rows.nth(1)).toContainText('Anulada');
    await page.keyboard.press('Escape');

    await commandBar.fill('/resumen');
    await commandBar.press('Enter');
    await expect(page.getByText('(2 recibos, 1 anulados)')).toBeVisible();
  });
});
```

(Importar `ACTIVE_CONFIG`, `CONFIG_STORAGE_KEY` de `./fixtures.ts`. Si al llegar a la venta después de "Recibo de cobranza" el cliente ya no está adjunto — lo está desadjuntado por diseño — el `@Ana Gómez` + Enter lo vuelve a adjuntar desde la lista; si la lista ofrece "Crear cliente" en vez de la existente, elegir la fila con ↓ antes de Enter, como hace `collection.spec.ts` si ya tiene ese paso.)

- [ ] **Paso 3: correr.** Run: `pnpm build && pnpm test:e2e` → PASS. Si falla, `superpowers:systematic-debugging` antes de tocar nada.

- [ ] **Paso 4: commit.**

```bash
git add e2e
git commit -m "test(e2e): anular una cobranza desde /ANULAR y textos nuevos de la pantalla (#125)"
```

---

### Tarea 9: Demo-backend 4.3.0 y panel

**Archivos:**
- Modificar: `demo-backend/src/settings.ts:7`, `demo-backend/src/routes/panel.ts`, `demo-backend/src/panel.html:44,52,149,151`
- Test: `demo-backend/test/routes/sync.test.ts`, `demo-backend/test/routes/panel.test.ts`, `demo-backend/test/routes/info.test.ts` (si fija `'4.2.0'`)

**Interfaces:** Produce en `/_demo/api/sales` y `/_demo/api/customer-payments`: `voids?: string` ("#1 · 28/09" o el id de la original), `voidedBy?: string` ("#2 · 28/09" o el id de la anulación); en cobranzas además `customerName?: string`.

- [ ] **Paso 1: tests que fallan.**

`test/routes/sync.test.ts`, dentro de `describe('saldo de cualquier cliente y recibo (4.2.0, #101)'`:

```typescript
  it('la anulación de una cobranza devuelve el saldo (4.3.0, #125)', async () => {
    seedCustomer('c-1');
    const voidOf = {
      type: 'customer-payment',
      id: 'cp2',
      payment: {
        id: 'cp2',
        customerId: 'c-1',
        payments: [{ method: 'cash', amount: -300 }],
        total: -300,
        createdAt: '2026-09-27T11:00:00.000Z',
        receipt: { date: '2026-09-27', number: 4 },
        voidsPaymentId: 'cp1',
      },
    };

    await push('lot-1', [collection('cp1', 'c-1', 300)]);
    await push('lot-2', [voidOf]);

    expect((await pulledCustomer('c-1'))?.balance).toBe(0);
  });
```

`test/routes/panel.test.ts`, en `describe('cobranzas y saldos en el panel (#101)'`:

```typescript
  it('cobranzas y ventas muestran qué anulan y quién las anula, por número (#125)', async () => {
    db.prepare('INSERT INTO customers (id, payload, source, updated_at) VALUES (?, ?, ?, ?)').run(
      'c-1',
      JSON.stringify({ id: 'c-1', name: 'Ana' }),
      'seed',
      '2026-01-01T00:00:00.000Z',
    );
    await pushLot('l1', [
      {
        type: 'customer-payment',
        id: 'cp1',
        payment: { id: 'cp1', customerId: 'c-1', payments: [{ method: 'cash', amount: 300 }], total: 300, createdAt: '2026-09-28T10:00:00.000Z', receipt: { date: '2026-09-28', number: 1 } },
      },
      {
        type: 'customer-payment',
        id: 'cp2',
        payment: { id: 'cp2', customerId: 'c-1', payments: [{ method: 'cash', amount: -300 }], total: -300, createdAt: '2026-09-28T11:00:00.000Z', receipt: { date: '2026-09-28', number: 2 }, voidsPaymentId: 'cp1' },
      },
      { type: 'sale', id: 's1', sale: { id: 's1', total: 100, ticket: { date: '2026-09-28', number: 1 } } },
      { type: 'sale', id: 's2', sale: { id: 's2', total: -100, voidsSaleId: 's1', ticket: { date: '2026-09-28', number: 2 } } },
      { type: 'sale', id: 's3', sale: { id: 's3', total: -5, voidsSaleId: 'no-esta' } },
    ]);

    const payments = await getJson('/_demo/api/customer-payments');
    expect(payments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'cp1', customerName: 'Ana', voidedBy: '#2 · 28/09' }),
        expect.objectContaining({ id: 'cp2', customerName: 'Ana', voids: '#1 · 28/09' }),
      ]),
    );
    expect(await getJson('/_demo/api/sales')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 's1', voidedBy: '#2 · 28/09' }),
        expect.objectContaining({ id: 's2', voids: '#1 · 28/09' }),
        expect.objectContaining({ id: 's3', voids: 'no-esta' }),
      ]),
    );
  });
```

(`pushLot` y `getJson` son los helpers que ya usa el archivo; si `pushLot` exige `createdAt`/`origin` en el sobre, copiarlos del test "lista ventas, movimientos de caja y cobranzas con su identidad".) Si `info.test.ts` o algún otro fija `'4.2.0'` como versión del backend, pasarlo a `'4.3.0'`.

- [ ] **Paso 2: ver fallar.** Run: `pnpm --dir demo-backend test` → FAIL.

- [ ] **Paso 3: implementar.** `settings.ts`: `export const CONTRACT_VERSION = '4.3.0';`. En `routes/panel.ts`, después de `listWithIdentity`:

```typescript
type Numbered = { id: string; ticket?: { date: string; number: number }; receipt?: { date: string; number: number } };

/** "#12 · 28/09" para el panel; sin número, el id (#125). */
function documentNumber(document: Numbered | undefined, fallbackId: string): string {
  const number = document?.ticket ?? document?.receipt;
  if (number === undefined) {
    return fallbackId;
  }
  return `#${String(number.number)} · ${number.date.slice(8, 10)}/${number.date.slice(5, 7)}`;
}

/**
 * Suma a cada documento qué anula (`voids`) y quién lo anula (`voidedBy`), por número (#125):
 * se cruza dentro del mismo listado por `voidsSaleId` / `voidsPaymentId`.
 */
function withVoidLabels(
  items: Record<string, unknown>[],
  refKey: 'voidsSaleId' | 'voidsPaymentId',
): Record<string, unknown>[] {
  const byId = new Map(items.map((item) => [item.id as string, item as Numbered]));
  const voidedBy = new Map<string, Numbered>();
  for (const item of items) {
    const ref = item[refKey];
    if (typeof ref === 'string') {
      voidedBy.set(ref, item as Numbered);
    }
  }
  return items.map((item) => {
    const ref = item[refKey];
    const voider = voidedBy.get(item.id as string);
    return {
      ...item,
      ...(typeof ref === 'string' ? { voids: documentNumber(byId.get(ref), ref) } : {}),
      ...(voider !== undefined ? { voidedBy: documentNumber(voider, voider.id) } : {}),
    };
  });
}
```

`listWithIdentity` pasa a devolver `Record<string, unknown>[]` (su `map` ya arma objetos). Las rutas quedan:

```typescript
      sendJson(res, 200, withVoidLabels(listWithIdentity(ctx.db, 'sales'), 'voidsSaleId'));
```

```typescript
      const names = new Map(
        (ctx.db.prepare('SELECT id, payload FROM customers').all() as { id: string; payload: string }[]).map(
          (row) => [row.id, (JSON.parse(row.payload) as { name?: string }).name ?? ''],
        ),
      );
      sendJson(
        res,
        200,
        withVoidLabels(listWithIdentity(ctx.db, 'customer_payments'), 'voidsPaymentId').map((item) => ({
          ...item,
          customerName: names.get(item.customerId as string) ?? '',
        })),
      );
```

`panel.html`: encabezado de Ventas `<th>anula a</th><th>anulada por</th>` (en lugar de solo "anula a"), y la fila `<td>${s.voids ?? ''}</td><td>${s.voidedBy ?? ''}</td>` en lugar de `<td>${s.voidsSaleId ?? ''}</td>`. Cobranzas: encabezado `<th>id</th><th>recibo</th><th>cliente</th><th>total</th><th>anula a</th><th>anulada por</th>…` y fila con `<td>${escapeHtml(p.customerName || p.customerId)}</td>…<td>${p.voids ?? ''}</td><td>${p.voidedBy ?? ''}</td>`.

- [ ] **Paso 4: verificar.** Run: `pnpm --dir demo-backend test && pnpm --dir demo-backend typecheck` → PASS. Y `pnpm test:e2e` del spec del minibackend si existe (`e2e/minibackend-sync.spec.ts`): `pnpm test:e2e -- minibackend-sync` → PASS (un POS 4.3 contra el demo-backend 4.3).

- [ ] **Paso 5: commit.**

```bash
git add demo-backend
git commit -m "feat(demo-backend): contrato 4.3.0 y anulaciones en el panel por número (#125)"
```

---

### Tarea 10: Documentación, #127 y cierre de la spec

**Archivos:**
- Modificar: `AGENTS.md`, `src/sync/AGENTS.md`, `src/domain/AGENTS.md`, `src/storage/AGENTS.md`, `src/ui/AGENTS.md`, `e2e/AGENTS.md` (si nombra `/ANULAR`), `docs/superpowers/specs/2026-09-28-anular-cobranzas-design.md`, `demo-backend/README.md` (si lista columnas del panel), `src/connectors/google-sheets/README.md` (solo si dice que el POS habla 4.2)

- [ ] **Paso 1: `AGENTS.md` (raíz).**
  - "Connector API": "**versión 4.3.0** desde #125 (spec `docs/superpowers/specs/2026-09-28-anular-cobranzas-design.md`); la 4.2.0 es de la Etapa 6…"; "(v3, 4.0.0, 4.1.0, 4.2.0, 4.3.0)"; en Sheets, "congelado en 4.2.0 … con un POS posterior la terminal lo ve incompatible" (ya lo dice) y "el camino para retomarlo es #138".
  - Tabla de comandos: `/ANULAR` → "Anula un ticket o una cobranza de las últimas 24 h con otro documento".
  - "Cobranza sin venta…": borrar "**Fuera de alcance**: anular o corregir una cobranza desde el POS (#125)…"; en su lugar: "Una cobranza se anula desde `/ANULAR` con otra cobranza negativa (#125): detalle en `src/domain/AGENTS.md` y `src/ui/AGENTS.md`."
  - Tabla del índice: fila "Venta … anulación" suma "y de cobranzas".
  - Estado del proyecto: fila "Epic #134" → "#124, #125: `/RESUMEN` más nuevo primero, anular cobranzas (4.3.0) y `/ANULAR` como `/RESUMEN`" con "PR #136, PR #N" (N se completa al abrir el PR); issues abiertas: sacar #125, #110 y #58; sumar #137 en Anulación y #138 en Conectores.

- [ ] **Paso 2: `src/sync/AGENTS.md`**, arriba de "Contrato 4.2.0":

```markdown
**Contrato 4.3.0 (#125)** — aditivo: `CustomerPayment.voidsPaymentId?`, la anulación de una
cobranza como otra cobranza negativa (mismos medios, total invertido, su propio recibo). Viaja como un
`customer-payment` más: la reaplicación (`-total`) y la limpieza ya la cubren. Un POS 4.3.0 ve
incompatible a un backend 4.2 ("se necesita 4.3 o posterior"). El minibackend la acompaña (su saldo
ya se mueve por `-total`; el panel muestra qué anula cada documento). Sheets (congelado, #127; camino
para retomarlo: #138) y el mini-erp (desarrollo separado) quedan en 4.2.
```

- [ ] **Paso 3: `src/domain/AGENTS.md`**, al final de "Venta: … anulación": "**Anulación de una cobranza** (#125): `domain/customer-payment.ts::buildVoidCustomerPayment`, espejo de `buildVoidSale` — medios y total invertidos, `voidsPaymentId`, misma ventana de 24 h, no se anula dos veces (`customer-payment/already-voided`) ni una anulación (`customer-payment/cannot-void-a-void`); consume número de recibo. `/ANULAR` (`storage/void-repository.ts::listVoidCandidates`) lista ventas y cobranzas de las últimas 24 h sin tope." — y corregir la frase actual "los últimos 20 tickets de 24 h" a lo mismo.

- [ ] **Paso 4: `src/storage/AGENTS.md`**, en "Cobranza: persistencia": "La anulación (`voidCollectionAndPersist`, #125) usa la misma transacción (`persistCollectionDocument`) con la cobranza negativa; índice `voidsPaymentId` en Dexie v9." y en la lista de arriba: "`void-repository.ts` (candidatos de `/ANULAR`): `src/ui/AGENTS.md`".

- [ ] **Paso 5: `src/ui/AGENTS.md`.** Sección nueva "## `/ANULAR` (#125, con #110 y #58)" con: layout de Movimientos de `/RESUMEN` y filas compartidas (`ui/components/document-rows.tsx`, buscador en `ui/document-search.ts`); ventas y cobranzas de 24 h sin tope, lo más nuevo primero; filas sin acción atenuadas y salteadas; el buscador es el único input (Esc lo limpia o sale); modal chico con la pregunta, el total y, en una cobranza, el saldo antes → después; con el modal abierto el buscador no recibe texto; al anular, aviso en el slot ("Anulado el Recibo #1 con el Recibo #2"); selección por índice que saltea con `useScrollSelectedIntoView` (no `useTicketListNavigation`, que elige por geometría y no puede saltear). En "`/RESUMEN`" de cobranzas: "una anulada dice '· Anulada' y su anulación '· Anulación del #1'; el panel, '(N recibos, M anulados)'". En "Teclado y mouse: dónde se aplica", `/ANULAR` pasa a "(filas clickeables = seleccionar + Enter, botones del modal)". En "Patrones de UI": "**Filas de documentos compartidas** entre `/RESUMEN` y `/ANULAR`: una sola forma de dibujar un ticket o un recibo".

- [ ] **Paso 6: spec.** `Estado: implementado (plan docs/superpowers/plans/2026-09-28-anular-cobranzas.md; desvíos al final).`; en §4 "Foco y teclas", reemplazar "con el hook de lista de `/RESUMEN` (`useTicketListNavigation`), que ya hace el scroll de una fila de varias líneas" por "con selección por índice que saltea y `useScrollSelectedIntoView`"; y al final una sección "## Desvíos de la implementación" con ese cambio, que la limpieza a 7 días no suma test (no depende del signo: borra por edad y por evento) y los que hayan aparecido al ejecutar.

- [ ] **Paso 7: #127.** Comentario (no se edita el cuerpo):

```bash
gh issue comment 127 --body "Contrato 4.3.0 (#125): \`CustomerPayment.voidsPaymentId\` — la anulación de una cobranza es otra cobranza con los mismos medios en negativo, \`total\` negativo y su propio recibo. Para retomar Sheets en 4.3 habría que aceptar cobranzas negativas con \`voidsPaymentId\` (filas en Cobranzas y el total en CuentaCorriente con su signo). El camino decidido para retomarlo es #138 (conector en el POS, API del puente especificada); el puente es responsabilidad de su propio proyecto."
```

- [ ] **Paso 8: verificar.** Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm build` → PASS (Prettier formatea también los `.md`).

- [ ] **Paso 9: commit.**

```bash
git add AGENTS.md src docs demo-backend e2e
git commit -m "docs: anular cobranzas, contrato 4.3.0 y /ANULAR como /RESUMEN (#125)"
```

---

## Cierre (no es una tarea de código)

Informe final más prueba manual paso a paso (convención del repo). El PR se abre **solo cuando el
usuario lo apruebe**, con "Closes #125", "Closes #110" y "Closes #58", y se mergea con merge commit.
