# CLAUDE.md

Guía de convenciones para trabajar en este repo. El diseño completo vive en
[`pos-web-diseno-arquitectura.md`](./pos-web-diseno-arquitectura.md) — este archivo es un resumen
operativo para no tener que releerlo entero en cada sesión; ante cualquier duda o contradicción,
el documento de diseño manda.

## Qué es esto

POS web offline-first para retail: kiosco/tienda, instalable como PWA, 100% operable con teclado
(sin mouse/touch en ningún flujo), que se integra con cualquier backend externo (ERP, e-commerce,
facturación) vía un contrato de API propio versionado — el POS no conoce ningún backend específico.

Fuera de alcance por ahora: facturación fiscal de un país específico, multi-tenant/SaaS, pasarelas
de pago y cobranzas con medios múltiples (eso es v2 — hoy el pago es solo `medio + monto`).

## Stack

| Capa | Elección |
|---|---|
| UI | Preact + `@preact/signals` |
| Server-state / cache | TanStack Query + persister a IndexedDB |
| Almacenamiento local | Dexie.js (sobre IndexedDB) |
| PWA / service worker | Vite + `vite-plugin-pwa` (Workbox) |
| Búsqueda local | FlexSearch o Fuse.js |
| Validación de contrato | Zod |
| Impresión / hardware | Web Serial / WebUSB (Chromium) |
| Testing | Vitest + Testing Library (preact) + Playwright |

Navegador de referencia: Chromium (Chrome/Edge). En Firefox/Safari la app sigue andando pero sin
Web Serial/WebUSB (sin impresión/cajón).

## Estructura de proyecto

```
src/
  domain/          # entidades y lógica de negocio pura (Sale, Product, etc.)
  storage/         # Dexie schema, outbox, persister de TanStack Query
  sync/            # motor de sincronización, adaptador del Connector API
  connectors/      # implementaciones de referencia (ej. REST genérico)
  ui/
    screens/       # Venta, Cobro, Caja, Historial
    components/    # inputs, tablas, paleta de comandos
    keyboard/      # gestor de foco, atajos, detección de scanner
  workers/         # service worker, background sync
```

`domain/` no importa nada de `ui/`, `storage/` ni `sync/` — es lógica pura, testeable sin DOM ni
IndexedDB. Los adaptadores (Dexie, fetch, service worker) viven en sus propias carpetas y son los
únicos lugares donde se permite `try/catch` real (ver más abajo).

## TypeScript estricto

- `any` prohibido sin excepción (`no-explicit-any` en modo error de lint).
- `unknown` solo puede aparecer en la firma de una función que recibe algo externo **y lo valida
  con Zod en la línea siguiente** — nunca se propaga `unknown` hacia el dominio.
- Toda función de negocio devuelve `Result<T>`, nunca lanza.

## Manejo de errores: `Result<T>`, nunca excepciones en el dominio

Regla general: **las funciones de negocio nunca lanzan**. Dos clases de error:

- **Error de negocio anticipado** (stock insuficiente, hold rechazado, payload de un conector mal
  formado, cualquier dato externo con forma incierta) → siempre `Result<T>`, nunca excepción.
- **Todo lo demás** (invariante rota, bug) → se deja explotar como excepción real hasta un único
  manejador global (error boundary de Preact + `window.onerror` / `unhandledrejection`). Por ahora
  ese manejador siempre muestra una pantalla bloqueante, sin retry silencioso.

`try/catch` queda limitado a los adaptadores que envuelven algo que sí lanza por naturaleza (fetch,
Dexie, `JSON.parse`) y lo convierten a `Result` en el borde — nunca como manejo de flujo de negocio.

Forma del `Result` casero — error como código string con metadata tipada por código, en un solo
registro central (`ErrorMeta`) para mantener exhaustividad en los `switch` de la UI:

```typescript
type ErrorMeta = {
  'sale/insufficient-stock': { productId: string; requested: number; available: number };
  'sale/no-line-to-reduce': undefined;
  'account/hold-rejected': { reasonCode: string };
  'account/offline-limit-exceeded': { missing: number };
  'sync/invalid-payload': { issues: { path: string; message: string }[] };
  // se va extendiendo acá, un solo registro central
};

type ErrorCode = keyof ErrorMeta;
type Failure = { [C in ErrorCode]: { ok: false; error: C; meta: ErrorMeta[C] } }[ErrorCode];
type Result<T> = { ok: true; value: T } | Failure;
```

Si un `ErrorCode` no necesita datos extra, `meta` es `undefined` sin costo. Si un código deja de
usarse, se saca. `neverthrow` es la alternativa a considerar solo si el encadenamiento manual de
`Result`s se vuelve incómodo — por ahora se prefiere el casero (sin dependencia extra, dominio chico).

## Modelo de dominio

