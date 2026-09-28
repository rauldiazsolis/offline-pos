/**
 * Versión del Connector API que habla este POS: 4.0.0 desde la Etapa 4 de #94 (#99), 4.1.0 desde
 * la Etapa 5 (#120: `Sale.ticket`), 4.2.0 desde la Etapa 6 (#101: `CustomerPayment.receipt` y
 * saldo sin cuenta corriente).
 */
export const POS_CONTRACT_VERSION = '4.2.0';

function parseVersion(version: string): [number, number, number] | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : undefined;
}

/**
 * Compatible: mismo major y el backend en un minor igual o mayor (si no,
 * puede no entender algo que el POS manda). Una versión con formato inválido
 * es incompatible.
 */
export function isCompatibleContract(
  backendVersion: string,
  posVersion: string = POS_CONTRACT_VERSION,
): boolean {
  const backend = parseVersion(backendVersion);
  const pos = parseVersion(posVersion);
  if (backend === undefined || pos === undefined) {
    return false;
  }
  return backend[0] === pos[0] && backend[1] >= pos[1];
}

/** Lo que el POS necesita, para los mensajes (`'4.2.0'` → `'4.2 o posterior'`). */
export function contractRequirement(version: string): string {
  const [major, minor] = version.split('.');
  return `${major ?? version}.${minor ?? '0'} o posterior`;
}
