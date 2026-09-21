/**
 * Acciones que un conector puede pedirle a la barra de comandos (Etapa 2c,
 * #77). Es el contrato entre `connectors/` y la UI: cada tipo de conector
 * declara sus comandos con un id de acción, y `ui/keyboard/connector-actions.ts`
 * tiene un mapa exhaustivo `acción → comportamiento` — si un conector declara
 * una acción nueva y la UI no la maneja, no compila. Así `connectors/` nunca
 * importa `ui/`.
 */
export type ConnectorActionId = 'demo-reset';

/** Un comando de la barra (`/NOMBRE`) que solo existe con el conector que lo declara. */
export type ConnectorCommand = {
  name: string;
  description: string;
  action: ConnectorActionId;
};
