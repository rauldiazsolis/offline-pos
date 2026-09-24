import type { TargetedEvent, TargetedKeyboardEvent } from 'preact';
import { useRef } from 'preact/hooks';
import {
  activateCommandBarRow,
  dismissCommandBarOverlay,
  moveSelection,
  removeSelectedCartLine,
  setSelectedCartLineQuantity,
  submitCommandBar,
  submitEmptyCommandBar,
  triggerCheckout,
  updateCommandBarBuffer,
} from '../keyboard/command-bar-controller.ts';
import { useFocusOnMount } from '../hooks/use-focus-on-mount.ts';
import { keepFocusOnMouseDown } from '../hooks/use-mouse-keeps-focus.ts';
import { useScrollIndicator } from '../hooks/use-scroll-indicator.ts';
import { useScrollSelectedIntoView } from '../hooks/use-scroll-selected-into-view.ts';
import { useSelectOnErrorSignal } from '../hooks/use-select-on-error.ts';
import { formatDate, formatMoney, formatQuantity } from '../format.ts';
import { parseQuantityText } from '../keyboard/parse-command-bar.ts';
import { cartSelectionIndexSignal, cartSignal } from '../state/cart.ts';
import { stockSnapshotSignal } from '../state/stock.ts';
import { ScrollIndicatorBar } from './ScrollIndicatorBar.tsx';
import {
  commandBarBufferSignal,
  commandBarErrorSignal,
  commandBarWarningSignal,
  commandResultsSignal,
  commandSelectionIndexSignal,
  customerResultsSignal,
  customerSelectionIndexSignal,
  effectiveCommandIndexSignal,
  overlayDismissedSignal,
  parsedSignal,
  searchResultsSignal,
  searchSelectionIndexSignal,
} from '../state/command-bar.ts';

/**
 * El único input siempre enfocado durante la operación normal (ver
 * "UX keyboard-first" en CLAUDE.md). Solo maneja el `<input>` real — la
 * lógica de qué hacer con cada tecla vive en `command-bar-controller.ts`.
 */
