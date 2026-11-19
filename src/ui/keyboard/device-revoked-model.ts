import type { PendingExportSummary } from '../../sync/pending-export.ts';
import { formatMoney } from '../format.ts';
import type { DeviceRevokedPending } from '../state/device-revoked-screen.ts';

/** El texto cuando el backend no mandó uno propio. */
export const DEVICE_REVOKED_EXPLANATION =
  'Esta terminal ya no puede sincronizar con el backend. Lo que no se llegó a enviar sigue guardado acá: podés bajarlo antes de desvincular la terminal.';

export const DEVICE_REVOKED_TITLE = 'Esta caja fue vinculada en otro dispositivo';

/**
 * El texto debajo del título (pura): el `message` del backend si dice algo más que el título (el
 * demo-backend manda justo el título), y si no, `DEVICE_REVOKED_EXPLANATION`.
 */
export function deviceRevokedText(message: string | undefined): string {
  const said = message?.trim().replace(/\.$/, '');
  return said === undefined || said === '' || said === DEVICE_REVOKED_TITLE
    ? DEVICE_REVOKED_EXPLANATION
    : (message ?? DEVICE_REVOKED_EXPLANATION);
}

function plural(count: number, singular: string, pluralForm: string): string {
  return `${String(count)} ${count === 1 ? singular : pluralForm}`;
}

function withTotal(text: string, total: number | undefined): string {
  return total !== undefined ? `${text} por $${formatMoney(total)}` : text;
}

/**
 * Un grupo de lo pendiente en una línea, o `undefined` si está vacío (pura): "2 ventas por
 * $1.500,00, 1 cobranza por $300,00 y 3 movimientos más". Ventas y cobranzas con su total; el
 * resto (clientes, stock, caja, reservas) son "movimientos".
 */
export function describePendingGroup(summary: PendingExportSummary): string | undefined {
  if (summary.events === 0) {
    return undefined;
  }
  const sales = summary.byType.sale;
  const payments = summary.byType['customer-payment'];
  const parts = [
    ...(sales !== undefined
      ? [withTotal(plural(sales.count, 'venta', 'ventas'), sales.total)]
      : []),
    ...(payments !== undefined
      ? [withTotal(plural(payments.count, 'cobranza', 'cobranzas'), payments.total)]
      : []),
  ];
  const others = summary.events - (sales?.count ?? 0) - (payments?.count ?? 0);
  if (others > 0) {
    parts.push(`${plural(others, 'movimiento', 'movimientos')}${parts.length > 0 ? ' más' : ''}`);
  }
  const last = parts.pop() ?? '';
  return parts.length > 0 ? `${parts.join(', ')} y ${last}` : last;
}

/** Si hay algo que exportar (pura). */
export function hasPending(pending: DeviceRevokedPending | undefined): boolean {
  return pending !== undefined && pending.notSent.events + pending.sentUnconfirmed.events > 0;
}

/**
 * La pregunta del segundo paso de "Desvincular" (pura). Con algo pendiente sin exportar en esta
 * sesión, lo remarca aparte (`warning`).
 */
export function describeUnlink(
  pending: DeviceRevokedPending | undefined,
  exportedFile: string | undefined,
): { question: string; warning?: string } {
  const question =
    'Se borran los datos locales de esta terminal, incluido lo pendiente que no exportaste. ¿Desvincular?';
  if (exportedFile === undefined && hasPending(pending)) {
    return {
      question,
      warning: 'Todavía no exportaste lo pendiente de esta terminal: se pierde para siempre.',
    };
  }
  return { question };
}
