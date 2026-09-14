import {
  addFreeformLine,
  addProductLine,
  adjustFreeformLineQuantity,
  removeLine,
  setGlobalAdjustment,
  setLineQuantity,
} from '../../domain/cart.ts';
import type { Product } from '../../domain/product.ts';
import type { Cart } from '../../domain/cart.ts';
import type { Result } from '../../domain/result.ts';
import type { SaleLine } from '../../domain/sale.ts';
import type { CustomerSearchResult } from '../../domain/customer-search.ts';
import { createCustomerLocally, loadCustomerRepository } from '../../storage/customer-repository.ts';
import { describeError } from '../errors.ts';
import { cartSelectionIndexSignal, cartSignal } from '../state/cart.ts';
import {
  commandBarBufferSignal,
  commandBarErrorSignal,
  commandResultsSignal,
  commandSelectionIndexSignal,
  customerResultsSignal,
  customerSelectionIndexSignal,
  parsedSignal,
  searchResultsSignal,
  searchSelectionIndexSignal,
  type UnifiedSearchResult,
} from '../state/command-bar.ts';
import { getCatalogRepository } from '../state/catalog.ts';
import { attachedCustomerSignal, resetAttachedCustomer } from '../state/customer.ts';
import { setCustomerRepository } from '../state/customer-repository.ts';
import { activeScreenSignal } from '../state/screen.ts';
import { enterConfigScreen } from './config-controller.ts';
import { parseCommandBar } from './parse-command-bar.ts';
import { runSyncCycle } from '../../sync/engine.ts';

/**
 * Capa de glue con IO (resuelve productos/stock contra el catálogo, llama a
 * las funciones puras de dominio) entre el input real de la barra de
 * comandos y el estado en signals. `domain/` no sabe que esto existe.
 */

/**
 * Agregar un producto es async (lookup de stock vía Dexie), y crear un
 * cliente nuevo desde `@` también (persiste en Dexie + encola outbox). Sin
 * este rastreo, `Ctrl+Enter`/`/COBRAR` disparado inmediatamente después
 * podría cambiar de pantalla antes de que la operación termine — una
 * carrera real, no solo teórica (la agarró el test e2e de cobro en Fase 1).
 * `triggerCheckout` espera esto antes de cambiar de pantalla.
 */
let pendingBarOperation: Promise<void> = Promise.resolve();

function trackPendingBarOperation(promise: Promise<void>): void {
  pendingBarOperation = promise;
}

// Type predicate (no solo `boolean`): varios callers necesitan `result.value`
// después de confirmar éxito (ej. para saber en qué índice quedó la línea
// recién agregada/ajustada, issue #15) — sin esto, TS no puede enterarse de
// que `result.ok` ya se confirmó adentro de esta función.
function applyCartResult(result: Result<Cart>): result is { ok: true; value: Cart } {
  if (result.ok) {
    cartSignal.value = result.value;
    commandBarErrorSignal.value = null;
    return true;
  }
  commandBarErrorSignal.value = describeError(result);
  return false;
}

/**
 * Deja seleccionada (y, gracias a `useScrollSelectedIntoView`, visible) la
 * línea resultante de una mutación — issue #15. Si `find` no encuentra
 * ninguna, no deja nada seleccionado: pasa cuando la operación restó hasta
 * borrar la línea, a propósito distinto del borrado explícito con Supr
 * (`removeSelectedCartLine`), que sí selecciona la siguiente o la anterior.
 */
function selectResultingLine(cart: Cart, find: (line: SaleLine) => boolean): void {
  const index = cart.lines.findIndex(find);
  cartSelectionIndexSignal.value = index === -1 ? null : index;
}

function clearBuffer(): void {
  commandBarBufferSignal.value = '';
  searchSelectionIndexSignal.value = null;
  customerSelectionIndexSignal.value = null;
  commandSelectionIndexSignal.value = null;
}

