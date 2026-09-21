import type { Result } from '../domain/result.ts';
import type { SyncConfig } from './config.ts';

/**
 * Estado de la conexión de esta terminal (Etapa 2b, #76):
 * - `unconfigured`: no hay config guardada (o está inválida).
 * - `unverified`: hay config pero sin una prueba exitosa registrada.
 * - `active`: hay config con `verifiedAt` — la app puede operar.
 * Depende solo de lo guardado, nunca de la conectividad: una terminal `active`
 * opera offline como siempre.
 */
export type ConnectionState = 'unconfigured' | 'unverified' | 'active';

export function connectionState(config: Result<SyncConfig>): ConnectionState {
  if (!config.ok) {
    return 'unconfigured';
  }
  return config.value.verifiedAt !== undefined ? 'active' : 'unverified';
}
