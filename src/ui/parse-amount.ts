import { resolveLocale } from './format.ts';

function escapeForCharClass(char: string): string {
  return char.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
}

/** Separador decimal y de miles que usa `Intl.NumberFormat` para ese locale. */
function localeSeparators(locale: string): { decimal: string; group: string } {
  const parts = new Intl.NumberFormat(locale).formatToParts(1234.5);
  const decimal = parts.find((part) => part.type === 'decimal')?.value ?? '.';
  const group = parts.find((part) => part.type === 'group')?.value ?? ',';
  return { decimal, group };
}

/**
 * Parsea un monto tipeado por el cajero según el separador decimal/de miles
 * del locale configurado por terminal (`/CONFIG`, o `navigator.language` si
 * no hay uno) — reemplaza la heurística fija de Fase 1 ("coma como decimal
 * si está presente"), que no tenía relación con el locale real ni con lo
 * que `formatMoney` termina mostrando. Rechaza cualquier caracter que no
 * sea dígito o alguno de esos dos separadores: `"$3.35"`, `"x4,38"` o
 * `"cualquier cosa"` quedan inválidos en vez de colarse como texto sin
 * sentido que el resto de la pila silenciosamente trataba como 0 (issue
 * encontrada probando el modal de cobro multi-medio, #55). Usado tanto por
 * la línea libre de la barra de comandos como por los montos de `/CAJA` y
 * los 6 campos de Cobro.
 */
function parseNormalized(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (trimmed === '') {
    return undefined;
  }

  const { decimal, group } = localeSeparators(resolveLocale());
  const allowed = new RegExp(`^[0-9${escapeForCharClass(group)}${escapeForCharClass(decimal)}]+$`);
  if (!allowed.test(trimmed)) {
    return undefined;
  }

  const withoutGroup = trimmed.split(group).join('');
  const normalized = decimal === '.' ? withoutGroup : withoutGroup.split(decimal).join('.');
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
