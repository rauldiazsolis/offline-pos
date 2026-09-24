import {
  addFreeformLine,
  addProductLine,
  adjustFreeformLineQuantity,
  discardCart,
  removeLine,
  setGlobalAdjustment,
  setLineQuantity,
} from '../../domain/cart.ts';
import type { Product } from '../../domain/product.ts';
import type { Cart } from '../../domain/cart.ts';
import type { Result } from '../../domain/result.ts';
import type { SaleLine } from '../../domain/sale.ts';
import {
  createCustomerLocally,
  loadCustomerRepository,
} from '../../storage/customer-repository.ts';
import { lineWarnings } from '../../domain/sale-warnings.ts';
import { describeError } from '../errors.ts';
import { formatQuantity } from '../format.ts';
import { formatWarning } from '../format-warning.ts';
import { cartSelectionIndexSignal, cartSignal } from '../state/cart.ts';
import {
  commandBarBufferSignal,
  commandBarErrorSignal,
  commandBarWarningSignal,
  commandResultsSignal,
  commandSelectionIndexSignal,
  effectiveCommandIndexSignal,
  customerResultsSignal,
  customerSelectionIndexSignal,
  overlayDismissedSignal,
  parsedSignal,
  searchResultsSignal,
  searchSelectionIndexSignal,
  type CustomerOrClear,
  type UnifiedSearchResult,
} from '../state/command-bar.ts';
import { getCatalogRepository } from '../state/catalog.ts';
import { attachedCustomerSignal, resetAttachedCustomer } from '../state/customer.ts';
import { setCustomerRepository } from '../state/customer-repository.ts';
import { activeScreenSignal } from '../state/screen.ts';
import { stockSnapshotSignal } from '../state/stock.ts';
import { activeConnectorTypeSignal } from '../state/sync.ts';
import { getCurrentOpenCashSession } from '../../storage/cash-session-repository.ts';
import { enterCashScreen } from './cash-session-controller.ts';
import { enterCheckout } from './checkout-controller.ts';
import { triggerCashSummary } from './cash-summary-controller.ts';
import { enterConfigScreen } from './config-controller.ts';
import { enterDiagnosticoScreen } from './diagnostico-controller.ts';
import { CONNECTOR_ACTIONS } from './connector-actions.ts';
import { commandAvailability, disabledCommandMessage } from './commands.ts';
import { parseCommandBar, roundedQuantityPrefix } from './parse-command-bar.ts';
import { connectorCommands } from '../../sync/connector-registry.ts';
import { syncNow } from '../../sync/engine.ts';

/**
 * Capa de glue con IO (resuelve productos/stock contra el catálogo, llama a
 * las funciones puras de dominio) entre el input real de la barra de
 * comandos y el estado en signals. `domain/` no sabe que esto existe.
 */

/**
 * Crear un cliente nuevo desde `@` es async (persiste en Dexie + encola
 * outbox); agregar un producto también lo era (lookup de stock) hasta #99,
 * que sacó el bloqueo por stock. Sin
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

function identityOfCustomerResult(result: CustomerOrClear): string {
  return result.kind === 'clear' ? '__clear__' : result.result.customer.id;
}

function identityOfCommandResult(command: { name: string }): string {
  return command.name;
}

/**
 * Se llama en cada tecla de la barra de comandos (issue #14) — antes, el
 * puntero de selección de ninguna de las tres listas se resetaba al
 * cambiar el buffer, así que podía quedar apuntando a una fila que ya no
 * tiene sentido para la lista filtrada nueva (una fila distinta, o
 * directamente fuera de rango).
 *
 * Las tres listas reindexan por identidad de la misma forma (issue #40,
 * Ciclo 8: el menú de comandos se unificó con el criterio de producto/línea
 * libre y cliente — ver `commandSelectionIndexSignal` en
 * `ui/state/command-bar.ts` para el porqué) — si el ítem que estaba
 * seleccionado sigue presente en la lista filtrada nueva, se lo sigue
 * apuntando aunque haya cambiado de posición; si no, vuelve a `null`.
 */