/**
 * Si el ítem que estaba en `previousIndex` sigue presente en `newItems`
 * (comparado por `identity`, no por índice — la posición puede cambiar
 * entre una lista filtrada y la siguiente), devuelve su índice nuevo; si
 * no, `null`. `previousIndex === null` (nada seleccionado todavía) es
 * siempre `null` sin buscar nada.
 */
function reindexByIdentity<T>(
  previousItems: T[],
  previousIndex: number | null,
  newItems: T[],
  identity: (item: T) => string,
): number | null {
  if (previousIndex === null) {
    return null;
  }
  const previous = previousItems[previousIndex];
  if (previous === undefined) {
    return null;
  }
  const target = identity(previous);
  const newIndex = newItems.findIndex((item) => identity(item) === target);
  return newIndex === -1 ? null : newIndex;
}

function identityOfSearchResult(result: UnifiedSearchResult): string {
  return result.kind === 'product'
    ? `product:${result.result.product.id}`
    : `freeform:${result.description}`;
}

function identityOfCustomerResult(result: CustomerSearchResult): string {
  return result.customer.id;
}

/**
 * Se llama en cada tecla de la barra de comandos (issue #14) — antes, el
 * puntero de selección de ninguna de las tres listas se resetaba al
 * cambiar el buffer, así que podía quedar apuntando a una fila que ya no
 * tiene sentido para la lista filtrada nueva (una fila distinta, o
 * directamente fuera de rango).
 *
 * Menú de comandos: reset simple a `null`, siempre — confirmado con el
 * usuario, ejecutar el comando equivocado por accidente tiene consecuencias
 * reales, así que no vale la pena ser "más inteligente" acá. Búsqueda de
 * producto/línea libre y de cliente: "más inteligente" — si el ítem que
 * estaba seleccionado sigue presente en la lista nueva (por identidad), se
 * lo sigue apuntando aunque haya cambiado de posición.
 */
export function updateCommandBarBuffer(value: string): void {
  const previousSearchResults = searchResultsSignal.value;
  const previousSearchIndex = searchSelectionIndexSignal.value;
  const previousCustomerResults = customerResultsSignal.value;
  const previousCustomerIndex = customerSelectionIndexSignal.value;

  commandBarBufferSignal.value = value;
  commandBarErrorSignal.value = null;

  commandSelectionIndexSignal.value = null;
  searchSelectionIndexSignal.value = reindexByIdentity(
    previousSearchResults,
    previousSearchIndex,
    searchResultsSignal.value,
    identityOfSearchResult,
  );
  customerSelectionIndexSignal.value = reindexByIdentity(
    previousCustomerResults,
    previousCustomerIndex,
    customerResultsSignal.value,
    identityOfCustomerResult,
  );
}

/** Alta local de un cliente nuevo desde `@<nombre>` sin match existente (RF-16). */
async function createAndAttachCustomer(name: string): Promise<void> {
  const result = await createCustomerLocally(name);
  if (!result.ok) {
    commandBarErrorSignal.value = describeError(result);
    return;
  }
  setCustomerRepository(await loadCustomerRepository());
  attachedCustomerSignal.value = result.value;
  clearBuffer();
}

async function addByProduct(product: Product, qty: number): Promise<void> {
  const repo = getCatalogRepository();
  const stock = await repo.getStock(product.id);
  const result = addProductLine(cartSignal.value, { product, stock, qty });
  if (applyCartResult(result)) {
    selectResultingLine(result.value, (line) => line.kind === 'product' && line.productId === product.id);
    clearBuffer();
  }
}

async function addByCode(code: string, qty: number): Promise<void> {
  const repo = getCatalogRepository();
  const product = repo.findByBarcodeOrSku(code);
  if (product === undefined) {
    commandBarErrorSignal.value = `No se encontró ningún producto con "${code}".`;
    return;
  }
  await addByProduct(product, qty);
}

/** `/COBRAR`, también disparado por `Ctrl+Enter` desde cualquier estado de la barra. */
export async function triggerCheckout(): Promise<void> {
  await pendingBarOperation;
  activeScreenSignal.value = 'checkout';
  clearBuffer();
}

