import type { Result } from '../domain/result.ts';
import type { SyncConfig } from './config.ts';

/**
 * Estado de la conexión de esta terminal (Etapa 2b, #76; `incomplete` desde la Etapa 2 de #94):
 * - `unconfigured`: no hay config guardada (o está inválida).
 * - `unverified`: hay config pero sin una prueba exitosa registrada.
 * - `incomplete`: probada, pero sin sucursal o punto de venta (obligatorios
 *   desde #97; una config de la Etapa 1 cae acá) — completarlos no exige probar.
 * - `active`: la app puede operar.
 * Depende solo de lo guardado, nunca de la conectividad: una terminal `active`
 * opera offline como siempre.
 */
export type ConnectionState = 'unconfigured' | 'unverified' | 'incomplete' | 'active';

/** Sucursal y punto de venta cargados (texto no vacío tras `trim`), obligatorios desde #97. */
export function hasTerminalIdentity(config: {
  branch?: string | undefined;
  pointOfSale?: string | undefined;
}): boolean {
  return (config.branch ?? '').trim() !== '' && (config.pointOfSale ?? '').trim() !== '';
}

export function connectionState(config: Result<SyncConfig>): ConnectionState {
  if (!config.ok) {
    return 'unconfigured';
  }
  if (config.value.verifiedAt === undefined) {
    return 'unverified';
  }
  return hasTerminalIdentity(config.value) ? 'active' : 'incomplete';
}