export function updateCommandBarBuffer(value: string): void {
  const previousSearchResults = searchResultsSignal.value;
  const previousSearchIndex = searchSelectionIndexSignal.value;
  const previousCustomerResults = customerResultsSignal.value;
  const previousCustomerIndex = customerSelectionIndexSignal.value;
  const previousCommandResults = commandResultsSignal.value;
  const previousCommandIndex = commandSelectionIndexSignal.value;

  commandBarBufferSignal.value = value;
  commandBarErrorSignal.value = null;
  commandBarWarningSignal.value = null;
  // Issue #28: cualquier tecla que cambie el buffer reabre el overlay que
  // corresponda al contenido nuevo, aunque se haya cerrado con Esc.
  overlayDismissedSignal.value = false;

  commandSelectionIndexSignal.value = reindexByIdentity(
    previousCommandResults,
    previousCommandIndex,
    commandResultsSignal.value,
    identityOfCommandResult,
  );
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

/** Esc con el overlay abierto (issue #28): lo cierra sin tocar el buffer. */
export function dismissCommandBarOverlay(): void {
  overlayDismissedSignal.value = true;
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

/**
 * Advertencias (#99) de la línea de producto que quedó en el carrito tras
 * agregarla o ajustarla, en el slot de la barra. Nunca bloquea nada.
 */
function warnAboutProductLine(cart: Cart, productId: string): void {
  const line = cart.lines.find(
    (candidate) => candidate.kind === 'product' && candidate.productId === productId,
  );
  if (line === undefined) {
    return;
  }
  const repo = getCatalogRepository();
  const warnings = lineWarnings(line, {
    product: repo.getProduct(productId),
    stockQuantity: stockSnapshotSignal.value.get(productId),
  });
  if (warnings.length > 0) {
    commandBarWarningSignal.value = warnings
      .map((warning) => formatWarning(warning, (id) => repo.getProduct(id)?.name ?? id))
      .join(' · ');
  }
}

function addByProduct(product: Product, qty: number): void {
  const result = addProductLine(cartSignal.value, { product, qty });
  if (applyCartResult(result)) {
    selectResultingLine(
      result.value,
      (line) => line.kind === 'product' && line.productId === product.id,
    );
    clearBuffer();
    warnAboutProductLine(result.value, product.id);
  }
}

function addByCode(code: string, qty: number): void {
  const repo = getCatalogRepository();
  const product = repo.findByBarcodeOrSku(code);
  if (product === undefined) {
    commandBarErrorSignal.value = `No se encontró ningún producto con "${code}".`;
    return;
  }
  addByProduct(product, qty);
}

/**
 * `/COBRAR`, también disparado por `Ctrl+Enter` desde cualquier estado de la
 * barra — único punto de entrada al cobro, así que es el único lugar que
 * necesita este chequeo temprano. Fase 6: sin turno de caja abierto, no se
 * puede cobrar — `closeSaleAndPersist` repite el mismo chequeo como
 * verificación de fondo (ver `storage/sale-repository.ts`), esto es solo
 * para fallar rápido sin llegar a abrir la pantalla de cobro.
 */
/**
 * Click en una fila de un overlay de la barra (Etapa 2 de #94): lo mismo que
 * llevar la selección ahí y apretar Enter — mismo camino (`submitCommandBar`,
 * con `pendingBarOperation`). Ejecuta de una. Un comando deshabilitado no hace
 * nada. En clientes, un índice igual al largo de la lista es "+ Crear cliente".
 */
export function activateCommandBarRow(
  list: 'command' | 'customer' | 'search',
  index: number,
): void {
  switch (list) {
    case 'command':
      if (commandResultsSignal.value[index]?.availability.enabled !== true) {
        return;
      }
      commandSelectionIndexSignal.value = index;
      break;
    case 'customer':
      customerSelectionIndexSignal.value = index;
      break;
    case 'search':
      searchSelectionIndexSignal.value = index;
      break;
  }
  submitCommandBar();
}

export async function triggerCheckout(): Promise<void> {
  await pendingBarOperation;
  // Etapa 2 de #94: sin nada que cobrar, el motivo en el slot de error — el
  // mismo que muestra la fila atenuada de /COBRAR en el menú de "/".
  const availability = commandAvailability('COBRAR');
  if (!availability.enabled) {
    commandBarErrorSignal.value = disabledCommandMessage('COBRAR', availability.reason);
    return;
  }
  const openSession = await getCurrentOpenCashSession();
  if (openSession === undefined) {
    commandBarErrorSignal.value = describeError({
      ok: false,
      error: 'cash-session/none-open',
      meta: undefined,
    });
    return;
  }
  enterCheckout();
  activeScreenSignal.value = 'checkout';
  clearBuffer();
}

/**
 * Enter con la barra vacía (#99): con líneas abre Cobro (aunque haya una
 * línea seleccionada — cambiar su cantidad necesita un número en la barra).
 * Sin líneas y con cliente, la cobranza sin venta llega en la Etapa 6
 * (#101); sin nada, no hace nada: Enter sobre la barra vacía es un gesto
 * reflejo y un error molestaría.
 */
export function submitEmptyCommandBar(): Promise<void> {
  if (cartSignal.value.lines.length > 0) {
    return triggerCheckout();
  }
  if (attachedCustomerSignal.value !== undefined) {
    commandBarErrorSignal.value = 'Cobranza sin venta: llega en una próxima versión.';
  }
  return Promise.resolve();
}

/** Click en una fila del carrito (#99): lo mismo que llegar con ↑/↓. */
export function selectCartLine(index: number): void {
  if (index >= 0 && index < cartSignal.value.lines.length) {
    cartSelectionIndexSignal.value = index;
  }
}

function triggerVoid(): void {
  activeScreenSignal.value = 'void';
  clearBuffer();
}

/**
 * `/DESCARTAR` (Ciclo 8): vacía la venta en curso completa (líneas, cliente
 * adjunto, ajuste global) — a propósito distinto de `/ANULAR` (ver
 * `domain/cart.ts::discardCart`). Sin confirmación (decisión explícita del
 * usuario): a diferencia de anular una venta ya cerrada, esto descarta un
 * carrito que ni siquiera se guardó — perderlo es barato de rehacer, no
 * justifica un paso extra.
 */
function triggerDiscardCart(): void {
  cartSignal.value = discardCart();
  cartSelectionIndexSignal.value = null;
  resetAttachedCustomer();
  clearBuffer();
}

function runCommand(name: string, _args: string[]): void {
  switch (name) {
    case 'COBRAR':
      void triggerCheckout();
      return;
    case 'CAJA':
      enterCashScreen();
      clearBuffer();
      return;
    case 'RESUMEN':
      void triggerCashSummary();
      clearBuffer();
      return;
    case 'ANULAR':
      triggerVoid();
      return;
    case 'DESCARTAR':
      triggerDiscardCart();
      return;
    case 'CONFIG':
      enterConfigScreen();
      clearBuffer();
      return;
    case 'SINCRONIZAR':
      // A pedido: fuerza el push del lote pendiente ya (ignora backoff) y un pull completo ya (#87).
      void syncNow();
      clearBuffer();
      return;
    case 'DIAGNOSTICO':
      enterDiagnosticoScreen();
      clearBuffer();
      return;
    default: {
      // Comandos que declara el conector activo (Etapa 2c, #77).
      const declared = connectorCommands(activeConnectorTypeSignal.value).find(
        (command) => command.name === name,
      );
      if (declared === undefined) {
        commandBarErrorSignal.value = `Comando desconocido: /${name}`;
        return;
      }
      CONNECTOR_ACTIONS[declared.action]();
      clearBuffer();
    }
  }
}

/** Se llama al presionar Enter con la barra de comandos activa (no en modo navegación del carrito). */
export function submitCommandBar(): void {
  // Más de 3 decimales en el prefijo se redondea (#99): se avisa si la acción salió bien.
  const rounded = roundedQuantityPrefix(commandBarBufferSignal.value);
  doSubmitCommandBar();
  if (
    rounded !== undefined &&
    commandBarBufferSignal.value === '' &&
    commandBarErrorSignal.value === null
  ) {
    prependCommandBarWarning(roundedQuantityWarning(rounded));
  }
}

function doSubmitCommandBar(): void {
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
      if (selected?.kind === 'clear') {
        resetAttachedCustomer();
        clearBuffer();
        return;
      }
      if (selected?.kind === 'customer') {
        attachedCustomerSignal.value = selected.result.customer;
        clearBuffer();
        return;
      }
      // selected === undefined: sin match. Con query vacía siempre hay al
      // menos la fila "Consumidor Final" (ver customerResultsSignal), así
      // que esto solo pasa con una query puntual sin resultados — crear un
      // cliente nuevo (RF-16).
      trackPendingBarOperation(createAndAttachCustomer(parsed.query.trim()));
      return;
    }
    case 'command': {
      // Issue #3, unificado con search/customer en el issue #40 (Ciclo 8):
      // Enter sin tocar ↑/↓ ejecuta la fila preseleccionada — que desde la
      // Etapa 2 de #94 existe solo si la fila 0 está habilitada (ver
      // `defaultCommandIndexSignal` en `ui/state/command-bar.ts`).
      const results = commandResultsSignal.value;
      const index = effectiveCommandIndexSignal.value;
      const selected = index === null ? undefined : results[index];
      if (selected === undefined) {
        const exact = results.find((command) => command.name === parsed.name);
        if (exact !== undefined && !exact.availability.enabled) {
          commandBarErrorSignal.value = disabledCommandMessage(
            exact.name,
            exact.availability.reason,
          );
          return;
        }
        if (results.length === 0) {
          commandBarErrorSignal.value = `Comando desconocido: /${parsed.name}`;
        }
        return;
      }
      if (!selected.availability.enabled) {
        commandBarErrorSignal.value = disabledCommandMessage(
          selected.name,
          selected.availability.reason,
        );
        return;
      }
      runCommand(selected.name, parsed.args);
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
    case 'barcode': {
      // Una fila de la lista de códigos elegida a mano (↓ o click) gana; si
      // no, el código exacto — un lector que escanea un código inexistente
      // nunca agrega una coincidencia parcial por accidente (#99).
      const index = searchSelectionIndexSignal.value;
      const selected = index !== null ? searchResultsSignal.value[index] : undefined;
      if (selected?.kind === 'product') {
        addByProduct(selected.result.product, parsed.qty);
        return;
      }
      addByCode(parsed.code, parsed.qty);
      return;
    }
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
      addByProduct(selected.result.product, parsed.qty);
    }
  }
}

