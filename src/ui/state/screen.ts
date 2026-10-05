import { signal } from '@preact/signals';

/**
 * Qué sub-pantalla está activa dentro del flujo de venta. `/COBRAR` (o
 * Ctrl+Enter), `/ANULAR`, `/CONFIG` y `/IMPRESORA` cambian este signal; las pantallas
 * correspondientes (ver ui/screens/) lo leen para decidir qué mostrar.
 */
export type ActiveScreen =
  | 'sale'
  | 'checkout'
  | 'collection'
  | 'receipt'
  | 'void'
  | 'config'
  | 'cash'
  | 'cash-summary'
  | 'demo-reset'
  | 'diagnostico'
  | 'printer';

export const activeScreenSignal = signal<ActiveScreen>('sale');
