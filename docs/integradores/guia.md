# Guía para integradores

offline-pos es un punto de venta web para comercios minoristas (kiosco, tienda). Funciona **offline
primero**: una venta queda cerrada y guardada en el navegador aunque no haya red, y viaja al backend
cuando vuelve la conexión. Se opera 100% con teclado (y también con mouse).

El POS es **estático y genérico**: son archivos HTML, JS y CSS sin servidor propio, y no conoce
ningún backend en particular. Se conecta a cualquier sistema (ERP, e-commerce, facturación,
inventario) que implemente el **Connector API**, un contrato REST/JSON versionado. Esta guía
acompaña a la versión del contrato **4.4.0**; el detalle de cada operación está en
[`connector-api.openapi.yaml`](../connector-api.openapi.yaml).

## Probarlo en 5 minutos

El repo incluye un **demo-backend**: la implementación de referencia del contrato, en Node y
SQLite, sin dependencias externas.

1. Con Node 24 y pnpm instalados, cloná el repo e instalá:

   ```sh
   git clone https://github.com/rauldiazsolis/offline-pos.git
   cd offline-pos
   pnpm install
   ```

2. Levantá el demo-backend (queda en `http://localhost:4000`):

   ```sh
   pnpm backend
   ```

   Usá el demo-backend del mismo tag que la versión del POS que vas a probar (`git checkout v0.1.0`
   antes de levantarlo).

3. Abrí la página `/versions` del sitio publicado y hacé click en **Abrir demo** en la columna del
   demo-backend local, en la fila de la versión que quieras probar.

4. Chrome te va a pedir permiso de **acceso a la red local**: la página es `https` y el backend es
   `http://localhost`. Aceptalo. Si lo rechazaste: ícono a la izquierda de la dirección →
   Configuración del sitio → "Acceso a la red local" → Permitir, y recargá la página.

El POS arranca en modo demo, ya conectado, con un catálogo de ejemplo. El navegador de referencia es
Chromium (Chrome, Edge); el POS anda en Firefox y Safari, pero se prueba en Chromium.

## Cómo entra un comercio: el link de demo y el alta

Un comercio llega al POS por un **link de demo** que arma el backend:

```
<pos>/?demo=true&backend=<base URL>&template=<opcional>
```

`backend` tiene que ser `https:`, o `http:` a `localhost`, `127.0.0.1` o `[::1]`. En una terminal
nueva (sin conexión configurada y sin datos), el POS llama a `POST /demo-sessions` en ese backend: es
el **único endpoint sin autenticación**. La respuesta trae la API key de la demo, la sucursal, el
punto de venta y la página de alta (`onboarding.url` y el texto de su botón). El POS prueba la
conexión, la aplica y entra a la venta.

Una terminal en demo muestra la marca **DEMO** y un botón para darse de alta. Ese botón lleva a
`onboarding.url` con `?return_url=<url del POS>&wipe_key=<token>`. Cuando el alta termina, el backend
devuelve al usuario a:

```
<return_url>#connect=<base64url de JSON>
JSON: { baseUrl, apiKey, branch, pointOfSale, wipeKey? }
```

La conexión viaja en el **fragmento** (`#…`), nunca en la query string: el navegador no manda el
fragmento al servidor que sirve el POS. `wipeKey` es el `wipe_key` recibido en la ida, sin modificar:
con él, el POS borra los datos de la demo y aplica la conexión real; sin él, precarga la
configuración para que el operador decida.

Un backend que no ofrece demos no implementa `POST /demo-sessions`; el operador carga la conexión a
mano en `/CONFIG` (URL y API key).

## Implementar el contrato

Principio central: **el backend nunca rechaza el contenido de lo que manda el POS**. No hay forma de
que una venta, un cliente o un movimiento de caja sea "rechazado" de forma síncrona: el backend
registra todo y audita, y una inconsistencia se resuelve de su lado o a mano. Para avisarle algo al
humano, el backend manda avisos (`notices`) en el pull.

Las operaciones:

