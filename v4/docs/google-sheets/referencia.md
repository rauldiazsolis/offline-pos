# Google Sheets: referencia del puente

Una planilla de Google Sheets puede ser el backend del POS: el POS habla con ella a través de un
**puente de Apps Script**, un solo archivo que se pega en la planilla y se implementa como aplicación
web: [`pos-sheets.gs`](pos-sheets.gs). Cómo instalarlo y conectar las cajas,
paso a paso, está en el [setup](./); esta página es el resto, para quien quiera
entender el puente o integrarse con él.

Esta página acompaña al contrato **4.6.0** (el mismo que la [guía para integradores](../guia.md)). Bajá
siempre el archivo de las docs del canal donde están tus terminales.

## Qué hace y qué no

El puente es un backend más del POS, con el mismo contrato que un backend REST pero con otro
transporte (ver "El contrato del puente", abajo). En el POS se elige como tipo de conexión "Google
Sheets".

- **Capacidades**: anula cobranzas (`customer-payment-void`) y ofrece el portal (`portal`): el
  comando `/PLANILLA` y el botón "Abrir planilla" abren la planilla en una pestaña nueva.
- **Empresa**: el nombre de la planilla es el nombre de la empresa que muestra el POS.
- **Cuenta corriente sin límite**: la planilla no maneja crédito. El fiado siempre se aprueba, sin
  red, y el saldo de cada cliente sale de su libro de cuenta corriente.
- **Sin stock**: el POS nunca controla stock para los productos de la planilla.
- **Sin avisos**: la planilla nunca está en mantenimiento ni manda avisos al POS.

## Permisos y acceso

