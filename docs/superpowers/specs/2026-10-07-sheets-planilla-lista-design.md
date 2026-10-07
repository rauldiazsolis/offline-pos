# Google Sheets: la planilla lista en un paso

Fecha: 2026-10-07
Estado: diseño aprobado en la prueba con el usuario; plan en `docs/superpowers/plans/`.
Issue: #219. Antecedentes: epic #180 (el puente en 4.6.0, "Conectar el POS" y el puente publicado),
#212 (la Descripción de una línea de producto). La forma final salió de un prototipo fuera del repo
(`pos-sheets.gs`, versiones 1 a 5, pegado a mano en Apps Script) probado con el usuario el 2026-10-06
y el 2026-10-07.

## Contexto

- **Hoy** conectar una planilla es: pegar `bridge.gs` y `columnas.gs` en Apps Script, implementar la
  aplicación web, abrir su página, tocar "Conectar el POS" y completar en `/CONFIG` la sucursal y la
  caja. La planilla nace con las pestañas vacías y 5 productos de ejemplo (`SEED` del puente).
- **Ya hecho en la rama de esta etapa**:
  - el POS acepta `branch` y `pointOfSale` en el `#connect` de Sheets y aplica la conexión sola si
    no se pierde nada (`sync/demo-link.ts`, `ui/onboarding.ts::handleSheetsReturn`), sin cambio de
    contrato;
  - #212: `pushSale` escribe en Descripción el nombre del producto que tiene Productos.
