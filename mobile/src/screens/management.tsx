import { useEffect, useLayoutEffect } from 'preact/hooks';
import { isVoidedPayment } from '../../../src/domain/customer-payment.ts';
import type { DayEntry } from '../../../src/domain/day-summary.ts';
import type { PaymentMethod } from '../../../src/domain/sale.ts';
import { isVoided } from '../../../src/domain/sale-lifecycle.ts';
import { calculateProductQuantities } from '../../../src/domain/sales-summary.ts';
import { localDateKey } from '../../../src/domain/ticket-number.ts';
import { paperFormat, type CheckoutAction } from '../../../src/storage/printer-config.ts';
import { originKey } from '../../../src/sync/connection.ts';
import { connectorLabel } from '../../../src/sync/connector-registry.ts';
import { collectDiagnostics, describeOffline } from '../../../src/sync/diagnostics.ts';
import { syncNow } from '../../../src/sync/engine.ts';
import { describeError } from '../../../src/ui/errors.ts';
import { formatDayHeading } from '../../../src/ui/format-day.ts';
import {
  receiptLabel,
  ticketLabel,
  voidOfLabel,
  voidOfReceiptLabel,
} from '../../../src/ui/format-ticket.ts';
import { formatQuantity, formatTime, resolveLocale } from '../../../src/ui/format.ts';
import {
  cancelCash,
  loadCashScreen,
  openConceptSuggestions,
  setCashKind,
  submitCash,
  updateCashField,
} from '../../../src/ui/keyboard/cash-controller.ts';
import {
  CASH_KIND_LABELS,
  CASH_KINDS,
  countDifference,
  describeDifference,
  describeLastCount,
  exceedsBalance,
} from '../../../src/ui/keyboard/cash-form-model.ts';
import {
  reprintEntry,
  setCashSummaryTab,
  showNextDay,
  showPreviousDay,
} from '../../../src/ui/keyboard/cash-summary-controller.ts';
import {
  confirmDemoReset,
  exitDemoResetScreen,
} from '../../../src/ui/keyboard/demo-reset-controller.ts';
import { exitDiagnosticoScreen } from '../../../src/ui/keyboard/diagnostico-controller.ts';
import {
  CHECKOUT_LABELS,
  checkoutOptions,
  FORMAT_LABELS,
  FORMAT_OPTIONS,
} from '../../../src/ui/keyboard/printer-form-model.ts';
import {
  cancelPrinterScreen,
  choosePrinterCheckout,
  choosePrinterFormat,
  printTestReceipt,
  savePrinterForm,
  setPrinterFooter,
  setPrinterHeader,
} from '../../../src/ui/keyboard/printer-controller.ts';
import { cancelTraining, confirmTraining } from '../../../src/ui/keyboard/training-controller.ts';
import {
  activateVoidRow,
  cancelVoidConfirmation,
  confirmVoid,
  exitVoidScreen,
  loadVoidCandidates,
  updateVoidFilter,
  voidBalancePreview,
  voidQuestion,
  candidateCustomerName,
} from '../../../src/ui/keyboard/void-controller.ts';
import {
  decimalSeparator,
  parseAmount,
  parseNonNegativeAmount,
} from '../../../src/ui/parse-amount.ts';
import { PAYMENT_METHOD_LABELS } from '../../../src/ui/payment-labels.ts';
import { ReceiptView } from '../../../src/ui/print/ReceiptView.tsx';
import { sampleDocumentFor } from '../../../src/ui/print/resolve-receipt.ts';
import {
  cashBalanceSignal,
  cashErrorSignal,
  cashFieldsSignal,
  cashKindSignal,
  conceptSuggestionsSignal,
  nowMinuteSignal,
} from '../../../src/ui/state/cash.ts';
import {
  cashSummaryNoticeSignal,
  cashSummaryTabSignal,
  dayViewSignal,
  type CashSummaryTab,
} from '../../../src/ui/state/cash-summary.ts';
import { getCatalogRepository } from '../../../src/ui/state/catalog.ts';
import {
  demoResetErrorSignal,
  demoResetInProgressSignal,
} from '../../../src/ui/state/demo-reset.ts';
import { printerErrorSignal, printerFormSignal } from '../../../src/ui/state/printer.ts';
import { syncLogSignal } from '../../../src/ui/state/sync.ts';
import { trainingScreenSignal } from '../../../src/ui/state/training.ts';
import {
  filteredVoidCandidatesSignal,
  voidConfirmingSignal,
  voidErrorSignal,
  voidFilterSignal,
  voidLoadedSignal,
  voidMessageSignal,
  voidSelectionIndexSignal,
} from '../../../src/ui/state/void.ts';
import { SearchIcon } from '../components/icons.tsx';
import { Sheet } from '../components/sheet.tsx';
import { money, plural } from '../format.ts';
import { openNumberEntry, openTextEntry } from '../keyboards/entry.ts';
import { keypadText, parseKeypadText } from '../keyboards/keypad-model.ts';

