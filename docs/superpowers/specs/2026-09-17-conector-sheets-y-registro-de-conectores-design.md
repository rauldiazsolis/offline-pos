# Conector de Google Sheets + registro de conectores integrados

Fecha: 2026-09-17
Estado: aprobado por el usuario (mecanismo + división en 3 etapas), pendiente de plan de
implementación etapa por etapa.

## Contexto

Brainstorming a partir de tres ideas del usuario: (1) un conector, aunque limitado, directo a un
libro de Google Sheets; (2) la posibilidad de conectores personalizados inyectables por
configuración, tipo plugins; (3) adaptar el POS a las características de un conector así. Hoy
`Connector` (`src/sync/connector.ts`) es un puerto fijo de 10 métodos, pero no existe ningún punto
de selección de implementación: tanto `sync/engine.ts::runSyncCycle` como
`sync/account-hold.ts::requestAccountHoldNow` instancian directo
`createRestFetchConnector(config)` — un solo conector posible, hardcodeado en dos lugares.

## Decisión: qué significa "plugin" acá

Se evaluó y se descartó carga dinámica de código (`import(url)` de un módulo remoto) — es
ejecución de código arbitrario dentro de una app que maneja ventas y pagos, superficie de ataque
seria (supply chain, XSS con privilegios de la app) que no se justifica. También se descartó un
conector genérico declarativo (mapeos JSON sin código) por tener un techo de expresividad bajo para
casos como el propio puente de Sheets.

**"Inyectable por configuración" significa: un registro cerrado de implementaciones que el POS trae
compiladas, seleccionable y configurable por `/CONFIG`** — no carga de código de terceros en
runtime. Un conector nuevo (a futuro) es un PR al repo, no algo que un integrador enchufe sin tocar
código del POS. Esto es más limitado que "plugin" en el sentido estricto, pero es el único punto
del espacio de diseño compatible con no introducir ejecución de código arbitrario.

Mecanismo elegido (de 3 opciones evaluadas): cada conector es dueño de su propio schema de config +
factory (`connectors/<tipo>/`), y un registro chico (`sync/connector-registry.ts`) arma la unión
discriminada importando esos schemas y expone `createConnector(config): Connector`. Se descartó
centralizar todos los schemas en `sync/config.ts` (obliga a tocar un archivo ajeno por cada
conector nuevo) y descartó también una bolsa de config sin tipar (viola la regla dura del repo de
no `unknown`/`any` fuera del borde). Este mecanismo sigue el mismo patrón "puerto + adaptador" que
ya usa el proyecto para `CatalogSearch`/`CustomerSearch`.

## Caso de uso del conector de Google Sheets

Backend completo para un micro-comercio sin ERP: catálogo y ventas viven en una planilla. Alcance
acotado a propósito:

- **`products`**: pull real, con `tracksStock: false` fijo en cada producto — el seam que ya existe
  en el dominio (`Product.tracksStock`, usado en `domain/cart.ts` para decidir si valida stock)
  hace que esto alcance por sí solo para que el POS nunca bloquee una venta por falta de stock con
  este conector, sin tocar `domain/cart.ts` para nada.
- **`stock`**: no se necesita. `pullStock`/`pushStockMovement` son no-ops (`ok([])`/`ok(undefined)`
  inmediatos, sin llamar al puente) — en la práctica `pushStockMovement` nunca se invoca porque
  ningún producto de este conector tiene `tracksStock: true`
  (`storage/sale-repository.ts` solo genera movimientos para productos que trackean stock).
- **`sales`**: push real, a dos pestañas. "Ventas": una fila por línea de venta (más útil para
  análisis con SUMIF/tablas dinámicas que una fila por venta). "Pagos": una fila por `Payment` de
  la venta (`saleId`, `method`, `amount`) — separada de "Ventas" porque una venta puede pagarse con
  varios medios a la vez (Ciclo 9, cobro con tender mixto), no hay un único "medio" por línea.
