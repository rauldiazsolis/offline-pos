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

/**
 * Fecha corta con el locale configurado por terminal (Ciclo 8, punto 2:
 * desambiguación de clientes en el overlay de `@` — sin documento ni
 * teléfono, dos "Juan Pérez" se ven idénticos; la fecha de alta es un dato
 * secundario barato, ya está en `Customer.createdAt`).
 */
export function formatDate(isoDate: string): string {
  // `timeZone: 'UTC'` a propósito: `createdAt` es un instante, no una fecha
  // de calendario local, y lo único que importa acá es desambiguar dos
  // clientes por "cuándo se dieron de alta" a simple vista — sin esto, la
  // misma fecha mostraría un día distinto según la zona horaria de cada
  // terminal (y del entorno donde corren los tests).
  return new Intl.DateTimeFormat(resolveLocale(), {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'UTC',
  }).format(new Date(isoDate));
}
