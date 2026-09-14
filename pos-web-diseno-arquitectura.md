# POS Web offline-first — Diseño y plan de desarrollo

## 1. Visión y alcance

Un punto de venta web para retail (kiosco, tienda), instalable como PWA, que:

- **Funciona 100% offline** para el flujo de venta completo (buscar producto, armar carrito, cobrar, emitir comprobante). La red es un lujo, no un requisito.
- **No depende del mouse ni del touch en ningún flujo operativo.** Todo se resuelve con teclado: navegación, búsqueda, cobro, atajos.
- **Se integra con cualquier sistema externo** (ERP, e-commerce, sistema de facturación, inventario centralizado) a través de un contrato de API documentado y versionado — el POS no asume qué hay del otro lado, solo que implementa el contrato.

No está en el alcance de este documento: facturación fiscal específica de un país, ni multi-tenant/SaaS. **Integración con pasarelas de pago y registro de cobranzas con múltiples medios queda para v2** — por ahora el pago se modela como un registro simple (medio + monto), sin conexión a ningún procesador.

## 2. Requisitos funcionales

### Venta (flujo core)
- RF-01: Buscar producto por nombre, SKU o código de barras, con resultados instantáneos desde el catálogo local.
- RF-02: Agregar, quitar y modificar cantidad de líneas del carrito sin usar el mouse.
- RF-03: Aplicar descuentos por línea o por total (monto o porcentaje).
- RF-04: Registrar uno o más medios de pago por venta (efectivo, tarjeta, otro), incluyendo pagos combinados.
- RF-05: Cerrar una venta y generar un comprobante (impreso o descargable) sin conexión a internet.
- RF-06: Anular o devolver una venta ya cerrada (dentro de la sesión de caja).

### Catálogo e inventario
- RF-07: El catálogo completo (productos, precios, stock) debe estar disponible localmente y usable sin red.
- RF-08: Reflejar ajustes de stock por cada venta en el almacén local, y sincronizarlos cuando haya red.
- RF-09: Soportar múltiples códigos de barra por producto.

### Caja y turnos
- RF-10: Apertura y cierre de caja (turno), con conteo de efectivo y arqueo.
- RF-11: Historial de ventas del turno, navegable por teclado.

### Sincronización e integración
- RF-12: Sincronizar catálogo y precios desde el sistema externo (pull) de forma periódica y bajo demanda.
- RF-13: Enviar ventas, movimientos de stock y cierres de caja al sistema externo (push) de forma asíncrona, con reintentos.
- RF-14: Ninguna venta debe perderse ni duplicarse aunque falle la red a mitad de la sincronización (idempotencia).
- RF-15: El sistema externo se configura mediante una URL base + credenciales; el POS no tiene lógica específica de ningún backend particular, solo del contrato.

### Clientes y cuenta corriente
- RF-16: Identificar un cliente durante la venta (crear uno nuevo si no existe) sin que eso implique tener cuenta corriente — la identificación y el crédito son responsabilidades separadas.
- RF-17: Vender a cuenta corriente requiere, si hay red, un bloqueo (hold) previo contra el saldo real del sistema externo antes de cerrar la venta.
- RF-18: Si no hay red, permitir vender a cuenta corriente sin bloqueo mientras el saldo cacheado + el margen configurado del comercio no se supere; si se supera, bloquear la operación.
- RF-19: La confirmación de un hold ya aprobado (cerrar el círculo del lado del backend) debe ser tolerante a que la conexión se corte justo después de aprobado — no depende de que el navegador siga online.

### Multi-terminal (fase posterior)
- RF-20: Varias terminales en el mismo local deben poder compartir catálogo actualizado y no pisarse el stock entre sí (vía el sistema externo como fuente de verdad eventual). Es el mismo problema que el saldo de cuenta corriente: un recurso compartido con límite, resuelto con la misma estrategia de margen configurable.

## 3. Requisitos no funcionales

