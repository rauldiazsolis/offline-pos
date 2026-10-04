# e2e — Playwright

Las reglas generales de testing (contra el build real, offline después de cargar, leer IndexedDB
directo) están en "Testing" del [`AGENTS.md` de la raíz](../AGENTS.md).

`e2e/keyboard-only.spec.ts` (Fase 4) es la "auditoría de accesibilidad por teclado" del roadmap
hecha verificable en CI: un test por pantalla popup, navegando solo con teclado, que confirma
explícitamente que la barra de comandos recupera el foco al volver — no una revisión manual sin
rastro.

`e2e/helpers.ts` (Fase 6) reúne acciones de setup que varios specs repiten y que tienen que pasar
por la UI real, no por IndexedDB directo (`completeWizardRest`, `fillPayment`; `openCashSession` se
eliminó en la Etapa 5: ya no hace falta un turno para cobrar) — distinto de `indexed-db.ts`, que es
lectura/escritura cruda para datos que en producción vendrían de un pull (`CustomerAccount`) y que
no tiene sentido ejercitar por UI en cada test.

`e2e/fixtures.ts` (Etapa 2b) exporta un `test` de Playwright que siembra una conexión `active`
(`ACTIVE_CONFIG`, con `verifiedAt`, sucursal y punto de venta, apuntando a un backend inalcanzable),
la capacidad `customer-payment-void` (4.4.0, #128: ese backend nunca la va a informar y sin ella
`/ANULAR` no anula cobranzas) y un id de dispositivo (`seedDeviceIdentity`, una vez por pestaña) antes de cargar la app: sin
conexión activa la app solo muestra `/CONFIG`, así que todo spec que ejercite la app ya conectada
(y offline) importa `test`/`expect` de ahí en vez de `@playwright/test`. Los que prueban el
arranque y la configuración (`connection-lifecycle`, `minibackend-sync`) usan el de Playwright a
secas. Para los unit tests, `src/test/fake-connector.ts` da un `Connector` de mentira. Un bug real de
esta etapa, encontrado por el e2e y no por jsdom: `useSignalEffect` corre diferido y dejaba una
ventana en la que tipear tras un error agregaba texto en vez de reemplazarlo — se usa
`useLayoutEffect`.

**Tres demo-backends** (`playwright.config.ts`): el de `4000` (archivo `demo-backend/data/demo.sqlite`)
para `minibackend-sync.spec.ts`, otro en `4001`, en memoria (`DEMO_BACKEND_PORT`,
`DEMO_BACKEND_DB=:memory:`), solo para `e2e/demo-onboarding.spec.ts` (#128), y un tercero en `4002`
para `e2e/published-site.spec.ts` (#148), por el mismo motivo: cada
`POST /demo-sessions` vuelve a cargar la base desde cero, así que con uno solo le pisaría los datos a
los specs que corren en paralelo. Los tests de ese archivo van en serie (`mode: 'serial'`) por el mismo
motivo; el de "datos sin enviar" (#176) usa el `test` de `fixtures.ts`, el resto el de Playwright a
secas. El de la demo revocada la revoca con `POST /_demo/revoke-demos` del panel.

**Sitio publicado** (#148, #54): `e2e/published-site.spec.ts` corre contra `.site-out/`
(`pnpm site:build`, con su propio build en `.site-dist/` para no pisar el `dist/` del servidor de
`4173`), servido por `pnpm site:preview` en `4174`, y usa el demo-backend en memoria de `4002`.
Prueba la home (el backend local con su link de demo al canal), que el canal `/v4/` arranca con rutas
relativas y que su almacenamiento es `offline-pos@/v4/`, y las docs del canal con el puente de
Sheets. El canal va fijo: si el contrato sube de major, que falle es lo que se quiere. El resto de la
suite sigue en `/`: prueba de paso que la raíz no cambió. El redirect de `/versions` y los headers
son de Cloudflare: se verifican en la primera publicación. Se arma con `--only-local` (#147): la home
solo con el demo-backend local, así el e2e no depende de un backend publicado ni le crea una demo en
cada corrida.

**Service worker** (#54): `playwright.config.ts` pone `serviceWorkers: 'block'` para toda la suite,
que así no depende de él. `e2e/pwa.spec.ts` lo habilita (`test.use({ serviceWorkers: 'allow' })`) y
levanta su propio servidor en `4175`, que sirve el `dist/` de `4173` bajo `/v4/` (en `localhost`,
contexto seguro) y puede agregarle bytes a `sw.js` para que el navegador vea una versión nueva sin
un segundo build. Prueba abrir sin red con F5, el aviso y `/ACTUALIZAR` (que no actualiza con una
venta en curso), `pos.reset()` (con una marca dentro de la caché: el nombre sale del contenido del
build, así que al reinstalarse se repite) y el manifest. Como cada test tiene un contexto nuevo, la
primera carga instala el service worker sin que controle la página: para probar una versión nueva
hay que recargar una vez antes (`openControlled`).

**Una sola pestaña** (#175): `e2e/single-tab.spec.ts` abre varias páginas en el **mismo contexto** de
Playwright, que comparten `localStorage`, IndexedDB, `navigator.locks` y `BroadcastChannel` como dos
pestañas de un navegador (cada test de los demás specs tiene su propio contexto, así que nunca se
cruzan). Solo la primera página siembra la conexión (el `page` de `fixtures.ts`); las otras comparten
su almacenamiento. La tercera página prueba **otra carpeta del mismo origen**: el sitio de
`site:preview` tiene una sola carpeta de versión, así que `context.route` sirve el build de 4173 en
`/otra-carpeta/` (la app usa rutas relativas) y la página arranca con su propio almacenamiento.

**Flakes en CI** (#169): `playwright.config.ts` reintenta una vez solo con `CI`, así
`trace: 'on-first-retry'` deja la traza; un test que pasa al reintentar sale como "flaky" en el log.
El workflow sube `test-results/` (artefacto `playwright-test-results`, 14 días) si falla el e2e o si
quedó algún `trace.zip`: ahí están la traza, las capturas y el `error-context.md` de cada test. Un
flake nuevo se anota como issue con lo que muestre la traza, no solo con el timeout.
