# Conector de Google Sheets

Backend completo para un micro-comercio sin ERP: el catálogo y las ventas viven en una planilla de
Google Sheets. Implementa el puerto `Connector` (`src/sync/connector.ts`) contra un **puente Apps
Script** implementado como Web App, que habla el contrato **4.6.0**. Se publica en un solo archivo,
`pos-sheets.gs` (lo arma `site/sheets-bundle.ts`), pero en el repo son varias partes, en el orden de
`apps-script-files.ts`: el puente (`bridge.gs`), los textos de la planilla (`columnas.gs`), la
inicialización (`inicio.gs`), el Tablero (`tablero.gs`), la home de la aplicación web (`home.gs`) y
los datos de prueba de cada rubro (`datos-*.gs`).

**Todo lo que ve quien usa el puente está en la guía pública,
[`docs/integradores/google-sheets.md`](../../../docs/integradores/google-sheets.md)**, que se publica
con `pos-sheets.gs` en `/v4/docs/google-sheets/`: qué hace y qué no, instalar, preparar la planilla,
abrir el POS en cada terminal, el Tablero, la pestaña Configuración, probar de nuevo, el portal
`/PLANILLA`, actualizar el puente, cómo se ve y se edita la planilla, qué guarda cada evento, el
contrato del puente (transporte y acciones), el cursor del pull y las limitaciones. Este README queda para el desarrollo; las reglas del conector, en
`src/connectors/AGENTS.md`.

Los `.gs` se publican **tal cual** dentro de `pos-sheets.gs`: sus comentarios no citan issues ni
archivos del repo (lo vigila `site/docs.test.ts`), y la historia de cada versión del contrato vive en
el historial de git, no en ellos. Solo `doGet`, `doPost` y las tres acciones de la home
(`posInicializar`, `posReiniciar`, `posAgregarTablero`) son públicas; todo lo demás termina en `_`,
porque `google.script.run` puede llamar desde la página a cualquier otra función.

## Desarrollo

Los `.gs` son JS plano para el motor V8 de Google — no pasan por TypeScript ni ESLint (ni por
prettier al guardar: están en `.prettierignore`; se formatean con
`prettier --ignore-path /dev/null --parser babel`). Sí tienen tests automáticos (`bridge.test.ts`,
`inicio.test.ts`, `tablero.test.ts`, `home.test.ts`, `datos.test.ts`): se cargan en un contexto
`node:vm` (`src/test/apps-script.ts`) contra una planilla falsa en memoria
(`src/test/fake-spreadsheet.ts`), que como Apps Script devuelve otro objeto por pestaña en cada
llamada (se comparan por `getSheetId()`) y calcula `=SUM` con el separador del idioma. El lado TS (`bridge-client.ts`,
`google-sheets-connector.ts`) se testea con `fetch` mockeado. **Lo que la planilla falsa no puede probar
(CORS, formatos y fechas reales, permisos) se valida contra un despliegue real con este checklist:**

### Checklist de validación manual

Reemplazar `$URL` por la URL del Web App de una copia de prueba. Payload de ejemplo para `pushBatch`:
`{ action: 'pushBatch', payload: { deviceId: 'prueba', events: [{ type: 'sale', id: '01J...', createdAt: '…', origin: {}, sale: {...} }] }, idempotencyKey: '01J...' }`.

1. Página: en una planilla nueva, abrir `$URL` → "Preparar la planilla"; prepararla con cada rubro
   → la home preparada con el resumen, el Tablero primero y seleccionado, sin `#ERROR!` (también
   con la planilla en inglés) y el link de L1 a `$URL`. "Abrir el POS" con un POS sin datos entra
   directo a la venta, con la empresa, la sucursal y la caja; con datos, abre el wizard precargado.
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
3. `pushBatch` con un lote de varios tipos de evento a la vez (una venta, un cliente nuevo, un
   movimiento de caja, una cobranza) → aparecen filas en `Ventas`/`Pagos`, `Clientes`,
   `MovimientosCaja` y `Cobranzas`/`CuentaCorriente` en una sola llamada, con Dispositivo, Sucursal y
   Punto de venta.
4. Idempotencia: repetir exactamente el mismo `pushBatch` (mismo `idempotencyKey`, mismos eventos) →
   `ok: true` y **no** se agregan filas de nuevo.
5. Issue de lote: en un `pushBatch` nuevo, incluir un evento `account-hold-confirm` con un `saleId`
   inexistente junto a uno válido → el `ok` del push sigue siendo `true`, el evento válido se aplica, y un
   `pullBatch` posterior con ese `idempotencyKey` en `pendingLotIds` responde
   `lots: { '<id>': { status: 'issues', issues: [{ message, eventId }] } }`.
6. `pushBatch` con `account-hold-confirm` (`{ holdId, saleId }` de una venta ya pusheada) → una fila
   en `CuentaCorriente` con el cliente y el monto correctos.
