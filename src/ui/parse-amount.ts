/**
 * Fase 1: heurística simple para el separador decimal (coma si está
 * presente, como en `$1500,50`). Reemplazar por `Intl.NumberFormat` con el
 * locale configurado por terminal cuando exista esa config (ver §7 del
 * doc de diseño) — no hay locale configurable todavía. Usado tanto por la
 * línea libre de la barra de comandos como por el input de cobro.
 */
export function parseAmount(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (trimmed === '') {
    return undefined;
  }
  const normalized = trimmed.includes(',') ? trimmed.replace(/\./g, '').replace(',', '.') : trimmed;
  const value = Number(normalized);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}
