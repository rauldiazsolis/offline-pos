# Foco, selección y texto con zoom — plan de implementación

> **Para agentes:** se ejecuta **inline** con superpowers:executing-plans, tarea por tarea con
> checkpoints (regla del repo: nunca un subagente por tarea). Los pasos usan checkboxes (`- [ ]`).

**Objetivo:** un lenguaje visual único (contorno = foco; relleno + marca = selección y paso actual) en
toda la app, y un piso de 11 px efectivos para el texto cuando la app se achica con `zoom`.

**Arquitectura:** todo el lenguaje vive en `src/ui/tokens.css` (tokens + clases); las pantallas dejan
de pintar la selección con estilos inline y pasan a marcarla con un atributo (`data-selected`,
`aria-pressed`, `aria-current`). El piso de texto es un factor CSS, `--text-zoom-compensation`, que
multiplica los tamaños de letra y, vía `ui/text-scale.ts::scaledPx`, los anchos fijos que envuelven
texto.

**Stack:** Preact + CSS plano, Vitest + Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-29-foco-seleccion-y-texto-design.md` (con la comparación
en https://claude.ai/artifact/2RmD9ssHtPEGfscT8WabFw).

## Restricciones globales

- Todo en español: código nuevo, comentarios, tests y commits.
- Rama `claude/offline-pos-visual-language-2a12ce` (la del worktree), commits chicos.
- Chequeo por tarea: `pnpm lint && pnpm typecheck && pnpm test && pnpm build` desde **PowerShell**
  (pnpm no anda desde Bash), y `pnpm test:e2e` en las tareas que lo dicen. Flakes conocidos: #142
  (`pnpm test`) y #155 (`demo-onboarding.spec.ts`): volver a correr antes de investigar.
- Prettier solo sobre los archivos tocados (`pnpm exec prettier --write <archivos>`); el repo no
  pasa `format:check` (#135).
- Commits con heredoc en Bash (`git commit -F - <<'EOF'`), terminados en
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Valores exactos de la spec: anillo `--focus-ring-width` 2 px con `--focus-ring-offset` 2 px por
  fuera; `--focus-room` 4 px; `--color-selected-bg` `#dbeafe`; `--color-selected-bg-subtle`
  `#eff6ff`; `--color-selected-text` `#1e40af`; barra de selección de 3 px en `--color-accent`;
  factor `max(1, calc(0.85 / var(--app-zoom)))`; piso de 11 px efectivos a 600 × 700.
- No se toca lo que #112 dice que quedó bien: `.btn-primary`/`.btn-danger`, placeholder "ej. …",
  cursores, click en la barra de estado, alto fijo del diálogo del wizard.
- Capturas de control con el script del brainstorming
  (`<scratchpad>/capture.mjs <etiqueta> [css] [escenas]`, contra `pnpm dev` en 5173 + backend en
  4000): después de las Tareas 2, 3 y 7 se comparan contra `shots/actual`.

## Archivos

| Archivo | Qué cambia |
|---|---|
| `src/ui/tokens.css` | Tokens de foco, selección y texto; regla de foco única; `.selectable-row`; opciones y pasos del wizard; hovers; tamaños base de `body` y controles |
| `src/ui/text-scale.ts` (nuevo) + test | `scaledPx(px)`: una medida que crece con el texto |
| `src/ui/screens/config-screen.tsx` | `StepList` sin estilos de selección inline; `--focus-room`; anchos con `scaledPx` |
| `src/ui/screens/config-wizard/steps.tsx` | `optionStyle` sin estado; título de la opción con clase |
| `src/ui/keyboard/config-controller.ts` + test | `moveTypeChoice` sin opción elegida |
| `src/ui/components/CartView.tsx` + test | Fila del carrito con `.selectable-row` |
| `src/ui/components/document-rows.tsx` | Filas de documentos con `.selectable-row` |
| `src/ui/screens/cash-summary-screen.tsx` | Filas de movimientos, arqueos, productos y medios; franja superior a 600 px |
| `src/ui/screens/cash-screen.tsx` | Sugerencias de concepto; anchos con `scaledPx` |
| `src/ui/components/CommandBarInput.tsx` | Hover de las filas de los overlays |
| `src/ui/components/StatusBar.tsx` | `--font-size-xs` → `--font-size-sm` |
| `src/ui/screens/dialog-styles.ts`, `components/PaymentFields.tsx`, `screens/receipt-screen.tsx`, `screens/void-screen.tsx` | Anchos con `scaledPx` |
| `e2e/text-size.spec.ts` (nuevo) | Piso de 11 px, botones sin partir y sin desborde a 600 × 700; 13 px a 1440 |
| `src/ui/AGENTS.md`, `docs/historia.md` | Reglas y cómo se llegó |

---

### Tarea 1: Flechas sin opción elegida

**Archivos:**
- Modificar: `src/ui/keyboard/config-controller.ts:341-349`
- Test: `src/ui/keyboard/config-controller.test.ts`, `src/ui/screens/config-screen.test.tsx:285-302`

