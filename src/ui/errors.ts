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
      if (failure.meta.field === 'description') {
        return 'Falta la descripción de la línea libre.';
      }
      return failure.meta.field === 'unitPrice'
        ? 'El monto de la línea libre es inválido.'
        : 'La cantidad de la línea libre es inválida.';
    case 'cart/freeform-line-not-found':
      return `No hay ninguna línea libre "${failure.meta.description}" en el carrito.`;
    case 'cart/invalid-global-adjustment':
      return `Recargo/descuento inválido (${String(failure.meta.percentage)}%). No se puede descontar más del 100%.`;
    case 'sale/insufficient-stock':
      return `Stock insuficiente (pedido ${String(failure.meta.requested)}, disponible ${String(failure.meta.available)}).`;
    case 'sale/empty-cart':
      return 'El carrito está vacío.';
    case 'sale/invalid-payment-amount':
      return 'Uno de los pagos tiene un monto inválido.';
    case 'sale/insufficient-payment':
      return `Falta pagar ${String(failure.meta.total - failure.meta.paid)}.`;
    case 'sale/non-cash-exceeds-total':
      return `No se puede dar vuelto con un medio distinto a efectivo (excedente ${String(failure.meta.nonCashTotal - failure.meta.total)}).`;
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
    case 'sync/invalid-payload':
      return 'El servidor devolvió datos con un formato inesperado.';
    case 'sync/request-failed': {
      const { status, message } = failure.meta;
      if (status === undefined) {
        return `No se pudo conectar con el servidor (${message}). ¿Está en línea y corriendo?`;
      }
      if (status === 401 || status === 403) {
        return `El servidor rechazó las credenciales (${String(status)}).`;
      }
      if (status === 404) {
        return 'El servidor no encontró el recurso (404). ¿La URL es correcta?';
      }
      return `El servidor respondió con un error (${String(status)}).`;
    }
    case 'sync/timeout':
      return `El servidor no respondió en ${String(failure.meta.seconds)} segundos.`;
    case 'sync/remote-error':
      return `El sistema externo respondió con un error: ${failure.meta.message}`;
    case 'sync/empty-snapshot': {
      const names = { products: 'productos', stock: 'stock', customers: 'clientes' } as const;
      return `El sistema externo devolvió vacío: ${failure.meta.tables.map((table) => names[table]).join(', ')}. Se conservaron los datos locales.`;
    }
    case 'sync/reconcile-failed':
      return `No se pudo actualizar el catálogo local (${failure.meta.message}).`;
    case 'sync/push-issues':
      return `El sistema externo reportó un problema con un envío ya confirmado: ${failure.meta.issues[0] ?? ''}`;
    case 'connection/sync-busy':
      return 'Hay una sincronización en curso que todavía no terminó. Esperá unos segundos y probá de nuevo.';
    case 'connection/apply-failed':
      return `No se pudo aplicar la conexión (${failure.meta.message}).`;
    case 'sync/config-missing':
      return 'No hay conexión configurada todavía. Usá /CONFIG.';
    case 'sync/config-invalid':
      return 'La configuración de conexión guardada es inválida. Usá /CONFIG para corregirla.';
    case 'account/hold-rejected':
      return `El sistema externo rechazó el crédito (${failure.meta.reasonCode}).`;
    case 'account/offline-limit-exceeded':
      return `Crédito insuficiente sin conexión (faltan ${String(failure.meta.missing)}).`;
    case 'account/no-customer-attached':
      return 'Adjuntá un cliente con @ antes de cobrar a cuenta corriente.';
    case 'customer/persist-failed':
      return `No se pudo guardar el cliente (${failure.meta.message}).`;
    case 'customer/invalid-fixture':
      return 'El fixture de clientes de ejemplo tiene datos inválidos.';
    case 'customer/seed-failed':
      return `No se pudieron sembrar los clientes de ejemplo (${failure.meta.message}).`;
    case 'cash-session/invalid-amount':
      return `Monto inválido (${String(failure.meta.amount)}).`;
    case 'cash-session/already-open':
      return 'Ya hay un turno de caja abierto.';
    case 'cash-session/none-open':
      return 'No hay un turno de caja abierto. Abrí uno con /CAJA antes de cobrar.';
    case 'cash-session/already-closed':
      return 'Ese turno ya estaba cerrado.';
    case 'cash-session/persist-failed':
      return `No se pudo guardar el turno de caja (${failure.meta.message}).`;
    case 'cash-session/none-ever':
      return 'No hay ningún turno de caja para consultar.';
    case 'customer-payment/invalid':
      if (failure.meta.reason === 'account-method') {
        return 'La cobranza no admite cuenta corriente.';
      }
      return failure.meta.reason === 'empty'
        ? 'Ingresá al menos un monto.'
        : 'Los montos de la cobranza tienen que ser mayores a cero.';
    case 'demo/reset-failed':
      return `No se pudo reiniciar la demo (${failure.meta.message}).`;
    case 'demo/backend-reset-failed':
      return `No se pudo reiniciar el minibackend de demo (${failure.meta.message}). ¿Está corriendo?`;
    case 'demo/unavailable-for-connector':
      return `/DEMO_RESET no está disponible con ${failure.meta.connectorLabel}: solo funciona con el backend REST de demo.`;
    case 'terminal/reset-failed':
      return `No se pudieron borrar los datos locales de la terminal (${failure.meta.message}).`;
    default: {
      const exhaustiveCheck: never = failure;
      return exhaustiveCheck;
    }
  }
}