function triggerVoid(): void {
  activeScreenSignal.value = 'void';
  clearBuffer();
}

function runCommand(name: string, _args: string[]): void {
  switch (name) {
    case 'COBRAR':
      void triggerCheckout();
      return;
    case 'ANULAR':
      triggerVoid();
      return;
    case 'CONFIG':
      enterConfigScreen();
      clearBuffer();
      return;
    case 'SINCRONIZAR':
      void runSyncCycle();
      clearBuffer();
      return;
    default:
      commandBarErrorSignal.value = `Comando desconocido: /${name}`;
  }
}

/** Se llama al presionar Enter con la barra de comandos activa (no en modo navegación del carrito). */
export function submitCommandBar(): void {
  const parsed = parseCommandBar(commandBarBufferSignal.value, { finalizing: true });

  switch (parsed.kind) {
    case 'typing':
    case 'pending-numeric':
      return;
    case 'parse-error':
      commandBarErrorSignal.value = parsed.message;
      return;
    case 'customer': {
      const results = customerResultsSignal.value;
      const index = customerSelectionIndexSignal.value ?? 0;
      const selected = results[index];
      if (selected !== undefined) {
        attachedCustomerSignal.value = selected.customer;
        clearBuffer();
        return;
      }
      if (parsed.query.trim() === '') {
        resetAttachedCustomer();
        clearBuffer();
        return;
      }
      trackPendingBarOperation(createAndAttachCustomer(parsed.query.trim()));
      return;
    }
    case 'command': {
      // Issue #3: filtrado por prefijo (commandResultsSignal) + navegación
      // explícita — a diferencia de search/customer, acá Enter sin haber
      // tocado ↑/↓ solo ejecuta si el filtro deja un único comando posible
      // (sin ambigüedad); con 2+ y sin selección explícita, no hace nada.
      const results = commandResultsSignal.value;
      const index = commandSelectionIndexSignal.value;
      if (index !== null) {
        const selected = results[index];
        if (selected !== undefined) {
          runCommand(selected.name, parsed.args);
        }
        return;
      }
      if (results.length === 1) {
        runCommand(results[0]?.name ?? '', parsed.args);
        return;
      }
      if (results.length === 0) {
        commandBarErrorSignal.value = `Comando desconocido: /${parsed.name}`;
      }
      return;
    }
    case 'global-adjustment':
      if (applyCartResult(setGlobalAdjustment(cartSignal.value, parsed.percentage))) {
        clearBuffer();
      }
      return;
    case 'freeform-line': {
      const result = addFreeformLine(cartSignal.value, {
        description: parsed.description,
        unitPrice: parsed.amount,
        qty: parsed.qty,
      });
      if (applyCartResult(result)) {
        // Siempre al final (addFreeformLine nunca fusiona) — no se usa
        // selectResultingLine por `find`: dos líneas libres pueden compartir
        // la misma descripción, y encontraría la primera, no la recién
        // creada.
        cartSelectionIndexSignal.value = result.value.lines.length - 1;
        clearBuffer();
      }
      return;
    }
    case 'barcode':
      trackPendingBarOperation(addByCode(parsed.code, parsed.qty));
      return;
    case 'search': {
      const results = searchResultsSignal.value;
      const index = searchSelectionIndexSignal.value ?? 0;
      const selected = results[index];
      if (selected === undefined) {
        commandBarErrorSignal.value = 'No hay resultados para agregar.';
        return;
      }
      if (selected.kind === 'freeform-line') {
        const result = adjustFreeformLineQuantity(cartSignal.value, {
          description: selected.description,
          qty: parsed.qty,
        });
        if (applyCartResult(result)) {
          selectResultingLine(
            result.value,
            (line) => line.kind === 'freeform' && line.description === selected.description,
          );
          clearBuffer();
        }
        return;
      }
      trackPendingBarOperation(addByProduct(selected.result.product, parsed.qty));
    }
  }
}