**Interfaces:** `moveTypeChoice(direction: 1 | -1): void` conserva la firma.

- [ ] **Paso 1: test que falla.** En `config-controller.test.ts`, sumar `moveTypeChoice` al import de
  `./config-controller.ts`, importar `CONNECTOR_TYPES` desde donde lo importa `config-controller.ts`
  (ver su línea 10) y agregar dentro de `describe('wizard — instalación', …)`:

```ts
  it('sin tipo elegido, la primera flecha elige la opción enfocada (la primera), no la vecina', () => {
    configTypeSignal.value = null;
    moveTypeChoice(1);
    expect(configTypeSignal.value).toBe(CONNECTOR_TYPES[0]?.type);
    configTypeSignal.value = null;
    moveTypeChoice(-1);
    expect(configTypeSignal.value).toBe(CONNECTOR_TYPES[0]?.type);
  });

  it('con un tipo elegido, las flechas se mueven a la vecina sin ciclar', () => {
    configTypeSignal.value = CONNECTOR_TYPES[0]?.type ?? null;
    moveTypeChoice(1);
    expect(configTypeSignal.value).toBe(CONNECTOR_TYPES[1]?.type);
    moveTypeChoice(-1);
    moveTypeChoice(-1);
    expect(configTypeSignal.value).toBe(CONNECTOR_TYPES[0]?.type);
  });
```

  El test de componente "Tipo de conexión: el foco va a una opción y sigue a ↑/↓"
  (`config-screen.test.tsx:285-302`) hoy afirma lo contrario (↓ elige la segunda). Se cambia su
  segunda mitad por:

```ts
    // ↓ sin nada elegido elige la opción enfocada, la que se ve (#112); la siguiente ↓ pasa a la vecina.
    await act(() => {
      fireEvent.keyDown(screen.getByRole('dialog'), { key: 'ArrowDown' });
    });
    expect(rest.getAttribute('aria-pressed')).toBe('true');
    expect(document.activeElement).toBe(rest);
    await act(() => {
      fireEvent.keyDown(screen.getByRole('dialog'), { key: 'ArrowDown' });
    });
    const demo = screen.getByRole('button', { name: /^REST \(minibackend de demo\)/ });
    expect(demo.getAttribute('aria-pressed')).toBe('true');
    expect(document.activeElement).toBe(demo);
```

- [ ] **Paso 2:** `pnpm exec vitest run src/ui/keyboard/config-controller.test.ts src/ui/screens/config-screen.test.tsx`
  → fallan el primero nuevo (elige `CONNECTOR_TYPES[1]`) y el de componente.
- [ ] **Paso 3: implementación.**

```ts
/**
 * ↑/↓ en Tipo de conexión. Sin nada elegido, la primera flecha elige la opción enfocada (la primera,
 * la que se ve con el anillo) en vez de saltar a la vecina (#112); con una elegida, se mueve sin ciclar.
 */
export function moveTypeChoice(direction: 1 | -1): void {
  const index = CONNECTOR_TYPES.findIndex((info) => info.type === configTypeSignal.value);
  const next =
    index === -1 ? 0 : Math.min(Math.max(index + direction, 0), CONNECTOR_TYPES.length - 1);
  const chosen = CONNECTOR_TYPES[next];
  if (chosen !== undefined) {
    setConfigType(chosen.type);
  }
}
```

(Conservar el comentario que ya tenga la función si dice algo más, adaptado.)

- [ ] **Paso 4:** los mismos vitest pasan; después el chequeo completo. Revisar también
  `e2e/config-connector.spec.ts` y `e2e/connection-lifecycle.spec.ts` (miran `aria-pressed`): si
  alguno depende de que ↓ elija la segunda, se ajusta igual.
- [ ] **Paso 5: commit** `feat: la primera flecha sin tipo elegido elige la opción enfocada (#112)`.

---

### Tarea 2: El lenguaje en `tokens.css` y el wizard

**Archivos:**
- Modificar: `src/ui/tokens.css`, `src/ui/screens/config-screen.tsx`,
  `src/ui/screens/config-wizard/steps.tsx`
- Test: `src/ui/screens/config-screen.test.tsx`

**Interfaces — produce:** tokens `--color-selected-bg`, `--color-selected-bg-subtle`,
`--color-selected-text`, `--focus-ring-offset`, `--focus-room`; clases `.wizard-option__title`,
`.selectable-row` (con `[data-selected]`), que usa la Tarea 3.

- [ ] **Paso 1: test que falla.** En `config-screen.test.tsx`, dentro del mismo `describe` que el test
  de Tipo de conexión (línea ~285, cuyo `beforeEach` abre el wizard requerido):

```ts
  it('el paso actual y la opción elegida se marcan con atributos, sin estilos de selección inline (#112)', async () => {
    configTerminalSignal.value = { branch: 'Centro', pointOfSale: 'Caja 1', locale: '' };
    render(<ConfigScreen />);
    await act(() => {
      jumpToStep('type');
      setConfigType('rest');
    });
    const current = screen.getByRole('button', { name: /^Paso 2:/ });
    expect(current.getAttribute('aria-current')).toBe('step');
    expect(current.style.background).toBe('');
    expect(current.style.borderLeft).toBe('');
    for (const option of screen.getAllByRole('button').filter((b) => b.classList.contains('wizard-option'))) {
      expect(option.style.border).toBe('');
      expect(option.style.background).toBe('');
    }
  });
```

