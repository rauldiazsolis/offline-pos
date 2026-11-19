import type { DatabaseSync } from 'node:sqlite';

/**
 * Versión del Connector API que habla este minibackend (4.4.0 desde #128: `POST /demo-sessions`,
 * capacidades y `notices`; 4.3.0, #125: anulación de una cobranza con `voidsPaymentId`; 4.2.0, #101:
 * recibo de cobranza y saldo de cualquier cliente; 4.1.0, #120; 4.0.0, #99). 4.5.0 desde #193:
 * `company` en `GET /info`. 4.6.0 desde #178: capacidad `portal` y el 503 de mantenimiento. 4.7.0
 * desde #230: capacidades `device-claim` (`POST /claim` y el `409 device-revoked`) y `cash-snapshot`
 * (`GET /snapshot`).
 */
export const CONTRACT_VERSION = '4.7.0';
/**
 * Lo opcional del contrato que implementa siempre (4.4.0, #128; `portal` desde 4.6.0, #178). Las de
 * 4.7.0 (#230) se pueden apagar desde el panel: ver `backendCapabilities`.
 */
export const CAPABILITIES = ['demo-sessions', 'customer-payment-void', 'portal'];
export const CAPABILITY_DEVICE_CLAIM = 'device-claim';
export const CAPABILITY_CASH_SNAPSHOT = 'cash-snapshot';
/** El comando y el botón que el POS inyecta con la capacidad `portal` (4.6.0, #178). */
export const PORTAL = { command: 'PANEL', label: 'Panel del backend' };
/** Lo que informa con "Simular contrato 3.0.0" prendido en el panel. */
export const SIMULATED_OLD_CONTRACT = '3.0.0';

export type MaintenanceSetting = { enabled: boolean; message: string };

/** Aviso de prueba que el pull devuelve en `notices` (4.4.0, #128). */
export type NoticeSetting = {
  enabled: boolean;
  severity: 'info' | 'warning' | 'critical';
  message: string;
};

/** Cómo responde `POST /demo-sessions` (4.6.0, #173): para ver los mensajes del POS sin un límite real. */
export type DemoSessionsMode = 'normal' | 'rate-limited' | 'capacity';
const DEMO_SESSIONS_MODES: readonly DemoSessionsMode[] = ['normal', 'rate-limited', 'capacity'];

/** Ajustes del panel `/_demo` para probar el estado del backend en el POS (4.0.0, #99; aviso, #128). */
export type DemoSettings = {
  maintenance: MaintenanceSetting;
  simulateContract3: boolean;
  notice: NoticeSetting;
  demoSessions: DemoSessionsMode;
  /**
   * `device-claim` prendido (4.7.0, #230, por omisión sí): apagado, `/info` no lo declara,
   * `POST /claim` da 404 y no se valida la exclusividad. Para probar el POS contra un backend viejo.
   */
  deviceClaim: boolean;
  /** `cash-snapshot` prendido (4.7.0, #230, por omisión sí): apagado, `GET /snapshot` da 404. */
  cashSnapshot: boolean;
};

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
  const notice = readSetting(db, 'notice');
  const demoSessions = readSetting(db, 'demoSessions');
  return {
    maintenance:
      maintenance === undefined
        ? { enabled: false, message: '' }
        : (JSON.parse(maintenance) as MaintenanceSetting),
    simulateContract3: readSetting(db, 'simulateContract3') === 'true',
    notice:
      notice === undefined
        ? { enabled: false, severity: 'warning', message: '' }
        : (JSON.parse(notice) as NoticeSetting),
    demoSessions: DEMO_SESSIONS_MODES.find((mode) => mode === demoSessions) ?? 'normal',
    deviceClaim: readSetting(db, 'deviceClaim') !== 'false',
    cashSnapshot: readSetting(db, 'cashSnapshot') !== 'false',
  };
}

export function setDemoSettings(db: DatabaseSync, partial: Partial<DemoSettings>): void {
  if (partial.maintenance !== undefined) {
    writeSetting(db, 'maintenance', JSON.stringify(partial.maintenance));
  }
  if (partial.simulateContract3 !== undefined) {
    writeSetting(db, 'simulateContract3', String(partial.simulateContract3));
  }
  if (partial.notice !== undefined) {
    writeSetting(db, 'notice', JSON.stringify(partial.notice));
  }
  if (partial.demoSessions !== undefined) {
    writeSetting(db, 'demoSessions', partial.demoSessions);
  }
  if (partial.deviceClaim !== undefined) {
    writeSetting(db, 'deviceClaim', String(partial.deviceClaim));
  }
  if (partial.cashSnapshot !== undefined) {
    writeSetting(db, 'cashSnapshot', String(partial.cashSnapshot));
  }
}

/** Las capacidades que declara `GET /info`: las fijas más las de 4.7.0 que estén prendidas (#230). */
export function backendCapabilities(db: DatabaseSync): string[] {
  const { deviceClaim, cashSnapshot } = getDemoSettings(db);
  return [
    ...CAPABILITIES,
    ...(deviceClaim ? [CAPABILITY_DEVICE_CLAIM] : []),
    ...(cashSnapshot ? [CAPABILITY_CASH_SNAPSHOT] : []),
  ];
}

/**
 * Plantilla de la demo en curso (#193): `/info` arma con ella el nombre de la demo. Vive en
 * `demo_settings`, así que `resetToSeed` la borra (la vuelve a escribir `POST /demo-sessions`).
 */
export function getDemoTemplate(db: DatabaseSync): string | undefined {
  return readSetting(db, 'demoTemplate');
}

export function setDemoTemplate(db: DatabaseSync, template: string): void {
  writeSetting(db, 'demoTemplate', template);
}

/**
 * Nombre del comercio cargado en el alta (#193); `undefined` = no se cargó. También en
 * `demo_settings`: una demo nueva lo borra, porque la base es de un solo comercio.
 */
export function getCompanyName(db: DatabaseSync): string | undefined {
  return readSetting(db, 'companyName');
}

/** Un nombre vacío borra la empresa: el comercio queda sin `company` en `/info`. */
export function setCompanyName(db: DatabaseSync, name: string): void {
  const trimmed = name.trim();
  if (trimmed === '') {
    db.prepare('DELETE FROM demo_settings WHERE key = ?').run('companyName');
  } else {
    writeSetting(db, 'companyName', trimmed);
  }
}

/** La versión que informa `/info` y contra la que se valida el header de cada request. */
export function backendContractVersion(db: DatabaseSync): string {
  return getDemoSettings(db).simulateContract3 ? SIMULATED_OLD_CONTRACT : CONTRACT_VERSION;
}

export function contractMajor(version: string): string {
  return version.split('.')[0] ?? version;
}
