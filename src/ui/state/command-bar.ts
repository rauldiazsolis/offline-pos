import { computed, signal } from '@preact/signals';
import type { CatalogSearchResult } from '../../domain/catalog-search.ts';
import { parseCommandBar, type ParsedCommand } from '../keyboard/parse-command-bar.ts';
import { getCatalogRepository } from './catalog.ts';

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
 * Resultados de búsqueda en vivo cuando el buffer resuelve a `search`. Llamada
 * síncrona a FlexSearch, sin debounce — a esta escala la propia consulta ya
 * cumple RNF-03.
 */
export const searchResultsSignal = computed<CatalogSearchResult[]>(() => {
  const parsed = parsedSignal.value;
  if (parsed.kind !== 'search') {
    return [];
  }
  return getCatalogRepository().search(parsed.query);
});

/**
 * Resultado de búsqueda seleccionado visualmente (↑/↓ mientras hay texto en
 * la barra). `null` = nada seleccionado (por defecto, el primer resultado).
 */
export const searchSelectionIndexSignal = signal<number | null>(null);
