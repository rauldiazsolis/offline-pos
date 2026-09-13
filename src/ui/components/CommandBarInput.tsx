import { useSignalEffect } from '@preact/signals';
import { useRef } from 'preact/hooks';
import type { TargetedEvent, TargetedKeyboardEvent } from 'preact';
import {
  moveSelection,
  removeSelectedCartLine,
  setSelectedCartLineQuantity,
  submitCommandBar,
  triggerCheckout,
} from '../keyboard/command-bar-controller.ts';
import { AVAILABLE_COMMANDS } from '../keyboard/commands.ts';
import { cartSelectionIndexSignal } from '../state/cart.ts';
import {
  commandBarBufferSignal,
  commandBarErrorSignal,
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
  const inputRef = useRef<HTMLInputElement>(null);

  // Al fallar el parseo/comando, se selecciona todo el input (.select() nativo)
  // — vale tanto para errores síncronos como para los que llegan después de
  // resolver una búsqueda async de producto/stock.
  useSignalEffect(() => {
    if (commandBarErrorSignal.value !== null) {
      inputRef.current?.select();
    }
  });

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
  const showCommandList = parsed.kind === 'command' && parsed.name === '';
  const showCustomerResults = parsed.kind === 'customer' && parsed.query !== '';

  return (
    <div>
      <input
        ref={inputRef}
        type="text"
        autoFocus
        value={commandBarBufferSignal.value}
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        aria-label="Barra de comandos"
        style={{
          width: '100%',
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--font-size-lg)',
          padding: 'var(--space-3)',
          border: '1px solid var(--color-border)',
          background: 'var(--color-bg)',
          color: 'var(--color-text)',
        }}
      />
      {/* Slot de altura fija: nunca corre el layout, tenga o no contenido. */}
      <div style={{ minHeight: 'var(--space-8)', padding: 'var(--space-2) 0' }}>
        {commandBarErrorSignal.value !== null ? (
          <p role="alert" style={{ margin: 0, color: 'var(--color-danger)' }}>
            {commandBarErrorSignal.value}
          </p>
        ) : showCommandList ? (
          <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {AVAILABLE_COMMANDS.map((command) => (
              <li key={command.name} style={{ padding: 'var(--space-1) var(--space-2)' }}>
                <strong style={{ fontFamily: 'var(--font-mono)' }}>/{command.name}</strong>
                {' — '}
                {command.description}
              </li>
            ))}
          </ul>
        ) : showCustomerResults ? (
          <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {customerResults.map((result, index) => (
              <li
                key={result.customer.id}
                style={{
                  padding: 'var(--space-1) var(--space-2)',
                  background:
                    index === selectedCustomerIndex ? 'var(--color-surface)' : 'transparent',
                }}
              >
                {result.customer.name}
              </li>
            ))}
            {customerResults.length === 0 && (
              <li style={{ padding: 'var(--space-1) var(--space-2)', fontStyle: 'italic' }}>
                + Crear cliente "{parsed.query}"
              </li>
            )}
          </ul>
        ) : searchResults.length > 0 ? (
          <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {searchResults.map((result, index) => (
              <li
                key={result.product.id}
                style={{
                  padding: 'var(--space-1) var(--space-2)',
                  background:
                    index === selectedSearchIndex ? 'var(--color-surface)' : 'transparent',
                }}
              >
                {result.product.name}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