- [ ] **Paso 2:** `pnpm exec vitest run src/ui/screens/config-screen.test.tsx` → falla (hay `background`
  y `border` inline).
- [ ] **Paso 3: tokens y foco** en `tokens.css`. En el primer `:root`, después de
  `--color-placeholder`:

```css
  /* selección y paso actual (#112): relleno + marca, nunca un contorno azul */
  --color-selected-bg: #dbeafe;
  --color-selected-bg-subtle: #eff6ff;
  --color-selected-text: #1e40af;
```

y en el bloque de foco:

```css
  /* foco — visible siempre, nunca depende de :hover (ver AGENTS.md). Solo el foco dibuja un
     contorno azul (#112): por fuera, con aire, en toda la app. */
  --focus-ring-width: 2px;
  --focus-ring-offset: 2px;
  /* margen que reserva un contenedor con scroll para no recortar el anillo de un hijo */
  --focus-room: calc(var(--focus-ring-width) + var(--focus-ring-offset));
```

La regla general pasa a `outline-offset: var(--focus-ring-offset);`.

- [ ] **Paso 4: reemplazar el bloque del wizard** (desde `.wizard-step-button:hover` hasta
  `.wizard-input:focus`, sin tocar `.wizard-step-summary` ni `::placeholder`) por:

```css
/*
 * Wizard de /CONFIG. Lenguaje de #112: el foco es el anillo general (por fuera); la selección y el
 * paso actual son relleno + marca. El hover es decorativo: nunca un contorno azul ni la selección.
 */
.wizard-step-button {
  border: none;
  border-left: 3px solid transparent;
  background: transparent;
}

.wizard-step-button[aria-current='step'] {
  background: var(--color-selected-bg);
  border-left-color: var(--color-accent);
}

.wizard-step-button:hover:not(:disabled):not([aria-current='step']) {
  background: var(--color-surface);
}

/* Opción de un grupo tipo radio: borde neutro siempre del mismo grosor (elegir no corre nada). */
.wizard-option {
  border: 1px solid var(--color-border);
  background: var(--color-bg);
}

.wizard-option:hover {
  border-color: var(--color-placeholder);
}

.wizard-option[aria-pressed='true'] {
  background: var(--color-selected-bg-subtle);
}

.wizard-option[aria-pressed='true'] .wizard-option__title {
  color: var(--color-selected-text);
}

.wizard-radio { /* igual que hoy */ }

.wizard-option[aria-pressed='true'] .wizard-radio { /* igual que hoy */ }

/*
 * Campo de texto enfocado: el anillo general, con `:focus` y no solo `:focus-visible` — Chromium no
 * marca `:focus-visible` cuando el foco se pone por código antes de cualquier interacción (el primer
 * campo de un paso al cargar la página), y el campo quedaba enfocado sin que se note.
 */
.wizard-input:focus {
  outline: var(--focus-ring-width) solid var(--color-focus-ring);
  outline-offset: var(--focus-ring-offset);
}
```

(Las dos reglas de `.wizard-radio` se copian tal cual están hoy; se borran `.wizard-option:focus-visible`
y `.wizard-step-button:focus-visible`.)

- [ ] **Paso 5: `.selectable-row`** al final de `tokens.css` (lo usa la Tarea 3):

```css
/*
 * Fila seleccionable de una lista sobre superficie clara (#112): la selección es relleno + barra de
 * acento de 3 px, nunca un contorno. El estado viaja en `data-selected`, no en el `style`. En una
 * tabla la barra va en la primera celda: `box-shadow` en un `<tr>` no es confiable.
 */
.selectable-row[data-selected] {
  background: var(--color-selected-bg);
  box-shadow: inset 3px 0 0 var(--color-accent);
}

tr.selectable-row[data-selected] {
  box-shadow: none;
}

tr.selectable-row[data-selected] > td:first-child {
  box-shadow: inset 3px 0 0 var(--color-accent);
}
```

- [ ] **Paso 6: `StepList`** (`config-screen.tsx`): en el `style` del botón se borran `border`,
  `borderLeft` y `background` (ahora en CSS); el `nav` pasa a
  `style={{ overflowY: 'auto', minHeight: 0, padding: 'var(--focus-room)' }}`; la `section` del paso
  pasa a `padding: 'var(--focus-room) var(--space-2) var(--focus-room) var(--focus-room)'`, con el
  comentario del margen apuntando a `--focus-room`.
- [ ] **Paso 7: opciones** (`steps.tsx`): `optionStyle` deja de recibir `selected` y pierde `border` y
  `background`:

