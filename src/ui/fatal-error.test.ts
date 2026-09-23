import { describe, expect, it } from 'vitest';
import { isBenignResizeObserverLoopError } from './fatal-error.ts';

describe('isBenignResizeObserverLoopError (issue #42)', () => {
  it('reconoce el mensaje moderno de Chromium', () => {
    expect(
      isBenignResizeObserverLoopError(
        'ResizeObserver loop completed with undelivered notifications.',
      ),
    ).toBe(true);
  });

  it('reconoce la variante vieja del mensaje', () => {
    expect(isBenignResizeObserverLoopError('ResizeObserver loop limit exceeded')).toBe(true);
  });

  it('no confunde un error real con el mensaje benigno', () => {
    expect(isBenignResizeObserverLoopError('TypeError: Cannot read properties of undefined')).toBe(
      false,
    );
  });

  it('no confunde un mensaje vacío o genérico', () => {
    expect(isBenignResizeObserverLoopError('')).toBe(false);
    expect(isBenignResizeObserverLoopError('Script error.')).toBe(false);
  });
});
