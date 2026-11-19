/**
 * El id de dispositivo resuelto al arrancar (`terminal-identity.ts::resolveDeviceIdentity`), en
 * memoria. Módulo sin dependencias a propósito (4.7.0, #230): lo usa el conector REST para
 * `X-Device-Id`, y `terminal-identity.ts` arrastra la config y el registro de conectores (ciclo de
 * imports). `terminal-identity.ts` lo reexporta: es el punto de entrada de siempre.
 */
let cachedDeviceId: string | undefined;

/** Solo `resolveDeviceIdentity` (y los tests, con `setDeviceIdForTests`). */
export function setResolvedDeviceId(id: string | undefined): void {
  cachedDeviceId = id;
}

/**
 * Id de dispositivo: viaja una vez por request de push y de pull (contrato
 * v3). Nunca crea uno: si alguien borra la clave a mitad de sesión, la
 * terminal sigue con el id en memoria hasta recargar, y recién ahí
 * `resolveDeviceIdentity` aplica el ciclo de vida. Llamarlo antes de resolver
 * es un bug (invariante), no un error de negocio.
 */
export function getDeviceId(): string {
  if (cachedDeviceId === undefined) {
    throw new Error('getDeviceId() antes de resolveDeviceIdentity()');
  }
  return cachedDeviceId;
}

/** Para `pos.deviceId()`, que existe antes del arranque: `null` si todavía no se resolvió. */
export function peekDeviceId(): string | null {
  return cachedDeviceId ?? null;
}