/**
 * `assumeFirstSelected`: cuando la UI ya resalta la fila 0 por default antes
 * de cualquier navegación (productos, clientes, y desde el issue #40
 * también comandos — issue #4), el punto de partida real tiene que ser `0`,
 * no `-1`/`itemCount`, o el primer ↓ "no se nota" (mueve el signal de
 * `null` a `0`, que ya se veía seleccionado). Solo el carrito NO lo usa —
 * ahí nada se resalta hasta que se navega explícitamente, así que el
 * criterio actual (entrar por arriba o por abajo según la dirección) sigue
 * siendo el correcto para esa lista.
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
/**
 * ↑/↓ en el menú de "/" (Etapa 2 de #94): saltea los comandos deshabilitados;
 * sin otro habilitado en esa dirección, no se mueve. Parte de la fila que
 * Enter ejecutaría (la preselección cuenta como elegida, como
 * `assumeFirstSelected` en las otras listas).
 */
function moveCommandSelection(direction: 1 | -1): void {
  const results = commandResultsSignal.value;
  const start = effectiveCommandIndexSignal.value ?? (direction === 1 ? -1 : results.length);
  for (let i = start + direction; i >= 0 && i < results.length; i += direction) {
    if (results[i]?.availability.enabled === true) {
      commandSelectionIndexSignal.value = i;
      return;
    }
  }
}

