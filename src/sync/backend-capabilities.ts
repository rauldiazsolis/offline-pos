import { z } from 'zod';
import { backendCapabilitiesSignal } from '../ui/state/sync.ts';

/** Capacidades del contrato 4.4.0 (#128): un backend las declara en `GET /info`. */
export const CAPABILITY_DEMO_SESSIONS = 'demo-sessions';
export const CAPABILITY_CUSTOMER_PAYMENT_VOID = 'customer-payment-void';

/**
 * Las del último `getInfo` exitoso, en `localStorage`: una terminal que arranca sin red las sabe
 * igual. Estado operativo best-effort, como los cursores: perderlo solo vuelve a "nunca se supo".
 */
const STORAGE_KEY = 'offline-pos:backend-capabilities';
const capabilitiesSchema = z.array(z.string());

export function restoreBackendCapabilities(): void {
  let parsedJson: unknown;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    parsedJson = raw === null ? null : (JSON.parse(raw) as unknown);
  } catch {
    parsedJson = null;
  }
  const parsed = capabilitiesSchema.safeParse(parsedJson);
  backendCapabilitiesSignal.value = parsed.success ? parsed.data : undefined;
}

/** `undefined` borra (aplicar otra conexión): vuelve a "nunca se supo". */
export function saveBackendCapabilities(capabilities: readonly string[] | undefined): void {
  backendCapabilitiesSignal.value = capabilities === undefined ? undefined : [...capabilities];
  try {
    if (capabilities === undefined) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(capabilities));
    }
  } catch {
    // Best-effort: el signal ya tiene el valor de esta sesión.
  }
}

/** `undefined` = nunca se supo (terminal previa a 4.4.0 que arrancó sin red). Pura. */
export function supportsCapability(
  capabilities: readonly string[] | undefined,
  name: string,
): boolean | undefined {
  return capabilities === undefined ? undefined : capabilities.includes(name);
}
