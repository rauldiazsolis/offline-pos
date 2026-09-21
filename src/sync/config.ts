import { z } from 'zod';
import { err, ok, type Result } from '../domain/result.ts';
import { toZodIssues } from '../domain/zod-issues.ts';
import { connectorConfigSchema } from './connector-registry.ts';

/**
 * Antes del registro de conectores (Etapa 2, #68) la config guardada no tenía
 * `type` — solo existía el conector REST. Un objeto sin `type` se lee como
 * `type: 'rest'`; la próxima vez que se guarde, queda con `type`. Recibe
 * `unknown` porque es lo que Zod le pasa a un `preprocess`: el resultado se
 * valida de inmediato contra `connectorConfigSchema`.
 */
function withLegacyType(value: unknown): unknown {
  if (typeof value === 'object' && value !== null && !('type' in value)) {
    return { ...value, type: 'rest' };
  }
  return value;
}

/**
 * Configuración de la terminal, editada por el humano vía `/CONFIG` (ver
 * `ui/screens/config-screen.tsx`): los campos del conector elegido
 * (`connectorConfigSchema`, discriminado por `type`) más `locale`, que queda
 * afuera de la unión porque es config de terminal transversal (§7 del doc de
 * diseño, Fase 4: usado por `ui/format.ts` para `Intl.NumberFormat`, default
 * `navigator.language` si no se configura), no de un backend. Separada de
 * `cursor.ts` a propósito: esto es lo único que la pantalla de config toca.
 */
export const syncConfigSchema = z.preprocess(
  withLegacyType,
  connectorConfigSchema.and(z.object({ locale: z.string().optional() })),
);

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
