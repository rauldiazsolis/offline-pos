# Empresa, sucursal y caja a la vista

Fecha: 2026-10-03
Estado: diseño aprobado en el brainstorming del 2026-10-03; plan en
`docs/superpowers/plans/2026-10-03-empresa-sucursal-y-caja.md`.
Issue: #193 (pedido "de pasada", antes de seguir con el epic #182).

## Contexto

En el POS no se ve en qué empresa, sucursal y caja está la terminal:

- La sucursal y el punto de venta (`SyncConfig.branch` y `pointOfSale`) solo aparecen en `/CONFIG`.
  Los carga el operador en el wizard o los trae la vuelta del alta (`#connect`).
- El nombre de la empresa no viaja en ningún lado. `GET /info` trae `backend.name`, que es el
  producto (`mini-erp`), no el comercio. Solo el backend sabe a qué comercio pertenece la key.
- La barra de estado existe solo en la pantalla de venta. `/CAJA`, `/COBRAR`, `/RESUMEN` y las
  demás reemplazan la pantalla entera.

## Decisiones

1. **La barra de estado pasa a tener dos líneas** (solo en la venta):

   ```
   Línea 1:  DEMO   Caja 1 - Central - Kiosco Pepe                     [Crear mi cuenta (/ALTA)]
   Línea 2:  ● Sincronizado (10:32) · 120 productos · 45 clientes      [Avisos (1)] [Sin arqueo en 24 h]
   ```

   - Línea 1, el contexto: la marca `DEMO` si la terminal está en demo, `<caja> - <sucursal> -
     <empresa>`, y a la derecha el botón de la demo (`<onboarding.label> (/ALTA)`, o "Empezar una
     demo nueva (/DEMO_NUEVA)" con la demo revocada).
   - Sin empresa conocida, el contexto queda `<caja> - <sucursal>`. Fuera de demo no hay marca ni
     botón, solo el contexto.
   - Si falta lugar, el contexto se recorta con "…"; el botón nunca parte su etiqueta (#111).
   - Línea 2, el estado de sync: como hoy, sin `DEMO` ni el botón de la demo, que suben a la línea 1.
   - Un click en la barra (fuera de los botones) sigue abriendo `/DIAGNOSTICO`, en las dos líneas.
2. **Título de la pestaña**: `<caja> - <sucursal>`, sin la empresa. Vale para todas las pantallas,
   también las que no tienen barra. Sin config activa queda el título de siempre. La segunda pestaña
   (#175) conserva su título propio.
3. **`/DIAGNOSTICO`** suma la empresa ("Empresa: Kiosco Pepe", o "no informada").
4. **Contrato 4.5.0** (minor):
   - `GET /info` suma un campo opcional `company: { name: string }`, el comercio al que pertenece la
     key, para mostrarlo en el POS. Ausente es válido, y el POS no muestra empresa.
   - No es una capacidad: un dato opcional se declara mandándolo.
   - El piso sigue en 4.0.0, así que un backend 4.4 sigue siendo compatible. El POS habla 4.5.0
     (`POS_CONTRACT_VERSION`).
   - El OpenAPI describe el campo y suma 4.5.0 al changelog, sin referencias internas.
5. **El POS guarda la empresa como las capacidades**, en un módulo hermano de
   `sync/backend-capabilities.ts` (`localStorage` por carpeta, más un signal):
   - Se actualiza con cada `/info` exitoso (`refreshBackendStatus`), así una terminal que arranca sin
     red la muestra igual.
   - Un `/info` sin `company` la borra: el backend dejó de mandarla.
   - Al aplicar una conexión (`applyConnection`) se toma la del `/info` de la prueba, nunca la de la
     conexión anterior.
6. **demo-backend**:
   - Es la referencia ejecutable de lo que debe hacer un backend, no un backend "para demos" del POS.
     El circuito de demo y alta es una parte más de esa referencia. Se aclara en `AGENTS.md`; el
     nombre de la carpeta queda.
   - Con una key de demo (`demo_keys`), `/info` manda el nombre de la demo según la plantilla
     (`Kiosco de demo`, `Almacén de demo`). La plantilla de la demo en curso se guarda al crearla.
   - Con la key del comercio (la que devuelve la página de alta), manda el nombre cargado en el
     alta. La página de alta suma el campo "Nombre del comercio", que el backend guarda antes de
     volver al POS con `#connect`. Sin nombre cargado, no manda `company`.
   - Así el circuito demo → alta muestra el cambio: `Caja 1 - CENTRAL - Kiosco de demo` pasa a
     `Caja 1 - CENTRAL - Almacén Rosa`.
7. **Otros backends**: se abre un issue en rauldiazsolis/mini-erp con el cambio (opcional, el nombre
   del tenant). El puente de Google Sheets no se toca: sigue compatible por el piso, y la barra
   muestra `<caja> - <sucursal>`.

## Fuera de alcance

- La línea de contexto en las pantallas que no tienen barra de estado: ahí queda el título de la
  pestaña.
- Nombres de sucursal o caja que vengan del backend: se muestran los de la config, como hoy.
- Renombrar `demo-backend/`.

## Pruebas

- Unit: el esquema de `/info` con y sin `company`; el módulo de la empresa (guardar, borrar,
  leer al arrancar); `refreshBackendStatus` y `applyConnection` la actualizan; el texto de contexto y
  el título (con y sin empresa, con y sin config).
- Componente: `StatusBar` en dos líneas, con y sin demo, con la demo revocada; `/DIAGNOSTICO` con la
  empresa.
- demo-backend: `/info` con una key de demo (nombre por plantilla), con la del comercio (nombre del
  alta, o sin `company` si no se cargó).
- e2e: el circuito demo → alta muestra la empresa de la demo y después la del alta en la barra, y el
  título de la pestaña.
