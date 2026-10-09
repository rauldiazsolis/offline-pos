import { COLLECTION_METHODS, type CollectionMethod } from '../../../src/domain/customer-payment.ts';
import type { PaymentMethod } from '../../../src/domain/sale.ts';
import { cartWarnings } from '../../../src/domain/sale-warnings.ts';
import { tenderMode } from '../../../src/domain/tender.ts';
import { calculateTotals } from '../../../src/domain/totals.ts';
import { paperFormat } from '../../../src/storage/printer-config.ts';
import { formatBalance } from '../../../src/ui/format-balance.ts';
import { formatWarning } from '../../../src/ui/format-warning.ts';
import { resolveLocale } from '../../../src/ui/format.ts';
import {
  accountBalancePreview,
  amountTendered,
  cancelCheckout,
  changePreview,
  submitCheckout,
} from '../../../src/ui/keyboard/checkout-controller.ts';
import {
  cancelCollection,
  collectionBalancePreview,
  collectionTotalPreview,
  submitCollection,
} from '../../../src/ui/keyboard/collection-controller.ts';
import { decimalSeparator, parseNonNegativeAmount } from '../../../src/ui/parse-amount.ts';
import { PAYMENT_METHOD_LABELS } from '../../../src/ui/payment-labels.ts';
import { printReceipt } from '../../../src/ui/print/after-close.ts';
import { ReceiptView } from '../../../src/ui/print/ReceiptView.tsx';
import { receiptDocumentFor } from '../../../src/ui/print/resolve-receipt.ts';
import { cartSignal } from '../../../src/ui/state/cart.ts';
import { getCatalogRepository } from '../../../src/ui/state/catalog.ts';
import {
  checkoutBuffersSignal,
  checkoutErrorSignal,
  TENDERABLE_METHODS,
} from '../../../src/ui/state/checkout.ts';
import {
  collectionBuffersSignal,
  collectionErrorSignal,
} from '../../../src/ui/state/collection.ts';
import { attachedCustomerSignal } from '../../../src/ui/state/customer.ts';
import { printerConfigSignal } from '../../../src/ui/state/printer.ts';
import { receiptSignal } from '../../../src/ui/state/receipt.ts';
import { activeScreenSignal } from '../../../src/ui/state/screen.ts';
import { stockSnapshotSignal } from '../../../src/ui/state/stock.ts';
import { Sheet } from '../components/sheet.tsx';
import { money } from '../format.ts';
import { openNumberEntry, type QuickValue } from '../keyboards/entry.ts';
import { keypadText } from '../keyboards/keypad-model.ts';
import { receiptText } from '../receipt-text.ts';
import { openCustomerPicker } from './sale-screen.tsx';

/** Billetes para el efectivo: los que cubren lo que falta, de menor a mayor. */
const BILLS = [1000, 2000, 10000, 20000];

function amountOf(text: string): number {
  return parseNonNegativeAmount(text) ?? 0;
}

/** Un importe por medio de pago, con el teclado numérico: "Justo" completa lo que falta. */
function askAmount(params: {
  title: string;
  current: string;
  remaining: number;
  cash: boolean;
  onDone: (text: string) => void;
}): void {
  const decimal = decimalSeparator(resolveLocale());
  const remaining = Math.max(0, params.remaining);
  const quick: QuickValue[] = [];
  if (remaining > 0) {
    quick.push({ label: `Justo ${money(remaining)}`, text: keypadText(remaining, decimal) });
  }
  if (params.cash) {
    for (const bill of BILLS.filter((value) => value > remaining).slice(0, 3)) {
      quick.push({ label: money(bill), text: String(bill) });
    }
  }
  quick.push({ label: 'Nada', text: '0' });
  openNumberEntry({
    title: params.title,
    initial: params.current,
    prefix: '$',
    options: { decimals: 2, signed: false },
    hint: () => (remaining > 0 ? `Falta ${money(remaining)}` : 'Ya está cubierto el total.'),
    quick,
    onDone: (value) => {
      params.onDone(value === undefined || value === 0 ? '' : keypadText(value, decimal));
    },
  });
}

function setCheckoutBuffer(method: PaymentMethod, text: string): void {
  checkoutBuffersSignal.value = { ...checkoutBuffersSignal.value, [method]: text };
  checkoutErrorSignal.value = null;
}

