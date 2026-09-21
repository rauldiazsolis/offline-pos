import { z } from 'zod';
import type { ConfigField } from '../config-field.ts';

/**
 * Config del conector REST genérico (`docs/connector-api.openapi.yaml`).
 * `type` es el discriminador del registro de conectores
 * (`sync/connector-registry.ts`).
 */
export const restConfigSchema = z.object({
  type: z.literal('rest'),
  baseUrl: z.url(),
  apiKey: z.string().optional(),
});

export type RestConfig = z.infer<typeof restConfigSchema>;

/**
 * Lo que `createRestFetchConnector` necesita para hablar con el backend — el
 * discriminador `type` es del registro, el conector no lo usa.
 */
export type RestConnectionConfig = Omit<RestConfig, 'type'>;

export const restConfigFields: ConfigField<keyof RestConnectionConfig>[] = [
  {
    key: 'baseUrl',
    label: 'URL del sistema externo',
    optional: false,
    placeholder: 'https://api.miempresa.com',
  },
  {
    key: 'apiKey',
    label: 'API key',
    optional: true,
    placeholder: 'Token de acceso, si el backend lo exige',
  },
];