- **Fiado ("cuenta corriente")**: identificación de cliente sí, bloqueo/restricción de crédito no
  — ver Etapa 3.
- **`cash-sessions`**: el turno de caja sigue siendo obligatorio para cobrar (gate local, Fase 6,
  no depende del conector) — la limpieza/arqueo periódico de caja (diario o semanal, a criterio del
  comerciante) sí tiene sentido registrarlo en la planilla, así que `pushCashSession` **es una
  acción real**, no un no-op: agrega una fila a "Turnos" con el resumen del turno cerrado (ver
  contrato del puente más abajo). Nunca hay `pull` de turnos — ningún conector lo tiene (el puerto
  `Connector` no define un método para eso), así que esto no es una limitación específica de Sheets.

## Etapa 1 — Conector aislado

Carpeta nueva y autocontenida, `src/connectors/google-sheets/`, que **no modifica ningún archivo
existente del repo**. Importa solo lo ya estable: el tipo `Connector` (`sync/connector.ts`) y los
tipos de dominio (`Sale`, `Product`, `Customer`, etc.). Contenido:

- `google-sheets-connector.ts`: implementa `Connector` completo contra el puente HTTP (ver abajo).
- `config.ts`: exporta `googleSheetsConfigSchema` (zod) + tipo — **local** a esta carpeta, todavía
  no conectado a `SyncConfig` (eso es Etapa 2).
- `google-sheets-connector.test.ts`: mockeando `fetch` (`vi.stubGlobal`), mismo patrón que
  `rest-fetch-connector.test.ts` — no depende de un Apps Script real para correr en CI.
- `bridge.gs`: fuente del Apps Script (JS plano, motor V8 de Google — no pasa por el toolchain de
  TypeScript/Vitest del repo, se excluye del build igual que `e2e/**` se excluye hoy de Vitest).
- `README.md`: instrucciones de setup para el comerciante (ver más abajo).

### Setup del comerciante

El usuario prefiere proveer plantillas de Google Sheet prearmadas (con `bridge.gs` ya incrustado y
datos de prueba) en vez de pedir copiar/pegar código a ciegas — "puedo darle planillas prearmadas
con datos de prueba para experimentar". El flujo:

1. El comerciante hace "Archivo > Hacer una copia" de la plantilla (vive en Google Drive, fuera del
   repo — el repo solo contiene la fuente `bridge.gs` que la plantilla ya trae incrustada, para que
   el script en sí quede versionado y auditable).
2. Extensions > Apps Script > Deploy > New deployment > Web app, "Execute as: Me", "Who has access:
   Anyone". Esto es lo que da la sensación de "lo más simple del mundo": la URL resultante no
   requiere login de Google ni token OAuth para ser llamada — el script corre con los permisos de
   quien lo desplegó (dueño de la planilla), no de quien llama.
3. Pega la URL del Web App (y opcionalmente un secreto compartido, ver abajo) en `/CONFIG`
   (Etapa 2).

**Aclaración técnica importante**, porque contradice la primera formulación de "cualquiera con la
URL es editor": esa es una config de *compartir en Drive* para humanos abriendo la hoja en el
navegador, no un mecanismo de autenticación de API. Google Sheets API nunca acepta escritura solo
por ese permiso — siempre exige OAuth2 o una Apps Script Web App desplegada con acceso "Anyone". Es
justamente ese despliegue el que logra el efecto deseado (nadie necesita loguearse para que el POS
pueda escribir), no un atajo alrededor de él.

### Contrato del puente (Apps Script Web App)

Un solo endpoint (`doPost`), sin routing REST real (Apps Script no lo soporta de forma nativa).
Envelope JSON: `{ action: string, payload: unknown, idempotencyKey?: string }` de request,
`{ ok: true, data: T } | { ok: false, error: string }` de response — mapea directo al `Result<T>`
que ya usa el resto del código (Apps Script no permite controlar el código HTTP de la respuesta con
`doPost`, así que el éxito/error viaja en el body, nunca en el status).