- RNF-01 (offline-first real): ninguna pantalla del flujo de venta debe bloquearse o degradarse por falta de red.
- RNF-02 (durabilidad): una venta se persiste en almacenamiento local **antes** de considerarse "cerrada" — un cuelgue del navegador o corte de luz no debe perder una venta ya cobrada.
- RNF-03 (velocidad): búsqueda de producto con feedback visual en <100ms sobre catálogos de hasta ~50.000 SKUs.
- RNF-04 (accesibilidad por teclado): cualquier acción operativa debe ser alcanzable con teclado en ≤2 pasos desde la pantalla principal de venta.
- RNF-05 (instalable): debe poder instalarse como app (PWA) en Windows y Linux desde un navegador Chromium; debe seguir siendo usable como pestaña de navegador normal si no se instala.
- RNF-06 (extensibilidad): agregar un nuevo backend externo no debe requerir tocar el código del POS, solo implementar el contrato documentado.
- RNF-07 (auditable): todo movimiento de dinero o stock queda registrado con timestamp y usuario, sin poder editarse retroactivamente (solo anularse con registro nuevo).

## 4. Modelo de dominio

Entidades canónicas del POS (independientes del sistema externo — el mapeo hacia/desde el backend real vive en el conector):

- **Product**: `id`, `sku`, `barcodes[]`, `name`, `price`, `taxRate`, `category`, `tracksStock`
- **StockItem**: `productId`, `quantity`, `updatedAt`
- **Sale**: `id` (ULID generado en cliente), `lines[]`, `payments[]`, `total`, `status` (`open` | `closed` | `voided`), `createdAt`, `syncedAt`
- **SaleLine**: `productId`, `qty`, `unitPrice`, `discount`
- **Payment**: `method`, `amount`, `reference`
- **CashSession**: `id`, `openedAt`, `closedAt`, `openingAmount`, `closingAmount`, `sales[]`
- **StockMovement**: `productId`, `delta`, `reason`, `saleId?`, `createdAt`
- **Customer**: `id`, `name`, `document?`, `phone?` — pura identificación, no sabe nada de crédito
- **CustomerAccount**: `customerId`, `creditLimit`, `margin`, `balance` (cacheado), `updatedAt` — módulo aparte, opcional; un `Customer` puede no tener asociada ninguna
- **AccountHold**: `id`, `customerId`, `amount`, `status` (`pending` | `confirmed` | `released` | `expired`), `createdAt`
- **AccountMovement**: `id`, `customerId`, `type` (`sale` | `payment` | `adjustment`), `amount`, `saleId?`, `holdId?`, `createdAt`

Todos los IDs de entidades creadas en el cliente (`Sale`, `CashSession`, `StockMovement`, `AccountHold`) se generan como **ULID** localmente — así una venta existe y es identificable aunque nunca haya habido red.

**Dos categorías distintas de dato**, y conviene tenerlas presentes porque cambian qué estrategia de sincronización aplica a cada una:
- **Eventos, sin conflicto posible** (`Sale`, `Payment`, `StockMovement`, `AccountMovement`): siempre seguros de crear offline vía outbox, no hay nada que reconciliar más que "llegó o no llegó".
- **Recursos con límite, conflicto posible** (`StockItem.quantity`, `CustomerAccount.balance`): offline significa operar sobre una foto del estado real que puede estar desactualizada. Se resuelven con la misma estrategia de margen configurable (ver §6 para el caso de cuenta corriente).

## 5. Arquitectura

Ver diagrama más arriba. Tres capas dentro del cliente:

1. **UI + estado** (Preact + `@preact/signals`): estado de interacción — carrito actual, foco activo, modo de teclado. Signals porque el estado de una pantalla de venta es muy reactivo y granular (cada tecla mueve algo), y evita el overhead de un VDOM re-render completo en cada pulsación.
2. **Almacén local** (IndexedDB): fuente de verdad local. Contiene el catálogo cacheado, las ventas, y una tabla `outbox` de eventos pendientes de sincronizar.
3. **Service worker**: cachea el app shell (assets, JS, CSS) para que la app cargue offline, y puede disparar sincronización en segundo plano cuando vuelve la red.

### Patrón outbox (la pieza clave del offline-first)

Cada mutación relevante (venta cerrada, ajuste de stock, cierre de caja) se escribe **primero** en una tabla local `outbox` como un evento inmutable (`type`, `payload`, `status`, `retries`, `createdAt`), en la misma transacción que el registro de negocio. Un proceso de sincronización, corriendo en background:

- Recorre `outbox` en orden y hace `POST` al conector externo con un `Idempotency-Key` = el ID (ULID) de la entidad.
- Si el servidor confirma, marca el evento como `synced`.
- Si falla (sin red, error 5xx), reintenta con backoff exponencial — el evento queda `pending`, la venta ya está cerrada y operativa localmente sin importar el resultado del sync.
- Nunca bloquea la UI: sincronizar es un efecto secundario, no una condición para operar.