```ts
const optionStyle = {
  display: 'flex',
  flexDirection: 'column' as const,
  gap: 'var(--space-1)',
  textAlign: 'left' as const,
  padding: 'var(--space-3)',
  borderRadius: 'var(--radius-md)',
  color: 'var(--color-text)',
  fontFamily: 'var(--font-sans)',
  fontSize: 'var(--font-size-base)',
  cursor: 'pointer',
};
```

Las tres llamadas `style={optionStyle(…)}` pasan a `style={optionStyle}`, y `OptionTitle` agrega
`class="wizard-option__title"` a su `<strong>`.

- [ ] **Paso 8:** el vitest del Paso 2 pasa; chequeo completo.
- [ ] **Paso 9: capturas** `node capture.mjs t2 - config-tipo,config-tipo-sin-elegir,config-paso-enfocado,config-datos-locales,config-terminal`
  y comparar con `shots/alt-a` (la maqueta aprobada) a 600, 1024 y 1440: ningún anillo cortado, nada
  que se corra al elegir.
- [ ] **Paso 10: commit** `feat: lenguaje de foco y selección en el wizard de /CONFIG (#112)`.

---

### Tarea 3: Filas seleccionables y hovers en el resto de la app

**Archivos:**
- Modificar: `src/ui/components/CartView.tsx:205-221`, `src/ui/components/document-rows.tsx`,
  `src/ui/screens/cash-summary-screen.tsx`, `src/ui/screens/cash-screen.tsx:305-316`,
  `src/ui/components/CommandBarInput.tsx:191-203`, `src/ui/tokens.css` (hover de overlays)
- Test: `src/ui/components/CartView.test.tsx`

**Interfaces — consume:** `.selectable-row[data-selected]` de la Tarea 2.

- [ ] **Paso 1: test que falla** en `CartView.test.tsx`:

```ts
  it('la línea seleccionada se marca con data-selected, sin fondo inline (#112)', () => {
    cartSignal.value = {
      lines: [
        { kind: 'product', productId: 'p1', qty: 1, unitPrice: 100 },
        { kind: 'product', productId: 'p1', qty: -1, unitPrice: 100 },
      ],
    };
    cartSelectionIndexSignal.value = 1;
    const { container } = render(<CartView />);
    const rows = [...container.querySelectorAll<HTMLTableRowElement>('tbody tr')];
    expect(rows[1]?.hasAttribute('data-selected')).toBe(true);
    expect(rows[1]?.style.background).toBe('');
    expect(rows[0]?.hasAttribute('data-selected')).toBe(false);
  });
```

- [ ] **Paso 2:** `pnpm exec vitest run src/ui/components/CartView.test.tsx` → falla.
- [ ] **Paso 3: carrito.** En el `<tr>` de cada línea: `class` pasa a
  `['selectable-row', line.qty < 0 ? 'cart-view__refund-line' : ''].join(' ').trim()`,
  `data-selected={index === selectedIndex ? '' : undefined}` y el `style` a
  `{ background: index !== selectedIndex && line.qty < 0 ? 'var(--color-refund-bg)' : undefined, cursor: 'pointer' }`
  (una devolución seleccionada muestra la selección, como hoy).
- [ ] **Paso 4: filas de documentos** (`document-rows.tsx`). `rowContainerStyle` pierde el
  `background`; cada contenedor de fila suma `class="selectable-row"` y
  `data-selected={selected ? '' : undefined}`, y se borran sus `boxShadow` de selección inline. El
  encabezado sticky: `background: selected ? undefined : 'var(--color-bg)'`, sin `boxShadow`. En
  `tokens.css`, junto a `.selectable-row`:

```css
/* Encabezado sticky de un ticket seleccionado (/RESUMEN, /ANULAR): tapa lo que scrollea debajo. */
.selectable-row[data-selected] .ticket__header {
  background: var(--color-selected-bg);
  box-shadow: inset 3px 0 0 var(--color-accent);
}
```

- [ ] **Paso 5: `/RESUMEN`** (`cash-summary-screen.tsx`). `rowContainerStyle(index)` deja de poner
  `background`; `MovementEntryRow` y `CountEntryRow` suman `class="selectable-row"` y
  `data-selected={isSelected ? '' : undefined}` y pierden el `boxShadow`. Las filas de Productos y
  Medios de pago (`style={rowStyle(…)}`, líneas ~444 y ~518) pasan a `class="selectable-row"`,
  `data-selected={… ? '' : undefined}` y `style={{ cursor: 'pointer' }}`; se borra `rowStyle`.
- [ ] **Paso 6: sugerencias de `/CAJA`** (`cash-screen.tsx`): el `<li>` suma `class="selectable-row"` y
  `data-selected={index === conceptSuggestionIndexSignal.value ? '' : undefined}` y pierde el
  `background` inline.
- [ ] **Paso 7: hover de los overlays.** En `CommandBarInput.tsx::rowStyle`,
  `background: selected ? 'var(--color-accent)' : undefined` (sin `'transparent'`, que le ganaba al
  hover de la clase). En `tokens.css`:

```css
.command-bar-row:hover:not([aria-disabled='true']) {
  background: var(--color-chrome-surface);
}
```

