import { z } from 'zod';
import type { ConfigField } from '../connectors/config-field.ts';
import type { ConnectorCommand } from '../connectors/connector-command.ts';
import {
  googleSheetsConfigFields,
  googleSheetsConfigSchema,
} from '../connectors/google-sheets/config.ts';
import { createGoogleSheetsConnector } from '../connectors/google-sheets/google-sheets-connector.ts';
import { restConfigFields, restConfigSchema } from '../connectors/rest/config.ts';
import { createRestFetchConnector } from '../connectors/rest/rest-fetch-connector.ts';
import {
  restDemoCommands,
  restDemoConfigFields,
  restDemoConfigSchema,
} from '../connectors/rest-demo/config.ts';
import type { Connector } from './connector.ts';

/**
 * Registro cerrado de conectores integrados (#66, Etapa 2). "Plugin" acá
 * significa un conjunto fijo de implementaciones que el POS trae compiladas,
 * seleccionable por `/CONFIG` — no carga de código de terceros en runtime
 * (descartada: ejecución de código arbitrario dentro de una app que maneja
 * ventas y pagos). Un conector nuevo es un PR al repo: su carpeta en
 * `connectors/<tipo>/` con su schema de config, su lista de campos y su
 * factory, más una entrada en cada lista de este archivo.
 *
 * Único punto de la app que decide qué implementación de `Connector` usar:
 * `sync/engine.ts::runSyncCycle` y `sync/account-hold.ts::requestAccountHoldNow`
 * llaman a `createConnector`, nunca instancian un conector directo.
 */
export const connectorConfigSchema = z.discriminatedUnion('type', [
  restConfigSchema,
  restDemoConfigSchema,
  googleSheetsConfigSchema,
]);

export type ConnectorConfig = z.infer<typeof connectorConfigSchema>;
export type ConnectorType = ConnectorConfig['type'];

/**
 * Cómo entrega el catálogo este conector: `delta` (`since` devuelve solo los cambios: hace falta
 * una foto completa de vez en cuando para enterarse de las bajas) o `snapshot` (no hay delta, todo
 * pull ya es completo y reconcilia siempre).
 */
export type PullMode = 'delta' | 'snapshot';

export type ConnectorTypeInfo = {
  type: ConnectorType;
  label: string;
  pullMode: PullMode;
  fields: ConfigField[];
  /** Comandos de la barra que solo existen con este conector (Etapa 2c, #77). */
  commands: ConnectorCommand[];
  /** Una línea en el paso "Tipo de conexión" del wizard (Etapa 2 de #94, #97). */
  description: string;
  /** Pasos numerados en "Datos del conector". */
  setupHelp: string[];
};

/** Orden = orden del selector de `/CONFIG`. */
export const CONNECTOR_TYPES: ConnectorTypeInfo[] = [
  {
    type: 'rest',
    label: 'REST genérico',
    pullMode: 'delta',
    fields: restConfigFields,
    commands: [],
    description: 'Cualquier backend que implemente el contrato del Connector API v3.',
    setupHelp: [
      'El backend tiene que implementar el contrato v3 (docs/connector-api.openapi.yaml).',
      'Cargá la URL base del backend, por ejemplo https://api.mi-negocio.com.',
      'Si el backend pide una API key, cargala; si no, dejala vacía.',
    ],
  },
  {
    type: 'rest-demo',
    label: 'REST (minibackend de demo)',
    pullMode: 'delta',
    fields: restDemoConfigFields,
    commands: restDemoCommands,
    description:
      'El minibackend de demostración que viene con el POS, para probar sin un backend real.',
    setupHelp: [
      'Levantá el minibackend: pnpm dev (levanta la app y el minibackend) o solo el minibackend con pnpm --filter demo-backend start.',
      'La URL es http://localhost:4000.',
      'El panel del minibackend está en http://localhost:4000/_demo.',
    ],
  },
  {
    type: 'google-sheets',
    label: 'Google Sheets',
    pullMode: 'snapshot',
    fields: googleSheetsConfigFields,
    commands: [],
    description: 'Una planilla de Google Sheets, a través de un puente de Apps Script.',
    setupHelp: [
      'En la planilla: Extensiones → Apps Script. Pegá bridge.gs y columnas.gs (están en src/connectors/google-sheets/).',
      'Implementar → Nueva implementación → Aplicación web. Ejecutar como: yo. Quién tiene acceso: cualquier persona.',
      'Copiá la URL de la aplicación web: termina en /exec.',
      'Si configuraste SHARED_SECRET en las propiedades del script, cargá el mismo valor como secreto compartido.',
      'Detalle completo en el README del conector (src/connectors/google-sheets/README.md).',
    ],
  },
];

/** La entrada del registro de un tipo; un tipo fuera del registro es un bug (invariante). */
export function connectorInfo(type: ConnectorType): ConnectorTypeInfo {
  const info = CONNECTOR_TYPES.find((entry) => entry.type === type);
  if (info === undefined) {
    throw new Error(`Tipo de conector desconocido: ${type}`);
  }
  return info;
}

export function connectorLabel(type: ConnectorType): string {
  return CONNECTOR_TYPES.find((info) => info.type === type)?.label ?? type;
}

export function connectorPullMode(type: ConnectorType): PullMode {
  return CONNECTOR_TYPES.find((info) => info.type === type)?.pullMode ?? 'delta';
}

export function connectorFields(type: ConnectorType): ConfigField[] {
  return CONNECTOR_TYPES.find((info) => info.type === type)?.fields ?? [];
}

/** Comandos que declara un tipo de conector; `null` (todavía sin conector) no declara ninguno. */
/**
 * Claves de config que algún conector marca como credencial
 * (`ConfigField.secret`) — de todos los tipos, no solo del activo, así una
 * config con un `type` inesperado igual sale redactada en `pos.export()`.
 */
export function secretConfigKeys(): Set<string> {
  return new Set(
    CONNECTOR_TYPES.flatMap((info) =>
      info.fields.filter((field) => field.secret === true).map((field) => field.key),
    ),
  );
}

export function connectorCommands(type: ConnectorType | null): ConnectorCommand[] {
  if (type === null) {
    return [];
  }
  return CONNECTOR_TYPES.find((info) => info.type === type)?.commands ?? [];
}

/**
 * `config` es `ConnectorConfig`, no `SyncConfig`: `SyncConfig` (con `locale`)
 * le es asignable, y así este módulo no importa de `sync/config.ts` (que sí
 * importa de acá) — evita un ciclo de imports.
 */
export function createConnector(config: ConnectorConfig): Connector {
  switch (config.type) {
    case 'rest':
    case 'rest-demo':
      return createRestFetchConnector(config);
    case 'google-sheets':
      return createGoogleSheetsConnector(config);
    default: {
      const exhaustiveCheck: never = config;
      return exhaustiveCheck;
    }
  }
}

/**
 * Los valores de los campos de una config, como strings — lo que el
 * formulario de `/CONFIG` necesita para precargarse (un opcional ausente es
 * `''`). Las claves tienen que coincidir con `connectorFields(type)`; un test
 * lo verifica.
 */
export function toFieldValues(config: ConnectorConfig): Record<string, string> {
  switch (config.type) {
    case 'rest':
    case 'rest-demo':
      return { baseUrl: config.baseUrl, apiKey: config.apiKey ?? '' };
    case 'google-sheets':
      return { webAppUrl: config.webAppUrl, sharedSecret: config.sharedSecret ?? '' };
    default: {
      const exhaustiveCheck: never = config;
      return exhaustiveCheck;
    }
  }
}
