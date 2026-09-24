import type { OutboxEvent } from './outbox.ts';

/**
 * Efectos sobre stock y saldo de un conjunto de eventos del outbox, para
 * reaplicarlos encima de la foto del backend (Etapa 3 de #94, #98): los
 * eventos que el backend todavía no refleja (lotes `queued`, lote en curso
 * no recibido, pendientes nunca enviados). Espeja lo que hace el backend al
 * procesar un lote y lo que hace el POS al cerrar una venta
 * (`storage/sale-repository.ts`). Deduplica por id de evento.
 */
export type ReapplyEffects = {
  stock: ReadonlyMap<string, number>;
  balance: ReadonlyMap<string, number>;
};

export function roundQuantity(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function roundAmount(value: number): number {
  return Math.round(value * 100) / 100;
}

function add(map: Map<string, number>, key: string, delta: number): void {
  map.set(key, (map.get(key) ?? 0) + delta);
}

function rounded(map: Map<string, number>, round: (value: number) => number): Map<string, number> {
  return new Map([...map].map(([key, value]) => [key, round(value)]));
}

export function reapplyEffects(events: readonly OutboxEvent[]): ReapplyEffects {
  const stock = new Map<string, number>();
  const balance = new Map<string, number>();
  const seen = new Set<string>();
  for (const event of events) {
    if (seen.has(event.id)) {
      continue;
    }
    seen.add(event.id);
    switch (event.type) {
      case 'stock-movement':
        add(stock, event.movement.productId, event.movement.delta);
        break;
      case 'sale': {
        const customerId = event.sale.customerId;
        if (customerId === undefined) {
          break;
        }
        // Con o sin hold: el monto de un hold confirmado ya es el del pago (mismo lote).
        for (const payment of event.sale.payments) {
          if (payment.method === 'account') {
            add(balance, customerId, payment.amount);
          }
        }
        break;
      }
      case 'customer-payment':
        add(balance, event.payment.customerId, -event.payment.total);
        break;
      case 'sale-void':
      case 'customer':
      case 'account-hold-confirm':
      case 'account-hold-release':
      case 'cash-movement':
        break;
      default: {
        // Un tipo que el contrato ya no tiene (p. ej. `cash-session`) no mueve stock ni saldo.
        event satisfies never;
      }
    }
  }
  return { stock: rounded(stock, roundQuantity), balance: rounded(balance, roundAmount) };
}