**Content-Type `text/plain;charset=utf-8` en vez de `application/json`** en el request: es un
workaround necesario y conocido — Apps Script Web Apps no responden bien al preflight `OPTIONS` que
un navegador dispara para `Content-Type: application/json` cross-origin, lo que rompe el POST desde
el POS. Con `text/plain` no hay preflight; el script parsea el body con `JSON.parse(e.postData.contents)`
de todas formas. **Esto es una asunción de diseño a validar con un despliegue real en la Etapa 1**
— Apps Script tiene comportamientos de CORS/parsing que solo se confirman contra el servicio real,
no contra mocks de `fetch` (mismo criterio que ya aplicó este proyecto para el bug de
ResizeObserver/zoom: verificar en el entorno real, no asumir).

Acciones (una por método del puerto `Connector`, salvo las marcadas "no llama al puente"):

| Acción | Payload | Notas |
|---|---|---|
| `pullProducts` | `{ since?: string }` | Devuelve **todo** el catálogo siempre (sin delta real — la planilla de un micro-comercio es chica, no se justifica la complejidad de un cursor). `tracksStock: false` fijo por producto. |
| `pullCustomers` | `{ since?: string }` | Todo el listado de la pestaña "Clientes". Cada cliente devuelto trae `unrestricted: true` (ver Etapa 3). |
| `pushSale` | `{ sale }` | Una fila por línea en "Ventas" + una fila por `Payment` en "Pagos". `idempotencyKey` = `sale.id` (misma key para ambas escrituras, atómicas dentro de la misma ejecución del script). |
| `pushCustomer` | `{ customer }` | Una fila en "Clientes". `idempotencyKey` = `customer.id`. |
| `requestAccountHold` | — | **No llama al puente.** Se resuelve localmente en el conector TS: siempre `{ approved: true, holdId: <ULID nuevo> }`, sin red — no tiene sentido pagar la latencia de un round-trip para una decisión que siempre es "sí". |
| `pushAccountHoldConfirm` | `{ holdId, saleId, customerId, amount, confirmedAt }` | Una fila en "CuentaCorriente" (el ledger real de fiado). |
| `releaseAccountHold` | — | **No llama al puente**, mismo motivo que `requestAccountHold`: nunca hubo una reserva real que liberar. |
| `pullStock` | — | No-op, `ok([])` sin red. |
| `pushStockMovement` | — | No-op, `ok(undefined)` sin red. |
| `pushCashSession` | `{ session }` | Una fila en "Turnos". `bridge.gs` calcula el total por medio de pago sumando las filas de "Pagos" cuyo `saleId` está en `session.sales[]` — el mismo cálculo que ya hace `domain/cash-session.ts::calculateCashSessionSummary`, pero del lado del puente (el conector TS no tiene ni necesita las `Sale[]` completas, solo el `CashSession` crudo que ya recibe hoy). `idempotencyKey` = `session.id`. |

**Idempotencia y concurrencia**: Sheets/Apps Script no tiene constraints únicos ni transacciones.
`bridge.gs` mantiene una pestaña oculta `_Idempotency` (key → timestamp); cada acción de escritura
chequea la key ahí antes de aplicar el cambio (si ya está, responde éxito sin reescribir) y usa
`LockService.getScriptLock()` alrededor de la sección leer-verificar-escribir — necesario porque
más de una terminal puede sincronizar al mismo tiempo contra la misma planilla (mismo escenario
multi-terminal que ya contempla Fase 6, pero acá sin backend real de por medio que lo resuelva).

**Auto-provisión**: cada request corre primero `ensureSheetsExist()` — si faltan las pestañas
`Productos`/`Clientes`/`Ventas`/`Pagos`/`CuentaCorriente`/`Turnos`/`_Idempotency`, las crea con sus
headers; si la planilla estaba completamente vacía (primera vez), además siembra datos de prueba. Resuelve "el
plugin verifica si ya tiene las planillas que necesita y sino las crea con datos de prueba" sin que
el conector TS necesite ningún paso de "init" separado — es transparente, corre en cada llamada.

