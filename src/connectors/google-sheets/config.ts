import { z } from 'zod';
import type { ConfigField } from '../config-field.ts';

/**
 * Config del conector de Google Sheets. `type` es el discriminador del
 * registro de conectores (`sync/connector-registry.ts`, Etapa 2).
 *
 * `webAppUrl` es la URL del Apps Script desplegado como Web App ("Execute
 * as: Me", "Who has access: Anyone") — no requiere login de Google.
 * `sharedSecret` es defensa en profundidad opcional, simétrica con el
 * `apiKey` del conector REST: se manda en el envelope y `bridge.gs` lo
 * compara contra la propiedad de script `SHARED_SECRET`.
 */
export const googleSheetsConfigSchema = z.object({
  type: z.literal('google-sheets'),
  webAppUrl: z.url(),
  sharedSecret: z.string().min(1).optional(),
});

export type GoogleSheetsConfig = z.infer<typeof googleSheetsConfigSchema>;

export const googleSheetsConfigFields: ConfigField<Exclude<keyof GoogleSheetsConfig, 'type'>>[] = [
  {
    key: 'webAppUrl',
    label: 'URL del Web App de Google Apps Script',
    optional: false,
    placeholder: 'ej. https://script.google.com/macros/s/…/exec',
  },
  {
    key: 'sharedSecret',
    label: 'Secreto compartido',
    optional: true,
    placeholder: 'Valor de SHARED_SECRET, si lo configuraste',
    secret: true,
  },
];