/** Cobro: los 6 medios, cada uno con su importe; Confirmar cierra la venta (checkout-controller). */
export function CheckoutSheet() {
  const cart = cartSignal.value;
  const { total } = calculateTotals(cart);
  const mode = tenderMode(total);
  const buffers = checkoutBuffersSignal.value;
  const customer = attachedCustomerSignal.value;
  const tendered = amountTendered();
  const target = Math.abs(total);
  const due = Math.round((target - tendered) * 100) / 100;
  const change = changePreview();
  const balance = accountBalancePreview();
  const repo = getCatalogRepository();
  const warnings = cartWarnings(cart, {
    productById: (id) => repo.getProduct(id),
    stockOf: (id) => stockSnapshotSignal.value.get(id),
    customer,
  });
  const error = checkoutErrorSignal.value;

  const tap = (method: PaymentMethod): void => {
    const others = TENDERABLE_METHODS.filter((m) => m !== method).reduce(
      (sum, m) => sum + amountOf(buffers[m]),
      0,
    );
    const ask = (): void => {
      askAmount({
        title: PAYMENT_METHOD_LABELS[method],
        current: checkoutBuffersSignal.value[method],
        remaining: Math.round((target - others) * 100) / 100,
        cash: method === 'cash' && mode === 'charge',
        onDone: (text) => {
          setCheckoutBuffer(method, text);
        },
      });
    };
    if (method === 'account' && attachedCustomerSignal.value === undefined) {
      openCustomerPicker({ onPicked: ask });
      return;
    }
    ask();
  };

  return (
    <Sheet
      title={mode === 'refund' ? 'Devolver' : 'Cobrar'}
      onClose={cancelCheckout}
      closeLabel="Cancelar"
      full
      testId="checkout-sheet"
      footer={
        <>
          <button
            type="button"
            class="btn"
            onClick={() => {
              checkoutBuffersSignal.value = {
                cash: target === 0 ? '' : keypadText(target, decimalSeparator(resolveLocale())),
                debit: '',
                credit: '',
                transfer: '',
                qr: '',
                account: '',
              };
              checkoutErrorSignal.value = null;
            }}
          >
            Todo en efectivo
          </button>
          <button type="button" class="btn btn-primary" onClick={() => void submitCheckout()}>
            Confirmar
          </button>
        </>
      }
    >
      <div class="total-row" style={{ paddingTop: 0 }}>
        <span>{mode === 'refund' ? 'A devolver' : 'Total'}</span>
        <span class="big num">{money(target)}</span>
      </div>
      <div class="list">
        {TENDERABLE_METHODS.map((method) => {
          const value = amountOf(buffers[method]);
          const sub =
            method === 'account'
              ? customer !== undefined
                ? customer.name
                : 'Tocá para elegir el cliente'
              : method === 'cash' && mode === 'charge'
                ? 'Con billetes rápidos'
                : 'Tocá para cargar el importe';
          return (
            <button
              key={method}
              type="button"
              class="item"
              data-method={method}
              onClick={() => {
                tap(method);
              }}
            >
              <span class="main">
                <div class="title">{PAYMENT_METHOD_LABELS[method]}</div>
                <div class="sub">{sub}</div>
              </span>
              <span class="amt num">{value > 0 ? money(value) : '—'}</span>
            </button>
          );
        })}
      </div>
      {mode !== 'zero' && due > 0.004 && (
        <div class="state-line due">
          <span>Falta</span>
          <span class="num">{money(due)}</span>
        </div>
      )}
      {change > 0.004 && (
        <div class="state-line change" data-testid="change">
          <span>Vuelto</span>
          <span class="num">{money(change)}</span>
        </div>
      )}
      {balance !== undefined && (
        <p class="note">
          Saldo del cliente: {formatBalance(balance.before)} → {formatBalance(balance.after)}
        </p>
      )}
      {warnings.length > 0 && (
        <div class="state-line due" style={{ display: 'block' }}>
          {warnings.map((warning) => (
            <div key={`${warning.kind}:${'productId' in warning ? warning.productId : ''}`}>
              ⚠ {formatWarning(warning, (id) => repo.getProduct(id)?.name ?? id)}
            </div>
          ))}
        </div>
      )}
      {error !== null && (
        <p class="state-line error" role="alert">
          {error}
        </p>
      )}
    </Sheet>
  );
}

