import { afterEach, describe, expect, it } from 'vitest';
import { setTrainingModeForTests } from '../../storage/training-mode.ts';
import { setActiveConnectorType, setDemoSession } from '../state/sync.ts';
import { RESERVED_COMMAND_NAMES, availableCommands, commandAvailability } from './commands.ts';

const startedAt = '2026-10-04T12:00:00.000Z';
const blocked = { enabled: false, reason: 'en entrenamiento; salí con /ENTRENAMIENTO' };

afterEach(() => {
  setTrainingModeForTests(null);
  setDemoSession(null);
  setActiveConnectorType(null);
});

function trainingDescription(): string | undefined {
  return availableCommands().find((command) => command.name === 'ENTRENAMIENTO')?.description;
}

describe('/ENTRENAMIENTO (#177)', () => {
  it('apagado, ofrece practicar; prendido, salir', () => {
    expect(trainingDescription()).toBe('Practicar sin enviar nada al backend');
    setTrainingModeForTests({ startedAt });
    expect(trainingDescription()).toBe('Salir del entrenamiento');
  });

  it('es un nombre reservado: el portal no puede llamarse así', () => {
    expect(RESERVED_COMMAND_NAMES.has('ENTRENAMIENTO')).toBe(true);
  });
});

describe('comandos cortados en entrenamiento (#177)', () => {
  it('/CONFIG queda deshabilitado con el motivo', () => {
    expect(commandAvailability('CONFIG')).toEqual({ enabled: true });
    setTrainingModeForTests({ startedAt });
    expect(commandAvailability('CONFIG')).toEqual(blocked);
  });

  it('/ALTA y /DEMO_NUEVA, con la terminal en demo', () => {
    setDemoSession({
      template: 'kiosco',
      onboarding: { url: 'https://b.x/alta', label: 'Crear' },
      startedAt,
    });
    expect(commandAvailability('ALTA')).toEqual({ enabled: true });
    setTrainingModeForTests({ startedAt });
    expect(commandAvailability('ALTA')).toEqual(blocked);
    expect(commandAvailability('DEMO_NUEVA')).toEqual(blocked);
  });

  it('/DEMO_RESET, con el conector rest-demo', () => {
    setActiveConnectorType('rest-demo');
    expect(commandAvailability('DEMO_RESET')).toEqual({ enabled: true });
    setTrainingModeForTests({ startedAt });
    expect(commandAvailability('DEMO_RESET')).toEqual(blocked);
  });

  it('el resto sigue como siempre', () => {
    setTrainingModeForTests({ startedAt });
    expect(commandAvailability('RESUMEN')).toEqual({ enabled: true });
    expect(commandAvailability('SINCRONIZAR')).toEqual({ enabled: true });
    expect(commandAvailability('ENTRENAMIENTO')).toEqual({ enabled: true });
  });
});