export function moveSelection(direction: 1 | -1): void {
  const parsed = parsedSignal.value;

  if (parsed.kind === 'customer') {
    moveSelectionOver(customerResultsSignal.value.length, customerSelectionIndexSignal, direction, {
      assumeFirstSelected: true,
    });
    return;
  }
  if (parsed.kind === 'command') {
    moveCommandSelection(direction);
    return;
  }

  const isSearching = commandBarBufferSignal.value !== '';
  if (isSearching) {
    // La lista de códigos (#99) no preselecciona la fila 0: Enter sin elegir es el código exacto.
    moveSelectionOver(searchResultsSignal.value.length, searchSelectionIndexSignal, direction, {
      assumeFirstSelected: parsed.kind !== 'code-search',
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

/** Suma una advertencia al slot de la barra (#99), delante de las que ya haya. */
function prependCommandBarWarning(text: string): void {
  const current = commandBarWarningSignal.value;
  commandBarWarningSignal.value = current === null ? text : `${text} · ${current}`;
}

function roundedQuantityWarning(qty: number): string {
  return `Cantidad redondeada a ${formatQuantity(qty)}`;
}

function doSetSelectedCartLineQuantity(qty: number): void {
  const index = cartSelectionIndexSignal.value;
  if (index === null) {
    return;
  }
  const line = cartSignal.value.lines[index];
  const result = setLineQuantity(cartSignal.value, index, qty);
  if (applyCartResult(result)) {
    if (line?.kind === 'product') {
      warnAboutProductLine(result.value, line.productId);
    }
    // Con 0 la línea se borra (#99): misma selección resultante que Supr.
    const newLength = result.value.lines.length;
    cartSelectionIndexSignal.value = newLength === 0 ? null : Math.min(index, newLength - 1);
  }
}

/** Número + Enter con la barra vacía: reemplaza la cantidad de la línea del carrito seleccionada. */
export function setSelectedCartLineQuantity(
  qty: number,
  options: { rounded?: boolean } = {},
): Promise<void> {
  doSetSelectedCartLineQuantity(qty);
  if (options.rounded === true && commandBarErrorSignal.value === null) {
    prependCommandBarWarning(roundedQuantityWarning(qty));
  }
  return Promise.resolve();
}