(reemplaza el `box-shadow` azul; comentario: "hover decorativo, nunca un contorno azul (#112)").
- [ ] **Paso 8:** vitest del Paso 1 pasa; chequeo completo (los tests de `/RESUMEN`, `/ANULAR` y
  `/CAJA` no miraban estilos inline: si alguno falla, se ajusta al atributo).
- [ ] **Paso 9: capturas** `node capture.mjs t3 - venta-busqueda,venta-clientes,resumen,caja,anular`:
  carrito, `/RESUMEN` y `/ANULAR` con relleno azul claro + barra; overlays sin cambios salvo el hover.
- [ ] **Paso 10: commit** `feat: filas seleccionables con relleno y barra en toda la app (#112)`.

---

### Tarea 4: Resumen de cada paso en un renglón

**Archivos:** modificar `src/ui/tokens.css` (`.wizard-step-summary`) y el comentario de
`config-screen.tsx:150-151`.

- [ ] **Paso 1:** `.wizard-step-summary` pasa a:

```css
/* Resumen de un paso en la columna: un renglón fijo, recortado con "…" (#112); completo en el title. */
.wizard-step-summary {
  grid-column: 2 / 4;
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  line-height: 1.3;
  min-height: 1.3em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
```

y el comentario del `span` en `StepList`: "Siempre presente y de alto fijo (un renglón): completar un
paso no agranda su ítem ni corre la lista. El texto completo, en el title."
- [ ] **Paso 2:** chequeo completo; captura `node capture.mjs t4 - config-tipo`.
- [ ] **Paso 3: commit** `feat: el resumen de cada paso del wizard ocupa un renglón (#112)`.

---

### Tarea 5: Piso de texto con zoom

**Archivos:**
- Crear: `src/ui/text-scale.ts`, `src/ui/text-scale.test.ts`, `e2e/text-size.spec.ts`
- Modificar: `src/ui/tokens.css`, `src/ui/components/StatusBar.tsx:182,206,229`

**Interfaces — produce:** `--text-zoom-compensation` (número ≥ 1) y
`scaledPx(px: number): string`, que usa la Tarea 6.

- [ ] **Paso 1: e2e que falla**, `e2e/text-size.spec.ts`:

```ts
import { expect, test } from './fixtures.ts';
import { seedCatalog } from './helpers.ts';
import type { Page } from '@playwright/test';

/**
 * #111: por debajo de 1024 px la app se achica con `zoom`, pero el texto no baja de 11 px efectivos
 * (tamaño CSS × zoom), ningún botón parte su etiqueta y nada se sale de la pantalla. A 1440 px los
 * tamaños son los de siempre.
 */
const MIN_EFFECTIVE_PX = 11;

type Measure = { smallest: { px: number; text: string }; wrappedButtons: string[]; overflows: boolean };

async function measure(page: Page): Promise<Measure> {
  return page.evaluate(() => {
    const wrapper = document.querySelector('.app-zoom-wrapper');
    const zoom = wrapper === null ? 1 : Number(getComputedStyle(wrapper).zoom);
    let smallest = { px: Number.POSITIVE_INFINITY, text: '' };
    for (const element of document.querySelectorAll('body *')) {
      if (element.getClientRects().length === 0) continue;
      const hasText = [...element.childNodes].some(
        (node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim() !== '',
      );
      if (!hasText) continue;
      const px = parseFloat(getComputedStyle(element).fontSize) * zoom;
      if (px < smallest.px) smallest = { px, text: (element.textContent ?? '').trim().slice(0, 40) };
    }
    // Las opciones y los pasos del wizard son botones de varios renglones a propósito.
    const wrappedButtons = [...document.querySelectorAll('button')]
      .filter((button) => button.getClientRects().length > 0)
      .filter((button) => !button.matches('.wizard-option, .wizard-step-button'))
      .filter((button) => {
        const range = document.createRange();
        range.selectNodeContents(button);
        const rects = [...range.getClientRects()]
          .filter((rect) => rect.width > 0)
          .sort((a, b) => a.top - b.top);
        let lines = 0;
        let bottom = Number.NEGATIVE_INFINITY;
        for (const rect of rects) {
          if (rect.top >= bottom - 1) {
            lines += 1;
            bottom = rect.bottom;
          } else {
            bottom = Math.max(bottom, rect.bottom);
          }
        }
        return lines > 1;
      })
      .map((button) => (button.textContent ?? '').trim());
    const overflows = document.documentElement.scrollWidth > window.innerWidth;
    return { smallest, wrappedButtons, overflows };
  });
}

async function expectLegible(page: Page, where: string): Promise<void> {
  const result = await measure(page);
  expect(result.smallest.px, `${where}: "${result.smallest.text}"`).toBeGreaterThanOrEqual(
    MIN_EFFECTIVE_PX,
  );
  expect(result.wrappedButtons, `${where}: botones partidos`).toEqual([]);
  expect(result.overflows, `${where}: desborde horizontal`).toBe(false);
}

async function runCommand(page: Page, command: string): Promise<void> {
  const bar = page.getByLabel('Barra de comandos');
  await bar.fill(command);
  await bar.press('Enter');
}

test.describe('a 600 × 700', () => {
  test.use({ viewport: { width: 600, height: 700 } });

  test('todas las pantallas se leen: texto ≥ 11 px, botones enteros, sin desborde', async ({
    page,
  }) => {
    await page.goto('/');
    await seedCatalog(page);
    const bar = page.getByLabel('Barra de comandos');
    for (const product of ['arroz', 'fideos', 'yerba']) {
      await bar.fill(product);
      await bar.press('Enter');
    }
    await expectLegible(page, 'venta');
    await bar.fill('/');
    await expectLegible(page, 'menú de /');
    await bar.fill('@');
    await expectLegible(page, 'clientes');
    await bar.fill('ar');
    await expectLegible(page, 'búsqueda');
    await bar.fill('');

    await page.keyboard.press('Control+Enter');
    await expect(page.getByLabel('Efectivo')).toBeFocused();
    await expectLegible(page, 'Cobro');
    await page.keyboard.press('Control+Enter');
    await expect(page.getByText('Comprobante')).toBeVisible();
    await expectLegible(page, 'comprobante');
    await page.keyboard.press('Escape');

    await bar.fill('@Ana');
    await bar.press('Enter');
    await expect(bar).toHaveValue('');
    await bar.press('Enter');
    await expect(page.getByLabel('Efectivo')).toBeFocused();
    await expectLegible(page, 'cobranza');
    await page.keyboard.press('Escape');

    await runCommand(page, '/RESUMEN');
    await expectLegible(page, '/RESUMEN Movimientos');
    await page.keyboard.press('Alt+2');
    await expectLegible(page, '/RESUMEN Productos');
    await page.keyboard.press('Alt+3');
    await expectLegible(page, '/RESUMEN Medios de pago');
    await page.keyboard.press('Escape');

    await runCommand(page, '/CAJA');
    await expectLegible(page, '/CAJA');
    await page.keyboard.press('Escape');

    await runCommand(page, '/ANULAR');
    await expectLegible(page, '/ANULAR');
    await page.keyboard.press('Escape');

    await runCommand(page, '/DIAGNOSTICO');
    await expectLegible(page, '/DIAGNOSTICO');
    await page.keyboard.press('Escape');

    await runCommand(page, '/CONFIG');
    for (const step of ['1', '2', '3', '4', '5', '6']) {
      await page.keyboard.press(`Alt+${step}`);
      await expectLegible(page, `/CONFIG paso ${step}`);
    }
  });
});

test.describe('a 1440 × 900', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('el texto más chico sigue en 13 px', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByLabel('Barra de comandos')).toBeVisible();
    const result = await measure(page);
    expect(result.smallest.px).toBe(13);
  });
});
```

