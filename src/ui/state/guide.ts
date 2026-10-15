import { computed, signal } from '@preact/signals';
import { calculateTotals } from '../../domain/totals.ts';
import type { GuideLesson, GuideSnapshot } from '../keyboard/guide-model.ts';
import { cartSelectionIndexSignal, cartSignal } from './cart.ts';
import { checkoutBuffersSignal } from './checkout.ts';
import { commandBarBufferSignal } from './command-bar.ts';
import { operationCountsSignal } from './operations.ts';
import { activeScreenSignal } from './screen.ts';

/**
 * La guía de entrenamiento (#226), `null` = cerrada. `waiting`: la lección espera volver a la venta
 * para empezar; `step`: en un paso, con las ventas que había al empezar la lección; `lesson-done`:
 * terminó una y espera "Siguiente lección"; `finished`: terminó la última; `unavailable`: no se
 * puede (sin productos con qué practicar).
 */
export type GuideState =
  | { phase: 'waiting'; lesson: number }
  | { phase: 'step'; lesson: number; step: number; salesAtStart: number }
  | { phase: 'lesson-done'; lesson: number }
  | { phase: 'finished' }
  | { phase: 'unavailable'; reason: string };

export const guideSignal = signal<GuideState | null>(null);

/** Las lecciones armadas con los productos de la terminal al abrir la guía. */
export const guideLessonsSignal = signal<GuideLesson[]>([]);

/** "Hacelo" en curso: cualquier tecla o click lo frena. */
export const guideRunningSignal = signal(false);

/** Lo que mira la guía para dar un paso por cumplido (`GuideSnapshot`). */
export const guideSnapshotSignal = computed<GuideSnapshot>(() => {
  const state = guideSignal.value;
  const sales = operationCountsSignal.value.sale;
  const cart = cartSignal.value;
  return {
    screen: activeScreenSignal.value,
    cart,
    total: calculateTotals(cart).total,
    buffer: commandBarBufferSignal.value,
    selectedLine: cartSelectionIndexSignal.value,
    checkout: checkoutBuffersSignal.value,
    salesClosed: state?.phase === 'step' ? sales - state.salesAtStart : 0,
  };
});
