import type { PaymentMethod } from '../domain/sale.ts';

/**
 * Etiquetas en español para cada medio de pago — compartidas entre el modal
 * de cobro (`checkout-screen.tsx`), el desglose de arqueo
 * (`cash-session-screen.tsx`) y el detalle de pagos del comprobante
 * (`receipt-screen.tsx`), así los tres muestran exactamente el mismo texto.
 */
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: 'Efectivo',
  debit: 'Tarjeta de Débito',
  credit: 'Tarjeta de Crédito',
  transfer: 'Transferencia',
  qr: 'Código QR',
  account: 'Cuenta corriente',
};
