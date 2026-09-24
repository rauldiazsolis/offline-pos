import { signal } from '@preact/signals';
import { db } from '../../storage/db.ts';

/**
 * Toda la tabla `stock` en memoria, para las advertencias de la venta (#99):
 * así la búsqueda puede mostrar "Stock: N" sin una lectura async por fila. Es
 * una tabla chica (una fila por producto). Se recarga al arrancar, tras cada
 * pull aplicado, al aplicar una conexión o un reset de demo, y tras cerrar o
 * anular una venta.
 */
export const stockSnapshotSignal = signal<ReadonlyMap<string, number>>(new Map());

export async function refreshStockSnapshot(): Promise<void> {
  const rows = await db.stock.toArray();
  stockSnapshotSignal.value = new Map(rows.map((row) => [row.productId, row.quantity]));
}
