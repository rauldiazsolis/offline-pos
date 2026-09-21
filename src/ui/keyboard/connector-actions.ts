import type { ConnectorActionId } from '../../connectors/connector-command.ts';
import { enterDemoResetScreen } from './demo-reset-controller.ts';

/**
 * Qué hace la UI con cada acción que un conector puede declarar en sus
 * comandos (Etapa 2c, #77). El conector declara *qué* (`ConnectorActionId`);
 * el cómo vive acá. `Record` exhaustivo: sumar una acción al tipo sin
 * implementarla no compila.
 */
export const CONNECTOR_ACTIONS: Record<ConnectorActionId, () => void> = {
  'demo-reset': enterDemoResetScreen,
};
