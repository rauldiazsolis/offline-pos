/**
 * Fase 1: heurística simple para el separador decimal (coma si está
 * presente, como en `$1500,50`). Reemplazar por `Intl.NumberFormat` con el
 * locale configurado por terminal cuando exista esa config (ver §7 del
 * doc de diseño) — no hay locale configurable todavía. Usado tanto por la
 * línea libre de la barra de comandos como por el input de cobro.
 */
function parseNormalized(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (trimmed === '') {
    return undefined;
  }
  const normalized = trimmed.includes(',') ? trimmed.replace(/\./g, '').replace(',', '.') : trimmed;
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
