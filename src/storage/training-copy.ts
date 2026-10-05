import Dexie from 'dexie';
import { PosDatabase } from './db.ts';
import { STORAGE_NAMESPACE } from './storage-namespace.ts';
import {
  TRAINING_KEY_PREFIX,
  TRAINING_MARK_KEY,
  operationalKeyFor,
  trainingDatabaseName,
} from './training-mode.ts';

/**
 * Lo que el entrenamiento (#177) trae de la base real al entrar: lo maestro. Ventas, cobranzas,
 * movimientos, caja, outbox y venta en curso arrancan vacíos (la caja, con saldo base 0).
 */
export const TRAINING_COPIED_TABLES = [
  'products',
  'stock',
  'customers',
  'customerAccounts',
  'customerBalances',
  'cashConcepts',
] as const;

/** Lo que el primer pull de entrenamiento necesita para ser un delta y no una foto completa. */
const COPIED_KEYS = ['sync-cursor:products', 'sync-cursor:customers', 'sync:last-full'];

/** Borra la base de entrenamiento (la de esta carpeta, salvo que se pase otra). */
export async function deleteTrainingDatabase(
  name: string = trainingDatabaseName(STORAGE_NAMESPACE),
): Promise<void> {
  await Dexie.delete(name);
}

/**
 * Borra una base de entrenamiento vieja y copia lo maestro de `source` a una nueva, en una sola
 * transacción: la base real solo se lee.
 */
export async function prepareTrainingDatabase(
  source: PosDatabase,
  targetName: string,
): Promise<void> {
  await deleteTrainingDatabase(targetName);
  const rows = await Promise.all(
    TRAINING_COPIED_TABLES.map((name) => source.table(name).toArray()),
  );
  const target = new PosDatabase(targetName);
  try {
    const tables = TRAINING_COPIED_TABLES.map((name) => target.table(name));
    await target.transaction('rw', tables, async () => {
      await Promise.all(tables.map((table, index) => table.bulkPut(rows[index] ?? [])));
    });
  } finally {
    target.close();
  }
}

/** Copia los cursores reales a las claves de entrenamiento (sin cursor, nada que copiar). */
export function copyOperationalStateToTraining(storage: Storage = localStorage): void {
  for (const name of COPIED_KEYS) {
    const value = storage.getItem(operationalKeyFor(name, false));
    if (value !== null) {
      storage.setItem(operationalKeyFor(name, true), value);
    }
  }
}

/**
 * Al salir: la marca y todas las claves operativas del entrenamiento. La marca (`…:training`) no
 * entra en el prefijo (`…:training:`), así que se borra aparte, a propósito.
 */
export function clearTrainingKeys(storage: Storage = localStorage): void {
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (key?.startsWith(TRAINING_KEY_PREFIX) === true) {
      keys.push(key);
    }
  }
  for (const key of keys) {
    storage.removeItem(key);
  }
  storage.removeItem(TRAINING_MARK_KEY);
}
