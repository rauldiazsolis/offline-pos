import { computed, signal } from '@preact/signals';

/** Lo que registra la terminal desde la venta: una venta, una cobranza, la caja o una anulación. */
export type OperationKind = 'sale' | 'collection' | 'cash' | 'void';

/**
 * Cuántas operaciones de cada tipo se registraron desde que arrancó la página (#226). La guía de
 * entrenamiento ve acá que se cerró una venta, y la invitación se apaga con la primera.
 */
export const operationCountsSignal = signal<Record<OperationKind, number>>({
  sale: 0,
  collection: 0,
  cash: 0,
  void: 0,
});

/** Lo llaman los controllers después de registrar una operación (nunca si falló). */
export function noteOperation(kind: OperationKind): void {
  operationCountsSignal.value = {
    ...operationCountsSignal.value,
    [kind]: operationCountsSignal.value[kind] + 1,
  };
}

/**
 * Si la base local tenía movimientos al arrancar (ventas, cobranzas, movimientos de caja o
 * arqueos), según `bootstrap`. `null` mientras no se contó: la invitación no aparece de más.
 */
export const hadLocalMovementsSignal = signal<boolean | null>(null);

/** La caja no tiene ningún movimiento: ni de antes del arranque ni de esta página. */
export const noMovementsSignal = computed(() => {
  const counts = operationCountsSignal.value;
  return (
    hadLocalMovementsSignal.value === false &&
    counts.sale + counts.collection + counts.cash + counts.void === 0
  );
});

/** Después de borrar lo local (una demo nueva, #128 y #176): la caja vuelve a estar vacía. */
export function resetOperations(): void {
  operationCountsSignal.value = { sale: 0, collection: 0, cash: 0, void: 0 };
  hadLocalMovementsSignal.value = false;
}