- **Solo esta planilla**: el código lleva la anotación `@OnlyCurrentDoc` en su primer comentario, así
  Google pide acceso solo a la planilla donde está pegado ("See, edit, create, and delete this
  spreadsheet"). Si la autorización pide acceso a **todas** tus planillas, la anotación no está. El
  aviso de "app no verificada" es normal en un script propio.
- **"Cualquier persona"** no significa que cualquiera pueda editar la planilla: el script corre con
  los permisos de quien lo implementó y solo expone lo que necesitan el POS y la página. Es la única
  forma de que el POS escriba sin que nadie tenga que iniciar sesión en Google. La página nunca borra
  nada: preparar solo anda con la planilla sin preparar, y reiniciar exige "Permitir reiniciar" = Sí
  en la pestaña Configuración.
- **Secreto compartido** (opcional): la propiedad del script `SHARED_SECRET`. Con ella, el puente
  rechaza todo pedido que no la traiga; cada terminal la carga una vez en la configuración del POS.
  Nunca va en la planilla (viajaría con cada copia) ni en el link de la página, que es pública.

## La planilla preparada

Preparar la planilla crea las pestañas, le pone a la planilla el nombre del comercio (es el que
muestra el POS) y guarda el comercio, la sucursal y la caja en la pestaña Configuración. Con un
rubro (**Ferretería**, **Kiosco** o **Almacén**) trae productos, clientes y diez días de ventas,
cobranzas y movimientos de caja de ejemplo, hasta ayer; un producto y un cliente vienen bloqueados,
para ver cómo lo avisa el POS.

## El link de cada caja

"Abrir el POS" lleva al POS con esta planilla, la sucursal y la caja en el fragmento del link
(`#connect=`). Si la terminal no tenía datos, el POS prueba la conexión y entra directo a la venta;
si tenía datos de otra conexión, o la planilla tiene secreto, abre su configuración con todo
precargado.

El link lleva la URL de **esa** implementación, así una copia de la planilla nunca conecta al POS con
la original, y **nunca** lleva el secreto. Sin la página, también se puede elegir "Google Sheets" en
`/CONFIG` del POS y pegar la URL de la aplicación web.

## El Tablero

La primera pestaña resume lo que pasa en el comercio, con fórmulas que se actualizan solas con cada
venta que llega del POS: lo vendido hoy, los tickets de hoy, lo vendido en 7 días, el fiado
pendiente, las ventas de cada uno de los últimos 14 días (con un gráfico), los medios de pago, los
10 productos más vendidos y lo que debe cada cliente. Los montos ya descuentan las anulaciones.

Si movés columnas de las otras pestañas, las fórmulas las siguen solas. A una planilla preparada
antes de que existiera el Tablero, la página le ofrece **Agregar el tablero**, sin tocar nada más.

## La pestaña Configuración

Pares clave/valor que el puente encuentra por el texto de la clave (columna A), no por la fila, y
debajo los pasos para conectar una terminal. Se le puede dar formato o moverla.

- **URL del POS**: adónde lleva "Abrir el POS" (por omisión `https://pos.contax.ar/v4/`, también con
  la celda vacía o con algo que no empiece con `http://` o `https://`). Cambiala para usar otro canal
  o un POS propio.
- **Comercio**, **Sucursal** y **Caja**: lo que se cargó al preparar la planilla; la página los usa
  para "Abrir el POS".
- **Permitir reiniciar**: con **Sí**, la página ofrece "Reiniciar la planilla" (ver
  [Volver a empezar](./#volver-a-empezar)).

El secreto compartido nunca va en esta pestaña: viajaría con cada copia de la planilla.

## El portal: abrir la planilla desde el POS

Con la terminal conectada, el comando `/PLANILLA` y el botón "Abrir planilla" de la barra de estado
abren la planilla en una pestaña nueva. No hay token: abrirla ya exige una cuenta de Google con
acceso a la planilla.

## Actualizar el puente

Los pasos están en el [setup](./#actualizar-el-puente): se reemplaza el código y se
publica una **nueva versión** de la misma implementación, para que la URL no cambie.

Una planilla anterior se actualiza sola: el puente agrega al final de cada pestaña las columnas
opcionales nuevas que le falten, y las filas que ya estaban quedan como estaban. Después de
actualizar, el primer pedido del POS puede volver a traer todos los productos y clientes: es
esperado.

## Cómo se ve y cómo se edita la planilla

Pestañas: **Tablero**, **Productos** y **Clientes** (los carga el comercio), **Ventas**, **Pagos**,
**CuentaCorriente**, **MovimientosCaja** y **Cobranzas** (las escribe el puente), **Configuración**,
y dos ocultas que usa el puente (`_PushLots` y `_Snapshot`).

El puente encuentra cada columna por su **encabezado**, no por su posición, sin distinguir
mayúsculas, acentos ni espacios. Podés:

- reordenar columnas y agregar las tuyas (notas, cálculos): se ignoran;
- borrar `Documento`, `Teléfono` o `Códigos de barras`, que son opcionales;
- **bloquear** un producto o un cliente: "Sí" en `Bloqueado` y, si querés, el motivo en `Motivo del
bloqueo`. Es informativo: el POS lo muestra, pero nunca impide vender ni cobrar;
- dejar vacía `Alta`: el puente la completa con la hora de la primera vez que lee la fila.

Las demás columnas no se pueden borrar ni renombrar: el puente responde con un error que dice cuál
falta (`Falta la columna 'Precio' en la pestaña Productos`) y el POS lo muestra. Para renombrar una
columna o un valor, cambiá su etiqueta en `pos-sheets.gs`: los textos de la planilla están juntos,
en `COLUMN_LABELS` y `VALUE_LABELS`.

Cada pestaña nueva nace con formato por columna (texto para ids y códigos, importes con miles y
decimales, fechas reales, cantidades con hasta tres decimales, listas desplegables en los valores
fijos); las filas nuevas copian el formato de la fila 2.

**No conviertas en tabla** (Formato > Convertir en tabla) las pestañas que escribe el puente: la
tabla no deja copiar el formato a las filas nuevas y la venta queda en una fila vacía. Para tus
propias consultas, armá una pestaña aparte con `QUERY` o `FILTER` sobre ellas, como el Tablero.
Tampoco se crean tablas desde el puente: hacerlo desde Apps Script exige un permiso sobre todas tus
planillas o todo tu Drive.

## Qué guarda cada evento

Cada fila que escribe el puente lleva el dispositivo, la sucursal y el punto de venta de la terminal.
Un evento nunca se modifica: una anulación es otro registro que apunta al original.

- **Venta**: una fila por línea en Ventas (con la fecha y el número del ticket) y una por medio en
  Pagos. La Descripción de una línea de producto es el nombre que el producto tiene en Productos al
  registrarse la venta (si el id ya no está, queda vacía). Un pago a cuenta corriente suma una fila
  en CuentaCorriente.
- **Anulación de una venta**: otra venta, con líneas y pagos invertidos, la columna **Anula a** y el
  motivo; las filas del original pasan a Estado = Anulada. Si la planilla no tiene el original, no es
  un error.
- **Cliente nuevo** (dado de alta en el POS): una fila en Clientes.
- **Movimiento de caja** (ingreso, egreso o ajuste por arqueo): una fila en MovimientosCaja.
- **Cobranza** (un cliente paga a cuenta): una fila por medio en Cobranzas (con la fecha y el
  número del recibo) y el total en negativo en CuentaCorriente.
- **Anulación de una cobranza**: otra cobranza en negativo, con **Anula a**; la original pasa a
  Estado = Anulada.

**CuentaCorriente** es el libro de cada cliente: ventas a cuenta en positivo, acreditaciones y
cobranzas en negativo. El saldo que el POS muestra de un cliente es la suma de sus filas.

## El contrato del puente

Un integrador no necesita esta sección para usar el puente: es para quien quiera entenderlo o
escribir otro cliente.

`POST <URL de la aplicación web>` con `Content-Type: text/plain;charset=utf-8` (a propósito, no
`application/json`: evita el preflight `OPTIONS`, que Apps Script no maneja) y un body JSON:

```json
{
  "action": "pushBatch",
  "payload": { "deviceId": "3f0c…", "events": [] },
  "idempotencyKey": "01J…",
  "sharedSecret": "…",
  "contractVersion": "4.6.0"
}
```

La respuesta siempre es HTTP 200 y el resultado viaja en el body:

```json
{ "ok": true, "data": {} }
{ "ok": false, "error": "mensaje" }
{ "ok": false, "error": "mensaje", "code": "incompatible-contract", "contractVersion": "4.6.0" }
```

Apps Script no expone los headers, así que la versión del contrato y el secreto van en el body. Con
otra versión mayor, el puente responde `incompatible-contract` **sin procesar nada**: el POS no
recibe ack y lo pendiente espera en la terminal hasta que se actualice el puente.

Acciones:

- `info`: sin payload. La versión del contrato, el estado (siempre `ok`), las capacidades, el portal
  y la empresa, con la misma forma que `GET /info` del [OpenAPI](../connector-api.openapi.yaml).
  Liviana: no toma el lock ni crea pestañas.
- `pushBatch`: payload `{ deviceId, events }`, cada evento con su `id`, `createdAt` y `origin`.
  Aplica el lote entero de una vez y responde `data: {}`. Es idempotente por `idempotencyKey` (el
  lote, no cada evento). Un evento que no se puede aplicar queda como _issue_ del lote con su id,
  sin tumbar el resto.
- `pullBatch`: payload `{ deviceId, cursors: { products?, customers? }, pendingLotIds }`. Responde
  `data: { products: { items, nextCursor? }, customers: { items, nextCursor? }, lots }`, con el
  estado (`ok` o `issues`) de los lotes pedidos. La planilla procesa cada lote dentro del pedido, así
  que nunca informa `queued` ni `processing`.
- `portalLink`: sin payload. Responde `data: { url }`, la URL de la planilla. Liviana, como `info`.

`pushBatch` y `pullBatch` toman el lock del script: la foto y el estado de los lotes son siempre del
mismo instante.

**Cursor del pull.** Sheets no registra cuándo cambió cada fila. El puente guarda una huella del
contenido de cada fila de Productos y Clientes en la pestaña oculta `_Snapshot` y la compara en cada
pull: una fila nueva o cambiada toma la hora actual, y el cursor es la hora más nueva de cada
pestaña. Así cubre igual una edición a mano en la planilla que una escritura del propio puente.

## Limitaciones

- **Bajas**: borrar una fila de Productos o Clientes no viaja en el pull por cursor; el POS la ve
  recién en la próxima foto completa (al conectar, cada 2 horas o con `/SINCRONIZAR`).
- **Cuotas de Apps Script**: Google limita el tiempo de ejecución y la cantidad de pedidos por día
  de cada cuenta. Alcanza para un comercio chico; para muchas terminales o mucho volumen, conviene un
  backend REST.
- **Una planilla a la vez**: el lock del script hace que los pedidos de varias terminales se
  atiendan de a uno. Si la planilla está ocupada más de 30 segundos, el pedido falla y el POS lo
  reintenta.
- **Sin stock, sin límite de crédito y sin avisos**, como se dijo arriba.
- **Sin reinicio desde el POS**: la planilla nunca se borra desde una terminal; solo desde su página,
  y con "Permitir reiniciar" = Sí (ver [Volver a empezar](./#volver-a-empezar)).