(Al correrlo por primera vez se ajustan los esperas de cada pantalla a lo que realmente muestra:
p. ej. si "Comprobante" aparece dos veces, usar el `heading`; si Esc de `/CAJA` primero cierra las
sugerencias, un segundo Esc. El criterio no se afloja: 11 px, botones enteros, sin desborde.)

- [ ] **Paso 2:** `pnpm exec playwright test e2e/text-size.spec.ts` (PowerShell) → falla: venta con
  7 px ("Sin arqueo en 24 h") a 600 y 12 px a 1440.
- [ ] **Paso 3: test unitario de `scaledPx`**, `src/ui/text-scale.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { scaledPx } from './text-scale.ts';

describe('scaledPx', () => {
  it('multiplica la medida por el factor de compensación del texto', () => {
    expect(scaledPx(240)).toBe('calc(240px * var(--text-zoom-compensation))');
  });
});
```

- [ ] **Paso 4:** `src/ui/text-scale.ts`:

```ts
/**
 * Una medida en píxeles que envuelve texto y crece con él (#111): por debajo de ~870 px de ancho el
 * texto deja de achicarse con el zoom (`--text-zoom-compensation` en `tokens.css`), así que el ancho
 * fijo de un diálogo, una columna o un campo tiene que acompañarlo o el texto no entra. De 870 px
 * para arriba el factor vale 1 y la medida es la de siempre.
 */
export function scaledPx(px: number): string {
  return `calc(${String(px)}px * var(--text-zoom-compensation))`;
}
```

- [ ] **Paso 5: tokens de texto.** En `tokens.css`, los tamaños pasan a:

```css
  /* tipografía — con piso para el zoom de pantallas angostas (#111, ver --text-zoom-compensation) */
  --font-size-sm: calc(13px * var(--text-zoom-compensation));
  --font-size-base: calc(16px * var(--text-zoom-compensation));
  --font-size-lg: calc(20px * var(--text-zoom-compensation));
  --font-size-xl: calc(28px * var(--text-zoom-compensation));
```

y en el `:root` del zoom, después de `--app-zoom`:

