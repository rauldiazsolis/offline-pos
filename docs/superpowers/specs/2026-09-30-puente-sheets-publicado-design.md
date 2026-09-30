# El puente de Google Sheets publicado en cada carpeta de versión

Fecha: 2026-09-30
Estado: diseño aprobado; plan en `docs/superpowers/plans/2026-09-30-puente-sheets-publicado.md`.
Issues: punto 2 del epic #166 (cierre del MVP). Antecedentes: #127 (congelamiento) y #138 (puente
aparte), los dos cerrados por la decisión del 2026-09-29 (PR #168). Fuera de alcance: llevar el
puente a 4.4.0 y probarlo contra una planilla real (punto 3 del epic, otra sesión).

## Contexto

Desde el 2026-09-29 el puente de Sheets (`src/connectors/google-sheets/bridge.gs` y `columnas.gs`)
se mantiene en este repo como un backend más, con piso, y se publica en cada carpeta de versión del
deploy, al lado del OpenAPI (`AGENTS.md`, "Qué backends acompañan un cambio de contrato"). Hoy
`site/build-version.ts` arma `/<versión>/docs/` con `guia.md`, `llms.txt`, el OpenAPI y la guía en
HTML (`index.html`), y el puente no se publica.

El README del conector no sirve tal cual para un integrador:

- mezcla la instalación con el historial de actualizaciones por versión (con `#96`, `#99`, `#120`,
  `#101`) y con una sección de desarrollo que remite a archivos del repo
  (`src/test/fake-spreadsheet.ts`, `src/sync/AGENTS.md`) y a issues donde registrar resultados;
- menciona una "plantilla de planilla" que no está publicada en ningún lado;
- quedó desactualizado: dice `contractVersion: '4.0.0'` y que "el balance de cada cliente no vuelve
  al POS", que dejó de ser cierto en 4.2.0.

`bridge.gs` tiene 18 comentarios que citan issues (`(#96)`, `#87`…), uno de ellos también el requisito `RNF-07` del doc de diseño, y uno que remite a
`demo-backend/src/lots.ts`; `columnas.gs` no tiene ninguno. `bridge.gs` también tiene formatos
numéricos de Sheets (`'#,##0.00'`), que un patrón `#\d+` confundiría con un issue.

## Decisiones

Tomadas en el brainstorming del 2026-09-30:

- **Doc público nuevo** en `docs/integradores/google-sheets.md`, escrito para quien instala el
  puente y sin referencias internas. El README del conector queda para desarrollo y enlaza al doc.
- **`bridge.gs` sin referencias internas en el repo**: se limpian los comentarios y se publica el
  archivo tal cual (el que se testea es el que se publica). Un test impide que vuelvan.
- **Sin versión nueva en este trabajo**: 0.1.0 es inmutable y queda sin el puente; sale con la
  próxima versión que se publique (probablemente con el punto 3 del epic o con #147). Así no queda
  publicada una versión con un puente 4.2.0 que se reemplaza enseguida. Se verifica con
  `pnpm site:build` y `pnpm site:preview`.

## Diseño

### 1. Qué se publica y dónde

```
/<x.y.z>/docs/google-sheets/
  index.html    la guía del puente en HTML (misma plantilla que la guía para integradores)
  guia.md       la guía del puente en Markdown
  bridge.gs     copia exacta de src/connectors/google-sheets/bridge.gs
  columnas.gs   copia exacta de src/connectors/google-sheets/columnas.gs
```

La arma `site/build-version.ts::buildVersionFolder`, en el mismo paso que el resto de `docs/`.
`DocsSources` suma las tres fuentes nuevas (la guía del puente y los dos `.gs`), con los valores por
omisión del repo, así el test puede seguir pasando fixtures. `publish.yml` no cambia, y el zip de la
versión incluye la subcarpeta sin hacer nada.

`renderGuidePage` se reusa (el título de la página sale del primer `# ` del Markdown), con un
parámetro nuevo: la ruta relativa hasta `docs/` (`''` para la guía, `'../'` para la del puente). El
encabezado de `site/templates/guide.html` enlaza al OpenAPI, a `llms.txt` y a `/versions` con
rutas relativas a `docs/`, que desde `docs/google-sheets/` se romperían; el link "Markdown" queda
relativo a la página (en las dos lleva a su propio `guia.md`).

**Links**: en el repo, el doc apunta a los archivos del repo para que se puedan seguir desde GitHub;
al publicar, `build-version.ts` los reescribe a su lugar en la carpeta, igual que ya hace
`localizeLinks` con el OpenAPI:

| En el repo (`docs/integradores/google-sheets.md`) | Publicado (`docs/google-sheets/guia.md`) |
|---|---|
| `../../src/connectors/google-sheets/bridge.gs` | `bridge.gs` |
| `../../src/connectors/google-sheets/columnas.gs` | `columnas.gs` |
| `guia.md` (la guía para integradores) | `../guia.md` |
| `../connector-api.openapi.yaml` | `../connector-api.openapi.yaml` (queda igual) |

La reescritura es por reemplazo literal de esos prefijos exactos, una función por destino (la de la
guía del puente es distinta de la de `guia.md` y `llms.txt`).

### 2. El doc público

`docs/integradores/google-sheets.md`, `# Google Sheets: el puente de Apps Script`. Secciones:

- **Qué es**: un backend sin servidor para un comercio sin ERP; el catálogo y las ventas viven en una
  planilla, y el puente (un Web App de Apps Script) habla el Connector API con el POS. Dice qué
  versión del contrato habla el puente de esa carpeta (hoy 4.2.0) y que es compatible con cualquier
  POS 4.x por el piso 4.0.0. Qué no hace: no declara capacidades (no se anulan cobranzas desde el
  POS), no lleva stock (`tracksStock: false`), el fiado se aprueba siempre y la planilla nunca se
  resetea desde el POS.
- **Instalar**: planilla nueva, *Extensiones > Apps Script*, pegar `bridge.gs` y `columnas.gs` como
  dos archivos del mismo proyecto, *Implementar > Nueva implementación > Aplicación web* (ejecutar
  como "Yo", acceso "Cualquier persona"), copiar la URL `/exec`, `SHARED_SECRET` opcional, y
  conectar desde `/CONFIG` (tipo "Google Sheets"). El puente crea las pestañas solo en el primer
  request, con datos de prueba en Productos y Clientes. Qué significa "Cualquier persona" y que el
  aviso de "app no verificada" es normal.
- **Permisos**: solo esta planilla (`@OnlyCurrentDoc`); si la autorización pide todas las planillas,
  cancelar y revisar la primera línea.
- **Actualizar el puente**: bajar los `.gs` de la carpeta de la versión del POS que usan las
  terminales, reemplazar los dos archivos, *Administrar implementaciones > editar > Nueva versión*.
  La URL no cambia (una implementación nueva daría otra URL, y cambiar la URL en `/CONFIG` es otro
  origen). Las columnas nuevas aparecen solas al final de cada pestaña. Si el POS y el puente no
  comparten el major del contrato, la terminal deja de sincronizar hasta actualizarlo, sin perder
  nada.
- **Cómo se ve y cómo se edita la planilla**: pestañas y encabezados en español (definidos en
  `columnas.gs`), columnas por encabezado y no por posición, qué se puede reordenar, agregar, borrar
  (las opcionales) y qué no, Bloqueado, Alta, formatos y desplegables.
- **Qué guarda cada evento**: el push (una fila por línea y por pago en Ventas y Pagos, la anulación
  como venta con Anula a, clientes, CuentaCorriente, MovimientosCaja, Cobranzas con su recibo, el
  número de ticket) y el pull (Productos y Clientes con cursor por fingerprint, el saldo de cada
  cliente como suma de CuentaCorriente). Un evento que no se puede aplicar queda como _issue_ del
  lote sin tumbar el resto.
- **El contrato del puente**: el transporte (`POST` con `text/plain`, `action`, `payload`,
  `idempotencyKey`, `sharedSecret`, `contractVersion`; respuesta `{ ok, data | error }`), las
  acciones `info`, `pullBatch` y `pushBatch`, la idempotencia por lote y el lock del script. Remite
  al OpenAPI para la forma de los eventos.
- **Limitaciones**: una fila borrada de Productos o Clientes se refleja recién en la próxima foto
  completa; una venta con hold confirmado no genera contra-asiento al anularse; la zona horaria del
  proyecto de Apps Script tiene que coincidir con la de la planilla.

Lo que queda solo en el README del conector: la sección de desarrollo, el checklist de validación
manual y las notas de actualización por versión (v3, 4.0.0, 4.1.0, 4.2.0). Las secciones que el doc
público cubre (setup, cómo se ve la planilla, qué hace cada operación, cursor, contrato del puente)
se reemplazan en el README por un link al doc. Poner al día lo que quede desactualizado en el README
es del punto 3.

### 3. `bridge.gs` sin referencias internas

Los 18 comentarios pierden el número de issue y conservan la versión del contrato cuando la tienen
("4.0.0 (#99): una anulación…" → "4.0.0: una anulación…"; "(conector de Google Sheets, #67)" → sin
paréntesis). El comentario que remite a `demo-backend/src/lots.ts` describe el despacho sin nombrar
el archivo. Solo cambian comentarios: `bridge.test.ts` sigue en verde sin tocarse.

### 4. Enlaces

- `docs/integradores/guia.md` suma una sección **Google Sheets: un backend sin servidor**, antes de
  "Servir el POS desde tu propio servidor", que enlaza a la guía del puente. En el repo apunta a
  `google-sheets.md`; publicado, a `google-sheets/` (la reescritura de links de `guia.md` suma ese
  caso).
- `docs/integradores/llms.txt` suma la guía del puente y los dos `.gs` en "Docs", con la misma
  reescritura.
- `/versions` no cambia: su columna Docs ya lleva a `/<versión>/docs/`. El `llms.txt` de la raíz
  tampoco: lista la guía y el OpenAPI de la última versión (hoy 0.1.0, sin puente) y el `llms.txt` de
  cada versión, que ya enlaza al puente.

### 5. Tests

- `site/docs.test.ts`:
  - la guía del puente empieza con su `# `, no tiene `#\d+`, `superpowers`, `AGENTS.md`,
    `pos-web-diseno`, `historia.md` ni `demo-backend`, y las únicas apariciones de `src/` son los
    dos links a los `.gs` que se localizan al publicar;
  - `bridge.gs` y `columnas.gs` no citan issues (`\(#\d+`, `#\d{2,}`, `, #\d`), ni `superpowers`,
    `AGENTS.md`, `demo-backend` o requisitos del doc de diseño (`RNF-07`) — el patrón no se
    confunde con `'#,##0.00'`;
  - la guía del puente dice el mismo `CONTRACT_VERSION` que `bridge.gs` (se lee del archivo), así
    no se desactualiza cuando el punto 3 lo lleve a 4.4.0;
  - la guía y `llms.txt` enlazan a la guía del puente.
- `site/build-version.test.ts`: la carpeta armada tiene `docs/google-sheets/` con sus cuatro
  archivos, los `.gs` idénticos a su fuente, los links localizados (sin `../../src/` ni
  `google-sheets.md`), `docs/guia.md` enlazando a `google-sheets/`, e `index.html` con el título de
  la guía del puente y el encabezado apuntando a `../connector-api.openapi.yaml`.
- `e2e/published-site.spec.ts`: desde `/<versión>/docs/`, el link a la guía del puente abre su
  página, y `bridge.gs`, `columnas.gs` y el OpenAPI del encabezado responden.

### 6. Documentación del repo

Al terminar: "Publicación" y "Estado del proyecto" del `AGENTS.md` de la raíz, `docs/publicacion.md`
(qué trae cada carpeta), `src/connectors/AGENTS.md` (el doc público existe, se publica, y los `.gs`
no citan issues) y el README del conector. Después del merge, tildar el punto 2 en #166.

## Verificación

`pnpm lint && pnpm typecheck && pnpm test && pnpm build`, `pnpm test:e2e` (no debería cambiar nada
de la app) y `pnpm site:build` con `pnpm site:preview` en `4174`, para ver
`/<versión>/docs/google-sheets/` armada y navegar desde `/versions` → Docs → Google Sheets.
