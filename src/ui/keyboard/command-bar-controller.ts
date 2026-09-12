import { addFreeformLine, addProductLine, removeLine, setLineQuantity } from '../../domain/cart.ts';
import type { Product } from '../../domain/product.ts';
import type { Cart } from '../../domain/cart.ts';
import type { Result } from '../../domain/result.ts';
import { describeError } from '../errors.ts';
import { cartSelectionIndexSignal, cartSignal } from '../state/cart.ts';
import {
  commandBarBufferSignal,
  commandBarErrorSignal,
  searchResultsSignal,
  searchSelectionIndexSignal,
} from '../state/command-bar.ts';
import { getCatalogRepository } from '../state/catalog.ts';
import { activeScreenSignal } from '../state/screen.ts';
import { parseCommandBar } from './parse-command-bar.ts';

/**
 * Capa de glue con IO (resuelve productos/stock contra el catálogo, llama a
 * las funciones puras de dominio) entre el input real de la barra de
 * comandos y el estado en signals. `domain/` no sabe que esto existe.
 */

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
export function triggerCheckout(): void {
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
      triggerCheckout();
      return;
    case 'ANULAR':
      triggerVoid();
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
    case 'reserved-customer':
      commandBarErrorSignal.value = 'Identificación de cliente no disponible todavía.';
      return;
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
      void addByCode(parsed.code, parsed.qty);
      return;
    case 'search': {
      const results = searchResultsSignal.value;
      const index = searchSelectionIndexSignal.value ?? 0;
      const selected = results[index];
      if (selected === undefined) {
        commandBarErrorSignal.value = 'No hay resultados para agregar.';
        return;
      }
      void addByProduct(selected.product, parsed.qty);
    }
  }
}

/** ↑/↓ sobre el carrito (barra vacía) o sobre los resultados de búsqueda (hay texto). */
export function moveSelection(direction: 1 | -1): void {
  const isSearching = commandBarBufferSignal.value !== '';
  const items = isSearching ? searchResultsSignal.value : cartSignal.value.lines;
  const selectionSignal = isSearching ? searchSelectionIndexSignal : cartSelectionIndexSignal;

  if (items.length === 0) {
    selectionSignal.value = null;
    return;
  }
  const current = selectionSignal.value ?? (direction === 1 ? -1 : items.length);
  selectionSignal.value = Math.min(Math.max(current + direction, 0), items.length - 1);
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

/** Número + Enter con la barra vacía: reemplaza la cantidad de la línea del carrito seleccionada. */
export async function setSelectedCartLineQuantity(qty: number): Promise<void> {
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