```css
  /*
   * Piso del texto (#111): el layout se achica con `--app-zoom`, pero el texto conserva al menos el
   * 85 % de su tamaño. Vale 1 con zoom ≥ 0,85 (ventana de ~870 px o más) y crece por debajo, así
   * que a 600 px `--font-size-sm` mide 11 px efectivos en vez de 7,6. Los anchos fijos que envuelven
   * texto lo acompañan con `ui/text-scale.ts::scaledPx`.
   */
  --text-zoom-compensation: max(1, calc(0.85 / var(--app-zoom)));
```

Y, después de la regla de `body { cursor }`:

```css
/*
 * Tamaños base (#111): todo texto sale de un token, así ninguno escapa del piso de zoom. Los
 * controles sin tamaño propio usan --font-size-sm (el default del navegador era 13,33 px).
 */
body {
  font-size: var(--font-size-base);
}

button,
input,
select,
textarea {
  font-size: var(--font-size-sm);
}
```

- [ ] **Paso 6: barra de estado.** En `StatusBar.tsx`, las tres `fontSize: 'var(--font-size-xs, 12px)'`
  pasan a `fontSize: 'var(--font-size-sm)'`.
- [ ] **Paso 7:** vitest de `text-scale` pasa; el e2e a 1440 pasa. El de 600 puede seguir fallando
  **solo** por botones partidos o desborde (lo resuelve la Tarea 6), no por tamaño: si falla por
  tamaño, buscar el elemento que nombra el mensaje y pasarlo a un token.
- [ ] **Paso 8:** chequeo completo (sin `test:e2e` todavía).
- [ ] **Paso 9: commit** `feat: piso de 11 px efectivos para el texto con zoom (#111)` (con el spec
  e2e; si todavía falla a 600 por densidad, decirlo en el cuerpo del commit).

---

### Tarea 6: Densidad a 600 px

**Archivos:** modificar `src/ui/screens/config-screen.tsx`, `src/ui/screens/cash-summary-screen.tsx`,
`src/ui/screens/dialog-styles.ts`, `src/ui/screens/cash-screen.tsx`,
`src/ui/components/PaymentFields.tsx`, `src/ui/screens/receipt-screen.tsx`,
`src/ui/screens/void-screen.tsx`.

**Interfaces — consume:** `scaledPx` de la Tarea 5 (`import { scaledPx } from '../text-scale.ts'`,
o `'../../text-scale.ts'` según la carpeta).

- [ ] **Paso 1: anchos que envuelven texto** con `scaledPx`:
  - `config-screen.tsx`: `dialogStyle.maxWidth: scaledPx(860)`,
    `height: \`min(${scaledPx(640)}, 100%)\``, y `gridTemplateColumns: \`${scaledPx(240)} 1fr\``.
  - `dialog-styles.ts`: `maxWidth: scaledPx(720)`.
  - `cash-screen.tsx`: `maxWidth: scaledPx(560)`, `inputStyle.width: scaledPx(280)`,
    `amountInputStyle.width: scaledPx(160)` y el `width: '280px'` de las sugerencias → `scaledPx(280)`.
  - `PaymentFields.tsx`: `width: scaledPx(160)`.
  - `receipt-screen.tsx`: `maxWidth: scaledPx(360)`.
  - `void-screen.tsx`: `width: \`min(${scaledPx(420)}, 90%)\``.
- [ ] **Paso 2: franja de `/RESUMEN`** (`cash-summary-screen.tsx`): `whiteSpace: 'nowrap'` en
  `tabButtonStyle`, `dayButtonStyle` y el botón "Cerrar (Esc)"; el grupo de la izquierda (título,
  fecha y botones de día) suma `flexWrap: 'wrap'` y `rowGap: 'var(--space-1)'`; la fecha,
  `whiteSpace: 'nowrap'`. La columna lateral pasa a
  `gridTemplateColumns: \`1fr clamp(${scaledPx(240)}, 25%, ${scaledPx(320)})\``.
- [ ] **Paso 3:** `pnpm exec playwright test e2e/text-size.spec.ts` → pasa. Si todavía hay un botón
  partido o desborde, el mensaje dice cuál: se resuelve con `nowrap` en ese botón y dejando que su
  contenedor haga `wrap`, o con `scaledPx` en el ancho que lo aprieta — nunca achicando la letra.
- [ ] **Paso 4: capturas** `node capture.mjs t6` (todas las escenas) y revisar a mano 600, 1024 y
  1440: a 1024 y 1440 las pantallas se ven como en `shots/t3` (el factor vale 1); a 600, nada cortado
  ni superpuesto.
- [ ] **Paso 5:** chequeo completo **y** `pnpm test:e2e`.
- [ ] **Paso 6: commit** `feat: diálogos y /RESUMEN acompañan al texto a 600 px (#111)`.

---

### Tarea 7: Documentación, capturas finales e informe

**Archivos:** modificar `src/ui/AGENTS.md`, `docs/historia.md`; este plan (desvíos).

- [ ] **Paso 1: `src/ui/AGENTS.md`, "Diseño visual"** — agregar, después del punto del chrome oscuro:

