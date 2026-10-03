import { z } from 'zod';
import { backendCompanySignal } from '../ui/state/sync.ts';
import { storageKey } from '../storage/storage-namespace.ts';

/**
 * La empresa del último `getInfo` exitoso (4.5.0, #193), en `localStorage`: una terminal que
 * arranca sin red la muestra igual. Estado operativo best-effort, como las capacidades
 * (`backend-capabilities.ts`): perderlo solo deja de mostrarla hasta el próximo `/info`.
 */
const STORAGE_KEY = storageKey('backend-company');
const companySchema = z.object({ name: z.string().min(1) });

export function restoreBackendCompany(): void {
  let parsedJson: unknown;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    parsedJson = raw === null ? null : (JSON.parse(raw) as unknown);
  } catch {
    parsedJson = null;
  }
  const parsed = companySchema.safeParse(parsedJson);
  backendCompanySignal.value = parsed.success ? parsed.data.name : undefined;
}

/** `undefined` borra: el backend no la mandó, o se aplicó otra conexión sin ella. */
export function saveBackendCompany(company: { name: string } | undefined): void {
  backendCompanySignal.value = company?.name;
  try {
    if (company === undefined) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ name: company.name }));
    }
  } catch {
    // Best-effort: el signal ya tiene el valor de esta sesión.
  }
}
