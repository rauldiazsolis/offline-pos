import { backendPortalSignal } from '../ui/state/sync.ts';
import { storageKey } from '../storage/storage-namespace.ts';
import { CAPABILITY_PORTAL } from './backend-capabilities.ts';
import { backendPortalSchema, type BackendPortal } from './connector.ts';

/**
 * El portal del último `getInfo` exitoso (4.6.0, #179), en `localStorage`: una terminal que arranca
 * sin red muestra el botón igual (al usarlo, el error explica que no hay red). Estado operativo
 * best-effort, como la empresa (`backend-company.ts`).
 */
const STORAGE_KEY = storageKey('backend-portal');

/** El nombre que usa el POS si el del backend choca con uno propio. */
export const PORTAL_FALLBACK_COMMAND = 'PORTAL';

export function restoreBackendPortal(): void {
  let parsedJson: unknown;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    parsedJson = raw === null ? null : (JSON.parse(raw) as unknown);
  } catch {
    parsedJson = null;
  }
  const parsed = backendPortalSchema.safeParse(parsedJson);
  backendPortalSignal.value = parsed.success ? parsed.data : undefined;
}

/** `undefined` borra: el backend no lo mandó, o se aplicó otra conexión sin él. */
export function saveBackendPortal(portal: BackendPortal | undefined): void {
  backendPortalSignal.value = portal;
  try {
    if (portal === undefined) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(portal));
    }
  } catch {
    // Best-effort: el signal ya tiene el valor de esta sesión.
  }
}

/**
 * Qué ofrece el POS (pura): nada sin la capacidad o sin el objeto (las dos, como pide el contrato);
 * un nombre que choca con uno del POS pasa a `/PORTAL`.
 */
export function portalOffer(
  capabilities: readonly string[] | undefined,
  portal: BackendPortal | undefined,
  reserved: ReadonlySet<string>,
): BackendPortal | null {
  if (portal === undefined || capabilities?.includes(CAPABILITY_PORTAL) !== true) {
    return null;
  }
  return reserved.has(portal.command) ? { ...portal, command: PORTAL_FALLBACK_COMMAND } : portal;
}