IDs generados en el cliente (`Sale`, `CashSession`, `StockMovement`, `AccountHold`) son **ULID**,
siempre — así una venta existe y es identificable aunque nunca haya habido red.

Entidades: `Product`, `StockItem`, `Sale`/`SaleLine`, `Payment`, `CashSession`, `StockMovement`,
`Customer` (pura identificación), `CustomerAccount` (crédito, módulo aparte y opcional — un
`Customer` puede no tener una asociada), `AccountHold`, `AccountMovement`. Detalle completo de
campos en §4 del documento de diseño.

Dos categorías de dato, porque cambian la estrategia de sync:

- **Eventos, sin conflicto posible** (`Sale`, `Payment`, `StockMovement`, `AccountMovement`):
  siempre seguros de crear offline vía outbox.
- **Recursos con límite, conflicto posible** (`StockItem.quantity`, `CustomerAccount.balance`):
  offline es operar sobre una foto que puede estar desactualizada. Se resuelven con margen
  configurable (mismo patrón para stock multi-terminal y para cuenta corriente).

## Patrón outbox (offline-first)

Toda mutación relevante se escribe **primero** en una tabla local `outbox`
(`type`, `payload`, `status`, `retries`, `createdAt`), en la misma transacción que el registro de
negocio. La venta/cierre/movimiento ya está cerrado y operativo localmente sin importar el
resultado del sync. El proceso de sync:

- Recorre `outbox` en orden, `POST` al conector con `Idempotency-Key` = ULID de la entidad.
- Confirmado → `synced`. Falla (sin red / 5xx) → backoff exponencial, sigue `pending`.
- Nunca bloquea la UI: sincronizar es efecto secundario, no condición para operar.

El catálogo es al revés (pull, por delta con `since`/cursor, cacheado vía TanStack Query +
persister a IndexedDB). Las ventas son append-only (sin conflicto real); el catálogo/precios sí
cambian del lado externo — ahí el cliente siempre es lector, el sistema externo manda.

Cuenta corriente es el único flujo que a propósito puede requerir red síncrona (hold contra saldo
real); sin red, se evalúa `balance` cacheado + `creditLimit` + `margin` configurado. Detalle en §5.

## Connector API

El POS no tiene lógica de ningún backend particular, solo del contrato (REST/JSON versionado,
documentado como OpenAPI — recursos en §6 del diseño: `/products`, `/stock`, `/sales`,
`/stock-movements`, `/cash-sessions`, `/customers`, `/account-holds`). Todo `POST` de eventos de
negocio es idempotente vía `Idempotency-Key`. Autenticación (Bearer/API key) se configura por
terminal, desacoplada del contrato. Un integrador nuevo implementa el contrato — nunca se toca
código del POS para sumar un backend (RNF-06).

## UX keyboard-first

Principio central: **un único input siempre enfocado** (la barra de comandos) — se elimina el
problema de foco competido en vez de gestionarlo. Nunca agregar un segundo elemento que pueda robar
foco durante la operación normal.

Prioridad de interpretación de la barra de comandos (orden fijo, ver §7 del diseño para el detalle
completo de cada regla y los casos de ambigüedad cantidad-vs-código-de-barras):

1. `/` → modo comando (lista completa de comandos con solo `/`).
2. `@` → búsqueda/alta de cliente.
3. `cualquier cosa$monto` → línea libre de venta.
4. `<n>*` o `-<n>*` de prefijo → cantidad antes de cualquier búsqueda.
5. Todo dígitos → código de barras o SKU.
6. Cualquier otro texto → búsqueda difusa por nombre.

`Ctrl+Enter` = `/COBRAR` desde cualquier estado. Con la barra vacía, `↑/↓` navegan el carrito; con
texto, navegan resultados. Errores de parseo van en un slot de altura fija reservado (nunca corren
el layout) y seleccionan todo el input (`.select()`) para reemplazar sin retipear.

Barra de estado (extremo opuesto, nunca interactiva): `offline` / `online-idle` / `syncing` /
`sync-error`, combinando `navigator.onLine`, conteo de `outbox` y estado del motor de sync.

Otros principios no negociables: todo alcanzable en ≤2 pasos sin mouse (RNF-04), foco siempre
visible (nunca depender de `:hover`), locale configurable por terminal para `Intl.NumberFormat`.

## Testing

Vitest + Testing Library para unit/componentes; Playwright para el flujo end-to-end, en particular
para simular offline real (`context.setOffline(true)`) — cualquier feature del flujo de venta debe
poder probarse sin red.

## Estado del proyecto

Repo en Fase 0 (scaffolding) según el roadmap del documento de diseño (§11). Antes de armar
estructura o herramental nuevo, confirmar en qué fase está el trabajo actual — no adelantar
features de una fase posterior (ej. no implementar sync antes de tener el MVP de venta offline).
