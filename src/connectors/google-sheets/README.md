# Conector de Google Sheets

Backend completo para un micro-comercio sin ERP: el catálogo y las ventas viven en una planilla de
Google Sheets. Implementa el puerto `Connector` (`src/sync/connector.ts`) contra un **puente Apps
Script** (`bridge.gs`) desplegado como Web App.

> Estado: conectado al POS desde la Etapa 2 del epic #68 — se elige en `/CONFIG` con el tipo de
> conexión "Google Sheets". Desde la Etapa 2 del rediseño de sync por lotes (#87), habla el
> contrato batch (`pushBatch`/`pullBatch`) igual que el conector REST, con cursor real para
> Productos/Clientes.

## Setup (comerciante)

1. Hacer "Archivo > Hacer una copia" de la plantilla de planilla (viene con `bridge.gs` y
   `columnas.gs` ya incrustados, y con datos de prueba). Si armás el proyecto a mano: Extensiones >
   Apps Script, y pegá **los dos archivos** (`bridge.gs` y `columnas.gs`) como archivos del mismo
   proyecto. Sin `columnas.gs` el puente responde `Falta el archivo columnas.gs…`.
2. En la copia: Extensiones > Apps Script > Implementar > Nueva implementación > **Aplicación web**:
   - "Ejecutar como": **Yo**
   - "Quién tiene acceso": **Cualquier persona**
3. Copiar la URL de la aplicación web (`https://script.google.com/macros/s/.../exec`).
4. (Opcional, recomendado) Proteger el puente con un secreto compartido: Configuración del proyecto >
   Propiedades de la secuencia de comandos > agregar `SHARED_SECRET` con el valor que quieras.
5. Pegar la URL (y el secreto, si lo pusiste) en `/CONFIG`: elegir el tipo de conexión "Google
   Sheets" (con la letra G alcanza) y completar "URL del Web App" y, opcionalmente, "Secreto
   compartido". Ctrl+Enter guarda.

"Cualquier persona" **no** significa que cualquiera pueda editar tu planilla: el script corre con tus
permisos y solo expone las acciones de `bridge.gs`. Es la única forma de que el POS escriba sin que
nadie tenga que iniciar sesión en Google. Con `SHARED_SECRET`, además, hace falta conocer el secreto.

**Permisos que pide Google al autorizar el script:** solo acceso a _esta_ planilla ("See, edit,
create, and delete **this** spreadsheet"). `bridge.gs` lleva la anotación `@OnlyCurrentDoc` justamente
para eso. Si la pantalla de autorización dice "**all** your Google Sheets spreadsheets", cancelá:
revisá que la anotación esté en la primera línea del script y volvé a autorizar. Google además
muestra un aviso de "app no verificada": es normal en un script propio y personal.

Si la planilla no tiene las pestañas que el puente necesita, las crea sola en el primer request (y
siembra datos de prueba en `Productos` y `Clientes`).

## Cómo se ve y cómo se edita la planilla

Todo está en español: pestañas (`Productos`, `Clientes`, `Ventas`, `Pagos`, `CuentaCorriente`,
`Turnos`), encabezados ("Precio unitario", "Medio de pago") y valores ("Efectivo", "Cerrada",
"Producto"). Los nombres los define `columnas.gs` — es el único archivo que hay que tocar para
cambiarlos; `bridge.gs` trabaja con claves internas que no se renombran.

El puente encuentra cada columna por su **encabezado**, no por su posición. Podés:

- reordenar columnas y agregar las tuyas ("Notas", cálculos…): se ignoran;
- convertir un rango en una tabla de Google Sheets desde el menú (Formato > Convertir en tabla);
- borrar `Documento`, `Teléfono` o `Códigos de barras` (son opcionales).

No podés borrar ni renombrar las demás columnas: el puente responde con un error que dice cuál falta
(`Falta la columna 'Precio' en la pestaña Productos`) y el POS lo muestra en la barra de estado.
Reconocer un encabezado no distingue mayúsculas, acentos ni espacios, y también entiende los nombres
de versiones anteriores (`name`, `precioUnitario`…): al leer una pestaña vieja, los pasa a la etiqueta
nueva; los datos y los valores viejos (`cash`, `cerrada`) se siguen leyendo.

Cada pestaña nueva nace con el tamaño exacto (encabezado y una fila de datos vacía) y con formato por
columna: texto para ids y códigos, importes con miles y decimales, IVA en porcentaje, fechas reales
(`dd/mm/aaaa hh:mm`) y listas desplegables en Estado, Medio de pago, Tipo y Tipo de descuento. Las
filas nuevas copian ese formato de la fila 2. Las pestañas que ya existían no se redimensionan.

**Permisos mínimos, a propósito.** El puente pide solo acceso a esta planilla (`@OnlyCurrentDoc`). Las
tablas nativas de Sheets no se usan porque crearlas desde Apps Script exige el servicio avanzado de
Sheets API, que necesita un permiso mucho más amplio (todas tus planillas o todo tu Drive).

## Qué hace cada operación

Desde la Etapa 2 (#87) el puente expone solo dos acciones — igual que el contrato REST —, cada una
resolviendo internamente varias de las operaciones de antes:

| Operación del POS | Comportamiento                                                                                                                                                                                             |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pushBatch`        | Aplica **todo el lote de una sola vez**: una fila por línea/pago en `Ventas`/`Pagos` (`sale`), marca Estado = Anulada sin borrar (`sale-void`), una fila en `Clientes` (`customer`), una fila en `CuentaCorriente` derivada de `Ventas`/`Pagos` (`account-hold-confirm`), una fila en `Turnos` con el total por medio de pago (`cash-session`). `stock-movement`/`account-hold-release` son no-ops. Un evento que no se puede aplicar (ej. `sale-void` de una venta que esa fila todavía no tiene) queda como *issue* del lote — nunca tumba el resto del lote ni el ack. |
| `pullBatch`        | Trae `Productos` y `Clientes`, completo o solo lo que cambió desde el cursor de cada uno (ver "Cursor de pull" abajo), más el estado (`ok`/`issues`/ausente) de los `idempotencyKey` de push que se le pidan. `tracksStock: false` fijo: el POS nunca bloquea una venta por falta de stock. |
| `requestAccountHold` / `releaseAccountHold` | Locales, sin red: el fiado es sin bloqueo (siempre aprobado).                                                                                                                              |

Limitaciones conocidas:

- Un fiado vendido **sin red** no genera fila en `CuentaCorriente` (no hubo hold, no hay evento de
  confirmación); sí queda en `Pagos` con Medio de pago = Cuenta corriente.
- Anular una venta después de cerrado el turno no reescribe la fila ya escrita en `Turnos`.
- El balance de cada cliente no vuelve al POS: sumar `CuentaCorriente` queda del lado de la planilla.
- Una fila borrada de `Productos`/`Clientes` no genera un "tombstone": el delta de `pullBatch` no
  informa bajas, solo altas y cambios. Una baja se refleja recién en la próxima foto completa (al
  configurar, cada 2h o a pedido — mismo mecanismo que documenta CLAUDE.md para la reconciliación en
  general).
- `/DEMO_RESET` no existe con este conector (solo lo declara el tipo `rest-demo`, ver "Comandos por
  conector" en CLAUDE.md): no aparece en el menú de "/". La planilla nunca se resetea desde el POS.

## Cursor de pull (Etapa 2, #87)

Sheets no tiene una noción nativa de "última modificación" por fila, y de todos modos `pullBatch`
necesita leer la pestaña completa (no hay forma de leer "solo lo que cambió" directamente). El
puente aprovecha esa lectura obligada: por cada fila de `Productos`/`Clientes` guarda un
*fingerprint* de su contenido en una pestaña oculta (`_Snapshot`) y lo compara contra lo que vio la
vez anterior. Fila nueva o con contenido distinto → se le asigna la hora actual como su
`updatedAt` y se persiste; sin cambios → conserva la que ya tenía. El `nextCursor` que devuelve
`pullBatch` es el máximo `updatedAt` entre todas las filas vigentes de ese recurso. Esto cubre por
igual una edición manual del comerciante en la planilla y una escritura del propio puente
(`pushCustomer`), sin necesitar un trigger `onEdit`.

## Contrato del puente

`POST <webAppUrl>` con `Content-Type: text/plain;charset=utf-8` (a propósito, no `application/json`:
evita el preflight `OPTIONS` que Apps Script no maneja) y body JSON:

```json
{
  "action": "pushBatch",
  "payload": { "events": [{ "type": "sale", "id": "01J...", "sale": {} }] },
  "idempotencyKey": "01J...",
  "sharedSecret": "..."
}
```

Respuesta (siempre HTTP 200; el resultado viaja en el body):

```json
{ "ok": true, "data": {} }
{ "ok": false, "error": "mensaje" }
```

Acciones: `pullBatch` (payload `{ cursors: { products?, customers? }, pendingLotIds: [] }`,
responde `data: { products: { items, nextCursor? }, customers: { items, nextCursor? }, lots: {} }`);
`pushBatch` (payload `{ events: [...] }`, responde `data: {}`). `pushBatch` es idempotente por
`idempotencyKey` — el **lote completo**, no cada evento — vía la pestaña oculta `_PushLots`, que
también guarda `ok`/`issues` para que `pullBatch` lo informe. Ambas toman
`LockService.getScriptLock()`.

## Desarrollo

`bridge.gs` y `columnas.gs` son JS plano para el motor V8 de Google — no pasan por TypeScript ni
ESLint. Sí tienen tests automáticos (`bridge.test.ts`): se cargan en un contexto `node:vm` contra una
planilla falsa en memoria (`src/test/fake-spreadsheet.ts`). El lado TS (`bridge-client.ts`,
`google-sheets-connector.ts`) se testea con `fetch` mockeado. **Lo que la planilla falsa no puede probar
(CORS, formatos y fechas reales, permisos) se valida contra un despliegue real con este checklist:**

### Checklist de validación manual

Reemplazar `$URL` por la URL del Web App de una copia de prueba. Payload de ejemplo para `pushBatch`:
`{ action: 'pushBatch', payload: { events: [{ type: 'sale', id: '01J...', sale: {...} }] }, idempotencyKey: '01J...' }`.

1. Health check: abrir `$URL` en el navegador → `{"ok":true,"data":{"service":"pos-sheets-bridge"}}`.
2. **CORS desde un navegador** (la asunción crítica del diseño). Abrir cualquier página `http(s)` (por
   ejemplo el POS con `pnpm build && pnpm preview`), DevTools > Console:
   ```js
   await (
     await fetch('$URL', {
       method: 'POST',
       headers: { 'Content-Type': 'text/plain;charset=utf-8' },
       body: JSON.stringify({ action: 'pullBatch', payload: { cursors: {}, pendingLotIds: [] } }),
     })
   ).json();
   ```
   Esperado: `{ ok: true, data: { products: { items: [...] }, customers: { items: [...] }, lots: {} } }`
   **sin error de CORS ni request `OPTIONS`** en la pestaña Network. Si falla, el diseño de
   `text/plain` no alcanza: parar y revisar.
3. `pushBatch` con un lote de varios tipos de evento a la vez (una venta, un cliente nuevo, un cierre
   de turno) → aparecen filas en `Ventas`/`Pagos`, `Clientes` y `Turnos` en una sola llamada.
4. Idempotencia: repetir exactamente el mismo `pushBatch` (mismo `idempotencyKey`, mismos eventos) →
   `ok: true` y **no** se agregan filas de nuevo.
5. Issue de lote: en un `pushBatch` nuevo, incluir un evento `sale-void` con un `saleId` inexistente
   junto a uno válido → el `ok` del push sigue siendo `true`, el evento válido se aplica, y un
   `pullBatch` posterior con ese `idempotencyKey` en `pendingLotIds` responde
   `lots: { '<id>': { status: 'issues', issues: [...] } }`.
6. `pushBatch` con `account-hold-confirm` (`{ holdId, saleId }` de una venta ya pusheada) → una fila
   en `CuentaCorriente` con el cliente y el monto correctos.
7. Cursor: un `pullBatch` sin `cursors` trae todo `Productos`/`Clientes` y devuelve `nextCursor` para
   cada uno; repetirlo pasando esos `nextCursor` de vuelta sin haber cambiado nada → `items: []` en
   los dos. Editar a mano el precio de un producto en la planilla y repetir con el mismo cursor →
   ese producto (solo ese) vuelve a aparecer.
8. Secreto: setear `SHARED_SECRET`, repetir el paso 2 sin `sharedSecret` → `ok: false` "Secreto
   compartido inválido"; con el secreto correcto → `ok: true`.
9. Auto-provisión: borrar la pestaña `Turnos` y llamar cualquier acción → se recrea con sus encabezados en español.
10. Concurrencia (opcional): dos `pushBatch` distintos disparados a la vez → ambos escritos, sin
    filas mezcladas.
11. Provisión: borrar todas las pestañas del puente y llamar `pullBatch` → pestañas con
    encabezados en español, congeladas y en negrita, **sin filas ni columnas de sobra** (`Turnos`: 2
    filas × 14 columnas; `Productos`: 6 filas con los 5 productos de prueba).
12. Formato: Precio con miles y decimales, IVA como `21,0%`, Fecha como `dd/mm/aaaa hh:mm`, un código de
    barras con ceros a la izquierda no los pierde. Desplegables en Estado, Medio de pago y Tipo.
13. Fechas: la hora que muestra `Fecha` coincide con la hora local de la venta en el POS. Si difiere,
    revisar la zona horaria del proyecto de Apps Script contra la de la planilla (riesgo conocido:
    el puente escribe un `Date`).
14. Reordenar columnas de `Productos` y agregar una propia ("Notas") → `pullBatch` devuelve lo mismo y
    un `pushBatch` con `customer`/`sale` escribe en las columnas correctas.
15. Borrar o renombrar `Precio` → `pullBatch` responde `ok: false` con "Falta la columna 'Precio' en la
    pestaña Productos". Borrar `Teléfono` → sigue funcionando.
16. Convertir `Clientes` en tabla nativa (Formato > Convertir en tabla) y hacer un `pushBatch` con un
    `customer` → anotar si la tabla se expande sola con la fila nueva. Si no, dejarlo como limitación
    en este README.
17. Planilla de una etapa anterior (encabezados viejos, sin `_PushLots`/`_Snapshot`): llamar cualquier
    acción → los encabezados pasan a español, los datos y valores viejos (`cash`, `cerrada`) se leen,
    las pestañas nuevas se crean solas y un `sale-void` de una venta vieja funciona.

Registrar el resultado de esta lista en el issue #87.
