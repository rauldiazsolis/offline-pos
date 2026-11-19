import { z } from 'zod';
import { storageKey } from '../storage/storage-namespace.ts';
import { deviceRevokedSignal, setDeviceRevoked, type DeviceRevoked } from '../ui/state/sync.ts';

/**
 * Caja vinculada en otro dispositivo (4.7.0, #230): otro equipo canjeó un código de vinculación
 * de esta caja y el backend responde `409 { code: 'device-revoked' }` a todo lo de esta terminal.
 * Como la demo revocada (`demo-revoked.ts`), es estado operativo best-effort: perderlo solo hace
 * que el próximo ciclo lo vuelva a descubrir. Se comparte entre la base real y la de
 * entrenamiento (es de la key, no de los datos). A diferencia de la demo revocada, `/SINCRONIZAR`
 * no la borra: la caja ya es de otro equipo y reintentar no cambia nada. La borran
 * `applyConnection` (una conexión nueva) y `unlinkTerminal`.
 */
const STORAGE_KEY = storageKey('device-revoked');
const storedSchema = z.object({ at: z.string(), message: z.string().optional() });

/** Conserva la primera fecha: la pantalla dice desde cuándo. El mensaje, el último que vino. */
export function markDeviceRevoked(at: string, message?: string): void {
  const since = deviceRevokedSignal.value?.at ?? at;
  const revoked: DeviceRevoked = message !== undefined ? { at: since, message } : { at: since };
  setDeviceRevoked(revoked);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(revoked));
  } catch {
    // Best-effort: el signal ya tiene el valor de esta sesión.
  }
}

export function clearDeviceRevoked(): void {
  setDeviceRevoked(undefined);
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Best-effort.
  }
}

export function restoreDeviceRevoked(): void {
  let parsedJson: unknown;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    parsedJson = raw === null ? null : JSON.parse(raw);
  } catch {
    parsedJson = null;
  }
  const parsed = storedSchema.safeParse(parsedJson);
  setDeviceRevoked(
    parsed.success
      ? {
          at: parsed.data.at,
          ...(parsed.data.message !== undefined ? { message: parsed.data.message } : {}),
        }
      : undefined,
  );
}