/**
 * `assumeFirstSelected`: cuando la UI ya resalta la fila 0 por default antes
 * de cualquier navegación (productos, clientes — issue #4), el punto de
 * partida real tiene que ser `0`, no `-1`/`itemCount`, o el primer ↓ "no se
 * nota" (mueve el signal de `null` a `0`, que ya se veía seleccionado). El
 * carrito y el menú de comandos NO lo usan — ahí nada se resalta hasta que
 * se navega explícitamente, así que el criterio actual (entrar por arriba o
 * por abajo según la dirección) sigue siendo el correcto.
 */
function moveSelectionOver(
  itemCount: number,
  selectionSignal: { value: number | null },
  direction: 1 | -1,
  options: { assumeFirstSelected?: boolean } = {},
): void {
  if (itemCount === 0) {
    selectionSignal.value = null;
    return;
  }
  const current =
    selectionSignal.value ?? (options.assumeFirstSelected ? 0 : direction === 1 ? -1 : itemCount);
  selectionSignal.value = Math.min(Math.max(current + direction, 0), itemCount - 1);
}

/**
 * ↑/↓: sobre el carrito (barra vacía), sobre resultados de producto o de
 * cliente (`@<query>`), o sobre el menú de comandos filtrado (`/<prefijo>`).
 */
export function moveSelection(direction: 1 | -1): void {
  const parsed = parsedSignal.value;

  if (parsed.kind === 'customer') {
    moveSelectionOver(customerResultsSignal.value.length, customerSelectionIndexSignal, direction, {
      assumeFirstSelected: true,
    });
    return;
  }
  if (parsed.kind === 'command') {
    moveSelectionOver(commandResultsSignal.value.length, commandSelectionIndexSignal, direction);
    return;
  }

  const isSearching = commandBarBufferSignal.value !== '';
  if (isSearching) {
    moveSelectionOver(searchResultsSignal.value.length, searchSelectionIndexSignal, direction, {
      assumeFirstSelected: true,
    });
    return;
  }
  moveSelectionOver(cartSignal.value.lines.length, cartSelectionIndexSignal, direction);
}

/** Tecla Supr con la barra vacía: elimina la línea del carrito seleccionada. */
/**
 * Tecla Supr con la barra vacía: elimina la línea seleccionada. A propósito
 * distinto de cuando una línea se borra como efecto de restar hasta 0 (ver
 * `selectResultingLine`) — un borrado explícito selecciona la línea que
 * quedó en ese mismo índice (la que se corrió al borrar), o la anterior si
 * se borró la última, o nada si el carrito quedó vacío (issue #15).
 */
export function removeSelectedCartLine(): void {
  const index = cartSelectionIndexSignal.value;
  if (index === null) {
    return;
  }
  const result = removeLine(cartSignal.value, index);
  if (applyCartResult(result)) {
    const newLength = result.value.lines.length;
    cartSelectionIndexSignal.value = newLength === 0 ? null : Math.min(index, newLength - 1);
  }
}

async function doSetSelectedCartLineQuantity(qty: number): Promise<void> {
  const index = cartSelectionIndexSignal.value;
  if (index === null) {
    return;
  }
  const line = cartSignal.value.lines[index];
  if (line === undefined) {
    return;
  }

  if (line.kind === 'product') {
    const repo = getCatalogRepository();
    const product = repo.getProduct(line.productId);
    const stock = await repo.getStock(line.productId);
    applyCartResult(
      setLineQuantity(cartSignal.value, index, qty, {
        ...(product !== undefined ? { product } : {}),
        ...(stock !== undefined ? { stock } : {}),
      }),
    );
    return;
  }

  applyCartResult(setLineQuantity(cartSignal.value, index, qty));
}

/** Número + Enter con la barra vacía: reemplaza la cantidad de la línea del carrito seleccionada. */
export function setSelectedCartLineQuantity(qty: number): Promise<void> {
  const promise = doSetSelectedCartLineQuantity(qty);
  trackPendingBarOperation(promise);
  return promise;
}
