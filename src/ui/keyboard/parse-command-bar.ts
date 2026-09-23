import { parseAmount } from '../parse-amount.ts';

/**
 * Resultado de interpretar el buffer de la barra de comandos, según el
 * orden de prioridad fijo de §7 del doc de diseño (ver también "UX
 * keyboard-first" en CLAUDE.md). Función pura, sin DOM: recibe el buffer
 * completo tal cual está en el input en este instante — no hay estado
 * parcial que arrastrar entre llamadas.
 */
export type ParsedCommand =
  | { kind: 'typing' } // buffer vacío, o a mitad de escribir algo que todavía no es accionable ni un error
  | { kind: 'command'; name: string; args: string[] } // '/', name === '' cuando el buffer es solo '/'
  | { kind: 'customer'; query: string } // '@', identificación de cliente (RF-16) — sin ambigüedad que resolver con finalizing
  | { kind: 'global-adjustment'; percentage: number } // '<signo><número>%', recargo/descuento sobre el total (RF-03)
  | { kind: 'freeform-line'; description: string; amount: number; qty: number }
  | { kind: 'pending-numeric' } // solo dígitos, ambiguo cantidad-vs-código: no dispara búsqueda aún
  | { kind: 'barcode'; code: string; qty: number }
  | { kind: 'search'; query: string; qty: number }
  | { kind: 'parse-error'; message: string };

export function parseCommandBar(buffer: string, options: { finalizing: boolean }): ParsedCommand {
  const { finalizing } = options;

  if (buffer === '') {
    return { kind: 'typing' };
  }

  if (buffer.startsWith('/')) {
    const parts = buffer.slice(1).trim().split(/\s+/).filter(Boolean);
    return { kind: 'command', name: (parts[0] ?? '').toUpperCase(), args: parts.slice(1) };
  }

  if (buffer.startsWith('@')) {
    return { kind: 'customer', query: buffer.slice(1) };
  }

  // RF-03: recargo/descuento global. Signo obligatorio salvo para "0%"
  // (cancela cualquier ajuste — no hay ambigüedad de dirección posible en
  // cero); una magnitud distinta de cero sin signo no es un comando, sigue
  // de largo hasta la búsqueda difusa de siempre (regla 6, sin cambios).
  const adjustmentMatch = /^([+-])?(\d+(?:[.,]\d+)?)%$/.exec(buffer);
  if (adjustmentMatch) {
    const magnitude = Number((adjustmentMatch[2] ?? '0').replace(',', '.'));
    if (magnitude === 0) {
      return { kind: 'global-adjustment', percentage: 0 };
    }
    if (adjustmentMatch[1] !== undefined) {
      return {
        kind: 'global-adjustment',
        percentage: adjustmentMatch[1] === '-' ? -magnitude : magnitude,
      };
    }
  }
  // Mientras el buffer es "<signo><dígitos>" sin el "%" todavía, es ambiguo
  // con el prefijo de cantidad "-<n>*" — esperar el carácter que
  // desambigua, mismo criterio que código-de-barras-vs-cantidad.
  if (/^[+-]\d+(?:[.,]\d+)?$/.test(buffer)) {
    if (finalizing) {
      return {
        kind: 'parse-error',
        message: 'Recargo/descuento inválido: usá "+<número>%" o "-<número>%"',
      };
    }
    return { kind: 'typing' };
  }

  // El prefijo de cantidad se resuelve antes que la línea libre y que
  // código/búsqueda — regla 4 aplica "antes de cualquier búsqueda", y una
  // línea libre también cuenta: "3*regalo$100" es 3 unidades a $100 c/u
  // ($300), no la descripción literal "3*regalo".
  const quantityMatch = /^(-?\d+)\*(.*)$/.exec(buffer);
  const qty = quantityMatch ? Number.parseInt(quantityMatch[1] ?? '1', 10) : 1;
  const rest = quantityMatch ? (quantityMatch[2] ?? '') : buffer;

  if (rest === '') {
    if (finalizing) {
      return {
        kind: 'parse-error',
        message: 'Falta el código o la búsqueda después de la cantidad',
      };
    }
    return { kind: 'typing' };
  }

  const dollarIndex = rest.lastIndexOf('$');
  if (dollarIndex !== -1) {
    const description = rest.slice(0, dollarIndex).trim();
    const amount = parseAmount(rest.slice(dollarIndex + 1));

    if (amount !== undefined && description !== '') {
      return { kind: 'freeform-line', description, amount, qty };
    }
    if (finalizing) {
      return { kind: 'parse-error', message: 'Línea libre inválida: usá "descripción$monto"' };
    }
    return { kind: 'typing' };
  }

  if (/^\d+$/.test(rest)) {
    if (!finalizing) {
      return { kind: 'pending-numeric' };
    }
    return { kind: 'barcode', code: rest, qty };
  }

  return { kind: 'search', query: rest, qty };
}
