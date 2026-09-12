import type { Failure } from '../domain/result.ts';

/**
 * Traductor central de errores de negocio a mensajes para el cajero. Switch
 * exhaustivo sobre `ErrorCode` (ver CLAUDE.md): si se agrega un código nuevo
 * a `ErrorMeta` y no se lo traduce acá, el `default` lo marca en tiempo de
 * compilación (`never`), no en producción.
 */
export function describeError(failure: Failure): string {
  switch (failure.error) {
    case 'cart/invalid-quantity':
      return `Cantidad inválida (${String(failure.meta.quantity)}).`;
    case 'cart/line-not-found':
      return 'No hay una línea del carrito en esa posición.';
    case 'cart/nothing-to-subtract':
      return 'Ese producto no está en el carrito.';
    case 'cart/invalid-discount':
      return 'Descuento inválido.';
    case 'cart/invalid-freeform-line':
      return failure.meta.field === 'description'
        ? 'Falta la descripción de la línea libre.'
        : 'El monto de la línea libre es inválido.';
    case 'sale/insufficient-stock':
      return `Stock insuficiente (pedido ${String(failure.meta.requested)}, disponible ${String(failure.meta.available)}).`;
    case 'sale/empty-cart':
      return 'El carrito está vacío.';
    case 'sale/invalid-payment-amount':
      return 'Uno de los pagos tiene un monto inválido.';
    case 'sale/insufficient-payment':
      return `Falta pagar ${String(failure.meta.total - failure.meta.paid)}.`;
    case 'sale/not-closed':
      return 'Esa venta no está cerrada.';
    case 'sale/already-voided':
      return 'Esa venta ya estaba anulada.';
    case 'catalog/duplicate-sku':
      return `SKU duplicado (${failure.meta.sku}).`;
    case 'catalog/duplicate-barcode':
      return `Código de barras duplicado (${failure.meta.barcode}).`;
    case 'catalog/invalid-fixture':
      return 'El catálogo de ejemplo tiene datos inválidos.';
    case 'catalog/seed-failed':
      return `No se pudo cargar el catálogo (${failure.meta.message}).`;
    case 'sale/persist-failed':
      return `No se pudo guardar la venta (${failure.meta.message}). Reintentá antes de cerrar la pantalla.`;
    case 'sale/not-found':
      return 'No se encontró esa venta.';
    default: {
      const exhaustiveCheck: never = failure;
      return exhaustiveCheck;
    }
  }
}
