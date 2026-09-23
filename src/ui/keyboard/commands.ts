import { connectorCommands } from '../../sync/connector-registry.ts';
import { activeConnectorTypeSignal } from '../state/sync.ts';

export type CommandInfo = { name: string; description: string };

/**
 * Comandos del núcleo del POS: existen con cualquier conector. Para la lista
 * que se muestra con solo "/" (§7 del doc de diseño: "la barra enseña en vez
 * de requerir memorización"). El comportamiento real de cada uno vive en
 * `command-bar-controller.ts` — esto es solo lo que se le muestra al cajero.
 */
export const CORE_COMMANDS: CommandInfo[] = [
  { name: 'COBRAR', description: 'Cobrar y cerrar la venta (o Ctrl+Enter)' },
  { name: 'CAJA', description: 'Abrir o cerrar el turno de caja' },
  { name: 'RESUMEN', description: 'Consultar tickets, productos y medios de pago del turno' },
  { name: 'ANULAR', description: 'Anular una venta ya cerrada' },
  { name: 'DESCARTAR', description: 'Vaciar la venta en curso (líneas, cliente y ajuste)' },
  { name: 'CONFIG', description: 'Configurar la conexión con el sistema externo' },
  { name: 'SINCRONIZAR', description: 'Sincronizar ahora' },
  { name: 'DIAGNOSTICO', description: 'Ver el estado y el historial reciente de sincronización' },
];

/**
 * Los del núcleo más los que declara el conector activo (Etapa 2c, #77).
 * Lee `activeConnectorTypeSignal`, así que dentro de un `computed` se
 * recalcula solo cuando cambia el conector.
 */
export function availableCommands(): CommandInfo[] {
  return [...CORE_COMMANDS, ...connectorCommands(activeConnectorTypeSignal.value)];
}