**Secreto compartido opcional**: `sharedSecret` en `google-sheets/config.ts`, enviado en el envelope
y validado por `bridge.gs`. Defensa en profundidad (la URL del Web App ya es difícil de adivinar),
simétrico con el `apiKey` opcional que ya tiene el conector REST.

## Etapa 2 — Integración

- Mover `connectors/rest-fetch-connector.ts` (+ test) a `connectors/rest/rest-fetch-connector.ts`,
  por simetría con `connectors/google-sheets/`. Extraer su config (`baseUrl`, `apiKey`) a
  `connectors/rest/config.ts` como `restConfigSchema`, siguiendo el mismo patrón que Etapa 1.
- `sync/config.ts` deja de definir los campos específicos de un conector: pasa a ser un envelope
  `{ locale?: string } & (RestConfig | GoogleSheetsConfig)`, discriminado por `type`. `locale` queda
  afuera de la unión porque es una config de terminal transversal (Fase 4), no algo específico de
  backend.
- `sync/connector-registry.ts` (nuevo): arma el `z.discriminatedUnion('type', [...])` importando
  `restConfigSchema`/`googleSheetsConfigSchema`, y expone `createConnector(config: SyncConfig):
  Connector`.
- Reemplazar los dos call sites hardcodeados (`sync/engine.ts::runSyncCycle`,
  `sync/account-hold.ts::requestAccountHoldNow`) por `createConnector(config)`.
- Actualizar los tests existentes que referencian las rutas movidas.

### UI de `/CONFIG`: absorbe y cierra el issue #56

