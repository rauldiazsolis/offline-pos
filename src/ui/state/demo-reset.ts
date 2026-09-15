import { signal } from '@preact/signals';

/** Estado de la pantalla `/DEMO_RESET` (Ciclo 8) — mismo criterio que `void-sale.ts`. */
export const demoResetErrorSignal = signal<string | null>(null);
/** true mientras el reset (borrado + re-siembra) está en vuelo — evita un doble Enter. */
export const demoResetInProgressSignal = signal(false);
