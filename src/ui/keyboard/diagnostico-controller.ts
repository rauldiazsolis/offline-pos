import { activeScreenSignal } from '../state/screen.ts';

/**
 * `/DIAGNOSTICO`: pantalla de solo lectura sobre el estado de sincronización
 * (ver `ui/screens/diagnostico-screen.tsx`) — todo lo que muestra sale de
 * signals que ya existen, así que a diferencia de `/RESUMEN`/`/CAJA` no hace
 * falta cargar nada al entrar.
 */
export function enterDiagnosticoScreen(): void {
  activeScreenSignal.value = 'diagnostico';
}

export function exitDiagnosticoScreen(): void {
  activeScreenSignal.value = 'sale';
}
