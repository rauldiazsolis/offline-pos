import { addFreeformLine, addProductLine, removeLine, setLineQuantity } from '../../domain/cart.ts';
import type { Product } from '../../domain/product.ts';
import type { Cart } from '../../domain/cart.ts';
import type { Result } from '../../domain/result.ts';
import { createCustomerLocally, loadCustomerRepository } from '../../storage/customer-repository.ts';
import { describeError } from '../errors.ts';
import { cartSelectionIndexSignal, cartSignal } from '../state/cart.ts';
import {
  commandBarBufferSignal,
  commandBarErrorSignal,
  customerResultsSignal,
  customerSelectionIndexSignal,
  parsedSignal,
  searchResultsSignal,
  searchSelectionIndexSignal,
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

function applyCartResult(result: Result<Cart>): boolean {
  if (result.ok) {
    cartSignal.value = result.value;
    commandBarErrorSignal.value = null;
    return true;
  }
  commandBarErrorSignal.value = describeError(result);
  return false;
}

function clearBuffer(): void {
  commandBarBufferSignal.value = '';
  searchSelectionIndexSignal.value = null;
  customerSelectionIndexSignal.value = null;
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
  if (applyCartResult(addProductLine(cartSignal.value, { product, stock, qty }))) {
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
    case '':
      // Solo "/": la lista de comandos disponibles la muestra el componente
      // leyendo parsedSignal directamente — acá no hay nada que ejecutar.
      return;
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
    case 'command':
      runCommand(parsed.name, parsed.args);
      return;
    case 'freeform-line':
      if (
        applyCartResult(
          addFreeformLine(cartSignal.value, {
            description: parsed.description,
            unitPrice: parsed.amount,
          }),
        )
      ) {
        clearBuffer();
      }
      return;
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
      trackPendingBarOperation(addByProduct(selected.product, parsed.qty));
    }
  }
}

function moveSelectionOver(
  itemCount: number,
  selectionSignal: { value: number | null },
  direction: 1 | -1,
): void {
  if (itemCount === 0) {
    selectionSignal.value = null;
    return;
  }
  const current = selectionSignal.value ?? (direction === 1 ? -1 : itemCount);
  selectionSignal.value = Math.min(Math.max(current + direction, 0), itemCount - 1);
}

/**
 * ↑/↓: sobre el carrito (barra vacía), sobre resultados de producto (hay
 * texto de búsqueda) o sobre resultados de cliente (`@<query>`).
 */
export function moveSelection(direction: 1 | -1): void {
  if (parsedSignal.value.kind === 'customer') {
    moveSelectionOver(customerResultsSignal.value.length, customerSelectionIndexSignal, direction);
    return;
  }

  const isSearching = commandBarBufferSignal.value !== '';
  const itemCount = isSearching ? searchResultsSignal.value.length : cartSignal.value.lines.length;
  const selectionSignal = isSearching ? searchSelectionIndexSignal : cartSelectionIndexSignal;
  moveSelectionOver(itemCount, selectionSignal, direction);
}

/** Tecla Supr con la barra vacía: elimina la línea del carrito seleccionada. */
export function removeSelectedCartLine(): void {
  const index = cartSelectionIndexSignal.value;
  if (index === null) {
    return;
  }
  if (applyCartResult(removeLine(cartSignal.value, index))) {
    cartSelectionIndexSignal.value = null;
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