| Operación             | Para qué                                                                                                                                                                                                                                                                  |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /info`           | Versión del contrato, estado (`ok` o `maintenance`) y capacidades. Liviana: el POS la consulta al probar la conexión, al arrancar y antes de sincronizar.                                                                                                                 |
| `POST /sync/push`     | Un lote con todos los eventos pendientes de la terminal (ventas, pagos, movimientos de stock y de caja, cobranzas, clientes). Responde un **ack de recepción**, no de procesamiento. Idempotente por `Idempotency-Key`: reintentar el mismo lote nunca duplica su efecto. |
| `POST /sync/pull`     | Catálogo, clientes con su saldo, stock, el estado de los lotes enviados y los avisos vigentes. Delta por cursor o foto completa.                                                                                                                                          |
| `POST /account-holds` | La única operación síncrona: reserva de crédito para una venta a cuenta corriente.                                                                                                                                                                                        |
| `POST /demo-sessions` | Opcional: arranca una demo (ver la sección anterior).                                                                                                                                                                                                                     |

Todo request del POS lleva:

- `Authorization: Bearer <apiKey>` (salvo `POST /demo-sessions`). Cómo se emite esa API key lo
  define cada backend.
- `X-POS-Contract-Version: <versión>`. Si el major no es uno que el backend soporta, responde `409`
  sin procesar nada; nada se pierde, el lote queda en la terminal hasta que el backend se actualice.

El POS corre en otro origen que el backend: el backend tiene que contestar **CORS** (incluidos
`Authorization`, `Idempotency-Key` y `X-POS-Contract-Version` en los headers permitidos). Si el
backend corre en la red local o en `localhost` y el POS está publicado en `https`, conviene además
contestar el preflight de red privada (`Access-Control-Allow-Private-Network: true` cuando llega
`Access-Control-Request-Private-Network: true`), como hace el demo-backend.

El detalle de cada operación, sus esquemas y ejemplos está en
[`connector-api.openapi.yaml`](../connector-api.openapi.yaml).

## Compatibilidad y capacidades

Un backend es compatible con el POS si habla el **mismo major** y un **minor igual o mayor que el
piso 4.0.0**. Un agregado nuevo del contrato no obliga a todos los backends a actualizarse.

Lo que un backend hace más allá del piso lo declara como **capacidad** en `GET /info`
(`capabilities`):

| Capacidad               | Qué habilita                                 |
| ----------------------- | -------------------------------------------- |
| `demo-sessions`         | El backend implementa `POST /demo-sessions`. |
| `customer-payment-void` | El POS puede anular cobranzas.               |

El POS nunca deduce una capacidad de la versión, e ignora una capacidad que no conoce. Las reglas de
evolución (campos y valores desconocidos, fotos completas, numeración con huecos) están en la sección
"Reglas de evolución" del OpenAPI.

## Servir el POS desde tu propio servidor

Cada versión publicada se puede descargar como zip desde `/versions`. Para servirla en tu
infraestructura:

- Descomprimí el zip y serví su carpeta como archivos estáticos, en **una carpeta propia** (por
  ejemplo `/pos/`).
- Abrila **siempre con barra final** (`/pos/`, no `/pos`): el build usa rutas relativas, y sin la
  barra los archivos no cargan.
- Cada carpeta tiene su **propio almacenamiento** en el navegador (IndexedDB y `localStorage`).
  Cambiar de carpeta, de versión o de dominio es una **instalación nueva**: lo que no se llegó a
  sincronizar queda en la carpeta anterior. Antes de cambiar, sincronizá.

## Aparecer en /versions

La página `/versions` lista cada versión publicada del POS contra los backends conocidos, con su
link de demo o el motivo de la incompatibilidad. Para sumar el tuyo, abrí un PR a
[`site/backends.json`](https://github.com/rauldiazsolis/offline-pos/blob/main/site/backends.json) con
`name`, `url` (`https`) y, si querés, `notes`.

El backend tiene que ofrecer demos (capacidad `demo-sessions`): la página se genera todos los días
consultando en vivo `POST /demo-sessions` y, con esa conexión, `GET /info`. Si tu backend no
contesta, la página no se publica hasta que vuelva.
