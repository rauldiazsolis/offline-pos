import { z } from 'zod';
import { err, ok, type Result } from '../domain/result.ts';
import { toZodIssues } from '../domain/zod-issues.ts';

/**
 * Configuración del conector, editada por el humano vía `/CONFIG` (ver
 * `ui/screens/config-screen.tsx`). Separada de `cursor.ts` a propósito:
 * esto es lo único que la pantalla de config toca.
 */
export const syncConfigSchema = z.object({
  baseUrl: z.url(),
  apiKey: z.string().optional(),
  // §7 del doc de diseño: locale configurable por terminal, usado por
  // `ui/format.ts` para `Intl.NumberFormat`. Default `navigator.language`
  // si no se configura.
  locale: z.string().optional(),
});

export type SyncConfig = z.infer<typeof syncConfigSchema>;

const STORAGE_KEY = 'offline-pos:sync-config';

function invalidConfig(message: string): Result<never> {
  return err('sync/config-invalid', { issues: [{ path: '', message }] });
}

/** `localStorage`/`JSON.parse` son el borde real acá — único try/catch de este módulo. */
export function loadSyncConfig(): Result<SyncConfig> {
  let raw: string | null;
  let parsedJson: unknown;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
    parsedJson = raw === null ? null : (JSON.parse(raw) as unknown);
  } catch (error) {
    return invalidConfig(error instanceof Error ? error.message : String(error));
  }

  if (parsedJson === null) {
    return err('sync/config-missing', undefined);
  }

  const parsed = syncConfigSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return err('sync/config-invalid', { issues: toZodIssues(parsed.error) });
  }
  return ok(parsed.data);
}

export function saveSyncConfig(config: SyncConfig): Result<void> {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch (error) {
    return invalidConfig(error instanceof Error ? error.message : String(error));
  }
  return ok(undefined);
}