Para el catálogo es al revés (pull): se trae por delta (`updatedAt` / cursor) y se cachea con TanStack Query + un persister a IndexedDB, así el catálogo sigue disponible aunque se cierre y reabra el navegador sin red.

### Resolución de conflictos

Las ventas son de solo-creación (append-only) — no hay conflicto real, como mucho una venta "huérfana" si se anuló en otro lado, que se concilia con una regla simple (last-write-wins por timestamp). El catálogo y precios sí pueden cambiar en el sistema externo: ahí el cliente siempre es "lector", el sistema externo manda.

### Cuenta corriente: bloqueo síncrono, confirmación asíncrona

Es el único flujo del POS que, a propósito, sí puede requerir red en el momento:

1. **Con red**: al elegir cuenta corriente como medio de pago, el POS pide un bloqueo síncrono (`POST /account-holds`) contra el saldo real. Si se aprueba, la venta sigue el camino normal (offline-safe) referenciando el `holdId`; la confirmación del hold viaja en el outbox como cualquier evento, tolerante a que la red se corte justo después de aprobado.
2. **Sin red**: no se puede pedir el bloqueo. El POS evalúa `balance` cacheado + `creditLimit` + `margin` configurado; si entra, se permite la venta sin bloqueo (evento de outbox como cualquier otro); si no entra, se rechaza la operación y hay que elegir otro medio de pago.
3. **Liberación de un hold no usado** (venta abortada después de aprobado): se encola como un evento más de outbox (`account-hold/release`), best-effort — si nunca sincroniza, el hold expira solo del lado del backend (ver §6).

## 6. Contrato de integración — Connector API

El POS no conoce ningún backend específico. Define un contrato REST/JSON versionado (documentado como OpenAPI) que cualquier sistema debe implementar para conectarse:

| Recurso | Método | Uso |
|---|---|---|
| `/products` | `GET` | Pull de catálogo, soporta `?since=<cursor>` para delta sync |
| `/stock` | `GET` | Pull de stock por producto/ubicación |
| `/sales` | `POST` | Push de una venta cerrada (requiere `Idempotency-Key`) |
| `/stock-movements` | `POST` | Push de ajustes de stock |
| `/cash-sessions` | `POST` | Push de apertura/cierre de caja |
| `/customers` | `GET` | Pull de clientes; los campos de cuenta corriente (`creditLimit`, `margin`, `balance`) son **opcionales** en la respuesta |
| `/account-holds` | `POST` | Bloqueo síncrono de crédito antes de cerrar una venta a cuenta corriente. Devuelve `{ approved, holdId }` o `{ approved: false, code }` |
| `/account-holds/:id` | `DELETE` | Liberación best-effort de un hold no usado (asíncrona desde el POS, vía outbox — ver §5) |
| `/webhooks/catalog-updated` | (opcional, lo expone el externo) | Notifica al POS que hay catálogo nuevo para no esperar al polling |

Reglas del contrato:

- Todo `POST` de eventos de negocio (`/sales`, `/stock-movements`) es **idempotente** vía header `Idempotency-Key`.
- Todo `GET` de catálogo soporta paginación por cursor y filtro `since` para traer solo lo que cambió.
- Autenticación desacoplada del POS: se configura como Bearer token / API key en la config de la terminal, el conector solo define **qué** se intercambia, no **cómo** se autentica cada backend (eso queda en una capa de adaptador por implementación, si hace falta).
- Cualquier integrador escribe un adaptador que traduce su modelo propio a estos recursos — el POS nunca necesita saber si del otro lado hay un ERP, un Shopify o una planilla con API casera.
- **`/customers` mantiene un solo recurso simple a propósito**: si un backend no maneja cuenta corriente, simplemente no manda esos campos y no tiene que implementar nada más. La separación interna entre `Customer` y `CustomerAccount` (§4) es una decisión de organización del dominio del POS, no algo que el integrador deba replicar.
- **Vencimiento de un hold no confirmado**: es responsabilidad del backend (timeout propio). El `DELETE` del POS es solo una optimización para liberar antes si se puede — si nunca llega a sincronizarse, el hold expira solo del lado del backend.

## 7. UX keyboard-first