7. Cursor: un `pullBatch` sin `cursors` trae todo `Productos`/`Clientes` y devuelve `nextCursor` para
   cada uno; repetirlo pasando esos `nextCursor` de vuelta sin haber cambiado nada → `items: []` en
   los dos. Editar a mano el precio de un producto en la planilla y repetir con el mismo cursor →
   ese producto (solo ese) vuelve a aparecer.
8. Secreto: setear `SHARED_SECRET`, repetir el paso 2 sin `sharedSecret` → `ok: false` "Secreto
   compartido inválido"; con el secreto correcto → `ok: true`.
9. Auto-provisión: borrar la pestaña `MovimientosCaja` y llamar cualquier acción → se recrea con sus
   encabezados en español.
10. Concurrencia (opcional): dos `pushBatch` distintos disparados a la vez → ambos escritos, sin
    filas mezcladas.
11. Provisión: borrar todas las pestañas del puente y llamar `pullBatch` → pestañas con
    encabezados en español, congeladas y en negrita, **sin filas ni columnas de sobra**
    (`MovimientosCaja`: 2 filas × 12 columnas; `Productos`: 2 filas × 10 columnas, vacía).
12. Formato: Precio con miles y decimales, IVA como `21,0%`, Fecha como `dd/mm/aaaa hh:mm`, un código de
    barras con ceros a la izquierda no los pierde. Desplegables en Estado, Medio de pago y Tipo.
13. Fechas: la hora que muestra `Fecha` coincide con la hora local de la venta en el POS. Si difiere,
    revisar la zona horaria del proyecto de Apps Script contra la de la planilla (riesgo conocido:
    el puente escribe un `Date`).
14. Reordenar columnas de `Productos` y agregar una propia ("Notas") → `pullBatch` devuelve lo mismo y
    un `pushBatch` con `customer`/`sale` escribe en las columnas correctas.
15. Borrar o renombrar `Precio` → `pullBatch` responde `ok: false` con "Falta la columna 'Precio' en la
    pestaña Productos". Borrar `Teléfono` → sigue funcionando.
16. Tablas nativas (Formato > Convertir en tabla): probado el 2026-10-07, una venta en Ventas como
    tabla queda en una fila vacía ("No puedes configurar el formato de número de las celdas de una
    columna con texto"). Es una limitación de la guía; no hace falta repetirlo.
17. Planilla de una etapa anterior (encabezados viejos, sin `_PushLots`/`_Snapshot`): llamar cualquier
    acción → los encabezados pasan a español, los datos y valores viejos (`cash`, `cerrada`) se leen,
    las pestañas nuevas se crean solas y la anulación de una venta vieja (un `sale` con `voidsSaleId`)
    la marca como Anulada.
18. Contrato v3 sobre una planilla anterior: seguir "Actualizar el puente" de la guía → las
    columnas nuevas aparecen al final de cada pestaña sin tocar los datos, Alta se completa, y marcar
    "Sí" en Bloqueado de un producto lo trae con `blocked: { reason }` en el siguiente `pullBatch`.

19. Contrato 4.0.0: `info` responde la versión y `status: 'ok'`; un request con
    `contractVersion: '3.0.0'` responde `code: 'incompatible-contract'` sin escribir nada; anular una
    venta desde el POS escribe sus filas con Anula a y deja las del original en Anulada.

20. Contrato 4.1.0: vender desde el POS escribe Fecha del ticket y N° de ticket en las filas de la
    venta; anularla escribe el número siguiente del día.

21. Contrato 4.2.0: `info` responde `4.2.0`; una cobranza desde el POS escribe Fecha del recibo y
    N° de recibo en Cobranzas y su total en negativo en CuentaCorriente; en el siguiente pull el
    cliente viaja con su saldo (también uno sin crédito).

22. Contrato 4.6.0: `info` responde `4.6.0` con las capacidades, el portal y el nombre de la
    planilla; en el POS, `/DIAGNOSTICO` muestra "Empresa: <nombre de la planilla>", y `/PLANILLA` (o
    el botón "Abrir planilla") abre la planilla en una pestaña nueva. Anular una cobranza desde
    `/ANULAR` escribe la fila negativa con Anula a, deja la original en Anulada y en el siguiente pull
    el saldo del cliente vuelve a subir.

23. Configuración: cambiar "URL del POS" (por ejemplo a un POS local) y recargar la página cambia
    adónde lleva "Abrir el POS". En una copia de la planilla ("Hacer una copia" e implementarla), el
    link de la copia lleva la URL del Web App de la copia, no la de la original.

24. Reiniciar: con "Permitir reiniciar" = Sí, "Reiniciar la planilla" deja una sola "Hoja 1", la
    planilla "Planilla sin inicializar" y el formulario; se puede preparar de nuevo. Sin el Sí, la
    página no lo ofrece.

25. Agregar el tablero: borrar la pestaña Tablero y recargar la página → "Agregar el tablero"; al
    tocarlo, el Tablero vuelve primero, sin tocar las demás pestañas.

Registrar el resultado de esta lista en el issue #87 (y, para el paso 18, en #96; para el 19, en #99;
para el 20, en #120; para el 21, en #101; para el 22, en #180; para el 23, en #133; para el 1, el 24
y el 25, en #219).
