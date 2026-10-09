# mobile — POS para celular sin teclado del sistema

Una vista nueva del mismo POS, para celular: **nunca abre el teclado del sistema**. Misma idea, mismo
Connector API y la misma lógica que el POS de escritorio (`src/`), que acá se **reusa sin copiar y sin
modificar**: dominio, storage, sync, conectores, el arranque (`ui/bootstrap.ts`), los signals de
`ui/state/` y los controllers de `ui/keyboard/` (que, pese al nombre, son la lógica de cada pantalla
sobre signals). Lo propio del mobile es solo la vista. Las reglas de la raíz (`../AGENTS.md`) valen
acá igual, empezando por "Cómo trabajamos".

Desarrollo en una rama larga que no se mergea hasta que el mobile esté prácticamente completo
(decisión del usuario, 2026-10-09). Lo único que se toca fuera de `mobile/` es configuración
(`pnpm-workspace.yaml`, el `exclude` de Vitest en `vite.config.ts`, el CI) y, si hace falta para
probar el onboarding, `demo-backend/`.

## Sin teclado del sistema (la regla central)

- Ningún elemento que pida el teclado del sistema: ni `input` de texto, ni `textarea`, ni `select`,
  ni `contenteditable`. Todo se ingresa con controles propios (`src/keyboards/`): el teclado
  numérico y el de letras (con una capa de números y símbolos que alcanza para URLs y claves),
  grillas, listas, chips y la cámara.
- `e2e/no-system-keyboard.spec.ts` lo vigila en cada pantalla.
- Una entrada se pide con `openNumberEntry` u `openTextEntry` (`keyboards/entry.ts`) y la muestra
  `EntryHost`, delante de todo; una a la vez. El texto de un número usa el separador decimal del
  locale y ningún separador de miles: el mismo formato que tipea un cajero en escritorio, así los
  controllers lo leen sin cambios. Las teclas físicas también andan (una compu, un teclado conectado).

## Dependencias

`mobile/package.json` **no declara dependencias**: todo sale del `node_modules` de la raíz. Así hay
una sola copia de Preact y de `@preact/signals` (dos copias rompen la reactividad sin avisar);
`resolve.dedupe` en `vite.config.ts` lo asegura igual. Una dependencia nueva del mobile va en el
`package.json` de la raíz.

## Comandos

`pnpm --filter pos-mobile <dev|build|preview|typecheck|test|test:e2e>`. El lint es el de la raíz
(`pnpm lint` cubre `mobile/`). Los tests de la raíz excluyen `mobile/**`.
