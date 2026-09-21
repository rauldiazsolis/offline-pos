import { z } from 'zod';
import type { ConnectorCommand } from '../connector-command.ts';
import { restConfigFields, restConfigSchema } from '../rest/config.ts';

/**
 * Minibackend de demo (Etapa 2c, #77): el mismo backend REST y la misma
 * implementación del conector (`createRestFetchConnector`), pero con su
 * propio `type` — así la disponibilidad de `/DEMO_RESET` depende solo del
 * tipo elegido, sin campos booleanos ni predicados. Un backend REST real
 * (`type: 'rest'`) nunca ofrece un comando que no puede funcionar.
 */
export const restDemoConfigSchema = restConfigSchema.extend({ type: z.literal('rest-demo') });

export type RestDemoConfig = z.infer<typeof restDemoConfigSchema>;

/** Mismos campos que REST. */
export const restDemoConfigFields = restConfigFields;

/** `POST /_demo/reset` solo existe en el minibackend de demo. */
export const restDemoCommands: ConnectorCommand[] = [
  {
    name: 'DEMO_RESET',
    description: 'Borrar todos los datos locales y reiniciar la demo',
    action: 'demo-reset',
  },
];
