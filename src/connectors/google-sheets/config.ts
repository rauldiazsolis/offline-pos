import { z } from 'zod';

/**
 * Config del conector de Google Sheets. `type` es el discriminador que va a
 * usar el registro de conectores (Etapa 2, `sync/connector-registry.ts`);
 * hoy este schema es local a la carpeta y no está conectado a `SyncConfig`.
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