Principio de diseño central: **un único input siempre enfocado** (la barra de comandos), en vez de múltiples campos que puedan robarse el foco entre sí. Cualquier elemento que pueda tomar foco es una fuente de bugs de teclado — se elimina el problema de raíz en vez de gestionarlo.

### Barra de comandos

Ubicada en un extremo de la pantalla (arriba o abajo, ver nota de layout más abajo), siempre con foco durante la operación normal. Interpreta lo que se escribe con esta prioridad, en orden:

1. Empieza con `/` → modo comando. Con solo `/` ya muestra la lista completa de comandos disponibles — la barra "enseña" en vez de requerir memorización. Ej: `/CAJA`, `/COBRAR`, `/CUENTA CORRIENTE`.
2. Empieza con `@` → búsqueda de cliente por nombre; permite dar de alta uno nuevo si no existe. Ej: `@juan`.
3. Matchea `cualquier cosa$monto` → línea libre de venta: todo antes del último `$` es la descripción, lo que sigue es el precio. Ej: `reparación varios$3000`.
4. Prefijo de cantidad `<n>*` o `-<n>*` antes de cualquiera de las búsquedas de abajo → suma o resta esa cantidad en vez de 1. Ej: `3*7798787667`, `-2*sandwich de miga`.
5. Todo dígitos → código de barras (match exacto) o SKU, según largo.
6. Cualquier otro texto → búsqueda difusa por nombre, con resultados en vivo; `Enter` agrega el resaltado.

`Ctrl+Enter` es equivalente global a `/COBRAR` desde cualquier estado de la barra.

**Ambigüedad cantidad vs. código de barras**: mientras el buffer sea solo dígitos (con o sin `-` adelante) y no haya aparecido `*` todavía, no se dispara la búsqueda en vivo — no se sabe todavía si va a terminar siendo una cantidad o un código completo. En cuanto aparece un carácter no numérico, un `*`, o se presiona `Enter`, se resuelve al instante. No es un timeout arbitrario, es "esperar el carácter que desambigua". Un lector de código de barras no se ve afectado porque siempre termina con `Enter`, que resuelve el buffer completo sin importar su longitud.

**Navegación del carrito sin un segundo foco**: con la barra vacía, `↑ / ↓` navegan (selección visual) las líneas del carrito ya armado; un número + `Enter` en ese estado reemplaza la cantidad de la línea seleccionada, `Supr` la elimina. En cuanto hay texto en la barra, `↑ / ↓` pasan a navegar los resultados de búsqueda en vez del carrito.

**Errores de parseo**: el mensaje aparece en un slot de altura fija y siempre reservado junto a la barra (mismo lugar donde se muestra la preview de resultados), nunca corriendo el layout. Al fallar, se selecciona todo el contenido del input (`.select()` nativo) — el texto no se pierde: si el usuario sigue escribiendo reemplaza todo, si mueve el cursor con una flecha o el mouse puede editar puntualmente sin retipear. El error se limpia solo con cualquier edición o con un comando exitoso, sin timeout.

### Barra de estado

En el extremo opuesto de la pantalla a la barra de comandos. Puramente informativa, nunca toma foco ni es interactiva.

| Estado | Cuándo | Qué muestra |
|---|---|---|
| `offline` | `navigator.onLine === false` | "Sin conexión" + cantidad de eventos pendientes en el outbox |
| `online-idle` | Hay red, outbox vacío | "Sincronizado" + hora de la última sync |
| `syncing` | Hay red, outbox enviándose | "Sincronizando (n)" |
| `sync-error` | Hay red pero los reintentos vienen fallando repetido | "Problema de sincronización" — se distingue de `syncing` porque acá hay algo que requiere atención, no es solo un delay normal |

Se arma combinando `navigator.onLine` (+ eventos `online`/`offline`), una live query al conteo de la tabla `outbox`, y el estado interno del motor de sync.

### Otros principios

- **Todo alcanzable en ≤2 pasos** desde la pantalla de venta, sin mouse.
- **Foco visible siempre** donde exista (el input de comandos, modales puntuales); nunca se depende de `:hover`.
- **El lector de código de barras es tecleo normal** hacia la barra de comandos — no necesita tratamiento especial más allá de la regla 5 de arriba, porque siempre llega como dígitos + `Enter`.
- **Login de terminal 100% teclado**: PIN numérico + `Enter`, sin selects ni checkboxes con mouse.
- **Locale configurable por terminal** (`locale?: string` en la config, default `navigator.language`), usado para `Intl.NumberFormat` al parsear montos de la barra (`$1500,50` vs `$1500.50`) y para todo el formateo de moneda en pantalla.

