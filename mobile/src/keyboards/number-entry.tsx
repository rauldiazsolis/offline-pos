import { useEffect, useState } from 'preact/hooks';
import { decimalSeparator } from '../../../src/ui/parse-amount.ts';
import { resolveLocale } from '../../../src/ui/format.ts';
import { Sheet } from '../components/sheet.tsx';
import { closeEntry, type NumberEntryRequest } from './entry.ts';
import {
  keypadState,
  parseKeypadText,
  pressKeypadKey,
  type KeypadKey,
  type KeypadState,
} from './keypad-model.ts';

const DIGITS: KeypadKey[] = ['7', '8', '9', '4', '5', '6', '1', '2', '3'];

/** Teclas físicas, para quien usa el POS mobile desde una compu o con un teclado conectado. */
function physicalKey(event: KeyboardEvent): KeypadKey | 'ok' | 'cancel' | null {
  if (/^[0-9]$/.test(event.key)) return event.key as KeypadKey;
  switch (event.key) {
    case ',':
    case '.':
      return 'decimal';
    case '-':
      return 'sign';
    case 'Backspace':
      return 'back';
    case 'Delete':
      return 'clear';
    case 'Enter':
      return 'ok';
    case 'Escape':
      return 'cancel';
    default:
      return null;
  }
}

export function NumberEntry({ request }: { request: NumberEntryRequest }) {
  const decimal = decimalSeparator(resolveLocale());
  const [state, setState] = useState<KeypadState>(() => keypadState(request.initial ?? ''));
  const [error, setError] = useState<string | null>(null);
  const value = parseKeypadText(state.text, decimal);

  const press = (key: KeypadKey): void => {
    setError(null);
    setState((current) => pressKeypadKey(current, key, request.options, decimal));
  };

  const done = (): void => {
    const message = request.validate?.(value) ?? null;
    if (message !== null) {
      setError(message);
      return;
    }
    closeEntry();
    request.onDone(value);
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

  const shown = state.text === '' ? '0' : state.text;
  return (
    <Sheet
      title={request.title}
      onClose={closeEntry}
      testId="number-entry"
      footer={
        <>
          {request.extra !== undefined && (
            <button
              type="button"
              class={request.extra.danger === true ? 'btn btn-danger' : 'btn'}
              onClick={() => {
                closeEntry();
                request.extra?.run();
              }}
            >
              {request.extra.label}
            </button>
          )}
          <button type="button" class="btn btn-primary" onClick={done}>
            {request.okLabel ?? 'Listo'}
          </button>
        </>
      }
    >
      <div class="display" data-testid="number-entry-display">
        <span class="val num">
          {request.prefix !== undefined ? `${request.prefix} ${shown}` : shown}
        </span>
        {request.unit !== undefined && <span class="unit">{request.unit}</span>}
      </div>
      <p
        class={error !== null ? 'hint hint--error' : 'hint'}
        role={error !== null ? 'alert' : undefined}
      >
        {error ?? request.hint?.(value) ?? ''}
      </p>
      {request.quick !== undefined && request.quick.length > 0 && (
        <div class="quick">
          {request.quick.map((quick) => (
            <button
              key={quick.label}
              type="button"
              class="chip"
              onClick={() => {
                setError(null);
                setState({ text: quick.text, pristine: true });
              }}
            >
              {quick.label}
            </button>
          ))}
        </div>
      )}
      <div class="keys">
        {DIGITS.map((digit) => (
          <button
            key={digit}
            type="button"
            class="key"
            onClick={() => {
              press(digit);
            }}
          >
            {digit}
          </button>
        ))}
        {request.options.signed ? (
          <button
            type="button"
            class="key fn"
            aria-label="Cambiar el signo"
            onClick={() => {
              press('sign');
            }}
          >
            ±
          </button>
        ) : request.options.decimals > 0 ? (
          <button
            type="button"
            class="key"
            aria-label="Coma decimal"
            onClick={() => {
              press('decimal');
            }}
          >
            {decimal}
          </button>
        ) : (
          <button
            type="button"
            class="key fn"
            onClick={() => {
              press('clear');
            }}
          >
            C
          </button>
        )}
        <button
          type="button"
          class="key"
          onClick={() => {
            press('0');
          }}
        >
          0
        </button>
        <button
          type="button"
          class="key fn"
          aria-label="Borrar"
          onClick={() => {
            press('back');
          }}
        >
          ⌫
        </button>
        {request.options.signed && request.options.decimals > 0 && (
          <>
            <button
              type="button"
              class="key"
              aria-label="Coma decimal"
              onClick={() => {
                press('decimal');
              }}
            >
              {decimal}
            </button>
            <button
              type="button"
              class="key fn"
              onClick={() => {
                press('clear');
              }}
            >
              C
            </button>
          </>
        )}
      </div>
    </Sheet>
  );
}
