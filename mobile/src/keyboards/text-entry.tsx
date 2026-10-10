import { useEffect, useState } from 'preact/hooks';
import { Sheet } from '../components/sheet.tsx';
import { closeEntry, type TextEntryRequest } from './entry.ts';
import {
  LETTER_ROWS,
  pressTextKey,
  SYMBOL_ROWS,
  textKeyboardState,
  type TextKey,
  type TextKeyboardState,
} from './text-keyboard-model.ts';

function physicalKey(event: KeyboardEvent): TextKey | 'ok' | 'cancel' | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  if (event.key === 'Enter') return 'ok';
  if (event.key === 'Escape') return 'cancel';
  if (event.key === 'Backspace') return { kind: 'back' };
  if (event.key === ' ') return { kind: 'space' };
  // Una tecla física ya trae su mayúscula: se agrega tal cual, sin la del teclado propio.
  if (event.key.length === 1) return { kind: 'raw', char: event.key };
  return null;
}

export function TextEntry({ request }: { request: TextEntryRequest }) {
  const [state, setState] = useState<TextKeyboardState>(() =>
    textKeyboardState(request.initial ?? '', request.options),
  );
  const [error, setError] = useState<string | null>(null);

  const press = (key: TextKey): void => {
    setError(null);
    setState((current) => pressTextKey(current, key, request.options));
  };

  const done = (): void => {
    if (request.onDone === undefined) return;
    const message = request.validate?.(state.text) ?? null;
    if (message !== null) {
      setError(message);
      return;
    }
    closeEntry();
    request.onDone(state.text.trim());
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const key = physicalKey(event);
      if (key === null) return;
      event.preventDefault();
      if (key === 'ok') done();
      else if (key === 'cancel') closeEntry();
      else press(key);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  });

  const rows = state.layer === 'letters' ? LETTER_ROWS : SYMBOL_ROWS;
  const upper = state.layer === 'letters' && state.shift !== 'off';
  const shown = request.secret === true ? '•'.repeat(state.text.length) : state.text;
  const ok = request.onDone !== undefined;

  return (
    <Sheet
      title={request.title}
      onClose={closeEntry}
      full={request.results !== undefined}
      fixedBody
      testId="text-entry"
    >
      {/* La lista arriba, y el texto pegado al teclado, que queda fijo abajo: escribir no mueve nada. */}
      {request.results !== undefined && (
        <div class="entry-results list">{request.results(state.text)}</div>
      )}
      {error !== null && (
        <p class="hint hint--error" role="alert" style={{ textAlign: 'left', margin: '6px 0 0' }}>
          {error}
        </p>
      )}
      <div class="query entry-query" data-testid="text-entry-display">
        {shown !== '' && <span>{shown}</span>}
        <span class="caret" />
        {shown === '' && <span class="ph">{request.placeholder}</span>}
      </div>
      <div class="lkeys">
        {rows.map((row, index) => (
          <div class="lrow" key={row.join('')}>
            {index === 2 && state.layer === 'letters' && (
              <button
                type="button"
                class="lkey wide"
                aria-label="Mayúscula"
                aria-pressed={state.shift !== 'off'}
                onClick={() => {
                  press({ kind: 'shift' });
                }}
                style={state.shift === 'lock' ? { textDecoration: 'underline' } : undefined}
              >
                ⇧
              </button>
            )}
            {row.map((char) => (
              <button
                key={char}
                type="button"
                class="lkey"
                onClick={() => {
                  press({ kind: 'char', char });
                }}
              >
                {upper ? char.toUpperCase() : char}
              </button>
            ))}
            {index === 2 && (
              <button
                type="button"
                class="lkey wide"
                aria-label="Borrar"
                onClick={() => {
                  press({ kind: 'back' });
                }}
              >
                ⌫
              </button>
            )}
          </div>
        ))}
        <div class="lrow">
          <button
            type="button"
            class="lkey wide"
            onClick={() => {
              press({ kind: 'layer' });
            }}
          >
            {state.layer === 'letters' ? '123' : 'abc'}
          </button>
          <button
            type="button"
            class="lkey space"
            onClick={() => {
              press({ kind: 'space' });
            }}
          >
            espacio
          </button>
          {ok ? (
            <button type="button" class="lkey ok" onClick={done}>
              {request.okLabel ?? 'Listo'}
            </button>
          ) : (
            <button
              type="button"
              class="lkey wide"
              onClick={() => {
                press({ kind: 'clear' });
              }}
            >
              Limpiar
            </button>
          )}
        </div>
      </div>
    </Sheet>
  );
}
