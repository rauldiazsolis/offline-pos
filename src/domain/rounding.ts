/**
 * Único lugar donde se redondea en el dominio (epic #94, Etapa 4 — #99):
 * cantidades a 3 decimales (se vende por peso), importes a 2.
 *
 * Redondea sobre la representación decimal (`1.005e2`), no sobre el
 * producto en coma flotante (`1.005 * 100` da `100.49999999999999`), así un
 * importe que se ve terminado en 5 redondea como se ve. Nunca devuelve `-0`.
 */
function roundTo(value: number, decimals: number): number {
  const text = String(value);
  const rounded = text.includes('e')
    ? Math.round(value * 10 ** decimals) / 10 ** decimals
    : Number(String(Math.round(Number(text + 'e' + String(decimals)))) + 'e-' + String(decimals));
  return rounded === 0 ? 0 : rounded;
}

export function roundQuantity(value: number): number {
  return roundTo(value, 3);
}

export function roundAmount(value: number): number {
  return roundTo(value, 2);
}

/** Lo que tipea el cajero nunca se redondea en silencio: más de 3 decimales es un error. */
export function hasAtMostThreeDecimals(value: number): boolean {
  return Number.isFinite(value) && Math.abs(roundQuantity(value) - value) < 1e-9;
}
