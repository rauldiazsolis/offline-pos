import { z } from 'zod';
import type { ConfigField } from '../connectors/config-field.ts';
import {
  googleSheetsConfigFields,
  googleSheetsConfigSchema,
} from '../connectors/google-sheets/config.ts';
import { createGoogleSheetsConnector } from '../connectors/google-sheets/google-sheets-connector.ts';
import { restConfigFields, restConfigSchema } from '../connectors/rest/config.ts';
import { createRestFetchConnector } from '../connectors/rest/rest-fetch-connector.ts';
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
  googleSheetsConfigSchema,
]);

export type ConnectorConfig = z.infer<typeof connectorConfigSchema>;
export type ConnectorType = ConnectorConfig['type'];

export type ConnectorTypeInfo = {
  type: ConnectorType;
  label: string;
  fields: ConfigField[];
};

/** Orden = orden del selector de `/CONFIG`. */
export const CONNECTOR_TYPES: ConnectorTypeInfo[] = [
  { type: 'rest', label: 'REST genérico', fields: restConfigFields },
  { type: 'google-sheets', label: 'Google Sheets', fields: googleSheetsConfigFields },
];

export function connectorLabel(type: ConnectorType): string {
  return CONNECTOR_TYPES.find((info) => info.type === type)?.label ?? type;
}

export function connectorFields(type: ConnectorType): ConfigField[] {
  return CONNECTOR_TYPES.find((info) => info.type === type)?.fields ?? [];
}

/**
 * `config` es `ConnectorConfig`, no `SyncConfig`: `SyncConfig` (con `locale`)
 * le es asignable, y así este módulo no importa de `sync/config.ts` (que sí
 * importa de acá) — evita un ciclo de imports.
 */
export function createConnector(config: ConnectorConfig): Connector {
  switch (config.type) {
    case 'rest':
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
      return { baseUrl: config.baseUrl, apiKey: config.apiKey ?? '' };
    case 'google-sheets':
      return { webAppUrl: config.webAppUrl, sharedSecret: config.sharedSecret ?? '' };
    default: {
      const exhaustiveCheck: never = config;
      return exhaustiveCheck;
    }
  }
}
