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
  const showCustomerResults = parsed.kind === 'customer' && parsed.query !== '';

  const rowStyle = (selected: boolean): { [key: string]: string } => ({
    padding: 'var(--space-2)',
    borderRadius: 'var(--radius-md)',
    background: selected ? 'var(--color-accent)' : 'transparent',
    color: selected ? '#ffffff' : 'var(--color-chrome-text)',
  });

  return (
    <div>
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
      {/* Slot de altura fija: nunca corre el layout, tenga o no contenido. */}
      <div style={{ minHeight: 'var(--space-8)', padding: 'var(--space-2) 0' }}>
        {commandBarErrorSignal.value !== null ? (
          <p role="alert" style={{ margin: 0, color: '#f87171' }}>
            {commandBarErrorSignal.value}
          </p>
        ) : showCommandList && commandResults.length > 0 ? (
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
            {customerResults.map((result, index) => (
              <li key={result.customer.id} style={rowStyle(index === selectedCustomerIndex)}>
                {result.customer.name}
              </li>
            ))}
            {customerResults.length === 0 && (
              <li style={{ ...rowStyle(false), fontStyle: 'italic' }}>
                + Crear cliente "{parsed.query}"
              </li>
            )}
          </ul>
        ) : searchResults.length > 0 ? (
          <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {searchResults.map((result, index) => (
              <li key={result.product.id} style={rowStyle(index === selectedSearchIndex)}>
                {result.product.name}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
