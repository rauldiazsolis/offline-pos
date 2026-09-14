# offline-pos

POS web offline-first para retail (kiosco/tienda): instalable como PWA, 100% operable con
teclado, que se integra con cualquier backend externo (ERP, e-commerce, facturación) vía un
contrato de API propio versionado — el POS no conoce ningún backend específico.

## Stack

Preact + `@preact/signals` · Dexie.js (IndexedDB) · Vite + `vite-plugin-pwa` · FlexSearch · Zod ·
Vitest + Testing Library (preact) · Playwright (Chromium).

Navegador de referencia: Chromium (Chrome/Edge). En Firefox/Safari la app funciona pero sin
Web Serial/WebUSB (sin impresión/cajón — ver Fase 5 del roadmap).

## Setup

```sh
pnpm install
pnpm dev          # servidor de desarrollo
```

## Scripts

```sh
pnpm lint         # eslint
pnpm typecheck    # tsc -b --noEmit
pnpm test         # vitest (unit + componentes)
pnpm test:e2e     # playwright, contra el build real (build + preview)
pnpm build        # build de producción
```

## Documentación

- [`pos-web-diseno-arquitectura.md`](./pos-web-diseno-arquitectura.md) — diseño completo:
  requisitos, modelo de dominio, contrato del Connector API, decisiones de arquitectura.
- [`CLAUDE.md`](./CLAUDE.md) — resumen operativo de convenciones para trabajar en este repo
  (estructura de carpetas, manejo de errores, patrones establecidos, estado del roadmap).