```markdown
- **Foco, selección y paso actual (#112)**: **solo el foco dibuja un contorno azul** — el anillo
  general de `tokens.css` (2 px por fuera, `--focus-ring-offset` de aire), igual en botones,
  opciones, pasos, filas y campos; nunca un halo, un anillo por dentro ni otro color. La **selección**
  (sobre qué actúa Enter, la opción elegida) y el **paso actual** son **relleno azul claro + una
  marca**: barra de 3 px en filas y pasos (`.selectable-row[data-selected]`), círculo lleno en las
  opciones (`.wizard-option[aria-pressed]`); el borde de una tarjeta elegida queda neutro y del mismo
  grosor. El **hover** es decorativo: nunca contorno azul ni la marca. Excepciones: sobre el chrome
  oscuro y en controles compactos (overlays de la barra, selector de `/CAJA`, pestañas de
  `/RESUMEN`) la selección es relleno sólido; la barra de comandos marca su foco con el borde
  inferior. Comparación que llevó a elegirlo: la spec
  `docs/superpowers/specs/2026-09-29-foco-seleccion-y-texto-design.md`.
```

En el punto del zoom, reemplazar "Pendientes: #41 (…) y #111 (tipografía chica con zoom)." por:

```markdown
**Piso de texto (#111)**: el texto no baja del 85 % de su tamaño — `--text-zoom-compensation`
(`max(1, 0.85 / --app-zoom)`) multiplica los `--font-size-*`, así que a 600 px nada mide menos de
11 px efectivos; todo texto sale de un token (`body` y los controles sin tamaño toman `base` y `sm`).
Los anchos fijos que envuelven texto (diálogos, la columna de pasos, campos) usan
`ui/text-scale.ts::scaledPx`. Lo vigila `e2e/text-size.spec.ts`. Pendiente: #41 (resize en el modo
Responsive de DevTools).
```

- [ ] **Paso 2: "Patrones de UI"** — agregar:

```markdown
- **Selección por atributo, no por estilo inline** (#112): una fila seleccionable lleva
  `class="selectable-row"` y `data-selected` (el estilo vive en `tokens.css`), y un contenedor con
  scroll que tiene controles enfocables adentro reserva `--focus-room` de padding para no recortar el
  anillo.
```

- [ ] **Paso 3: "`/CONFIG` como wizard"** — en el punto 2 (Tipo de conexión): "↑/↓ + Enter o click;
  sin nada elegido, la primera flecha elige la opción enfocada (#112)"; y en el párrafo de la columna:
  "resumen de un renglón, recortado con «…» (completo en el `title`)".
- [ ] **Paso 4: `docs/historia.md`** — una entrada "Pasada visual: foco, selección y texto (#112,
  #111)" con: las tres rondas de #97 que no convencieron, el relevamiento (seis formas de "elegido",
  contorno azul con dos significados, 7 px a 600 px, `--font-size-xs` inexistente), las alternativas
  A/B/C comparadas con capturas de la app real y por qué A, el piso de 0,85 frente a subir el ancho
  mínimo o hacer reflow, y los desvíos de este plan.
- [ ] **Paso 5:** desvíos al final de este plan (sección "Desvíos"), si los hubo.
- [ ] **Paso 6: capturas finales** `node capture.mjs final` y armar el informe: antes/después a 600,
  1024 y 1440 (actualizar la página de comparación o publicar una nueva) y la prueba manual paso a
  paso.
- [ ] **Paso 7:** chequeo completo + `pnpm test:e2e`; commit
  `docs: lenguaje de foco y selección y piso de texto en las reglas (#112, #111)`.
- [ ] **Paso 8: informe al usuario** con la prueba manual (abajo) y notificación al teléfono. El PR
  ("Closes #112", "Closes #111", merge commit) se abre **recién** después de su revisión; después del
  merge, `AGENTS.md` de la raíz ("Estado del proyecto" e "Issues abiertas") y cierre de los issues
  con comentario apuntando al PR.

**Prueba manual (para el informe):**
1. `pnpm dev`, abrir http://localhost:5173/?demo=true&backend=http%3A%2F%2Flocalhost%3A4000.
2. Venta: agregar 3 artículos, ↑/↓ con la barra vacía → la línea elegida con fondo azul claro y barra
   a la izquierda. Tipear "ga" → overlay con la fila azul sólida; pasar el mouse por otra fila → solo
   se aclara el fondo, sin contorno azul.
3. `/CONFIG`, Alt+2: la opción elegida con fondo azul claro y círculo lleno, y el anillo por fuera;
   ↓/↑ mueven la elección sin que nada se corra. Shift+Tab hasta la columna: el paso enfocado lleva
   el anillo por fuera, sin cortarse; el paso actual, fondo + barra. Cada paso, un renglón de resumen.
4. En una terminal nueva (o `pos.reset()`), Tipo de conexión: la primera opción con el anillo y el
   círculo vacío; ↓ la elige (no salta a la segunda).
5. `/RESUMEN` y `/ANULAR`: la fila elegida con fondo azul claro y barra.
6. DevTools → modo Responsive a 600 × 700: repetir 2 a 5; nada ilegible (el texto más chico ~11 px),
   ningún botón partido, nada que se salga. A 1024 y 1440, todo del tamaño de siempre.
