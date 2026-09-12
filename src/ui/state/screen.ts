import { signal } from '@preact/signals';

/**
 * Qué sub-pantalla está activa dentro del flujo de venta. `/COBRAR` (o
 * Ctrl+Enter) y `/ANULAR` cambian este signal; las pantallas correspondientes
 * (ver ui/screens/) lo leen para decidir qué mostrar.
 */
export type ActiveScreen = 'sale' | 'checkout' | 'receipt' | 'void';

export const activeScreenSignal = signal<ActiveScreen>('sale');
