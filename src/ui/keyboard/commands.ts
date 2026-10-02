import { connectorCommands } from '../../sync/connector-registry.ts';
import { cartSignal } from '../state/cart.ts';
import { attachedCustomerSignal } from '../state/customer.ts';
import { activeConnectorTypeSignal, demoSessionSignal } from '../state/sync.ts';

export type CommandAvailability = { enabled: true } | { enabled: false; reason: string };

export type CommandInfo = {
  name: string;
  description: string;
  /**
   * Etapa 2 de #94: un comando puede estar deshabilitado según el estado de la
   * venta. Se deriva de signals (se lee dentro de `commandResultsSignal`).
   * Ausente = siempre habilitado.
   */
  availability?: () => CommandAvailability;
};

const ENABLED: CommandAvailability = { enabled: true };

/** `/COBRAR` sin nada que cobrar: ni artículos ni cliente (con cliente y sin artículos, cobranza — #101). */
function checkoutAvailability(): CommandAvailability {
  return cartSignal.value.lines.length > 0 || attachedCustomerSignal.value !== undefined
    ? ENABLED
    : { enabled: false, reason: 'sin artículos ni cliente' };
}

export function disabledCommandMessage(name: string, reason: string): string {
  return `/${name} no está disponible: ${reason}.`;
}

/**
 * Comandos del núcleo del POS: existen con cualquier conector. Para la lista
 * que se muestra con solo "/" (§7 del doc de diseño: "la barra enseña en vez
 * de requerir memorización"). El comportamiento real de cada uno vive en
 * `command-bar-controller.ts` — esto es solo lo que se le muestra al cajero.
 */
export const CORE_COMMANDS: CommandInfo[] = [
  {
    name: 'COBRAR',
    description: 'Cobrar la venta, o una cobranza al cliente sin artículos (o Ctrl+Enter)',
    availability: checkoutAvailability,
  },
  { name: 'CAJA', description: 'Arqueo, ingreso o egreso de caja' },
  {
    name: 'RESUMEN',
    description: 'Consultar tickets, productos, medios de pago y caja de un día',
  },
  { name: 'ANULAR', description: 'Anular una venta o una cobranza de las últimas 24 h' },
  { name: 'DESCARTAR', description: 'Vaciar la venta en curso (líneas, cliente y ajuste)' },
  { name: 'CONFIG', description: 'Configurar la conexión con el sistema externo' },
  { name: 'IMPRESORA', description: 'Configurar la impresión de tickets' },
  { name: 'SINCRONIZAR', description: 'Sincronizar ahora' },
  { name: 'DIAGNOSTICO', description: 'Ver el estado y el historial reciente de sincronización' },
];

/**
 * Los del núcleo, `/ALTA` si la terminal está en demo (#128) y los que declara el conector activo
 * (Etapa 2c, #77). Lee `activeConnectorTypeSignal` y `demoSessionSignal`, así que dentro de un
 * `computed` se recalcula solo cuando cambian.
 */
export function availableCommands(): CommandInfo[] {
  const demo = demoSessionSignal.value;
  const alta: CommandInfo[] =
    demo !== null ? [{ name: 'ALTA', description: `Darse de alta: ${demo.onboarding.label}` }] : [];
  return [...CORE_COMMANDS, ...alta, ...connectorCommands(activeConnectorTypeSignal.value)];
}

/** Disponibilidad actual de un comando por nombre (para Ctrl+Enter, que no pasa por el menú). */
export function commandAvailability(name: string): CommandAvailability {
  return (
    availableCommands()
      .find((command) => command.name === name)
      ?.availability?.() ?? ENABLED
  );
}
