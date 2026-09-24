import type { SaleWarning } from '../domain/sale-warnings.ts';
import { formatQuantity } from './format.ts';

/**
 * Texto de una advertencia de la venta (#99) fuera de contexto (slot de la
 * barra, bloque de Cobro): nombra el producto o el cliente. Nunca solo color.
 */
export function formatWarning(warning: SaleWarning, productName: (id: string) => string): string {
  switch (warning.kind) {
    case 'insufficient-stock':
      return `${productName(warning.productId)}: stock disponible ${formatQuantity(warning.available)}`;
    case 'blocked-product':
      return `${productName(warning.productId)}: bloqueado — ${warning.reason}`;
    case 'blocked-customer':
      return `Cliente bloqueado — ${warning.reason}`;
  }
}

/** Texto de una advertencia en su propia fila (carrito, tarjeta de Cliente): sin repetir el nombre. */
export function formatWarningInContext(warning: SaleWarning): string {
  switch (warning.kind) {
    case 'insufficient-stock':
      return `Stock disponible: ${formatQuantity(warning.available)}`;
    case 'blocked-product':
    case 'blocked-customer':
      return `Bloqueado: ${warning.reason}`;
  }
}