const METHODS: PaymentMethod[] = ['cash', 'debit', 'credit', 'transfer', 'qr', 'account'];

function PageHeader(props: { title: string; onBack?: () => void; backLabel?: string }) {
  return (
    <div
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}
    >
      <h2 style={{ fontSize: '26px', margin: '8px 0 4px' }}>{props.title}</h2>
      {props.onBack !== undefined && (
        <button type="button" class="close" onClick={props.onBack}>
          {props.backLabel ?? 'Volver'}
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Resumen

function entryRow(entry: DayEntry, customerNames: ReadonlyMap<string, string>) {
  const view = dayViewSignal.value;
  switch (entry.kind) {
    case 'sale': {
      const sale = entry.sale;
      const mark =
        sale.voidsSaleId !== undefined
          ? voidOfLabel(sale, view?.voidOriginals.get(sale.voidsSaleId))
          : view !== undefined && isVoided(sale, view.voidedSaleIds)
            ? 'Anulada'
            : undefined;
      const customer =
        sale.customerId !== undefined ? customerNames.get(sale.customerId) : undefined;
      return {
        key: `s:${sale.id}`,
        title: ticketLabel(sale),
        sub: [
          formatTime(sale.createdAt),
          mark,
          customer,
          plural(sale.lines.length, 'línea', 'líneas'),
        ]
          .filter((part) => part !== undefined)
          .join(' · '),
        amount: sale.total,
        dimmed: mark !== undefined,
        printable: true,
      };
    }
    case 'collection': {
      const payment = entry.payment;
      const mark =
        payment.voidsPaymentId !== undefined
          ? voidOfReceiptLabel(payment, view?.paymentVoidOriginals.get(payment.voidsPaymentId))
          : view !== undefined && isVoidedPayment(payment, view.voidedPaymentIds)
            ? 'Anulada'
            : undefined;
      return {
        key: `p:${payment.id}`,
        title: `${receiptLabel(payment)} · ${customerNames.get(payment.customerId) ?? ''}`,
        sub: [formatTime(payment.createdAt), mark, 'Cobranza']
          .filter((p) => p !== undefined)
          .join(' · '),
        amount: payment.total,
        dimmed: mark !== undefined,
        printable: true,
      };
    }
    case 'movement': {
      const movement = entry.movement;
      const signed = movement.direction === 'in' ? movement.amount : -movement.amount;
      return {
        key: `m:${movement.id}`,
        title: movement.concept,
        sub: [
          formatTime(movement.createdAt),
          movement.direction === 'in' ? 'Ingreso' : 'Egreso',
          movement.description,
        ]
          .filter((p) => p !== undefined && p !== '')
          .join(' · '),
        amount: signed,
        dimmed: false,
        printable: false,
      };
    }
    case 'count': {
      const count = entry.count;
      const difference = countDifference(count.expected, count.counted);
      return {
        key: `c:${count.id}`,
        title: 'Arqueo',
        sub: `${formatTime(count.createdAt)} · ${difference !== undefined ? describeDifference(difference) : ''}`,
        amount: count.counted,
        dimmed: false,
        printable: false,
      };
    }
  }
}

const SUMMARY_TABS: [CashSummaryTab, string][] = [
  ['movements', 'Movimientos'],
  ['products', 'Productos'],
  ['payments', 'Medios de pago'],
];

/** `/RESUMEN`: un día, con los movimientos (tocar una venta la reimprime), productos y medios. */
export function SummaryScreen() {
  const view = dayViewSignal.value;
  const tab = cashSummaryTabSignal.value;
  const notice = cashSummaryNoticeSignal.value;
  if (view === undefined) {
    return <p class="empty">Cargando el resumen…</p>;
  }
  const today = localDateKey(new Date().toISOString());
  const { summary } = view;
  const cashOfDay =
    summary.cash.sales +
    summary.cash.income -
    summary.cash.expense +
    summary.cash.countAdjustments +
    summary.cash.collections;
  const entries = view.entries;
  const products = calculateProductQuantities(view.sales.filter((sale) => sale.lines.length > 0))
    .map((row) => ({
      ...row,
      name: getCatalogRepository().getProduct(row.productId)?.name ?? row.productId,
    }))
    .sort((a, b) => b.qty - a.qty);
  return (
    <div class="page">
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          justifyContent: 'space-between',
        }}
      >
        <button
          type="button"
          class="m-btn"
          aria-label="Día anterior"
          disabled={view.date <= view.oldestDate}
          onClick={() => void showPreviousDay()}
        >
          ‹
        </button>
        <h2 style={{ margin: 0, fontSize: '22px', textAlign: 'center' }}>
          {formatDayHeading(view.date, today)}
        </h2>
        <button
          type="button"
          class="m-btn"
          aria-label="Día siguiente"
          disabled={view.isToday}
          onClick={() => void showNextDay()}
        >
          ›
        </button>
      </div>
      <div class="stats" style={{ marginTop: '12px' }}>
        <div class="stat">
          <small>Vendido</small>
          <strong class="num">{money(summary.totalSold)}</strong>
        </div>
        <div class="stat">
          <small>
            Tickets{summary.voidedCount > 0 ? ` (${String(summary.voidedCount)} anul.)` : ''}
          </small>
          <strong class="num">{String(summary.ticketCount)}</strong>
        </div>
        <div class="stat">
          <small>Cobranzas ({String(summary.collections.count)})</small>
          <strong class="num">{money(summary.collections.total)}</strong>
        </div>
        <div class="stat">
          <small>Efectivo del día</small>
          <strong class="num">{money(cashOfDay)}</strong>
        </div>
      </div>
      <div class="cats" style={{ padding: '14px 0 4px' }}>
        {SUMMARY_TABS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            class="chip"
            aria-pressed={tab === id}
            onClick={() => {
              setCashSummaryTab(id);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {notice !== null && <p class="state-line change">{notice}</p>}
      {tab === 'movements' && (
        <div class="card list">
          {entries.length === 0 && <p class="note">No hay movimientos este día.</p>}
          {entries.map((entry) => {
            const row = entryRow(entry, view.customerNames);
            return (
              <button
                key={row.key}
                type="button"
                class="item"
                style={row.dimmed ? { opacity: 0.6 } : undefined}
                disabled={!row.printable}
                onClick={() => {
                  reprintEntry(entry, view.customerNames);
                }}
              >
                <span class="main">
                  <div class="title">{row.title}</div>
                  <div class="sub">{row.sub}</div>
                </span>
                <span class={row.amount < 0 ? 'amt num neg' : 'amt num'}>{money(row.amount)}</span>
              </button>
            );
          })}
        </div>
      )}
      {tab === 'movements' &&
        entries.some((entry) => entry.kind === 'sale' || entry.kind === 'collection') && (
          <p class="note">Tocá una venta o una cobranza para ver o reimprimir el comprobante.</p>
        )}
      {tab === 'products' && (
        <div class="card list">
          {products.length === 0 && <p class="note">No se vendieron productos este día.</p>}
          {products.map((row) => (
            <div class="item" key={row.productId}>
              <span class="main">
                <div class="title">{row.name}</div>
              </span>
              <span class="amt num">{formatQuantity(row.qty)}</span>
            </div>
          ))}
        </div>
      )}
      {tab === 'payments' && (
        <div class="card">
          {METHODS.map((method) => {
            const sales = summary.totalsByMethod[method];
            const collections = summary.collectionsByMethod[method];
            if (sales === 0 && collections === 0) return null;
            return (
              <div class="kv" key={method}>
                <span>{PAYMENT_METHOD_LABELS[method]}</span>
                <span class="num">
                  {money(sales + collections)}
                  {collections !== 0 ? ` (cobranzas ${money(collections)})` : ''}
                </span>
              </div>
            );
          })}
          {summary.adjustmentTotal !== 0 && (
            <div class="kv">
              <span>Descuentos y recargos</span>
              <span class="num">{money(summary.adjustmentTotal)}</span>
            </div>
          )}
          {METHODS.every(
            (method) =>
              summary.totalsByMethod[method] === 0 && summary.collectionsByMethod[method] === 0,
          ) && <p class="note">No hubo cobros este día.</p>}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Caja

function amountField(params: {
  label: string;
  text: string;
  onDone: (text: string) => void;
  hint?: string;
}) {
  const decimal = decimalSeparator(resolveLocale());
  return (
    <button
      type="button"
      class="field"
      onClick={() => {
        openNumberEntry({
          title: params.label,
          initial: params.text,
          prefix: '$',
          options: { decimals: 2, signed: false },
          ...(params.hint !== undefined ? { hint: () => params.hint ?? '' } : {}),
          onDone: (value) => {
            params.onDone(value === undefined ? '' : keypadText(value, decimal));
          },
        });
      }}
    >
      <small>{params.label}</small>
      {params.text === '' ? (
        <span class="ph">Tocá para cargar</span>
      ) : (
        <span class="num">{money(parseKeypadText(params.text, decimal) ?? 0)}</span>
      )}
    </button>
  );
}

/** `/CAJA`: arqueo (no ciego: muestra lo esperado), ingreso o egreso, con el teclado propio. */
export function CashScreen() {
  useLayoutEffect(() => {
    void loadCashScreen();
  }, []);
  const kind = cashKindSignal.value;
  useEffect(() => {
    if (kind !== 'count') openConceptSuggestions();
  }, [kind]);
  const fields = cashFieldsSignal.value;
  const balance = cashBalanceSignal.value;
  const error = cashErrorSignal.value;
  const counted = parseNonNegativeAmount(fields.counted);
  const difference = balance !== undefined ? countDifference(balance.balance, counted) : undefined;
  const amount = parseAmount(fields.amount);
  const suggestions = conceptSuggestionsSignal.value;
  return (
    <div class="page stack">
      <PageHeader title="Caja" onBack={cancelCash} />
      <div class="cats" style={{ padding: 0 }} role="group" aria-label="Tipo de movimiento">
        {CASH_KINDS.map((option) => (
          <button
            key={option}
            type="button"
            class="chip"
            aria-pressed={kind === option}
            onClick={() => {
              setCashKind(option);
            }}
          >
            {CASH_KIND_LABELS[option]}
          </button>
        ))}
      </div>
      <div class="card">
        <div class="kv">
          <span>Esperado en caja</span>
          <span class="num">{balance === undefined ? '…' : money(balance.balance)}</span>
        </div>
        <div class="kv">
          <span>{describeLastCount(balance?.lastCountAt, nowMinuteSignal.value)}</span>
          <span />
        </div>
      </div>
      {kind === 'count' ? (
        <>
          {amountField({
            label: 'Efectivo contado',
            text: fields.counted,
            onDone: (text) => {
              updateCashField('counted', text);
            },
          })}
          {difference !== undefined && (
            <p class={difference.kind === 'even' ? 'state-line change' : 'state-line due'}>
              {describeDifference(difference)}
            </p>
          )}
        </>
      ) : (
        <>
          <p class="section-title" style={{ margin: '6px 0 0' }}>
            Concepto
          </p>
          <div class="quick">
            {suggestions.map((concept) => (
              <button
                key={concept}
                type="button"
                class="chip"
                aria-pressed={fields.concept === concept}
                onClick={() => {
                  updateCashField('concept', concept);
                }}
              >
                {concept}
              </button>
            ))}
            <button
              type="button"
              class="chip"
              aria-pressed={fields.concept !== '' && !suggestions.includes(fields.concept)}
              onClick={() => {
                openTextEntry({
                  title: 'Concepto',
                  initial: fields.concept,
                  placeholder: kind === 'in' ? 'ej. Cambio inicial' : 'ej. Proveedor',
                  options: { capitalize: 'words', maxLength: 60 },
                  onDone: (text) => {
                    updateCashField('concept', text);
                  },
                });
              }}
            >
              {fields.concept !== '' && !suggestions.includes(fields.concept)
                ? fields.concept
                : 'Otro…'}
            </button>
          </div>
          <button
            type="button"
            class="field"
            onClick={() => {
              openTextEntry({
                title: 'Descripción (opcional)',
                initial: fields.description,
                placeholder: 'ej. Factura 123',
                options: { capitalize: 'words', maxLength: 120 },
                onDone: (text) => {
                  updateCashField('description', text);
                },
              });
            }}
          >
            <small>Descripción (opcional)</small>
            {fields.description === '' ? (
              <span class="ph">Tocá para escribir</span>
            ) : (
              <span>{fields.description}</span>
            )}
          </button>
          {amountField({
            label: 'Monto',
            text: fields.amount,
            onDone: (text) => {
              updateCashField('amount', text);
            },
          })}
          {balance !== undefined && exceedsBalance(kind, amount, balance.balance) && (
            <p class="state-line due">⚠ El egreso supera lo esperado en caja.</p>
          )}
        </>
      )}
      {error !== null && (
        <p class="state-line error" role="alert">
          {error.message}
        </p>
      )}
      <button
        type="button"
        class="m-btn m-btn-primary m-btn-block"
        onClick={() => void submitCash()}
      >
        {kind === 'count'
          ? 'Registrar arqueo'
          : kind === 'in'
            ? 'Registrar ingreso'
            : 'Registrar egreso'}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------- Anular

/** `/ANULAR`: ventas y cobranzas de las últimas 24 h; tocar una pide confirmación. */
export function VoidScreen() {
  useLayoutEffect(() => {
    void loadVoidCandidates();
  }, []);
  const candidates = filteredVoidCandidatesSignal.value;
  const filter = voidFilterSignal.value;
  const message = voidMessageSignal.value;
  const selected = candidates[voidSelectionIndexSignal.value];
  return (
    <div class="page stack">
      <PageHeader title="Anular" onBack={exitVoidScreen} backLabel="Volver a la venta" />
      <button
        type="button"
        class="tool"
        style={{ justifyContent: 'flex-start' }}
        onClick={() => {
          openTextEntry({
            title: 'Buscar',
            initial: filter,
            placeholder: 'Número, cliente o producto',
            options: { capitalize: 'none', maxLength: 40 },
            onDone: updateVoidFilter,
            okLabel: 'Buscar',
          });
        }}
      >
        <SearchIcon />
        <span>
          {filter === '' ? 'Buscar por número o cliente' : `«${filter}» · tocá para cambiar`}
        </span>
      </button>
      {message !== null && (
        <p class="state-line due" role="status">
          {message}
        </p>
      )}
      <div class="card list">
        {!voidLoadedSignal.value && <p class="note">Cargando…</p>}
        {voidLoadedSignal.value && candidates.length === 0 && (
          <p class="note">
            {filter === ''
              ? 'No hay ventas ni cobranzas de las últimas 24 horas para anular.'
              : 'Ningún documento coincide con la búsqueda.'}
          </p>
        )}
        {candidates.map((candidate, index) => {
          const isSale = candidate.kind === 'sale';
          const title = isSale ? ticketLabel(candidate.sale) : receiptLabel(candidate.payment);
          const at = isSale ? candidate.sale.createdAt : candidate.payment.createdAt;
          const total = isSale ? candidate.sale.total : candidate.payment.total;
          const name = candidateCustomerName(candidate);
          const mark =
            candidate.state === 'voided'
              ? 'Anulada'
              : candidate.state === 'void-document'
                ? 'Anulación'
                : undefined;
          return (
            <button
              key={isSale ? candidate.sale.id : candidate.payment.id}
              type="button"
              class="item"
              style={candidate.state !== 'voidable' ? { opacity: 0.55 } : undefined}
              onClick={() => {
                activateVoidRow(index);
              }}
            >
              <span class="main">
                <div class="title">
                  {title}
                  {isSale ? '' : ' · Cobranza'}
                </div>
                <div class="sub">
                  {[formatTime(at), mark, name === '' ? undefined : name]
                    .filter((p) => p !== undefined)
                    .join(' · ')}
                </div>
              </span>
              <span class={total < 0 ? 'amt num neg' : 'amt num'}>{money(total)}</span>
            </button>
          );
        })}
      </div>
      {voidConfirmingSignal.value && selected !== undefined && (
        <Sheet
          title="Anular"
          onClose={cancelVoidConfirmation}
          footer={
            <>
              <button type="button" class="m-btn" onClick={cancelVoidConfirmation}>
                Volver
              </button>
              <button type="button" class="m-btn m-btn-danger" onClick={() => void confirmVoid()}>
                Anular
              </button>
            </>
          }
        >
          <div class="stack">
            <p style={{ fontWeight: 700, fontSize: '18px', margin: 0 }}>{voidQuestion(selected)}</p>
            <p class="note" style={{ margin: 0 }}>
              Total {money(selected.kind === 'sale' ? selected.sale.total : selected.payment.total)}
              . Se registra otro documento que lo anula; el original no se modifica.
            </p>
            {voidBalancePreview(selected) !== undefined && (
              <p class="note">{voidBalancePreview(selected)}</p>
            )}
            {voidErrorSignal.value !== null && (
              <p class="state-line error" role="alert">
                {voidErrorSignal.value}
              </p>
            )}
          </div>
        </Sheet>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Diagnóstico

/** `/DIAGNOSTICO`, de solo lectura, y "Sincronizar ahora" (`/SINCRONIZAR`). */
export function DiagnosticsScreen() {
  const d = collectDiagnostics();
  const log = syncLogSignal.value;
  const config = d.config;
  const backend = d.backendStatus;
  return (
    <div class="page stack">
      <PageHeader title="Diagnóstico" onBack={exitDiagnosticoScreen} />
      <button type="button" class="m-btn m-btn-primary m-btn-block" onClick={() => void syncNow()}>
        Sincronizar ahora
      </button>
      <div class="card">
        <div class="kv">
          <span>Conexión</span>
          <span>
            {config.ok
              ? `${connectorLabel(config.value.type)} · ${originKey(config.value)}`
              : 'Sin configurar'}
          </span>
        </div>
        <div class="kv">
          <span>Red</span>
          <span>{d.online ? 'Con conexión' : 'Sin conexión'}</span>
        </div>
        <div class="kv">
          <span>Backend</span>
          <span>
            {backend.kind === 'ok'
              ? `OK · contrato ${backend.info.contractVersion}`
              : backend.kind === 'unknown'
                ? 'Sin consultar'
                : backend.kind === 'maintenance'
                  ? `En mantenimiento${backend.info.message !== undefined ? `: ${backend.info.message}` : ''}`
                  : `Incompatible (contrato ${backend.backendVersion})`}
          </span>
        </div>
        <div class="kv">
          <span>Empresa</span>
          <span>{d.company ?? 'no informada'}</span>
        </div>
        <div class="kv">
          <span>Capacidades</span>
          <span>
            {d.capabilities === undefined
              ? 'sin consultar'
              : d.capabilities.length === 0
                ? 'ninguna'
                : d.capabilities.join(', ')}
          </span>
        </div>
        <div class="kv">
          <span>Última sincronización</span>
          <span>
            {d.lastSyncedAt !== null
              ? new Date(d.lastSyncedAt).toLocaleString(resolveLocale())
              : 'nunca'}
          </span>
        </div>
        {d.lastSyncFailure !== null && (
          <div class="kv">
            <span>Último error</span>
            <span class="neg">{describeError(d.lastSyncFailure)}</span>
          </div>
        )}
        <div class="kv">
          <span>Lotes esperando confirmación</span>
          <span>{String(d.awaitingLots.length)}</span>
        </div>
        <div class="kv">
          <span>Modo sin conexión</span>
          <span>{describeOffline(d.offline)}</span>
        </div>
        {d.trainingSince !== null && (
          <div class="kv">
            <span>Entrenamiento</span>
            <span>desde {new Date(d.trainingSince).toLocaleString(resolveLocale())}</span>
          </div>
        )}
        <div class="kv">
          <span>Versión</span>
          <span>{d.posVersion} (mobile)</span>
        </div>
        <div class="kv">
          <span>Almacenamiento</span>
          <span>{d.storageNamespace}</span>
        </div>
        <div class="kv">
          <span>Dispositivo</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '12px' }}>{d.deviceId}</span>
        </div>
      </div>
      {d.notices.length > 0 && (
        <>
          <p class="section-title">Avisos del backend</p>
          <div class="card">
            {d.notices.map((notice, index) => (
              <div class="kv" key={String(index)}>
                <span>{notice.severity}</span>
                <span>{notice.message}</span>
              </div>
            ))}
          </div>
        </>
      )}
      <p class="section-title">Últimos intentos</p>
      <div class="card">
        {log.length === 0 && <p class="note">Todavía no hubo intentos en esta sesión.</p>}
        {log.slice(0, 8).map((entry, index) => (
          <div class="kv" key={String(index)}>
            <span>
              {entry.kind} · {formatTime(entry.at)}
            </span>
            <span class={entry.result.ok ? 'pos' : 'neg'}>
              {entry.result.ok ? 'OK' : entry.result.error}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Impresora

/** `/IMPRESORA`: formato, qué pasa al cobrar, encabezado y pie, con la vista previa. */
export function PrinterScreen() {
  const form = printerFormSignal.value;
  const error = printerErrorSignal.value;
  const options: CheckoutAction[] = checkoutOptions(form.format);
  const textField = (label: string, value: string, onDone: (text: string) => void) => (
    <button
      type="button"
      class="field"
      onClick={() => {
        openTextEntry({
          title: label,
          initial: value,
          placeholder: 'ej. Gracias por su compra',
          options: { capitalize: 'none', maxLength: 120 },
          onDone,
        });
      }}
    >
      <small>{label}</small>
      {value === '' ? <span class="ph">Sin texto</span> : <span>{value}</span>}
    </button>
  );
  return (
    <div class="page stack">
      <PageHeader title="Impresora" onBack={cancelPrinterScreen} backLabel="Cancelar" />
      <p class="section-title" style={{ margin: 0 }}>
        Formato
      </p>
      <div class="quick">
        {FORMAT_OPTIONS.map((format) => (
          <button
            key={format}
            type="button"
            class="chip"
            aria-pressed={form.format === format}
            onClick={() => {
              choosePrinterFormat(format);
            }}
          >
            {FORMAT_LABELS[format]}
          </button>
        ))}
      </div>
      <p class="section-title" style={{ margin: 0 }}>
        Al cobrar
      </p>
      <div class="quick">
        {options.map((option) => (
          <button
            key={option}
            type="button"
            class="chip"
            aria-pressed={form.onCheckout === option}
            onClick={() => {
              choosePrinterCheckout(option);
            }}
          >
            {CHECKOUT_LABELS[option]}
          </button>
        ))}
      </div>
      {textField('Encabezado', form.header, setPrinterHeader)}
      {textField('Pie', form.footer, setPrinterFooter)}
      <div class="m-paper">
        <ReceiptView document={sampleDocumentFor(form)} format={paperFormat(form.format)} />
      </div>
      {error !== null && (
        <p class="state-line error" role="alert">
          {error}
        </p>
      )}
      <div class="stack">
        <button
          type="button"
          class="m-btn m-btn-block"
          disabled={form.format === 'none'}
          onClick={() => void printTestReceipt()}
        >
          Prueba de impresión
        </button>
        <button type="button" class="m-btn m-btn-primary m-btn-block" onClick={savePrinterForm}>
          Guardar
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Reiniciar demo

export function DemoResetScreen() {
  const busy = demoResetInProgressSignal.value;
  const error = demoResetErrorSignal.value;
  return (
    <div class="page stack">
      <PageHeader title="Reiniciar la demo" onBack={exitDemoResetScreen} />
      <p>
        Se vuelve a cargar la demo en el backend y se borra todo lo de esta terminal: ventas, caja y
        lo pendiente. La conexión se conserva.
      </p>
      {error !== null && (
        <p class="state-line error" role="alert">
          {error}
        </p>
      )}
      <button
        type="button"
        class="m-btn m-btn-danger m-btn-block"
        disabled={busy}
        onClick={() => void confirmDemoReset()}
      >
        {busy ? 'Reiniciando…' : 'Reiniciar la demo'}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------- Entrenamiento

/** Entrar o salir del entrenamiento (#177): la lógica de escritorio, en un paso. */
export function TrainingScreen() {
  const state = trainingScreenSignal.value;
  if (state === null) return null;
  const busy = state.phase !== 'ready';
  const entering = state.mode === 'enter';
  return (
    <main class="full">
      <h1>{entering ? 'Entrar al entrenamiento' : 'Salir del entrenamiento'}</h1>
      {state.mode === 'enter' ? (
        <>
          <p>
            Vas a practicar con el catálogo, el stock y los clientes reales: podés vender, cobrar y
            usar la caja.
          </p>
          <p style={{ fontWeight: 700 }}>
            Nada se envía al backend. Al salir se borra todo lo que hiciste.
          </p>
          {state.phase === 'checking' ? (
            <p class="note">Revisando lo pendiente…</p>
          ) : (
            state.pending !== undefined && (
              <p class="note">{state.pending} Se intenta enviar antes de entrar.</p>
            )
          )}
        </>
      ) : (
        <>
          <div class="card" style={{ paddingBlock: '10px' }}>
            <p style={{ margin: '0 0 6px', fontWeight: 700 }}>Se descarta:</p>
            {state.discard.lines.map((line) => (
              <p key={line} style={{ margin: '2px 0' }}>
                {line}
              </p>
            ))}
          </div>
          <p class="note">
            Vuelven el stock, los saldos y el resumen reales; lo pendiente real sigue guardado.
          </p>
        </>
      )}
      {state.phase === 'starting' && <p class="note">Preparando el entrenamiento…</p>}
      {state.phase === 'leaving' && <p class="note">Saliendo…</p>}
      <div class="stack">
        <button
          type="button"
          class={entering ? 'm-btn m-btn-primary m-btn-block' : 'm-btn m-btn-danger m-btn-block'}
          disabled={busy}
          onClick={() => void confirmTraining()}
        >
          {entering ? 'Entrar al entrenamiento' : 'Descartar y salir'}
        </button>
        <button
          type="button"
          class="m-btn m-btn-block"
          disabled={busy}
          onClick={() => {
            cancelTraining();
          }}
        >
          {entering ? 'Cancelar' : 'Seguir entrenando'}
        </button>
      </div>
    </main>
  );
}
