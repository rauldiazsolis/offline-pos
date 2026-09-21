# Conector de Google Sheets

Backend completo para un micro-comercio sin ERP: el catálogo y las ventas viven en una planilla de
Google Sheets. Implementa el puerto `Connector` (`src/sync/connector.ts`) contra un **puente Apps
Script** (`bridge.gs`) desplegado como Web App.

> Estado: conectado al POS desde la Etapa 2 (#68) — se elige en `/CONFIG` con el tipo de conexión
> "Google Sheets".

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

| Operación del POS                           | Comportamiento                                                                                                      |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `pullProducts`                              | Lee `Productos` completo (sin delta). `tracksStock: false` fijo: el POS nunca bloquea una venta por falta de stock. |
| `pullCustomers`                             | Lee `Clientes` completo.                                                                                            |
| `pushSale`                                  | Una fila por línea en `Ventas` + una fila por medio de pago en `Pagos`.                                             |
| `pushSaleVoid`                              | Marca las filas de esa venta en `Ventas` y `Pagos` con Estado = Anulada (no borra).                                 |
| `pushCustomer`                              | Una fila en `Clientes`.                                                                                             |
| `pushAccountHoldConfirm`                    | Una fila en `CuentaCorriente` (ledger de fiado). Cliente y monto se derivan de `Ventas`/`Pagos`.                    |
| `pushCashSession`                           | Una fila en `Turnos` con el total por medio de pago (solo ventas Cerradas del turno) y el arqueo de efectivo.       |
| `requestAccountHold` / `releaseAccountHold` | Locales, sin red: el fiado es sin bloqueo (siempre aprobado).                                                       |
| `pullStock` / `pushStockMovement`           | No-ops: no aplican a este caso de uso.                                                                              |

Limitaciones conocidas:

- Un fiado vendido **sin red** no genera fila en `CuentaCorriente` (no hubo hold, no hay evento de
  confirmación); sí queda en `Pagos` con Medio de pago = Cuenta corriente.
- Anular una venta después de cerrado el turno no reescribe la fila ya escrita en `Turnos`.
- El balance de cada cliente no vuelve al POS: sumar `CuentaCorriente` queda del lado de la planilla.
- `/DEMO_RESET` no existe con este conector (solo lo declara el tipo `rest-demo`, ver "Comandos por
  conector" en CLAUDE.md): no aparece en el menú de "/". La planilla nunca se resetea desde el POS.

## Contrato del puente

`POST <webAppUrl>` con `Content-Type: text/plain;charset=utf-8` (a propósito, no `application/json`:
evita el preflight `OPTIONS` que Apps Script no maneja) y body JSON:

```json
{
  "action": "pushSale",
  "payload": { "sale": {} },
  "idempotencyKey": "01J...",
  "sharedSecret": "..."
}
```

Respuesta (siempre HTTP 200; el resultado viaja en el body):

```json
{ "ok": true, "data": {} }
{ "ok": false, "error": "mensaje" }
```

Acciones: `pullProducts`, `pullCustomers` (responden `data: { items: [...] }`); `pushSale`,
`pushSaleVoid`, `pushCustomer`, `pushAccountHoldConfirm`, `pushCashSession` (responden `data: {}`).
Las de escritura son idempotentes por `idempotencyKey` (pestaña oculta `_Idempotency`) y toman
`LockService.getScriptLock()`.

## Desarrollo

`bridge.gs` y `columnas.gs` son JS plano para el motor V8 de Google — no pasan por TypeScript ni
ESLint. Sí tienen tests automáticos (`bridge.test.ts`): se cargan en un contexto `node:vm` contra una
planilla falsa en memoria (`src/test/fake-spreadsheet.ts`). El lado TS (`bridge-client.ts`,
`google-sheets-connector.ts`) se testea con `fetch` mockeado. **Lo que la planilla falsa no puede probar
(CORS, formatos y fechas reales, permisos) se valida contra un despliegue real con este checklist:**

### Checklist de validación manual (antes de dar la Etapa 1 por cerrada)

Reemplazar `$URL` por la URL del Web App de una copia de prueba.

1. Health check: abrir `$URL` en el navegador → `{"ok":true,"data":{"service":"pos-sheets-bridge"}}`.
2. **CORS desde un navegador** (la asunción crítica del diseño). Abrir cualquier página `http(s)` (por
   ejemplo el POS con `pnpm build && pnpm preview`), DevTools > Console:
   ```js
   await (
     await fetch('$URL', {
       method: 'POST',
       headers: { 'Content-Type': 'text/plain;charset=utf-8' },
       body: JSON.stringify({ action: 'pullProducts', payload: {} }),
     })
   ).json();
   ```
   Esperado: `{ ok: true, data: { items: [...] } }` **sin error de CORS ni request `OPTIONS`** en la
   pestaña Network. Si falla, el diseño de `text/plain` no alcanza: parar y revisar.
3. `pullCustomers` con la misma forma → 3 clientes de prueba, sin campos vacíos.
4. `pushSale` (una venta con 2 líneas y 2 pagos, uno de `medio: "account"` con `customerId`) →
   aparecen 2 filas en `Ventas` y 2 en `Pagos`, con Estado = Cerrada.
5. Idempotencia: repetir exactamente el mismo `pushSale` (misma `idempotencyKey`) → `ok: true` y **no**
   se agregan filas.
6. `pushAccountHoldConfirm` con `{ holdId, saleId }` de esa venta → una fila en `CuentaCorriente` con
   el cliente y el monto correctos. Con un `saleId` inexistente → `ok: false`.
7. `pushSaleVoid` de esa venta → sus filas de `Ventas` y `Pagos` pasan a Estado = Anulada, con fecha
   y motivo. Con un `saleId` inexistente → `ok: false`.
8. `pushCashSession` con `sales: [<saleId>]` → una fila en `Turnos`; con la venta ya anulada, los
   totales por medio son 0 (no cuenta).
9. Secreto: setear `SHARED_SECRET`, repetir el paso 2 sin `sharedSecret` → `ok: false` "Secreto
   compartido inválido"; con el secreto correcto → `ok: true`.
10. Auto-provisión: borrar la pestaña `Turnos` y llamar cualquier acción → se recrea con sus encabezados en español.
11. Concurrencia (opcional): dos `pushSale` distintos disparados a la vez → ambos escritos, sin
    filas mezcladas.

12. Provisión (Etapa 2d): borrar todas las pestañas del puente y llamar `pullProducts` → pestañas con
    encabezados en español, congeladas y en negrita, **sin filas ni columnas de sobra** (`Turnos`: 2
    filas × 14 columnas; `Productos`: 6 filas con los 5 productos de prueba).
13. Formato: Precio con miles y decimales, IVA como `21,0%`, Fecha como `dd/mm/aaaa hh:mm`, un código de
    barras con ceros a la izquierda no los pierde. Desplegables en Estado, Medio de pago y Tipo.
14. `pushSale` de 2 líneas y 2 pagos → la primera fila de `Ventas` y `Pagos` es la plantilla (no queda
    una fila vacía arriba) y las filas siguientes mantienen formato y desplegables.
15. Fechas: la hora que muestra `Fecha` coincide con la hora local de la venta en el POS. Si difiere,
    revisar la zona horaria del proyecto de Apps Script contra la de la planilla (riesgo conocido:
    el puente escribe un `Date`).
16. Reordenar columnas de `Productos` y agregar una propia ("Notas") → `pullProducts` devuelve lo mismo y
    un `pushCustomer`/`pushSale` escribe en las columnas correctas.
17. Borrar o renombrar `Precio` → `pullProducts` responde `ok: false` con "Falta la columna 'Precio' en la
    pestaña Productos". Borrar `Teléfono` → sigue funcionando.
18. Convertir `Clientes` en tabla nativa (Formato > Convertir en tabla) y hacer un `pushCustomer` → anotar
    si la tabla se expande sola con la fila nueva. Si no, dejarlo como limitación en este README.
19. Planilla de la Etapa 1 o 2 (encabezados viejos): llamar cualquier acción → los encabezados pasan a
    español, los datos y valores viejos (`cash`, `cerrada`) se leen y `pushSaleVoid` de una venta vieja
    funciona.

Registrar el resultado de esta lista en el issue #67 (pasos 1–11) y en el #80 (pasos 12–19).
