import type { SaleLine } from '../../../src/domain/sale.ts';
import { cartWarnings, lineWarnings } from '../../../src/domain/sale-warnings.ts';
import { calculateLineTotal, calculateTotals } from '../../../src/domain/totals.ts';
import { formatBalance } from '../../../src/ui/format-balance.ts';
import { formatWarningInContext } from '../../../src/ui/format-warning.ts';
import { formatMoney, formatQuantity, resolveLocale } from '../../../src/ui/format.ts';
import { triggerCheckout } from '../../../src/ui/keyboard/command-bar-controller.ts';
import { decimalSeparator } from '../../../src/ui/parse-amount.ts';
import { cartSignal } from '../../../src/ui/state/cart.ts';
import { getCatalogRepository } from '../../../src/ui/state/catalog.ts';
import { customerBalancesSignal } from '../../../src/ui/state/customer-balance.ts';
import { attachedCustomerSignal } from '../../../src/ui/state/customer.ts';
import { stockSnapshotSignal } from '../../../src/ui/state/stock.ts';
import { money, plural } from '../format.ts';
import { openNumberEntry } from '../keyboards/entry.ts';
import { keypadText } from '../keyboards/keypad-model.ts';
import { openCustomerPicker } from '../screens/sale-screen.tsx';
import { cartOpenSignal } from '../state/nav.ts';
import { discardSale, removeLineAt, setAdjustment, setLineQty } from '../state/sale-actions.ts';
import { Sheet } from './sheet.tsx';

function lineName(line: SaleLine): string {
  return line.kind === 'product'
    ? (getCatalogRepository().getProduct(line.productId)?.name ?? 'Producto')
    : line.description;
}

function checkout(): void {
  cartOpenSignal.value = false;
  void triggerCheckout();
}

/** Abajo de la venta: cuántas líneas, el total y Cobrar. Tocar el total abre el ticket. */
export function TicketBar() {
  const cart = cartSignal.value;
  const count = cart.lines.length;
  const customer = attachedCustomerSignal.value;
  const { total } = calculateTotals(cart);
  const adjustment = cart.globalAdjustmentPercentage;
  const canCharge = count > 0 || customer !== undefined;
  const detail =
    count === 0
      ? customer !== undefined
        ? `${customer.name} · cobranza sin venta`
        : 'Tocá un producto para empezar'
      : [
          plural(count, 'línea', 'líneas'),
          adjustment !== undefined && adjustment !== 0
            ? `${adjustment > 0 ? 'recargo' : 'descuento'} ${formatQuantity(Math.abs(adjustment))}%`
            : undefined,
          'ver ticket',
        ]
          .filter((part) => part !== undefined)
          .join(' · ');
  return (
    <div class="ticketbar">
      <button
        type="button"
        class="sum"
        disabled={count === 0}
        onClick={() => {
          cartOpenSignal.value = true;
        }}
        data-testid="ticket-total"
      >
        <small>{detail}</small>
        <strong class="num">{money(total)}</strong>
      </button>
      <button type="button" class="m-btn m-btn-primary" disabled={!canCharge} onClick={checkout}>
        {count === 0 && customer !== undefined ? 'Cobranza' : total < 0 ? 'Devolver' : 'Cobrar'}
      </button>
    </div>
  );
}

function editLine(index: number): void {
  const line = cartSignal.value.lines[index];
  if (line === undefined) return;
  const decimal = decimalSeparator(resolveLocale());
  openNumberEntry({
    title: lineName(line),
    initial: keypadText(line.qty, decimal),
    unit: 'unidades',
    options: { decimals: 3, signed: true },
    hint: (value) =>
      value === undefined
        ? `${money(line.unitPrice)} c/u`
        : value === 0
          ? 'Con 0 se quita la línea.'
          : `${money(line.unitPrice)} c/u · ${money(line.unitPrice * value)}${value < 0 ? ' · devolución' : ''}`,
    quick: [
      { label: '1', text: '1' },
      { label: '2', text: '2' },
      { label: '6', text: '6' },
      { label: '12', text: '12' },
    ],
    validate: (value) => (value === undefined ? 'Ingresá la cantidad.' : null),
    extra: {
      label: 'Quitar',
      danger: true,
      run: () => {
        removeLineAt(index);
        if (cartSignal.value.lines.length === 0) cartOpenSignal.value = false;
      },
    },
    onDone: (value) => {
      if (value === undefined) return;
      setLineQty(index, value);
      if (cartSignal.value.lines.length === 0) cartOpenSignal.value = false;
    },
  });
}

