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

  it('sync/request-failed sin status es un problema de conectividad', () => {
    const message = describeError({
      ok: false,
      error: 'sync/request-failed',
      meta: { message: 'Failed to fetch' },
    });

    expect(message).toBe(
      'No se pudo conectar con el servidor (Failed to fetch). ¿Está en línea y corriendo?',
    );
  });

  it.each([401, 403])('sync/request-failed con %i: rechazó las credenciales', (status) => {
    const message = describeError({
      ok: false,
      error: 'sync/request-failed',
      meta: { status, message: 'x' },
    });

    expect(message).toBe(`El servidor rechazó las credenciales (${String(status)}).`);
  });

  it('sync/request-failed con 404 sugiere revisar la URL', () => {
    const message = describeError({
      ok: false,
      error: 'sync/request-failed',
      meta: { status: 404, message: 'x' },
    });

    expect(message).toBe('El servidor no encontró el recurso (404). ¿La URL es correcta?');
  });

  it('sync/request-failed con otro status', () => {
    const message = describeError({
      ok: false,
      error: 'sync/request-failed',
      meta: { status: 500, message: 'x' },
    });

    expect(message).toBe('El servidor respondió con un error (500).');
  });

  it('sync/timeout', () => {
    expect(describeError({ ok: false, error: 'sync/timeout', meta: { seconds: 20 } })).toBe(
      'El servidor no respondió en 20 segundos.',
    );
  });

  it('sync/remote-error', () => {
    expect(
      describeError({
        ok: false,
        error: 'sync/remote-error',
        meta: { message: 'Secreto compartido inválido' },
      }),
    ).toBe('El sistema externo respondió con un error: Secreto compartido inválido');
  });

  it('sync/empty-snapshot dice qué llegó vacío y que se conservó lo local', () => {
    expect(
      describeError({
        ok: false,
        error: 'sync/empty-snapshot',
        meta: { tables: ['products', 'customers'] },
      }),
    ).toBe(
      'El sistema externo devolvió vacío: productos, clientes. Se conservaron los datos locales.',
    );
  });

  it('sync/reconcile-failed incluye el motivo', () => {
    expect(
      describeError({ ok: false, error: 'sync/reconcile-failed', meta: { message: 'boom' } }),
    ).toBe('No se pudo actualizar el catálogo local (boom).');
  });

  it('storage/cleanup-failed: dice que no se pudo limpiar y por qué', () => {
    expect(
      describeError({ ok: false, error: 'storage/cleanup-failed', meta: { message: 'boom' } }),
    ).toBe('No se pudieron borrar los datos locales viejos: boom');
  });

  it('connection/sync-busy pide esperar y reintentar', () => {
    expect(describeError({ ok: false, error: 'connection/sync-busy', meta: undefined })).toBe(
      'Hay una sincronización en curso que todavía no terminó. Esperá unos segundos y probá de nuevo.',
    );
  });

  it('connection/apply-failed', () => {
    expect(
      describeError({ ok: false, error: 'connection/apply-failed', meta: { message: 'boom' } }),
    ).toBe('No se pudo aplicar la conexión (boom).');
  });

  it('demo/backend-reset-failed sugiere revisar que el backend esté corriendo', () => {
    expect(
      describeError({
        ok: false,
        error: 'demo/backend-reset-failed',
        meta: { message: 'Failed to fetch' },
      }),
    ).toBe('No se pudo reiniciar el minibackend de demo (Failed to fetch). ¿Está corriendo?');
  });

  it('sync/push-issues: incluye el primer issue reportado por el backend (#87)', () => {
    const message = describeError({
      ok: false,
      error: 'sync/push-issues',
      meta: { issues: ['stock insuficiente en p1'] },
    });
    expect(message).toContain('stock insuficiente en p1');
  });
});
