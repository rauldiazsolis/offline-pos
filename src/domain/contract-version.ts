/** Versión del Connector API que habla este POS (epic #94, Etapa 4 — #99). */
export const POS_CONTRACT_VERSION = '4.0.0';

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

/** Major de una versión (`'4.0.0'` → `'4'`), para los mensajes. */
export function contractMajor(version: string): string {
  return version.split('.')[0] ?? version;
}
