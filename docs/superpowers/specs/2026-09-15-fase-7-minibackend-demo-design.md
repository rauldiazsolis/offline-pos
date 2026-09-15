# Fase 7, primera pieza: minibackend de demostración del Connector API

Fecha: 2026-09-15
Estado: aprobado por el usuario, pendiente de plan de implementación.

## Contexto

Fase 7 (publicación) agrupa varias piezas bastante separables: manifest PWA, flujo de
actualización del service worker, documentación del Connector API, hardening/lanzamiento, y un
minibackend de demostración que implemente el contrato (alcance agregado a propósito — ver
CLAUDE.md § "Estado del proyecto"). Se decidió planificar e implementar estas piezas una por una,
en vez de una spec única para las cinco. Esta spec cubre **solo la primera: el minibackend de
demostración**, por ser la base que permite probar el resto (incluida la propia documentación del
contrato) de punta a punta en vez de contra fakes.

Hasta ahora, `sync/engine.test.ts` y el resto de los tests de sync validan contra un `Connector`
fake hecho a mano — nunca contra un servidor HTTP real. El minibackend es la primera
implementación de referencia real del contrato (`docs/connector-api.openapi.yaml`), pensada
también como la mejor documentación posible de ese contrato: código que efectivamente lo
implementa, no solo un spec OpenAPI leído en abstracto.

## Decisión reabierta durante la planificación: de dónde vienen los datos de demo

