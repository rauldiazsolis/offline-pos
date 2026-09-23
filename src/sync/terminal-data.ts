import { z } from 'zod';
import { err, ok, type Result } from '../domain/result.ts';
import { db } from '../storage/db.ts';
import { clearAllTables } from '../storage/local-data.ts';
import { setSyncPaused } from '../ui/state/sync.ts';
import { secretConfigKeys } from './connector-registry.ts';
import { acquireSyncLockWaiting } from './engine.ts';

/**
 * Todo lo que la app guarda en `localStorage` lleva este prefijo
 * (`sync/config.ts`, `sync/cursor.ts`, `sync/push-lot.ts`). Borrar/volcar por
 * prefijo, no por una lista de claves escrita a mano — mismo criterio que
 * `clearAllTables` con `db.tables`: una clave futura queda incluida sola.
 */
export const LOCAL_STORAGE_PREFIX = 'offline-pos:';

/** Tiempo máximo que `resetTerminal` espera a que termine un ciclo de sync en curso. */
export const RESET_LOCK_WAIT_MS = 15_000;

const REDACTED = '***';

function posLocalStorageKeys(): string[] {
  const keys: string[] = [];
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index);
    if (key?.startsWith(LOCAL_STORAGE_PREFIX) === true) {
      keys.push(key);
    }
  }
  return keys;
}

type JsonValue = z.infer<ReturnType<typeof z.json>>;

/**
 * Parsea un valor guardado; si es un objeto, reemplaza las credenciales que
 * declara algún conector (`ConfigField.secret`) — el volcado va a soporte. Un
 * valor que no es JSON (por ejemplo un cursor opaco) queda como string.
 */
function readStoredValue(raw: string, secrets: Set<string>): JsonValue {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return raw;
  }
  const json = z.json().safeParse(parsed);
  if (!json.success) {
    return raw;
  }
  const value = json.data;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, field]) => [key, secrets.has(key) ? REDACTED : field]),
  );
}

/**
 * Volcado de los datos locales para soporte (`pos.export()`, Etapa 0 de #94).
 * Las filas de IndexedDB van tal cual — es un blob opaco para un humano,
 * nadie lo vuelve a leer desde la app, así que no se tipa tabla por tabla.
 */
export type LocalDataDump = {
  exportedAt: string;
  indexedDb: Record<string, unknown[]>;
  localStorage: Record<string, JsonValue>;
};

export async function exportLocalData(
  now: string = new Date().toISOString(),
): Promise<LocalDataDump> {
  const tables = await Promise.all(
    db.tables.map(async (table): Promise<[string, unknown[]]> => [
      table.name,
      await table.toArray(),
    ]),
  );
  const secrets = secretConfigKeys();
  const stored: Record<string, JsonValue> = {};
  for (const key of posLocalStorageKeys()) {
    const raw = localStorage.getItem(key);
    if (raw !== null) {
      stored[key] = readStoredValue(raw, secrets);
    }
  }
  return { exportedAt: now, indexedDb: Object.fromEntries(tables), localStorage: stored };
}

/**
 * `pos.reset()` (Etapa 0 de #94): deja la terminal como recién instalada —
 * todas las tablas de IndexedDB y todas las claves `offline-pos:*` de
 * `localStorage`, **incluida la config de `/CONFIG`** (a diferencia de
 * `/DEMO_RESET`, que a propósito la conserva): equivale a perder el id de
 * dispositivo, y sin él la terminal arranca de cero (decisión del epic).
 *
 * Toma el cerrojo de sync mientras borra, así ningún ciclo en curso vuelve a
 * escribir en el medio, y si sale bien pausa el sync (`syncPausedSignal`,
 * mismo mecanismo que `/CONFIG`): quien llama recarga la página a
 * continuación, y hasta entonces ningún ciclo tiene que arrancar sobre una
 * base vacía.
 */
export async function resetTerminal(): Promise<Result<void>> {
  const release = await acquireSyncLockWaiting(RESET_LOCK_WAIT_MS);
  if (release === undefined) {
    return err('connection/sync-busy', undefined);
  }
  try {
    await db.transaction('rw', db.tables, clearAllTables);
    for (const key of posLocalStorageKeys()) {
      localStorage.removeItem(key);
    }
    setSyncPaused(true);
    return ok(undefined);
  } catch (error) {
    return err('terminal/reset-failed', {
      message: error instanceof Error ? error.message : String(error),
    });
  } finally {
    release();
  }
}