function setCollectionBuffer(method: CollectionMethod, text: string): void {
  collectionBuffersSignal.value = { ...collectionBuffersSignal.value, [method]: text };
  collectionErrorSignal.value = null;
}

/** Cobranza sin venta (#101): cinco medios, sin vuelto; pagar de más deja saldo a favor. */
export function CollectionSheet() {
  const customer = attachedCustomerSignal.value;
  const buffers = collectionBuffersSignal.value;
  const total = collectionTotalPreview();
  const balance = collectionBalancePreview();
  const error = collectionErrorSignal.value;
  return (
    <Sheet
      title={`Cobranza a ${customer?.name ?? ''}`}
      onClose={cancelCollection}
      closeLabel="Cancelar"
      full
      testId="collection-sheet"
      footer={
        <button type="button" class="btn btn-primary" onClick={() => void submitCollection()}>
          Confirmar cobranza
        </button>
      }
    >
      <div class="total-row" style={{ paddingTop: 0 }}>
        <span>Total</span>
        <span class="big num">{money(total)}</span>
      </div>
      <div class="list">
        {COLLECTION_METHODS.map((method) => {
          const value = amountOf(buffers[method]);
          return (
            <button
              key={method}
              type="button"
              class="item"
              data-method={method}
              onClick={() => {
                // Un saldo positivo es lo que el cliente debe ("Justo" lo salda).
                const owed = Math.max(0, balance.before ?? 0);
                askAmount({
                  title: PAYMENT_METHOD_LABELS[method],
                  current: collectionBuffersSignal.value[method],
                  remaining: Math.round((owed - (total - value)) * 100) / 100,
                  cash: false,
                  onDone: (text) => {
                    setCollectionBuffer(method, text);
                  },
                });
              }}
            >
              <span class="main">
                <div class="title">{PAYMENT_METHOD_LABELS[method]}</div>
              </span>
              <span class="amt num">{value > 0 ? money(value) : '—'}</span>
            </button>
          );
        })}
      </div>
      <p class="note">
        Saldo: {formatBalance(balance.before)} → {formatBalance(balance.after)}
      </p>
      {customer?.blocked !== undefined && (
        <p class="state-line due">⚠ Cliente bloqueado — {customer.blocked.reason}</p>
      )}
      {error !== null && (
        <p class="state-line error" role="alert">
          {error}
        </p>
      )}
    </Sheet>
  );
}

/** Compartir (Web Share) existe en Chrome para Android y Safari; en una compu, casi nunca. */
function canShare(): boolean {
  return 'share' in navigator;
}

/** El comprobante recién emitido o una copia, en el formato de la impresora; Imprimir si hay papel. */
export function ReceiptSheet() {
  const current = receiptSignal.value;
  if (current === null) {
    return null;
  }
  const config = printerConfigSignal.value;
  const document = receiptDocumentFor(current.source, config);
  const close = (): void => {
    receiptSignal.value = null;
    activeScreenSignal.value = current.returnTo;
  };
  return (
    <Sheet
      title={
        current.source.copy
          ? 'Copia'
          : current.source.kind === 'sale'
            ? 'Venta cobrada'
            : 'Cobranza registrada'
      }
      onClose={close}
      full
      testId="receipt-sheet"
      footer={
        <>
          {canShare() && (
            <button
              type="button"
              class="btn"
              onClick={() => {
                navigator.share({ text: receiptText(document) }).catch(() => {
                  // Cerrar el menú de compartir no es un error.
                });
              }}
            >
              Compartir
            </button>
          )}
          {config.format !== 'none' && (
            <button
              type="button"
              class="btn"
              onClick={() => {
                printReceipt(current.source);
              }}
            >
              Imprimir
            </button>
          )}
          <button type="button" class="btn btn-primary" onClick={close}>
            {current.returnTo === 'sale' ? 'Nueva venta' : 'Volver'}
          </button>
        </>
      }
    >
      <div class="receipt-paper">
        <ReceiptView document={document} format={paperFormat(config.format)} />
      </div>
    </Sheet>
  );
}