El POS hoy siembra catálogo y ~22 clientes de ejemplo localmente al arrancar
(`src/ui/bootstrap.ts` → `seedCatalogIfEmpty`/`seedCustomersIfEmpty`, fixtures en
`src/storage/fixtures/`). El usuario señaló que ese seed local es poco representativo de un caso
real (un backend real nunca "aparece ya sembrado" en la terminal) y pidió mover los datos de demo
al minibackend: una terminal nueva se llena vía pull real contra el backend, no vía datos locales
inventados — coherente con el principio de diseño ya existente en CLAUDE.md ("el cliente siempre
es lector" del catálogo).

Esto cambia el comportamiento de una terminal recién instalada, sin `/CONFIG` configurado y sin
red: **arranca vacía hasta el primer sync** (decisión explícita del usuario, sección "Bootstrap sin
config" de la conversación de diseño) — no hay fallback local. Es más honesto con el principio de
que el backend manda, a costa de que la pantalla de venta se vea vacía antes de configurar algo.

Los fixtures locales y las funciones `seedCatalogIfEmpty`/`seedCustomersIfEmpty` **se mantienen**
en `src/storage/` — dejan de llamarse desde `bootstrap.ts`, pero siguen siendo necesarios para
`e2e/offline-sale.spec.ts` y `e2e/account-sale.spec.ts` (e2e que prueban el flujo 100% offline sin
ningún backend) y para varios tests unitarios. El propio usuario marcó este caso como la excepción
("a menos que sea imprescindible para el testing").

## Arquitectura: monorepo liviano, no un solo `package.json`

Se evaluaron dos opciones y se optó por un workspace pnpm liviano (`demo-backend/` como paquete
separado del root) en vez de meter el minibackend en el mismo `package.json` que el POS. Razones:

1. El proyecto ya tiene una disciplina fuerte de límites explícitos entre capas (`domain/` no
   importa `ui/`/`storage/`/`sync/`, ver CLAUDE.md). El minibackend corre en Node puro, sin DOM ni
   IndexedDB — un contexto de runtime distinto al del POS (navegador). Mezclar ambos en un mismo
   manifiesto difumina esa frontera justo donde más conviene mantenerla.
2. El usuario anotó (issue #46, backlog) la intención de evolucionar este mismo minibackend a un
   backend multitenant apto para producción más adelante — empezar con un paquete separado evita
   una migración más grande cuando llegue ese momento.

El costo del workspace es bajo porque el minibackend no necesita dependencias nuevas de runtime
(ver más abajo) — no hay fricción real de mantener dos sets de dependencias sincronizados todavía.

`pnpm-workspace.yaml` agrega `demo-backend` como paquete. `pnpm dev` en la raíz orquesta ambos
procesos en paralelo vía `pnpm --parallel -r dev` (cada paquete define su propio script `dev`:
`vite` en el root, el servidor Node en `demo-backend`).

## Stack del minibackend: cero dependencias nuevas de runtime

Node 24 (ya es lo que usa CI y el entorno de desarrollo) ejecuta `.ts` de forma nativa sin
transpilar, y trae `node:sqlite` y `node:http` como built-ins. El minibackend se implementa sobre
estas dos APIs nativas, sin librerías HTTP/router ni ORM — alcanza para 10 recursos con routing de
caminos fijos, hecho a mano, siguiendo la preferencia del proyecto de minimizar dependencias de
terceros.

`demo-backend/package.json` reusa `typescript`/`eslint`/`vitest` como `devDependencies` propias
(mismo criterio de calidad que el resto del repo — lint/typecheck/tests corren igual sobre este
paquete).

## Persistencia y datos semilla

SQLite embebido vía `node:sqlite`, un archivo en `demo-backend/data/demo.sqlite` (gitignoreado).
Tablas espejo de los recursos del contrato: `products`, `stock`, `customers`,
`customer_accounts`, `sales`, `sale_lines`, `payments`, `stock_movements`, `cash_sessions`,
`account_holds`, más `idempotency_keys` (key → respuesta ya dada, para deduplicar cualquier `POST`
de evento).

Los fixtures que hoy usa el POS (`storage/fixtures/catalog.json`, `customers.json`) se copian a
`demo-backend/src/fixtures/` como semilla — duplicados **a propósito** entre los dos paquetes (el
POS los sigue necesitando para tests offline-only, el backend los usa para poblar SQLite la
primera vez que arranca vacío).

## Comportamiento por recurso

Siguiendo lo confirmado en la conversación de diseño — el minibackend nunca simula rechazo de
negocio en el camino de sincronización, porque este es un POS de mostrador (no e-commerce): lo que
está en la mano se puede vender, el stock es solo informativo.

- `POST /sales`, `/stock-movements`, `/sales/{id}/void`, `POST /customers`,
  `POST /cash-sessions`: siempre responden éxito (200/201) tras deduplicar por
  `Idempotency-Key` (ver tabla `idempotency_keys` arriba) — nunca simulan rechazo.
- `GET /products`, `/stock`, `/customers`: pull por delta real (`since`/cursor) contra lo que haya
  en SQLite. El stock se guarda y se sirve, pero nada en el backend lo usa para bloquear nada.
- `POST /account-holds`, `/account-holds/{id}/confirm`, `DELETE /account-holds/{id}`: responden
  **501 "not implemented"** — cuenta corriente no tiene avances suficientes todavía del lado del
  backend para simular aprobación/rechazo de verdad. Confirmado en el código
  (`checkout-controller.ts::submitAccountPayment`) que un error acá ya se maneja con normalidad,
  mostrado en el slot de error del cobro — no rompe nada del lado del POS. El panel de solo
  lectura (ver abajo) igual loguea los holds recibidos, para poder mostrar que llegaron aunque no
  se procesen.
- Auth: exige el header `Authorization: Bearer <cualquier-valor-no-vacío>` (401 si falta) — no
  valida el valor en sí, es demostrar que el contrato espera Bearer auth sin construir un sistema
  de usuarios real.
- `POST /_demo/reset`: vuelve SQLite al estado de la semilla inicial. Es lo que dispara el botón
  "Reset demo" del panel, y lo que dispara `/DEMO_RESET` del POS antes de resincronizar (ver
  abajo) — mismo endpoint para los dos casos.

## Panel web de solo lectura

`GET /_demo` sirve una única página HTML+CSS+JS vanilla (sin build step, sin framework de
frontend) — path separado del namespace del contrato real (`/products`, `/sales`, etc.) para
dejar claro que es tooling, no parte de lo que un integrador real implementaría. Consume un puñado
de endpoints propios de solo lectura (`GET /_demo/api/sales`, `/_demo/api/cash-sessions`, etc.)
que consultan SQLite directo. Muestra tablas simples: ventas sincronizadas, turnos de caja
cerrados, clientes creados desde el POS, y holds de cuenta corriente recibidos (aunque se
respondan con 501). Botón "Reset demo" → `POST /_demo/reset`. Sin autenticación propia — es
tooling de desarrollo local, no algo que se exponga.

## Cambios del lado del POS

- `src/ui/bootstrap.ts`: se sacan las llamadas a `seedCatalogIfEmpty`/`seedCustomersIfEmpty`.
- `src/storage/seed-catalog.ts`/`seed-customers.ts` + fixtures se mantienen, solo para tests (ver
  "Decisión reabierta" arriba).
- `src/storage/demo-reset.ts` (`/DEMO_RESET`): con `/CONFIG` seteado, ahora hace tres pasos en
  orden — (1) `POST /_demo/reset` contra el backend configurado, para que también vuelva a su
  semilla inicial; (2) borra todo lo local (mismo alcance que hoy: catálogo, stock, clientes,
  cuentas, ventas, movimientos, turnos de caja, `draftCart`, outbox pendiente, cursores de pull);
  (3) dispara un pull completo, repoblando desde el backend ya reseteado. Si el paso (1) falla
  (backend no disponible, por ejemplo), `/DEMO_RESET` no continúa con (2)/(3) y muestra el error —
  evita dejar la terminal local vacía sin poder repoblarla. Sin `/CONFIG`, se salta el paso (1) y
  solo borra lo local (mismo criterio que el bootstrap: sin backend configurado, queda vacía).
- `/CONFIG`: el campo de URL trae `http://localhost:4000` precargado como default/placeholder (no
  forzado — sigue siendo editable) para que levantar la demo completa sea de un solo paso.

## Puerto

El minibackend escucha en el puerto **4000** — no choca con Vite (`5173`) ni con `vite preview`
(`4173`).

## Testing y CI

Además de tests unitarios propios del minibackend (routing, deduplicación por
`Idempotency-Key`, reset), se suma un e2e nuevo que levanta el minibackend real, configura
`/CONFIG` apuntando a él, corre un flujo real de venta → sync, y verifica que la venta/turno de
caja llegó al SQLite del backend (vía sus endpoints `/_demo/api/*` o el archivo directo). Es la
prueba real de que Fase 6 funciona contra un backend de verdad, no solo contra fakes — corre en
CI (`ci.yml` gana un paso que levanta el minibackend antes de este spec puntual, análogo a cómo ya
instala Chromium para el resto de los e2e).

## Fuera de alcance de esta pieza

- Deploy/hosting real del minibackend (Docker, nube) — queda para más adelante si hace falta
  mostrarlo a alguien externo sin clonar el repo.
- El backend multitenant de producción evolucionado de este minibackend — anotado como idea futura
  (issue #46, `backlog`), no parte de Fase 7.
- El resto de las piezas de Fase 7 (manifest PWA, flujo de actualización del service worker,
  documentación del Connector API, hardening/lanzamiento) — se planifican por separado, una vez
  terminada esta.
