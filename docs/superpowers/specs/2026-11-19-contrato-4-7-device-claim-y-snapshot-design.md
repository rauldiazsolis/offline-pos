# Contrato 4.7.0: `device-claim` y `cash-snapshot` (#230)

Fecha: 2026-11-19. Epic en la rama `feat/device-claim-and-snapshot`, en tres bloques: contrato y
tipos (1), demo-backend (2) y POS (3).

## Para qué

Cambiar una caja de equipo sin pasar la API key a mano y sin perder la caja:

- **`device-claim`**: el backend emite un código de un solo uso (`claimToken`) para una caja; el POS
  lo canjea y la caja queda vinculada a ese dispositivo. El equipo anterior queda revocado.
- **`cash-snapshot`**: la terminal nueva retoma la caja donde quedó (numeración, lo de las últimas
  24 h y el efectivo).

## Decisiones (aprobadas el 2026-11-19)

1. **Rutas relativas a la `baseUrl`**, como el resto del contrato: `POST /claim` y `GET /snapshot`
   (en el mini-erp quedan bajo `/connector`).
2. **El 409 nuevo usa `ErrorBody`**: `{ code: "device-revoked", message? }`. El 409 de contrato
   (`incompatible-contract`) sigue igual; se distinguen por `code`. En el OpenAPI, los 409 de los
   endpoints autenticados pasan a la respuesta `Conflict` (`oneOf` de los dos cuerpos); `POST /claim`
   usa `IncompatibleContractOnly`, porque no tiene key que revocar. Un POS 4.6 que recibiera el
   `device-revoked` lo ve como un fallo con status 409, sin romper nada (no le llega: ver 5).
3. **camelCase** en todo (`claimToken`, `lastTicket`, …). El `#connect=` acepta
   `{ baseUrl, claimToken, branch?, pointOfSale?, wipeKey? }` además del de siempre con `apiKey`,
   que no cambia. La sucursal y el punto de venta del fragmento ganan sobre los de la respuesta del
   claim.
4. **Sin turnos** (se eliminaron en #120): la foto trae `lastTicket` y `lastReceipt`
   (`{ date, number }`, porque los contadores son por día y la cobranza tiene el suyo),
   `recentSales` y `recentCustomerPayments` de las últimas 24 h (la ventana de `/ANULAR`),
   `cashAnchor?: { countedAt, amount }` y `cashMovements` desde el ancla. Se descartaron
   `shift_opened_at` y `opening_balance`. El ancla existe porque el saldo de efectivo se calcula desde
   el último arqueo, y los arqueos son locales: el backend solo ve su ajuste (`count-adjustment`, con
   `count.counted`). Sin ancla, los movimientos son todos los de la caja y la base es 0, la misma
   regla que el POS usa sin arqueo.
5. **`X-Device-Id` solo donde hace falta**: un header nuevo dispara el preflight de CORS, y un
   backend que lista sus headers permitidos (el demo-backend 4.6) rechazaría el request entero. Así
   que el POS lo manda solo en `POST /claim` y a un backend que declara `device-claim`. Del lado del
   backend, sin el header no se valida la exclusividad (compatibilidad con un POS 4.6), y `/info`
   nunca responde 409.

## Contrato

- `POST /claim`, sin `Authorization`, con `X-Device-Id` obligatorio y `{ claimToken }`:
  - `200 { apiKey, branch, pointOfSale, company?, register?: { name } }`.
  - Errores con `ErrorBody`: `400 invalid-request`, `404 claim-not-found` y `410 claim-expired` o
    `claim-used`. Un 404 sin cuerpo (o con otro `code`) es un backend sin claim.
  - El token es de un solo uso. Repetirlo desde el mismo dispositivo mientras no venció devuelve lo
    mismo (la respuesta se pudo perder); desde otro, `410 claim-used`.
- `GET /snapshot`: `CashSnapshot`. `404`: sin foto. El backend nunca la trunca.
- `X-Device-Id` (parámetro `DeviceId`) en push, pull, account-holds, portal-links y snapshot.
- La foto no vuelve a viajar: lo hidratado ya está en el backend, así que el POS nunca lo encola.

## Del lado del POS (bloque 1: solo tipos)

- `POS_CONTRACT_VERSION = '4.7.0'`; el piso sigue en 4.0.0.
- `CAPABILITY_DEVICE_CLAIM` y `CAPABILITY_CASH_SNAPSHOT` en `sync/backend-capabilities.ts`.
- `DEVICE_ID_HEADER` y `deviceRevokedBodySchema` en `sync/connector.ts`.
- `sync/claim-schema.ts`: `claimResponseSchema` (`company` y `register` mal formados cuentan como
  ausentes) y los `code` del claim.
- `sync/snapshot-schema.ts`: `cashSnapshotSchema` y `toCashSnapshot`, a tipos del dominio, sin el
  `origin`. Tolerante: números y ancla mal formados cuentan como ausentes, y un elemento mal formado
  de una lista se descarta sin tirar la foto (como los `notices`). Un medio de pago desconocido
  descarta su documento: hidratarlo con otro medio sería inventar un dato.
- `ErrorMeta`: `claim/not-offered`, `claim/not-found`, `claim/expired` (`reason: expired | used`) y
  `sync/device-revoked` (`message?`), con sus textos en `ui/errors.ts`.

## Bloques siguientes

- **2, demo-backend**: la caja con su dispositivo activo, la emisión y el canje del `claimToken`, la
  exclusividad por `X-Device-Id` en las rutas autenticadas (no en `/info`), `X-Device-Id` en CORS,
  `GET /snapshot` desde lo guardado, y declarar las capacidades y 4.7.0.
- **3, POS**:
  - El `#connect=` con `claimToken` hace `POST /claim` antes de guardar nada.
  - Con `cash-snapshot`, se hidrata al aplicar la conexión, tolerando el 404 y cualquier fallo sin
    cortar el onboarding.
  - El `409 device-revoked` frena el sync y muestra una pantalla bloqueante ("Esta caja fue
    vinculada en otro dispositivo") con dos opciones: bajar lo pendiente en `.json` y desvincular la
    terminal.

## Preguntas abiertas para el bloque 3

- Cómo encaja la hidratación con el contador de tickets en `localStorage` y la limpieza a 7 días
  (las ventas hidratadas no tienen evento en el outbox).
- La pantalla de revocada en la vista de celular.
