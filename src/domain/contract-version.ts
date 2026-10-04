/**
 * Versión del Connector API que habla este POS: 4.0.0 desde la Etapa 4 de #94 (#99), 4.1.0 desde
 * la Etapa 5 (#120: `Sale.ticket`), 4.2.0 desde la Etapa 6 (#101: `CustomerPayment.receipt` y
 * saldo sin cuenta corriente), 4.3.0 desde #125 (`CustomerPayment.voidsPaymentId`: anular cobranzas),
 * 4.4.0 desde #128 (`POST /demo-sessions`, capacidades en `GET /info`, `notices` en el pull, reglas
 * de evolución), 4.5.0 desde #193 (`company` opcional en `GET /info`), 4.6.0 desde #178 (capacidad
 * `portal` con `POST /portal-links`, `ErrorBody`, el 503 de mantenimiento y el 429/503 de
 * `/demo-sessions`).
 */
export const POS_CONTRACT_VERSION = '4.6.0';

/**
 * Piso de compatibilidad (4.4.0, #128): desde acá un agregado nuevo entra como capacidad
 * (`GET /info.capabilities`), así que el POS ya no exige que el backend esté en su mismo minor.
 */
export const MIN_BACKEND_CONTRACT = '4.0.0';

function parseVersion(version: string): [number, number, number] | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : undefined;
}

/** Compatible: mismo major que el piso y minor igual o mayor. Un formato inválido es incompatible. */
export function isCompatibleContract(
  backendVersion: string,
  floor: string = MIN_BACKEND_CONTRACT,
): boolean {
  const backend = parseVersion(backendVersion);
  const min = parseVersion(floor);
  if (backend === undefined || min === undefined) {
    return false;
  }
  return backend[0] === min[0] && backend[1] >= min[1];
}

/** Lo que el POS necesita, para los mensajes (`'4.0.0'` → `'4.0 o posterior'`). */
export function contractRequirement(version: string): string {
  const [major, minor] = version.split('.');
  return `${major ?? version}.${minor ?? '0'} o posterior`;
}
