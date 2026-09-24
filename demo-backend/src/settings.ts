import type { DatabaseSync } from 'node:sqlite';

/** Versión del Connector API que habla este minibackend (4.0.0, #99). */
export const CONTRACT_VERSION = '4.0.0';
/** Lo que informa con "Simular contrato 3.0.0" prendido en el panel. */
export const SIMULATED_OLD_CONTRACT = '3.0.0';

export type MaintenanceSetting = { enabled: boolean; message: string };

/** Ajustes del panel `/_demo` para probar el estado del backend en el POS (4.0.0, #99). */
export type DemoSettings = { maintenance: MaintenanceSetting; simulateContract3: boolean };

function readSetting(db: DatabaseSync, key: string): string | undefined {
  const row = db.prepare('SELECT value FROM demo_settings WHERE key = ?').get(key) as
    { value: string } | undefined;
  return row?.value;
}

function writeSetting(db: DatabaseSync, key: string, value: string): void {
  db.prepare(
    'INSERT INTO demo_settings (key, value) VALUES (?, ?) ' +
      'ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, value);
}

export function getDemoSettings(db: DatabaseSync): DemoSettings {
  const maintenance = readSetting(db, 'maintenance');
  return {
    maintenance:
      maintenance === undefined
        ? { enabled: false, message: '' }
        : (JSON.parse(maintenance) as MaintenanceSetting),
    simulateContract3: readSetting(db, 'simulateContract3') === 'true',
  };
}

export function setDemoSettings(db: DatabaseSync, partial: Partial<DemoSettings>): void {
  if (partial.maintenance !== undefined) {
    writeSetting(db, 'maintenance', JSON.stringify(partial.maintenance));
  }
  if (partial.simulateContract3 !== undefined) {
    writeSetting(db, 'simulateContract3', String(partial.simulateContract3));
  }
}

/** La versión que informa `/info` y contra la que se valida el header de cada request. */
export function backendContractVersion(db: DatabaseSync): string {
  return getDemoSettings(db).simulateContract3 ? SIMULATED_OLD_CONTRACT : CONTRACT_VERSION;
}

export function contractMajor(version: string): string {
  return version.split('.')[0] ?? version;
}
