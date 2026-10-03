import { signal } from '@preact/signals';
import type { DemoEntry } from '../../sync/demo-link.ts';
import type { DemoLoss } from '../keyboard/demo-confirm-model.ts';

/**
 * La pantalla "Abrir una demo" (#176): `null` = cerrada. `checking` mientras manda lo pendiente y
 * cuenta; `confirming` esperando la decisión; `starting` pidiendo la demo, probándola y aplicándola.
 * `App` la muestra delante de todo, también sin conexión activa.
 */
export type DemoConfirmState =
  | { phase: 'checking'; entry: DemoEntry }
  | { phase: 'confirming' | 'starting'; entry: DemoEntry; loss: DemoLoss };

export const demoConfirmSignal = signal<DemoConfirmState | null>(null);