## 8. Stack tecnológico

| Capa | Elección | Por qué |
|---|---|---|
| UI | Preact + `@preact/signals` | Ya lo conocés, bundle chico, signals encajan bien con estado muy granular (cada tecla mueve algo) |
| Server-state / cache | TanStack Query + persister a IndexedDB | Cache, reintentos y estado de sync "gratis"; el persister mantiene el catálogo disponible offline entre sesiones |
| Almacenamiento local | Dexie.js (sobre IndexedDB) | API ergonómica sobre IndexedDB para `outbox`, ventas, catálogo cacheado |
| PWA / service worker | Vite + `vite-plugin-pwa` (Workbox por debajo) | Precache de app shell, estrategias de runtime caching, manejo de actualizaciones |
| Búsqueda local | FlexSearch o Fuse.js | Búsqueda difusa sub-100ms sobre el catálogo cacheado, sin red |
| Validación de contrato | Zod | Validar payloads del Connector API en ambos sentidos |
| Impresión / hardware | Web Serial / WebUSB (Chromium) | Comandos ESC/POS directos a impresora térmica y apertura de cajón, sin agente externo — con fallback documentado si el navegador no lo soporta |
| Testing | Vitest + Testing Library (preact) + Playwright | Playwright permite simular offline real (`context.setOffline(true)`) para testear el flujo completo sin red |

## 9. Estilo de código y manejo de errores

Regla general: **las funciones de negocio nunca lanzan**. Se distinguen dos clases de error:

- **Error de negocio anticipado** — el dominio ya sabe que puede pasar y sabe cómo reaccionar (stock insuficiente, hold rechazado, payload de un conector mal formado). Siempre `Result<T>`, nunca excepción. Incluye la validación con Zod de cualquier dato externo (respuesta del conector, algo leído de IndexedDB con forma incierta) — un conector externo mal implementado es un caso de negocio, no un bug propio.
- **Todo lo demás** (una invariante rota, un bug) — no se envuelve en `Result` en ningún punto intermedio. Se deja explotar como excepción real hasta un único manejador global (error boundary de Preact + `window.onerror` / `unhandledrejection` para lo que pasa fuera del árbol de componentes). Por ahora ese manejador siempre decide "no se puede continuar" y muestra una pantalla bloqueante — sin intento de retry silencioso, hasta tener criterio de qué casos son seguros de resumir.

`try/catch` queda limitado a los adaptadores que envuelven algo que sí lanza por naturaleza (fetch, Dexie, `JSON.parse`) y lo convierten a `Result` en el borde — nunca como manejo de flujo de negocio.

### Result casero, error como código string con metadata tipada

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

`ErrorCode` como unión cerrada mantiene exhaustividad en los `switch` de la UI/traductor. `meta` está atado por tipo a cada código específico (no es un `Record<string, unknown>` genérico, así que no rompe la regla de estricto) — TypeScript obliga a poner exactamente los datos que ese código necesita. Se trata como un punto de partida a ajustar con casos reales: si un código no necesita datos extra, `meta` queda en `undefined` sin costo; si en algún momento sobra, se saca.

### Reglas de TypeScript estricto

- `any` prohibido sin excepción (`no-explicit-any` en modo error de lint).
- `unknown` solo puede aparecer en la firma de una función que recibe algo externo **y lo valida con Zod en la misma línea siguiente** — nunca se propaga `unknown` hacia el dominio.
- Toda función de negocio devuelve `Result<T>`, nunca lanza.

## 10. Estructura de proyecto propuesta

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

## 11. Roadmap de desarrollo

**Fase 0 — Base del proyecto**
Scaffolding con Vite + Preact, tooling (lint, tests, CI), design tokens básicos, `Result`/`ErrorCode` base.

**Fase 1 — MVP de venta offline (sin sync)**
Catálogo local estático, carrito, barra de comandos (búsqueda, código de barras, línea libre, cantidad), cobro, cierre de venta persistido en IndexedDB. Funciona como POS standalone, sin backend todavía.

**Fase 2 — Motor de sync**
Tabla `outbox`, Connector API v1 documentado (OpenAPI), implementación de referencia REST, sincronización en background con reintentos, barra de estado.

