import { signal } from '@preact/signals';

/**
 * Qué sub-pantalla está activa dentro del flujo de venta. `/COBRAR` (o
 * Ctrl+Enter), `/ANULAR` y `/CONFIG` cambian este signal; las pantallas
 * correspondientes (ver ui/screens/) lo leen para decidir qué mostrar.
 */
export type ActiveScreen =
  | 'sale'
  | 'checkout'
  | 'receipt'
  | 'void'
  | 'config'
  | 'cash'
  | 'cash-summary'
  | 'demo-reset';

export const activeScreenSignal = signal<ActiveScreen>('sale');
