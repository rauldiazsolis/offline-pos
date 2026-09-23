import { afterEach, describe, expect, it } from 'vitest';
import { activeScreenSignal } from '../state/screen.ts';
import { enterDiagnosticoScreen, exitDiagnosticoScreen } from './diagnostico-controller.ts';

afterEach(() => {
  activeScreenSignal.value = 'sale';
});

describe('enterDiagnosticoScreen / exitDiagnosticoScreen', () => {
  it('entra y sale de la pantalla sin tocar nada más', () => {
    enterDiagnosticoScreen();
    expect(activeScreenSignal.value).toBe('diagnostico');

    exitDiagnosticoScreen();
    expect(activeScreenSignal.value).toBe('sale');
  });
});
