import { signal } from '@preact/signals';
import type { ComponentChildren } from 'preact';
import type { KeypadOptions } from './keypad-model.ts';
import type { TextKeyboardOptions } from './text-keyboard-model.ts';

export type QuickValue = { label: string; text: string };

/** Un pedido de número: cantidades, importes, porcentajes. */
export type NumberEntryRequest = {
  kind: 'number';
  title: string;
  /** Texto precargado (con el decimal del locale); el primer dígito lo reemplaza. */
  initial?: string;
  /** Delante del número ("$") o detrás ("kg", "%", "unidades"). */
  prefix?: string;
  unit?: string;
  options: KeypadOptions;
  /** Línea de ayuda debajo del número, en vivo. */
  hint?: (value: number | undefined) => string;
  quick?: QuickValue[];
  okLabel?: string;
  /** Si devuelve un mensaje, se muestra y la hoja no se cierra. */
  validate?: (value: number | undefined) => string | null;
  onDone: (value: number | undefined) => void;
  /** Una acción más al pie (por ejemplo "Quitar" en una línea del ticket). */
  extra?: { label: string; danger?: boolean; run: () => void };
};

/** Un pedido de texto: búsquedas, nombres, campos de configuración. */
export type TextEntryRequest = {
  kind: 'text';
  title: string;
  initial?: string;
  placeholder: string;
  options: TextKeyboardOptions;
  /** Se muestra con puntos (claves). */
  secret?: boolean;
  /** Resultados en vivo entre el texto y el teclado (búsquedas). */
  results?: (text: string) => ComponentChildren;
  okLabel?: string;
  validate?: (text: string) => string | null;
  /** Sin `onDone`, el teclado no tiene "Listo": se elige un resultado. */
  onDone?: (text: string) => void;
};

export type EntryRequest = NumberEntryRequest | TextEntryRequest;

/**
 * La entrada abierta, delante de todo. Una sola a la vez: abrir otra la reemplaza. `seq` distingue
 * una de otra aunque pidan lo mismo, así el teclado arranca de cero.
 */
export const entrySignal = signal<{ seq: number; request: EntryRequest } | null>(null);

let seq = 0;

export function openNumberEntry(request: Omit<NumberEntryRequest, 'kind'>): void {
  seq += 1;
  entrySignal.value = { seq, request: { kind: 'number', ...request } };
}

export function openTextEntry(request: Omit<TextEntryRequest, 'kind'>): void {
  seq += 1;
  entrySignal.value = { seq, request: { kind: 'text', ...request } };
}

export function closeEntry(): void {
  entrySignal.value = null;
}