export function CommandBarInput() {
  // useFocusOnMount, no el atributo HTML `autoFocus` — al volver de un popup
  // (Esc desde cobro/anulación/config/comprobante), `App` desmonta y vuelve a
  // montar esta pantalla, y `autoFocus` no dispara el foco de forma
  // confiable en una inserción dinámica (a diferencia de la carga inicial de
  // la página). Este era justo el bug real: el foco se perdía al volver de
  // cualquier popup con Esc.
  const inputRef = useFocusOnMount<HTMLInputElement>();

  // Al fallar el parseo/comando, se selecciona todo el input (.select() nativo)
  // — vale tanto para errores síncronos como para los que llegan después de
  // resolver una búsqueda async de producto/stock.
  useSelectOnErrorSignal(inputRef, commandBarErrorSignal);

  // Issue #27: cada overlay (comandos, clientes, artículos) es una lista
  // independiente — mismo hook que ya usa el carrito (#26), tres instancias
  // porque cada una necesita su propio Map de refs.
  const commandRowRef = useScrollSelectedIntoView(commandSelectionIndexSignal);
  const customerRowRef = useScrollSelectedIntoView(customerSelectionIndexSignal);
  const searchRowRef = useScrollSelectedIntoView(searchSelectionIndexSignal);

  // Indicador de scroll pasivo del overlay — el mismo, cualquiera sea la
  // lista que esté mostrando (nunca hay más de una a la vez).
  const overlayScrollRef = useRef<HTMLDivElement>(null);
  const overlayScrollThumb = useScrollIndicator(overlayScrollRef);

  const searchResults = searchResultsSignal.value;
  // La lista de códigos (#99) no preselecciona: sin elegir, Enter es el código exacto.
  const selectedSearchIndex =
    parsedSignal.value.kind === 'code-search'
      ? searchSelectionIndexSignal.value
      : (searchSelectionIndexSignal.value ?? 0);
  const customerResults = customerResultsSignal.value;
  const selectedCustomerIndex = customerSelectionIndexSignal.value ?? 0;
  const parsed = parsedSignal.value;
  const commandResults = commandResultsSignal.value;
  // issue #40 (Ciclo 8): la fila 0 se preselecciona por default, igual que
  // producto/cliente — desde la Etapa 2 de #94, solo si está habilitada.
  const selectedCommandIndex = effectiveCommandIndexSignal.value;
  const showCommandList = parsed.kind === 'command';
  // Issue #21: la lista se muestra apenas se abre "@", sin esperar texto —
  // con query vacía son los clientes más recientes (customerResultsSignal).
  const showCustomerResults = parsed.kind === 'customer';

  const hasError = commandBarErrorSignal.value !== null;
  // #99: una advertencia usa el mismo slot; el error tiene precedencia.
  const hasWarning = !hasError && commandBarWarningSignal.value !== null;
  const hasCommandResults = showCommandList && commandResults.length > 0;
  // Con query hay algo para mostrar siempre (la lista, o "+ Crear cliente");
  // con query vacía, solo si hay clientes recientes — si no, no hay nada que
  // este overlay deba ocupar en pantalla.
  const hasCustomerResults =
    showCustomerResults && (parsed.query !== '' || customerResults.length > 0);
  const hasSearchResults = !showCommandList && !showCustomerResults && searchResults.length > 0;
  // Issue #28: Esc cierra el overlay sin tocar el buffer — como su
  // visibilidad se deriva puramente del buffer parseado, hace falta este
  // flag aparte (`overlayDismissedSignal`) para poder "ocultarlo" sin
  // vaciar ni cambiar lo que se tipeó. Se resetea en cada tecla
  // (`updateCommandBarBuffer`), así que seguir tipeando reabre el overlay
  // que corresponda a lo nuevo.
  const showOverlay =
    !overlayDismissedSignal.value &&
    (hasError || hasWarning || hasCommandResults || hasCustomerResults || hasSearchResults);

  // updateCommandBarBuffer (no tocar los signals directo): además de
  // actualizar el buffer, resetea/reindexa la selección de las tres listas
  // — issue #14.
  const handleInput = (event: TargetedEvent<HTMLInputElement>) => {
    updateCommandBarBuffer(event.currentTarget.value);
  };

  const handleKeyDown = (event: TargetedKeyboardEvent<HTMLInputElement>) => {
    if (event.ctrlKey && event.key === 'Enter') {
      event.preventDefault();
      void triggerCheckout();
      return;
    }

    // Issue #28: solo actúa si hay algo para cerrar — con el overlay ya
    // oculto, Esc no hace nada acá (no es "vaciar el buffer", eso es otro
    // alcance).
    if (event.key === 'Escape') {
      if (showOverlay) {
        event.preventDefault();
        dismissCommandBarOverlay();
      }
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveSelection(-1);
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveSelection(1);
      return;
    }

    const bufferEmpty = commandBarBufferSignal.value === '';

    if (bufferEmpty && event.key === 'Delete') {
      event.preventDefault();
      removeSelectedCartLine();
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      const buffer = commandBarBufferSignal.value;

      // Barra vacía (#99): Enter abre Cobro si hay algo que cobrar, igual
      // que Ctrl+Enter — va antes que la línea seleccionada, que necesita un
      // número para cambiar su cantidad.
      if (buffer === '') {
        void submitEmptyCommandBar();
        return;
      }

      // Con una línea del carrito seleccionada (↑/↓ previo), una cantidad +
      // Enter reemplaza la de la línea en vez de buscarse como código de
      // barras — con signo y hasta 3 decimales desde #99 (`-2`, `1,5`).
      // Una fila de la lista de códigos elegida a mano gana sobre "cantidad de la línea".
      const pickingCode =
        parsedSignal.value.kind === 'code-search' && searchSelectionIndexSignal.value !== null;
      if (cartSelectionIndexSignal.value !== null && !pickingCode) {
        const parsedQty = parseQuantityText(buffer);
        if (parsedQty.ok) {
          void setSelectedCartLineQuantity(parsedQty.qty, { rounded: parsedQty.rounded });
          commandBarBufferSignal.value = '';
          return;
        }
      }

      submitCommandBar();
    }
  };

  const rowStyle = (selected: boolean): { [key: string]: string } => ({
    padding: 'var(--space-2)',
    borderRadius: 'var(--radius-md)',
    background: selected ? 'var(--color-accent)' : 'transparent',
    color: selected ? '#ffffff' : 'var(--color-chrome-text)',
    // Mismo diagnóstico que el header sticky del carrito: scrollIntoView
    // no sabe que el padding del overlay reserva espacio arriba/abajo del
    // primer/último ítem — sin esto, volver al principio de la lista con
    // flechas lo deja pegado contra el borde redondeado, sin el margen que
    // se ve al abrir el overlay por primera vez. Un solo scroll-margin
    // (los 4 lados) en las tres listas, vía este mismo helper compartido.
    scrollMargin: 'var(--space-2)',
  });

  // Subtexto (SKU/precio de producto, cantidad×monto de una línea libre ya
  // en el carrito, documento/teléfono de cliente) — mismo patrón que
  // `lineCode` en CartView, adaptado a legible sobre el fondo sólido cuando
  // la fila está seleccionada.
  const warningTextStyle = {
    fontSize: 'var(--font-size-sm)',
    color: 'var(--color-chrome-warning)',
  };

  const subtextStyle = (selected: boolean): { [key: string]: string } => ({
    fontSize: 'var(--font-size-sm)',
    color: selected ? 'rgba(255, 255, 255, 0.85)' : 'var(--color-chrome-text-muted)',
  });

  // Issue #29: dentro del subtexto de precio, la parte relevante según haya
  // o no un prefijo de cantidad se resalta con contraste completo — el
  // resto del subtexto ya viene atenuado por `subtextStyle`.
  const emphasisStyle = (selected: boolean): { [key: string]: string } => ({
    color: selected ? '#ffffff' : 'var(--color-chrome-text)',
    fontWeight: 'bold',
  });

  return (
    // position: relative — ancla del overlay de abajo, que se abre hacia
    // arriba desde acá (issue #9: antes empujaba el carrito al crecer, sin
    // techo de altura; ahora flota, no participa del flujo del documento).
    <div style={{ position: 'relative' }}>
      <input
        ref={inputRef}
        type="text"
        value={commandBarBufferSignal.value}
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        aria-label="Barra de comandos"
        placeholder="Escribí para buscar · @ cliente · / comandos"
        class="command-bar-input"
        style={{
          width: '100%',
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--font-size-lg)',
          padding: 'var(--space-2) 0',
          border: 'none',
          borderBottom: '2px solid transparent',
          background: 'transparent',
          color: 'var(--color-chrome-text)',
        }}
      />
      {showOverlay && (
        // El indicador de scroll pasivo tiene que quedar fuera del
        // elemento que scrollea (el div de abajo, con la clase
        // "command-bar-overlay-scroll") — si no, scrollearía con el
        // contenido en vez de quedar fijo en el borde. display: flex +
        // flex: 1 en el que scrollea, para que "maxHeight" siga
        // clampeando el conjunto igual que antes.
        // Teclado + mouse (Etapa 2 de #94): click en una fila = Enter sobre
        // ella; el `mousedown` se cancela para que la barra no pierda el foco.
        <div
          data-command-bar-overlay=""
          onMouseDown={keepFocusOnMouseDown}
          style={{
            position: 'absolute',
            bottom: '100%',
            left: 0,
            right: 0,
            marginBottom: 'var(--space-2)',
            maxHeight: '40vh',
            display: 'flex',
            flexDirection: 'column',
            background: 'var(--color-chrome-bg)',
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-card)',
            zIndex: 10,
          }}
        >
          <div
            ref={overlayScrollRef}
            class="command-bar-overlay-scroll"
            style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 'var(--space-2)' }}
          >
            {hasError ? (
              <p role="alert" style={{ margin: 0, padding: 'var(--space-2)', color: '#f87171' }}>
                {commandBarErrorSignal.value}
              </p>
            ) : hasWarning ? (
              <p
                role="status"
                style={{
                  margin: 0,
                  padding: 'var(--space-2)',
                  color: 'var(--color-chrome-warning)',
                }}
              >
                ⚠ {commandBarWarningSignal.value}
              </p>
            ) : hasCommandResults ? (
              <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                {commandResults.map((command, index) => {
                  const enabled = command.availability.enabled;
                  return (
                    <li
                      key={command.name}
                      ref={commandRowRef(index)}
                      class="command-bar-row"
                      aria-disabled={enabled ? undefined : 'true'}
                      onClick={() => {
                        activateCommandBarRow('command', index);
                      }}
                      style={{
                        ...rowStyle(enabled && index === selectedCommandIndex),
                        ...(enabled ? {} : { opacity: 0.5 }),
                      }}
                    >
                      <strong style={{ fontFamily: 'var(--font-mono)' }}>/{command.name}</strong>
                      {' — '}
                      {command.description}
                      {!command.availability.enabled && (
                        <span style={subtextStyle(false)}>
                          {' — '}
                          {command.availability.reason}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : showCustomerResults ? (
              <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                {customerResults.map((result, index) => {
                  const selected = index === selectedCustomerIndex;
                  if (result.kind === 'clear') {
                    return (
                      <li
                        key="clear"
                        ref={customerRowRef(index)}
                        class="command-bar-row"
                        onClick={() => {
                          activateCommandBarRow('customer', index);
                        }}
                        style={{ ...rowStyle(selected), fontStyle: 'italic' }}
                      >
                        Consumidor Final
                      </li>
                    );
                  }
                  const { customer } = result.result;
                  // Ciclo 8, punto 2: sin documento ni teléfono (el caso
                  // común — no hay UI todavía para cargarlos, issue #37),
                  // dos clientes con el mismo nombre se veían idénticos acá.
                  // La fecha de alta es la desambiguación barata: ya está en
                  // `Customer.createdAt`, no hace falta ningún dato nuevo.
                  const identifier =
                    [customer.document, customer.phone]
                      .filter((value): value is string => value !== undefined)
                      .join(' · ') || `Alta: ${formatDate(customer.createdAt)}`;
                  return (
                    <li
                      key={customer.id}
                      ref={customerRowRef(index)}
                      class="command-bar-row"
                      onClick={() => {
                        activateCommandBarRow('customer', index);
                      }}
                      style={rowStyle(selected)}
                    >
                      <div>{customer.name}</div>
                      <div style={subtextStyle(selected)}>{identifier}</div>
                      {customer.blocked !== undefined && (
                        <div style={warningTextStyle}>Bloqueado: {customer.blocked.reason}</div>
                      )}
                    </li>
                  );
                })}
                {parsed.query !== '' && customerResults.length === 0 && (
                  <li
                    class="command-bar-row"
                    onClick={() => {
                      activateCommandBarRow('customer', customerResults.length);
                    }}
                    style={{ ...rowStyle(false), fontStyle: 'italic' }}
                  >
                    + Crear cliente "{parsed.query}"
                  </li>
                )}
              </ul>
            ) : (
              <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                {searchResults.map((result, index) => {
                  const selected = index === selectedSearchIndex;
                  if (result.kind === 'freeform-line') {
                    return (
                      <li
                        key={`freeform:${result.description}`}
                        ref={searchRowRef(index)}
                        class="command-bar-row"
                        onClick={() => {
                          activateCommandBarRow('search', index);
                        }}
                        style={rowStyle(selected)}
                      >
                        <div>{result.description}</div>
                        <div style={subtextStyle(selected)}>
                          en el carrito: {result.qtyInCart} × {formatMoney(result.unitPrice)}
                        </div>
                      </li>
                    );
                  }
                  const { product } = result.result;
                  const qty =
                    parsed.kind === 'search' || parsed.kind === 'code-search' ? parsed.qty : 1;
                  // #99: advertir en vez de bloquear — el stock que quedaría
                  // corto con la cantidad pedida (sumada a la del carrito).
                  const stock = stockSnapshotSignal.value.get(product.id) ?? 0;
                  const inCart =
                    cartSignal.value.lines.find(
                      (line) => line.kind === 'product' && line.productId === product.id,
                    )?.qty ?? 0;
                  const shortOfStock = product.tracksStock && qty > 0 && inCart + qty > stock;
                  return (
                    <li
                      key={product.id}
                      ref={searchRowRef(index)}
                      class="command-bar-row"
                      onClick={() => {
                        activateCommandBarRow('search', index);
                      }}
                      style={rowStyle(selected)}
                    >
                      <div>{product.name}</div>
                      <div style={subtextStyle(selected)}>
                        {product.sku} ·{' '}
                        {qty === 1 ? (
                          <strong style={emphasisStyle(selected)}>
                            {formatMoney(product.price)}
                          </strong>
                        ) : (
                          <>
                            {formatMoney(product.price)}{' '}
                            <strong style={emphasisStyle(selected)}>
                              x {formatQuantity(qty)} = {formatMoney(product.price * qty)}
                            </strong>
                          </>
                        )}
                      </div>
                      {product.blocked !== undefined && (
                        <div style={warningTextStyle}>Bloqueado: {product.blocked.reason}</div>
                      )}
                      {shortOfStock && (
                        <div style={warningTextStyle}>Stock: {formatQuantity(stock)}</div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <ScrollIndicatorBar thumb={overlayScrollThumb} variant="dark" />
        </div>
      )}
    </div>
  );
}
