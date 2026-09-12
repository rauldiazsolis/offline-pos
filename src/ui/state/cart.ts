import { signal } from '@preact/signals';
import type { Cart } from '../../domain/cart.ts';

/** Carrito en curso. Único estado de carrito: se muta reasignando `.value`. */
export const cartSignal = signal<Cart>({ lines: [] });

/**
 * Línea del carrito seleccionada visualmente (↑/↓ con la barra vacía, ver
 * "UX keyboard-first" en CLAUDE.md). `null` = nada seleccionado.
 */
export const cartSelectionIndexSignal = signal<number | null>(null);
