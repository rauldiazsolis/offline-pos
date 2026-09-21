import { describe, expect, it } from 'vitest';
import { describeError } from './errors.ts';

describe('describeError', () => {
  it('cash-session/none-ever', () => {
    const message = describeError({ ok: false, error: 'cash-session/none-ever', meta: undefined });

    expect(message).toBe('No hay ningún turno de caja para consultar.');
  });

  it('demo/unavailable-for-connector', () => {
    const message = describeError({
      ok: false,
      error: 'demo/unavailable-for-connector',
      meta: { connectorLabel: 'Google Sheets' },
    });

    expect(message).toBe(
      '/DEMO_RESET no está disponible con Google Sheets: solo funciona con el backend REST de demo.',
    );
  });
});
