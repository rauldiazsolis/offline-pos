import type { TargetedEvent, TargetedKeyboardEvent } from 'preact';
import {
  moveSelection,
  removeSelectedCartLine,
  setSelectedCartLineQuantity,
  submitCommandBar,
  triggerCheckout,
} from '../keyboard/command-bar-controller.ts';
import { useFocusOnMount } from '../hooks/use-focus-on-mount.ts';
import { useSelectOnErrorSignal } from '../hooks/use-select-on-error.ts';
import { formatMoney } from '../format.ts';
import { cartSelectionIndexSignal } from '../state/cart.ts';
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
} from '../state/command-bar.ts';

const ONLY_DIGITS = /^\d+$/;

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

  const handleInput = (event: TargetedEvent<HTMLInputElement>) => {
    commandBarBufferSignal.value = event.currentTarget.value;
    commandBarErrorSignal.value = null;
  };

  const handleKeyDown = (event: TargetedKeyboardEvent<HTMLInputElement>) => {
    if (event.ctrlKey && event.key === 'Enter') {
      event.preventDefault();
      void triggerCheckout();
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

      // Con una línea del carrito seleccionada (↑/↓ previo), un número + Enter
      // reemplaza su cantidad en vez de buscarse como código de barras.
      if (cartSelectionIndexSignal.value !== null && ONLY_DIGITS.test(buffer)) {
        void setSelectedCartLineQuantity(Number.parseInt(buffer, 10));
        commandBarBufferSignal.value = '';
        return;
      }

      submitCommandBar();
    }
  };

  const searchResults = searchResultsSignal.value;
  const selectedSearchIndex = searchSelectionIndexSignal.value ?? 0;
  const customerResults = customerResultsSignal.value;
  const selectedCustomerIndex = customerSelectionIndexSignal.value ?? 0;
  const parsed = parsedSignal.value;
  const commandResults = commandResultsSignal.value;
  const selectedCommandIndex = commandSelectionIndexSignal.value;
  const showCommandList = parsed.kind === 'command';
  // Issue #21: la lista se muestra apenas se abre "@", sin esperar texto —
  // con query vacía son los clientes más recientes (customerResultsSignal).
  const showCustomerResults = parsed.kind === 'customer';

  const rowStyle = (selected: boolean): { [key: string]: string } => ({
    padding: 'var(--space-2)',
    borderRadius: 'var(--radius-md)',
    background: selected ? 'var(--color-accent)' : 'transparent',
    color: selected ? '#ffffff' : 'var(--color-chrome-text)',
  });

  // Subtexto (SKU/precio de producto, cantidad×monto de una línea libre ya
  // en el carrito, documento/teléfono de cliente) — mismo patrón que
  // `lineCode` en CartView, adaptado a legible sobre el fondo sólido cuando
  // la fila está seleccionada.
  const subtextStyle = (selected: boolean): { [key: string]: string } => ({
    fontSize: 'var(--font-size-sm)',
    color: selected ? 'rgba(255, 255, 255, 0.85)' : 'var(--color-chrome-text-muted)',
  });

  const hasError = commandBarErrorSignal.value !== null;
  const hasCommandResults = showCommandList && commandResults.length > 0;
  // Con query hay algo para mostrar siempre (la lista, o "+ Crear cliente");
  // con query vacía, solo si hay clientes recientes — si no, no hay nada que
  // este overlay deba ocupar en pantalla.
  const hasCustomerResults =
    showCustomerResults && (parsed.query !== '' || customerResults.length > 0);
  const hasSearchResults = !showCommandList && !showCustomerResults && searchResults.length > 0;
  const showOverlay = hasError || hasCommandResults || hasCustomerResults || hasSearchResults;

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
        <div
          style={{
            position: 'absolute',
            bottom: '100%',
            left: 0,
            right: 0,
            marginBottom: 'var(--space-2)',
            maxHeight: '40vh',
            overflowY: 'auto',
            background: 'var(--color-chrome-bg)',
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-card)',
            padding: 'var(--space-2)',
            zIndex: 10,
          }}
        >
          {hasError ? (
            <p role="alert" style={{ margin: 0, padding: 'var(--space-2)', color: '#f87171' }}>
              {commandBarErrorSignal.value}
            </p>
          ) : hasCommandResults ? (
            <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
              {commandResults.map((command, index) => (
                <li key={command.name} style={rowStyle(index === selectedCommandIndex)}>
                  <strong style={{ fontFamily: 'var(--font-mono)' }}>/{command.name}</strong>
                  {' — '}
                  {command.description}
                </li>
              ))}
            </ul>
          ) : showCustomerResults ? (
            <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
              {customerResults.map((result, index) => {
                const selected = index === selectedCustomerIndex;
                const identifier = [result.customer.document, result.customer.phone]
                  .filter((value): value is string => value !== undefined)
                  .join(' · ');
                return (
                  <li key={result.customer.id} style={rowStyle(selected)}>
                    <div>{result.customer.name}</div>
                    {identifier !== '' && <div style={subtextStyle(selected)}>{identifier}</div>}
                  </li>
                );
              })}
              {parsed.query !== '' && customerResults.length === 0 && (
                <li style={{ ...rowStyle(false), fontStyle: 'italic' }}>
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
                    <li key={`freeform:${result.description}`} style={rowStyle(selected)}>
                      <div>{result.description}</div>
                      <div style={subtextStyle(selected)}>
                        en el carrito: {result.qtyInCart} × {formatMoney(result.unitPrice)}
                      </div>
                    </li>
                  );
                }
                const { product } = result.result;
                const qty = parsed.kind === 'search' ? parsed.qty : 1;
                return (
                  <li key={product.id} style={rowStyle(selected)}>
                    <div>{product.name}</div>
                    <div style={subtextStyle(selected)}>
                      {product.sku} · {formatMoney(product.price)}
                      {qty !== 1 && ` · ${String(qty)} × = ${formatMoney(product.price * qty)}`}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