**Fase 3 — Clientes y cuenta corriente**
Identificación de cliente (`@`), `CustomerAccount`, flujo de hold síncrono + confirmación asíncrona, modo offline con margen configurable.

**Fase 4 — Keyboard-first completo**
`/COMANDOS` completos, gestor de foco global (navegación de carrito vs. resultados), integración de scanner, auditoría de accesibilidad por teclado (probar todo el flujo sin tocar el mouse ni una vez).

**Fase 5 — Hardware (pospuesta a v2)**
Impresión de tickets (Web Serial/USB), apertura de cajón, fallback para navegadores sin soporte.
Decisión tomada al terminar Fase 4: depende de dispositivos físicos reales para poder validarse en
serio, y ninguna fase posterior depende de que esté hecha — se pospone a v2 y se avanza directo a
Fase 6. Se retoma el orden numérico original (5, 6, 7) solo como referencia histórica de lo ya
documentado; el orden de ejecución real de esta primera etapa es Fase 6 → ciclos de mejora de UI →
Fase 7.

**Fase 6 — Multi-terminal y caja**
Turnos de caja, arqueo, reportes básicos, reconciliación de catálogo y saldo entre terminales. La
reconciliación multi-terminal solo se puede validar contra un `Connector` fake/mockeado hasta que
exista el minibackend de Fase 7 — mismo criterio ya usado para el motor de sync.

**Fase 7 — Publicación**
Manifest PWA, flujo de actualización de service worker, documentación del Connector API para
integradores externos, hardening y lanzamiento. Alcance ampliado a propósito (decisión al terminar
Fase 6): además de documentar el contrato, se construye un minibackend de demostración que lo
implementa — es la mejor documentación posible ("funcionando" en vez de solo especificado) y la
única forma de probar de punta a punta lo que Fase 6 dejó validado solo con fakes (reconciliación
multi-terminal, holds de cuenta corriente, sync real en vez de mockeado).

**v2 (fuera de este documento)**: Fase 5 (hardware, ver nota arriba), cobranzas con medios de pago
múltiples e integración con pasarelas de pago.

## 12. Publicación y distribución

- **Hosting**: cualquier estático servido por HTTPS (Cloudflare Pages, Netlify, Vercel, nginx propio) — HTTPS es obligatorio para service worker.
- **Instalación**: PWA instalable vía el navegador ("Instalar app") en Windows y Linux sobre Chrome/Edge. En navegadores sin soporte completo (Firefox, Safari) sigue funcionando como pestaña normal, pero **sin** Web Serial/WebUSB — por eso conviene documentar Chromium como navegador recomendado para terminales reales.
- **Actualizaciones**: versionado del service worker con banner de "hay una actualización, reiniciar" (patrón estándar de Workbox) — nunca actualización silenciosa a mitad de una venta.
- **Distribución del contrato**: el Connector API se publica como spec OpenAPI versionada, independiente del release del POS, para que integradores externos puedan implementarlo sin acoplarse al código del frontend.

## 13. Riesgos y decisiones abiertas

- **Impresión sin Chromium**: si hace falta soportar Firefox/Safari en terminales reales, hay que definir un agente local puente (servicio corriendo en `localhost` que reciba comandos ESC/POS) como plan B a Web Serial/WebUSB.
- **Multi-terminal**: por ahora el sistema externo es la fuente de verdad eventual para stock compartido; si se necesita stock en tiempo real entre terminales sin pasar por el backend, es una fase aparte (sync P2P o polling agresivo).
- **Impuestos/fiscalidad**: este diseño no asume ningún régimen fiscal particular — queda como responsabilidad del sistema externo o de un módulo aparte si hace falta.
- **Autenticación del conector**: el contrato define qué se envía, pero cada integración real va a necesitar su propia capa de credenciales — vale la pena definir un formato de configuración estándar para eso antes de la Fase 2.
- **`meta` en los errores**: se agregó tipado por código (§9) a pedido, pero todavía no está probado contra casos reales (ej. detalle de un 400 del conector) — revisar si la forma actual alcanza una vez que haya integraciones concretas.
- **`Result` casero vs. librería**: se optó por rodar el propio (control total, sin dependencia extra) dado que el dominio es chico; si en el camino se vuelve incómodo el encadenamiento de `Result`s, vale reconsiderar algo como `neverthrow`.
