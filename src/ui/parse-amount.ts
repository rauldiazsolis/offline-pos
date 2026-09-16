import { resolveLocale } from './format.ts';

function escapeForCharClass(char: string): string {
  return char.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
}

/** Separador decimal que usa `Intl.NumberFormat` para ese locale. */
export function decimalSeparator(locale: string): string {
  const parts = new Intl.NumberFormat(locale).formatToParts(1.5);
  return parts.find((part) => part.type === 'decimal')?.value ?? '.';
}

/**
 * Parsea un monto tipeado por el cajero según el separador decimal del
 * locale configurado por terminal (`/CONFIG`, o `navigator.language` si no
 * hay uno) — reemplaza la heurística fija de Fase 1 ("coma como decimal si
 * está presente"). No acepta separador de miles: un monto de cobro nunca se
 * tipea con agrupación ("1500,00", nunca "1.500,00"), así que el caracter
 * que no es el decimal del locale queda directamente inválido en vez de
 * interpretarse como miles — bajo `es-AR` (decimal ','), tipear "1.23" con
 * un teclado que no coincide con la configuración regional ya no se
 * malinterpreta en silencio como 123 (issue real encontrada por el usuario
 * probando el modal de cobro multi-medio, #55): antes de este cambio ese
 * caso se aceptaba sin ningún aviso. `ui/keyboard/decimal-key.ts` completa
 * esto reinterpretando la tecla `.`/`,` como el separador correcto al
 * tipear, así ni hace falta que el cajero acierte la tecla física.
 */
function parseNormalized(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (trimmed === '') {
    return undefined;
  }

  const decimal = decimalSeparator(resolveLocale());
  const allowed = new RegExp(`^[0-9${escapeForCharClass(decimal)}]+$`);
  if (!allowed.test(trimmed)) {
    return undefined;
  }

  const normalized = decimal === '.' ? trimmed : trimmed.split(decimal).join('.');
  const value = Number(normalized);
  return Number.isFinite(value) ? value : undefined;
}

export function parseAmount(raw: string): number | undefined {
  const value = parseNormalized(raw);
  return value !== undefined && value > 0 ? value : undefined;
}

/**
 * Como `parseAmount`, pero acepta `0` — para los montos de apertura/cierre
 * de turno de caja (Fase 6): empezar un turno con el cajón vacío, o
 * cerrarlo sin nada de efectivo contado, son casos válidos. `parseAmount`
 * en cambio exige `> 0` a propósito para pagos/líneas libres (un pago o una
 * línea de $0 no tiene sentido de negocio).
 */
export function parseNonNegativeAmount(raw: string): number | undefined {
  const value = parseNormalized(raw);
  return value !== undefined && value >= 0 ? value : undefined;
}
