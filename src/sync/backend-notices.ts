import { z } from 'zod';
import { backendNoticesSignal } from '../ui/state/sync.ts';
import { backendNoticeSchema, type BackendNotice, type NoticeSeverity } from './connector.ts';

/**
 * Avisos del backend (4.4.0, #128): la lista vigente llega completa en cada pull y reemplaza a la
 * anterior, sin acuse ni descarte local. En `localStorage` para que una terminal que arranca sin red
 * los siga mostrando; estado operativo best-effort, como los cursores.
 */
const STORAGE_KEY = 'offline-pos:backend-notices';
const noticesSchema = z.array(backendNoticeSchema);

/** Omite `ref` si falta (`exactOptionalPropertyTypes`). */
function toNotice(notice: z.infer<typeof backendNoticeSchema>): BackendNotice {
  return {
    id: notice.id,
    severity: notice.severity,
    message: notice.message,
    ...(notice.ref !== undefined ? { ref: notice.ref } : {}),
  };
}

export function restoreBackendNotices(): void {
  let parsedJson: unknown;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    parsedJson = raw === null ? null : (JSON.parse(raw) as unknown);
  } catch {
    parsedJson = null;
  }
  const parsed = noticesSchema.safeParse(parsedJson);
  backendNoticesSignal.value = parsed.success ? parsed.data.map(toNotice) : [];
}

export function saveBackendNotices(notices: readonly BackendNotice[]): void {
  backendNoticesSignal.value = [...notices];
  try {
    if (notices.length === 0) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(notices));
    }
  } catch {
    // Best-effort: el signal ya tiene el valor de esta sesión.
  }
}

const SEVERITY_RANK: Record<NoticeSeverity, number> = { info: 0, warning: 1, critical: 2 };

/** La severidad más grave de la lista, para el color de "Avisos (N)". Pura. */
export function mostSevere(notices: readonly BackendNotice[]): NoticeSeverity | undefined {
  let worst: NoticeSeverity | undefined;
  for (const notice of notices) {
    if (worst === undefined || SEVERITY_RANK[notice.severity] > SEVERITY_RANK[worst]) {
      worst = notice.severity;
    }
  }
  return worst;
}
