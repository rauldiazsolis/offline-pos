import { loadSyncConfig } from '../sync/config.ts';

/**
 * Formateo de moneda con el locale configurado por terminal (`/CONFIG`,
 * Fase 4 — §7 del doc de diseño), o `navigator.language` si no se
 * configuró. Se resuelve en cada llamada en vez de cachear un
 * `Intl.NumberFormat` al importar el módulo: a esta escala (líneas de un
 * carrito/comprobante, no un catálogo de 50.000 filas) el costo es
 * irrelevante, y así un cambio de `/CONFIG` se refleja sin recargar la app.
 */
function resolveLocale(): string {
  const configResult = loadSyncConfig();
  if (configResult.ok && configResult.value.locale !== undefined) {
    return configResult.value.locale;
  }
  return navigator.language;
}

export function formatMoney(amount: number): string {
  return new Intl.NumberFormat(resolveLocale(), {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}