- **El agujero de `google.script.run`**: desde que `doGet` es una página de `HtmlService` (#133),
  cualquiera que abra la URL del Web App puede llamar desde la consola del navegador a cualquier
  función del proyecto cuyo nombre no termine en `_`, y corre con los permisos del dueño. Hoy eso
  incluye `pushBatchAction`, `pullBatchAction`, `appendObjects`, `setCells`, etc.: escribir en la
  planilla sin el `SHARED_SECRET`.

## Qué se busca

Que un comercio sin conocimientos técnicos llegue de una planilla vacía al POS vendiendo en tres
pasos: **pegar un archivo, implementar, completar un formulario**. Y que la planilla le muestre algo
útil desde el primer minuto: datos de prueba de su rubro y un tablero.

## Decisiones

- **Un solo archivo, `pos-sheets.gs`**, que se pega en el `Código.gs` que trae todo proyecto nuevo.
  En el repo las partes siguen separadas (el puente, los textos, la home, la inicialización, el
  tablero y un archivo de datos por rubro) y un paso del armado del sitio las concatena. Se publica
  solo `pos-sheets.gs`: dejan de publicarse `bridge.gs` y `columnas.gs` sueltos.
- **La home de la aplicación web hace todo**: sin plantilla compartida ni hoja de bienvenida con
  botones (se probaron: más pasos y botones asignados a scripts que el comercio no tiene por qué
  entender). Implementar sigue siendo manual: hacerlo desde el script exige la API de Apps Script y
  un permiso amplio.
- **Permisos**: los mismos de hoy, solo esta planilla (`@OnlyCurrentDoc`). Sin diálogos ni menús
  (pedirían `script.container.ui`), sin `clasp` y sin tablas nativas de Sheets (piden acceso a todas
  las planillas; se descartaron también en la Etapa 2d). Verificado en la prueba: renombrar la
  planilla, borrar y ordenar pestañas, crear un gráfico y `google.script.run` desde la home anónima
  andan con el permiso de siempre.
- **La home es pública, así que no destruye nada**: inicializar solo con la planilla virgen;
  reiniciar (solo para probar) exige que un editor ponga "Sí" en "Permitir reiniciar" en
  Configuración; agregar el tablero a una planilla anterior no borra nada.
- **Tablas de Sheets**: no se soportan en las pestañas que escribe el puente. Convertir Ventas en
  tabla deja las filas en blanco ("No puedes configurar el formato de número de las celdas de una
  columna con texto", probado el 2026-10-07). Se descartó un parche que no se puede probar: la guía
  pasa a recomendar una pestaña aparte con `QUERY` o `FILTER` para consultas propias, y deja de decir
  que se puede convertir un rango en tabla.
- **Los datos de prueba son del prototipo, no de la realidad**: precios aproximados de octubre de
  2026, ids y códigos de barras inventados (EAN-13 válidos con prefijo `7799881`/`7799883`/`7799884`).

## La home (`doGet`)

Una sola página de `HtmlService` que se dibuja con el estado que le pasa el servidor
(`estadoDeLaHome_`), y se redibuja con el que devuelve cada acción (sin recargar).

- **Planilla sin inicializar** (no existe Productos): "Preparar la planilla", con Nombre del
  comercio, Sucursal y Caja (requeridos, con `placeholder`s "ej. …") y "Empezar con": Ferretería
  (elegida), Kiosco, Almacén o Vacía. "Preparar la planilla" llama a `posInicializar` y muestra
  "Preparando… (puede tardar unos segundos)"; un error se muestra debajo del formulario.
- **Planilla inicializada**: el comercio como título, "Sucursal X · contrato 4.6.0", el resumen de lo
  cargado si se acaba de preparar, **Abrir la planilla** (directo al Tablero: `#gid=` de esa pestaña)
  y el recuadro **Abrir el POS en esta terminal**, con la Caja precargada y editable. El link es
  `<URL del POS>#connect=<base64url>` con `{ type: 'google-sheets', webAppUrl, branch, pointOfSale }`,
  armado en el navegador con la caja que se tipea. Nunca lleva el secreto.
- **Sin Tablero** (una planilla preparada antes de esta etapa): un botón "Agregar el tablero".
- **Con "Permitir reiniciar" = Sí**: "Reiniciar la planilla", que borra todas las pestañas, deja una
  "Hoja 1" vacía, renombra la planilla "Planilla sin inicializar" y vuelve al formulario.
- Si falta `columnas.gs` no aplica: es un solo archivo.

## La inicialización (`posInicializar`)

Con el cerrojo del script (el mismo de `doPost`), y negándose si la planilla ya está inicializada:

1. La primera hoja vacía de una planilla nueva ("Hoja 1") pasa a llamarse Tablero, y las otras
   vacías se borran. El script no puede elegir qué pestaña ve quien ya tiene la planilla abierta
   (probado: al borrar "Hoja 1", Sheets lo pasaba a Productos); renombrándola, termina viendo el
   Tablero. Quien la abre después entra por "Abrir la planilla", con el `#gid=` del Tablero.
2. Crea las pestañas del puente (`ensureSheetsExist`), sin datos de ejemplo (sale `SEED`).
3. Renombra la planilla con el comercio: es la empresa que muestra el POS (`info.company`).
4. Escribe en Configuración, arriba: Comercio, Sucursal, Caja y "Permitir reiniciar" = No.
5. Si se eligió un modelo, carga sus datos (abajo).
6. Arma el Tablero (en la hoja renombrada, o en una nueva si no había ninguna vacía), primero en el
   orden: Tablero, Productos, Clientes, Ventas, Pagos,
   CuentaCorriente, MovimientosCaja, Cobranzas, Configuración (y las dos ocultas).

Devuelve el estado de la home con el resumen ("Ferretería: 42 productos, 7 clientes, 150 ventas, 1
anulación, 4 cobranzas y 15 movimientos de caja en los últimos 10 días.").

## Los datos de prueba

Un archivo por rubro (`datos-ferreteria.gs`, `datos-kiosco.gs`, `datos-almacen.gs`), cada uno con
una función privada (`datosFerreteria_`, …) que devuelve `{ nombre, productos, clientes, historia }`:

- **productos** con las claves internas de Productos (`id`, `sku`, `barcodes`, `name`, `price`,
  `taxRate`, `category`, `blocked`, `blockedReason`) más cómo se venden: `frecuencia` y `cantidades`
  (con decimales lo que va por peso o por metro, que no lleva código de barras). Uno bloqueado por
  rubro, para que se vea la advertencia.
- **clientes** con las claves de Clientes más `fia` (compra a cuenta) y `saldoInicial` (lo que ya
  debía). Uno bloqueado con deuda.
- **historia**: semilla, días (10), días cerrados, horarios, ventas por día, medios de pago con su
  peso, proporción de ventas con cliente y fiadas, descuentos, líneas libres, cobranzas por día, día
  de la anulación, fondo inicial, egresos y arqueos.

El generador (en `inicio.gs`) arma, de hace 10 días hasta ayer y con las fechas relativas a hoy:
ventas con su número de ticket por día, pagos (también divididos), fiado en CuentaCorriente, una
anulación (el primer día abierto desde `diaDeLaAnulacion`), cobranzas de quien debe (nunca del
bloqueado), y en caja el fondo inicial, egresos con el efectivo que hay, el retiro al cerrar y
arqueos con diferencias chicas. Generador pseudoaleatorio con semilla fija (mulberry32): la historia
es la misma para un rubro, solo se corren las fechas. Ids ULID. Las filas llevan el dispositivo
`datos-de-prueba` y la sucursal y la caja del formulario. Todo se escribe con un `appendObjects` por
pestaña.

| Rubro | Productos | Clientes | Cómo es |
|---|---|---|---|
| Ferretería | 42 | 7 | Cerrado el domingo, mañana y tarde, ~15 ventas por día, fiado de constructoras y oficios |
| Kiosco | 30 | 5 | Todos los días de 7 a 23, ~60 ventas chicas, efectivo y QR, poco fiado |
| Almacén | 38 | 8 | Fiambres, verduras y pan por peso, IVA 10,5 % en lo básico, ~40 ventas, mucha libreta |

## El tablero

Pestaña "Tablero" con fórmulas vivas, armadas con las columnas que el puente encuentra en ese momento
(`headerMap`): si después se mueven columnas, Sheets ajusta las referencias solo.

- A1 el comercio; A2 "Se actualiza solo con cada venta que llega del POS. Los montos ya descuentan
  las anulaciones."
- Indicadores (fila 4 el título, fila 5 el valor): Vendido hoy (A), Tickets hoy (C), Vendido en 7
  días (E) y Fiado pendiente (L, arriba de "Fiado por cliente"). Lo vendido sale de Pagos (las
  anulaciones restan solas); los tickets, de los ids distintos de Ventas.
- Ventas por día de los últimos 14 días (A:C) con un gráfico de columnas debajo; medios de pago de 7
  días (E:F); los 10 más vendidos de 7 días por importe (H:J, `QUERY`, cantidad × precio sin
  descuentos, por la Descripción); el fiado por cliente (L:M, `QUERY` con el nombre de Clientes, sin
  los saldos en cero).
- **Separadores**: en una planilla en español los argumentos van con `;` y las columnas de un arreglo
  con `\` (verificado: con `,` daba "Error de análisis de fórmula"). Se prueba `=SUM(1,2)` en una
  celda y se borra; las fórmulas se escriben con `;` y `\` y se pasan a `,` si la planilla usa coma.
  Los nombres de función van en inglés en los dos casos.

## Seguridad

- Las únicas funciones públicas del proyecto son `doGet`, `doPost`, `posInicializar`,
  `posReiniciar` y `posAgregarTablero`. Todas las demás (del puente y de lo nuevo) terminan en `_`.
  Las tres `pos*` validan su condición dentro del cerrojo.
- Un test carga `pos-sheets.gs` armado y verifica esa lista exacta de funciones públicas.

## El puente

- Sin `SEED`: las pestañas nacen vacías. Una planilla que conecta el POS sin pasar por la home
  (pegando la URL en `/CONFIG`) queda inicializada sin datos, como cualquier comercio que empieza de
  cero.
- `CONFIG_STEPS` (debajo de las claves de Configuración) describe el flujo nuevo: abrir la URL de la
  aplicación web desde cada terminal, poner la caja y tocar Abrir el POS; qué es "URL del POS" y
  "Permitir reiniciar"; el secreto, en las propiedades del script.
- El resto, sin cambios: `doPost`, el contrato del puente y la forma de la planilla.

## Publicación

- `site/build-channel.ts` arma `docs/google-sheets/pos-sheets.gs` concatenando, en orden fijo,
  `bridge.gs` (con `@OnlyCurrentDoc` en el primer comentario), `columnas.gs`, `inicio.gs`,
  `home.gs`, `tablero.gs` y los tres `datos-*.gs`. Dejan de publicarse `bridge.gs` y `columnas.gs`.
- La página de la guía (`docs/google-sheets/index.html`) suma un botón **Copiar el código** que copia
  `pos-sheets.gs` al portapapeles, y el link al archivo.
- **La guía** (`docs/integradores/google-sheets.md`) se reescribe para el flujo nuevo: instalar
  (pegar en `Código.gs`), implementar, preparar la planilla, abrir el POS en cada terminal, el
  tablero, actualizar (pegar la versión nueva y una nueva versión de la misma implementación; quien
  tenía los dos archivos los borra y pega el único), reiniciar para probar, y la corrección sobre las
  tablas. Sigue sin referencias internas (`site/docs.test.ts`, ahora sobre todos los `.gs`).
- **La home de pos.contax.ar** (`site/home-page.ts`) suma, antes de "Para integradores", la sección
  **"Con Google Sheets"**: una línea ("Sin servidor y gratis: una planilla de Google como backend")
  y el link a las instrucciones del canal más nuevo (`v4/docs/google-sheets/`).
- **Versión 0.7.0** del POS con todo lo de la rama; se publica con `docs/publicacion.md`.

## Tests

- `bridge.test.ts` y los nuevos cargan los archivos con el mismo arnés `vm` y la planilla falsa,
  que suma lo que usa lo nuevo: `getSheets`, `deleteSheet`, `rename`, `setActiveSheet`,
  `moveActiveSheet`, `getSheetId`, rangos en notación A1, `setFormula`, `getValue`, `clear`,
  `setFontSize`, `setFontColor`, `setColumnWidth` y un `newChart`/`insertChart` de mentira.
- **Inicialización**: crea las pestañas en orden y "Hoja 1" pasa a ser el Tablero; renombra; escribe Configuración;
  se niega si ya está inicializada; vacía no carga nada. Con cada rubro: los totales de cada venta
  coinciden con sus pagos, los tickets son correlativos por día, hay exactamente una anulación (también
  si el día elegido cae cerrado), ningún código de barras repetido, ningún cobro al bloqueado, y un
  `pullBatch` devuelve los productos y los saldos.
- **Home**: el estado sin inicializar y el inicializado; el link a la planilla con `#gid=`;
  reiniciar con y sin "Sí"; agregar el tablero sin borrar nada.
- **Tablero**: las fórmulas con `;` y `\` o con `,` según la prueba del separador; el fiado en L.
- **Seguridad**: la lista exacta de funciones públicas.
- **Sitio**: `pos-sheets.gs` publicado y armado en orden, sin `bridge.gs` ni `columnas.gs` sueltos;
  la home con la sección de Google Sheets; `docs.test.ts` sobre los `.gs` nuevos.

## Verificación manual

En Sheets real, con el `pos-sheets.gs` del canal armado en local: planilla vacía, pegar, implementar,
preparar con cada rubro, ver el tablero y abrir el POS (con `URL del POS` apuntando al POS local);
vender y ver la venta en Ventas (con su Descripción) y en el tablero.

## Documentación del repo

`AGENTS.md` (Connector API: el puente como un solo archivo publicado; la tabla de estado),
`src/connectors/AGENTS.md` (las partes, el armado, la home, la inicialización, los datos, el tablero
y la regla de las funciones públicas) y el README del conector.

## Fuera de alcance

- Tablas de Sheets en las pestañas del registro.
- Más rubros, o cargar los datos de un rubro en una planilla ya preparada.
- Actualizar el puente desde la home.
