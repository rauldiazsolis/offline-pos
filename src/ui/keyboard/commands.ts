import { portalOffer } from '../../sync/backend-portal.ts';
import type { BackendPortal } from '../../sync/connector.ts';
import { CONNECTOR_TYPES, connectorCommands } from '../../sync/connector-registry.ts';
import { appUpdateSignal } from '../state/app-update.ts';
import { cartSignal } from '../state/cart.ts';
import { attachedCustomerSignal } from '../state/customer.ts';
import {
  activeConnectorTypeSignal,
  backendCapabilitiesSignal,
  backendPortalSignal,
  demoRevokedSignal,
  demoSessionSignal,
} from '../state/sync.ts';

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
 * Todos los nombres del POS, estén disponibles o no ahora (#179): el comando del portal que choca
 * con uno pasa a `/PORTAL`, así no cambia de nombre según el estado de la terminal.
 */
export const RESERVED_COMMAND_NAMES: ReadonlySet<string> = new Set([
  ...CORE_COMMANDS.map((command) => command.name),
  'ACTUALIZAR',
  'ALTA',
  'DEMO_NUEVA',
  ...CONNECTOR_TYPES.flatMap((info) => info.commands.map((command) => command.name)),
]);

/**
 * El portal que ofrece el POS ahora (4.6.0, #179): el comando y el botón. Nada con la demo revocada
 * (la key ya no sirve y el encabezado ofrece `/DEMO_NUEVA`). Lee signals: dentro de un `computed` o
 * de un componente se recalcula solo.
 */
export function currentPortalOffer(): BackendPortal | null {
  if (demoRevokedSignal.value !== null) {
    return null;
  }
  return portalOffer(
    backendCapabilitiesSignal.value,
    backendPortalSignal.value,
    RESERVED_COMMAND_NAMES,
  );
}

/**
 * Los del núcleo, `/ACTUALIZAR` (#54) si hay una versión nueva descargada, `/ALTA` (#128) y
 * `/DEMO_NUEVA` (#176) si la terminal está en demo, el del portal (#179) si el backend lo ofrece y
 * los que declara el conector activo (Etapa 2c, #77). Lee signals, así que dentro de un `computed`
 * se recalcula solo cuando cambian.
 */
export function availableCommands(): CommandInfo[] {
  const demo = demoSessionSignal.value;
  const demoCommands: CommandInfo[] =
    demo !== null
      ? [
          { name: 'ALTA', description: `Darse de alta: ${demo.onboarding.label}` },
          { name: 'DEMO_NUEVA', description: 'Empezar una demo nueva (se borra lo de esta)' },
        ]
      : [];
  const updateCommands: CommandInfo[] =
    appUpdateSignal.value !== 'none'
      ? [{ name: 'ACTUALIZAR', description: 'Aplicar la versión nueva del POS (recarga)' }]
      : [];
  const portal = currentPortalOffer();
  const portalCommands: CommandInfo[] =
    portal !== null ? [{ name: portal.command, description: portal.label }] : [];
  return [
    ...CORE_COMMANDS,
    ...updateCommands,
    ...demoCommands,
    ...portalCommands,
    ...connectorCommands(activeConnectorTypeSignal.value),
  ];
}

/** Disponibilidad actual de un comando por nombre (para Ctrl+Enter, que no pasa por el menú). */
export function commandAvailability(name: string): CommandAvailability {
  return (
    availableCommands()
      .find((command) => command.name === name)
      ?.availability?.() ?? ENABLED
  );
}