Hoy `ui/screens/config-screen.tsx` es un wizard secuencial fijo de tres pasos (`baseUrl → apiKey →
locale`, un input a la vez, `Enter` avanza) — y ya hay un issue abierto, **#56** (parte del epic
#49, "rediseñar pantallas secundarias como diálogos modales"), pidiendo reemplazar exactamente ese
wizard por un formulario con **todos los campos visibles a la vez** (Tab/Shift+Tab entre ellos,
Ctrl+Enter confirma todo junto, Esc cancela) — mismo tratamiento que ya recibió Cobro en el #55
(que a su vez absorbió #48/#50). Construir un wizard con pasos dinámicos por tipo de conector sobre
el mecanismo viejo sería trabajo tirado: en cuanto se encarara el #56 se reescribiría todo de
nuevo. **Se decidió que la Etapa 2 absorbe y cierra el #56 directamente**, mismo criterio que usó
el #55: un solo rediseño de la pantalla, no dos pasadas.

Diseño resultante (mismo chrome de diálogo modal — tarjeta centrada, overlay — que ya estableció el
#55 para Cobro):

- Selector de tipo de conector como primer campo (REST genérico / Google Sheets), visible siempre.
  Cambiar la selección intercambia en el acto qué campos específicos se muestran debajo — el
  selector en sí nunca se oculta.
- Debajo, **todos** los campos del tipo elegido, visibles y editables a la vez (no un campo por
  vez): `baseUrl`/`apiKey` para REST, `webAppUrl`/`sharedSecret` para Sheets.
- `locale` es un campo más, siempre visible al final — config de terminal, no de conector (ver
  "Decisión: mecanismo de selección de conectores").
- Tab/Shift+Tab navega entre todos los campos (se puede volver atrás a corregir cualquiera antes de
  confirmar); Ctrl+Enter valida y guarda todo junto; Esc cancela sin guardar. Validación solo al
  confirmar, nunca mientras se tipea — mismo criterio que Cobro.
- Cada conector sigue exportando su propia lista ordenada de campos (`configFields:
  { key: string; label: string; optional: boolean }[]`, en `connectors/rest/config.ts` y
  `connectors/google-sheets/config.ts`, junto a su `configSchema`/factory) — lo que cambia respecto
  al diseño anterior es que esa lista ahora describe qué renderizar en el set de campos visibles del
  tipo activo, no una cola de pasos secuenciales.

## Etapa 3 — Adaptación de dominio: crédito ilimitado explícito

Hoy `canChargeOffline` (`domain/customer.ts`) evalúa `creditLimit + margin - balance`, y
`splitConnectorCustomer` **no crea** ninguna `CustomerAccount` si al pull le faltan `creditLimit`,
`margin` o `balance` — a propósito, para no inventar crédito donde no hay dato (ver CLAUDE.md,
"No inventar datos que no llegaron del backend"). Con el conector de Sheets, el fiado es sin
bloqueo ni restricciones — no hay `creditLimit`/`margin` reales que declarar.

Cambios (viven en `domain/customer.ts` y el wire schema `ConnectorCustomer` de `sync/connector.ts`
— es lo único de todo este trabajo que toca código de dominio compartido, nada de esto vive en
`connectors/`):

- `ConnectorCustomer` (schema) y `CustomerAccount` (tipo de dominio) suman un campo
  `unrestricted?: boolean`. Es una capacidad declarada por el backend/conector para ESE cliente, no
  algo que el POS infiera de "qué conector está activo" — cualquier conector (REST incluido) podría
  en principio declarar un cliente sin restricción.
- `splitConnectorCustomer` crea una `CustomerAccount` cuando `unrestricted === true`, **aunque**
  falten `creditLimit`/`margin`/`balance` (se completan en `0`, valores que quedan sin usar — no es
  "inventar crédito", es declarar que esos números no aplican).
- `canChargeOffline`: si `account.unrestricted`, aprueba sin evaluar `availableCredit` en absoluto.
  Sin cuenta cacheada, se sigue rechazando igual que hoy (sin cambios) — `unrestricted` solo entra
  en juego una vez que efectivamente hay una `CustomerAccount`, nunca se fabrica una desde cero.
- El conector de Sheets (Etapa 1) simplemente siempre pobla `unrestricted: true` en cada
  `ConnectorCustomer` que devuelve `pullCustomers`.

## Testing

- Etapa 1: unitarios del conector mockeando `fetch` (formato envelope, idempotencia del lado
  cliente si aplica, mapeo de errores a `Result`). El `.gs` en sí no corre en Vitest — se valida
  manualmente contra un despliegue real antes de dar la etapa por terminada (ver nota de CORS
  arriba), mismo criterio que otros casos de este proyecto donde el navegador/entorno real es la
  única fuente de verdad confiable.
- Etapa 2: actualizar tests de rutas movidas; sumar tests de `connector-registry.ts` (arma el
  conector correcto según `type`, rechaza config inválida) y de `config-controller.ts`/
  `ConfigScreen` con el set de campos visibles cambiando según el tipo elegido (`locale` siempre
  presente), navegación Tab/Shift+Tab entre todos los campos, y validación solo al confirmar —
  mismos criterios heredados del #56/#49 que ya se testean para Cobro.
- Etapa 3: extender `domain/customer.test.ts` con el caso `unrestricted` (aprueba sin cuenta
  suficiente, cuenta ausente sigue rechazando).

## Fuera de alcance

- Carga dinámica de código de terceros (conectores realmente "plugin", no del registro cerrado) —
  descartada por riesgo de seguridad, ver "Decisión: qué significa 'plugin' acá".
- `pull` de `stock` contra Sheets — no forma parte del caso de uso acordado (`tracksStock: false`
  fijo alcanza). `cash-sessions` sí se sincroniza (push, ver "Caso de uso" y contrato del puente).
- Balance de cuenta corriente calculado/pulled-back desde Sheets (ej. vía fórmula agregada en la
  planilla) — el ledger (`CuentaCorriente`) es de solo escritura desde el POS; sumar los saldos
  queda del lado del comerciante en su propia planilla.
- Cualquier conector adicional más allá de REST y Google Sheets — el registro queda diseñado para
  agregarlos, pero ninguno más se planifica en este trabajo.
