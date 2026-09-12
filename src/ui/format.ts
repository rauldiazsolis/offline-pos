/**
 * Formateo de moneda con el locale del navegador (`navigator.language`).
 * Fase 1 no tiene todavía config de terminal (locale/moneda por terminal,
 * ver §7 del doc de diseño) — cuando exista, este es el único punto a tocar.
 */
const numberFormat = new Intl.NumberFormat(navigator.language, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatMoney(amount: number): string {
  return numberFormat.format(amount);
}
