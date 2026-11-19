import { backendCapabilitiesSignal } from '../ui/state/sync.ts';
import { CAPABILITY_DEVICE_CLAIM, supportsCapability } from './backend-capabilities.ts';
import { getDeviceId } from './device-id.ts';

/**
 * El id de dispositivo para el header `X-Device-Id` (4.7.0, #230), o `undefined` si no va. Va
 * solo a un backend que declara `device-claim`: un header nuevo dispara el preflight de CORS, y un
 * backend que lista sus headers permitidos (uno 4.6) rechazaría el request entero. Sin capacidades
 * conocidas (`undefined`, terminal que nunca consultó `/info`) tampoco va. `capabilities` por
 * omisión son las guardadas (`backendCapabilitiesSignal`, de la conexión activa); el conector REST
 * pasa las de su propio `getInfo` cuando ya lo hizo (la prueba de una conexión nueva no puede usar
 * las de la anterior). `/claim` lo manda siempre, aparte (`device-claim.ts`).
 */
export function deviceIdForBackend(
  capabilities: readonly string[] | undefined = backendCapabilitiesSignal.value,
): string | undefined {
  return supportsCapability(capabilities, CAPABILITY_DEVICE_CLAIM) === true
    ? getDeviceId()
    : undefined;
}
