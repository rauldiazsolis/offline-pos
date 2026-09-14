import { computed, signal } from '@preact/signals';
import type { CatalogSearchResult } from '../../domain/catalog-search.ts';
import type { CustomerSearchResult } from '../../domain/customer-search.ts';
import type { SaleLine } from '../../domain/sale.ts';
import { AVAILABLE_COMMANDS } from '../keyboard/commands.ts';
import { parseCommandBar, type ParsedCommand } from '../keyboard/parse-command-bar.ts';
import { getCatalogRepository } from './catalog.ts';
import { cartSignal } from './cart.ts';
import { getCustomerRepository } from './customer-repository.ts';

/** Contenido actual del input de la barra de comandos. */
export const commandBarBufferSignal = signal('');

/**
 * Mensaje de error de parseo, para el slot de altura fija junto a la barra
 * (ver "UX keyboard-first" en CLAUDE.md). Se limpia con cualquier edición o
 * comando exitoso — nunca por timeout.
 */
export const commandBarErrorSignal = signal<string | null>(null);

/** Preview en vivo del buffer actual (`finalizing: false`) — se recalcula solo. */
export const parsedSignal = computed<ParsedCommand>(() =>
  parseCommandBar(commandBarBufferSignal.value, { finalizing: false }),
);

/**
 * Un resultado de "buscar artículo" puede ser un producto del catálogo o una
 * línea libre que ya está en este ticket — la segunda no vive en ningún
 * índice, es la forma de identificar cuál ajustar con `<n>*descripción`/
 * `-<n>*descripción` (sin `$`, ver `domain/cart.ts::adjustFreeformLineQuantity`).
 */
export type UnifiedSearchResult =
  | { kind: 'freeform-line'; description: string; unitPrice: number; qtyInCart: number }
  | { kind: 'product'; result: CatalogSearchResult };

function matchingFreeformLines(query: string): UnifiedSearchResult[] {
  const needle = query.toLowerCase();
  return cartSignal.value.lines
    .filter(
      (line): line is Extract<SaleLine, { kind: 'freeform' }> =>
        line.kind === 'freeform' && line.description.toLowerCase().includes(needle),
    )
    .map((line) => ({
      kind: 'freeform-line',
      description: line.description,
      unitPrice: line.unitPrice,
      qtyInCart: line.qty,
    }));
}

/**
 * Resultados de búsqueda en vivo cuando el buffer resuelve a `search`. Llamada
 * síncrona a FlexSearch, sin debounce — a esta escala la propia consulta ya
 * cumple RNF-03. Líneas libres ya en el carrito que matcheen van primero
 * (decisión del usuario: es lo más probable que se quiera ajustar), después
 * el catálogo — mezclados en una sola lista, no en secciones separadas.
 */
export const searchResultsSignal = computed<UnifiedSearchResult[]>(() => {
  const parsed = parsedSignal.value;
  if (parsed.kind !== 'search') {
    return [];
  }
  const productMatches: UnifiedSearchResult[] = getCatalogRepository()
    .search(parsed.query)
    .map((result) => ({ kind: 'product', result }));
  return [...matchingFreeformLines(parsed.query), ...productMatches];
});

/**
 * Resultado de búsqueda seleccionado visualmente (↑/↓ mientras hay texto en
 * la barra). `null` = nada seleccionado (por defecto, el primer resultado).
 */
export const searchSelectionIndexSignal = signal<number | null>(null);

/**
 * Un resultado de `@` puede ser un cliente real o "Consumidor Final" — la
 * forma de desadjuntar el cliente actual. Antes era un caso especial ("@"
 * vacío + Enter sin nada seleccionado, ver `submitCommandBar`), pero desde
 * que la query vacía muestra clientes recientes (#21) esa lista ya no está
 * vacía, así que ese caso especial dejó de dispararse — un bug real
 * reportado por el usuario: no había forma de desadjuntar un cliente.
 * Ponerlo como una fila más de la lista es más discoverable y no depende
 * de ningún caso especial.
 */
export type CustomerOrClear =
  { kind: 'clear' } | { kind: 'customer'; result: CustomerSearchResult };

/**
 * Resultados en vivo de `@<query>` — mismo criterio que `searchResultsSignal`.
 * Con la query vacía (apenas se abre `@`) muestra "Consumidor Final" primero
 * y después los clientes más recientes, en vez de nada: a diferencia de la
 * búsqueda de artículos, no tiene sentido esperar a que se tipee algo para
 * mostrar una lista (issue #21). Con una query puntual (buscando o creando
 * un cliente específico), no se incluye "Consumidor Final" — no tiene
 * sentido mezclarlo con el flujo de crear un cliente nuevo.
 */
export const customerResultsSignal = computed<CustomerOrClear[]>(() => {
  const parsed = parsedSignal.value;
  if (parsed.kind !== 'customer') {
    return [];
  }
  if (parsed.query === '') {
    const recent = getCustomerRepository().listRecent();
    return [{ kind: 'clear' }, ...recent.map((result) => ({ kind: 'customer' as const, result }))];
  }
  return getCustomerRepository()
    .search(parsed.query)
    .map((result) => ({ kind: 'customer' as const, result }));
});

/** Selección visual (↑/↓) sobre `customerResultsSignal`. */
export const customerSelectionIndexSignal = signal<number | null>(null);

/**
 * Comandos que matchean el prefijo tipeado después de `/` (issue #3). Con
 * `parsed.name === ''` (buffer es solo `/`) matchea todo — mismo caso que
 * antes de filtrar.
 */
export const commandResultsSignal = computed<typeof AVAILABLE_COMMANDS>(() => {
  const parsed = parsedSignal.value;
  if (parsed.kind !== 'command') {
    return [];
  }
  return AVAILABLE_COMMANDS.filter((command) => command.name.startsWith(parsed.name));
});

/**
 * Selección visual (↑/↓) sobre `commandResultsSignal` — a propósito, sin
 * default a la fila 0 (a diferencia de `searchSelectionIndexSignal`/
 * `customerSelectionIndexSignal`): ejecutar el comando equivocado sin querer
 * tiene consecuencias reales, así que acá nada queda preseleccionado hasta
 * que el usuario navegue explícitamente (ver `command-bar-controller.ts`).
 */
export const commandSelectionIndexSignal = signal<number | null>(null);