function editAdjustment(): void {
  const decimal = decimalSeparator(resolveLocale());
  const current = cartSignal.value.globalAdjustmentPercentage;
  openNumberEntry({
    title: 'Descuento o recargo',
    initial: current === undefined || current === 0 ? '-' : keypadText(current, decimal),
    unit: '%',
    options: { decimals: 2, signed: true },
    hint: (value) => {
      const { subtotal, discountTotal } = calculateTotals(cartSignal.value);
      const base = subtotal - discountTotal;
      if (value === undefined || value === 0) return 'Sin ajuste.';
      return `${value < 0 ? 'Descuento' : 'Recargo'} sobre ${money(base)}: ${money((base * value) / 100)}`;
    },
    quick: [
      { label: '−5 %', text: '-5' },
      { label: '−10 %', text: '-10' },
      { label: '+10 %', text: '10' },
      { label: 'Sin ajuste', text: '0' },
    ],
    validate: (value) =>
      value !== undefined && (value < -100 || value > 100) ? 'Entre −100 % y +100 %.' : null,
    onDone: (value) => {
      setAdjustment(value ?? 0);
    },
  });
}

/** El ticket en curso: el cliente, cada línea (un toque cambia la cantidad), el ajuste y el total. */
export function TicketSheet() {
  const cart = cartSignal.value;
  const customer = attachedCustomerSignal.value;
  const totals = calculateTotals(cart);
  const repo = getCatalogRepository();
  const blockedCustomer = cartWarnings(
    { lines: [] },
    { productById: () => undefined, stockOf: () => undefined, customer },
  );
  const close = (): void => {
    cartOpenSignal.value = false;
  };
  return (
    <Sheet
      title="Ticket"
      onClose={close}
      full
      testId="ticket-sheet"
      footer={
        <>
          <button type="button" class="m-btn" onClick={editAdjustment}>
            % Ajuste
          </button>
          <button
            type="button"
            class="m-btn m-btn-danger"
            onClick={() => {
              discardSale();
              close();
            }}
          >
            Descartar
          </button>
          <button type="button" class="m-btn m-btn-primary" onClick={checkout}>
            {totals.total < 0 ? 'Devolver' : 'Cobrar'}
          </button>
        </>
      }
    >
      <button
        type="button"
        class="item"
        onClick={() => {
          openCustomerPicker();
        }}
      >
        <span class="main">
          <div class="title">{customer?.name ?? 'Consumidor Final'}</div>
          <div class={blockedCustomer.length > 0 ? 'sub warn' : 'sub'}>
            {blockedCustomer[0] !== undefined
              ? formatWarningInContext(blockedCustomer[0])
              : customer !== undefined
                ? formatBalance(customerBalancesSignal.value.get(customer.id))
                : 'Tocá para elegir un cliente'}
          </div>
        </span>
        <span class="sub">Cambiar</span>
      </button>
      <div class="list">
        {cart.lines.map((line, index) => {
          const warnings =
            line.kind === 'product'
              ? lineWarnings(line, {
                  product: repo.getProduct(line.productId),
                  stockQuantity: stockSnapshotSignal.value.get(line.productId),
                })
              : [];
          const lineTotal = calculateLineTotal(line);
          return (
            <button
              key={
                line.kind === 'product' ? line.productId : `${line.description}:${String(index)}`
              }
              type="button"
              class="item"
              data-testid="ticket-line"
              onClick={() => {
                editLine(index);
              }}
            >
              <span class="main">
                <div class="title">{lineName(line)}</div>
                <div class="sub num">
                  {formatQuantity(line.qty)} × $ {formatMoney(line.unitPrice)}
                </div>
                {warnings.map((warning) => (
                  <div class="sub warn" key={warning.kind}>
                    ⚠ {formatWarningInContext(warning)}
                  </div>
                ))}
              </span>
              <span class={lineTotal < 0 ? 'amt num neg' : 'amt num'}>{money(lineTotal)}</span>
            </button>
          );
        })}
        {totals.globalAdjustmentAmount !== 0 && (
          <button type="button" class="item" onClick={editAdjustment}>
            <span class="main">
              <div class="title">
                {(cart.globalAdjustmentPercentage ?? 0) < 0 ? 'Descuento' : 'Recargo'}{' '}
                {formatQuantity(Math.abs(cart.globalAdjustmentPercentage ?? 0))} %
              </div>
            </span>
            <span class={totals.globalAdjustmentAmount < 0 ? 'amt num neg' : 'amt num'}>
              {money(totals.globalAdjustmentAmount)}
            </span>
          </button>
        )}
      </div>
      <div class="total-row">
        <span>Total</span>
        <span class="big num">{money(totals.total)}</span>
      </div>
      <p class="note">Tocá una línea para cambiar la cantidad o quitarla.</p>
    </Sheet>
  );
}
