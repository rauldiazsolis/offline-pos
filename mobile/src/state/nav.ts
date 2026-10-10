import { signal } from '@preact/signals';

/** "Más" no es una pantalla de escritorio: es el menú del mobile con el resto de los comandos. */
export const moreOpenSignal = signal(false);

/** El ticket (la venta en curso) abierto como hoja. */
export const cartOpenSignal = signal(false);
