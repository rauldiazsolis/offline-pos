import { useEffect } from 'preact/hooks';
import './styles.css';
import { isTrainingMode } from '../../src/storage/training-mode.ts';
import { applyAppUpdate } from '../../src/ui/keyboard/app-update-controller.ts';
import { enterCashScreen } from '../../src/ui/keyboard/cash-controller.ts';
import { triggerCashSummary } from '../../src/ui/keyboard/cash-summary-controller.ts';
import { toggleTraining } from '../../src/ui/keyboard/training-controller.ts';
import { appUpdateSignal } from '../../src/ui/state/app-update.ts';
import { demoConfirmSignal } from '../../src/ui/state/demo-confirm.ts';
import { activeScreenSignal, type ActiveScreen } from '../../src/ui/state/screen.ts';
import { connectionStateSignal } from '../../src/ui/state/sync.ts';
import { trainingScreenSignal } from '../../src/ui/state/training.ts';
import { setUiMode } from '../../src/ui/state/ui-mode.ts';
import { viewportWidthSignal } from '../../src/ui/state/viewport.ts';
import { signal } from '@preact/signals';
import { DemoAndPortalBar, Header } from './components/header.tsx';
import { CartIcon, CashIcon, ListIcon, MoreIcon } from './components/icons.tsx';
import { TicketBar, TicketSheet } from './components/ticket.tsx';
import { Toast } from './components/toast.tsx';
import { EntryHost } from './keyboards/entry-host.tsx';
import { CheckoutSheet, CollectionSheet, ReceiptSheet } from './screens/checkout-sheets.tsx';
import { ConfigScreen } from './screens/config-screen.tsx';
import { DemoConfirmScreen } from './screens/demo-confirm-screen.tsx';
import { MoreScreen } from './screens/more-screen.tsx';
import { SaleScreen } from './screens/sale-screen.tsx';
import { startCatalogBrowse } from './state/catalog-browse.ts';
import { startPendingCount } from './state/pending-count.ts';
import { cartOpenSignal, moreOpenSignal } from './state/nav.ts';
import {
  CashScreen,
  DemoResetScreen,
  DiagnosticsScreen,
  PrinterScreen,
  SummaryScreen,
  TrainingScreen,
  VoidScreen,
} from './screens/management.tsx';

type Tab = 'sale' | 'summary' | 'cash' | 'more';

function currentTab(screen: ActiveScreen): Tab {
  if (moreOpenSignal.value) return 'more';
  switch (screen) {
    case 'cash-summary':
      return 'summary';
    case 'cash':
      return 'cash';
    case 'void':
    case 'diagnostico':
    case 'printer':
    case 'demo-reset':
      return 'more';
    default:
      return 'sale';
  }
}

function goTo(tab: Tab): void {
  cartOpenSignal.value = false;
  moreOpenSignal.value = tab === 'more';
  switch (tab) {
    case 'sale':
    case 'more':
      activeScreenSignal.value = 'sale';
      return;
    case 'summary':
      void triggerCashSummary();
      return;
    case 'cash':
      enterCashScreen();
      return;
  }
}

function Tabs({ tab }: { tab: Tab }) {
  const tabs: [Tab, string, () => preact.JSX.Element][] = [
    ['sale', 'Vender', CartIcon],
    ['summary', 'Resumen', ListIcon],
    ['cash', 'Caja', CashIcon],
    ['more', 'Más', MoreIcon],
  ];
  return (
    <nav class="tabs" aria-label="Secciones">
      {tabs.map(([id, label, Icon]) => (
        <button
          key={id}
          type="button"
          aria-current={tab === id ? 'page' : undefined}
          onClick={() => {
            goTo(id);
          }}
        >
          <Icon />
          {label}
        </button>
      ))}
    </nav>
  );
}

function Content({ screen }: { screen: ActiveScreen }) {
  if (moreOpenSignal.value) return <MoreScreen />;
  switch (screen) {
    case 'cash-summary':
      return <SummaryScreen />;
    case 'cash':
      return <CashScreen />;
    case 'void':
      return <VoidScreen />;
    case 'diagnostico':
      return <DiagnosticsScreen />;
    case 'printer':
      return <PrinterScreen />;
    case 'demo-reset':
      return <DemoResetScreen />;
    default:
      return <SaleScreen />;
  }
}

/** Lo que se muestra encima de la pantalla: el cobro, la cobranza y el comprobante. */
function Overlay({ screen }: { screen: ActiveScreen }) {
  switch (screen) {
    case 'checkout':
      return <CheckoutSheet />;
    case 'collection':
      return <CollectionSheet />;
    case 'receipt':
      return <ReceiptSheet />;
    default:
      return cartOpenSignal.value && screen === 'sale' && !moreOpenSignal.value ? (
        <TicketSheet />
      ) : null;
  }
}

/** Ancho desde el que se sugiere la vista de escritorio (la de su diseño, sin zoom). */
const DESKTOP_SUGGESTION_PX = 1024;
const desktopSuggestionDismissedSignal = signal(false);

/** En una pantalla ancha, la vista de escritorio entra entera: se sugiere, nunca se cambia sola. */
function DesktopSuggestion() {
  if (viewportWidthSignal.value < DESKTOP_SUGGESTION_PX || desktopSuggestionDismissedSignal.value) {
    return null;
  }
  return (
    <div class="banner banner--info">
      <span>La pantalla es ancha: ¿usar la versión de escritorio?</span>
      <span style={{ display: 'flex', gap: '14px' }}>
        <button
          type="button"
          onClick={() => {
            desktopSuggestionDismissedSignal.value = true;
          }}
        >
          No
        </button>
        <button
          type="button"
          onClick={() => {
            setUiMode('desktop');
          }}
        >
          Usar escritorio
        </button>
      </span>
    </div>
  );
}

/** #54: una versión nueva descargada; se aplica a pedido, nunca con una venta en curso. */
function UpdateBanner() {
  const state = appUpdateSignal.value;
  if (state === 'none') return null;
  return (
    <div class="banner banner--info">
      <span>Hay una versión nueva del POS.</span>
      <button type="button" disabled={state === 'applying'} onClick={() => void applyAppUpdate()}>
        {state === 'applying' ? 'Actualizando…' : 'Actualizar'}
      </button>
    </div>
  );
}

function Shell() {
  useEffect(() => startCatalogBrowse(), []);
  useEffect(() => startPendingCount(), []);
  const screen = activeScreenSignal.value;
  const tab = currentTab(screen);
  const training = isTrainingMode();
  const onSale = tab === 'sale';
  return (
    <div class="app">
      {training && (
        <button type="button" class="training-band" onClick={() => void toggleTraining()}>
          ENTRENAMIENTO · tocá para salir
        </button>
      )}
      <Header />
      <DesktopSuggestion />
      <UpdateBanner />
      <DemoAndPortalBar />
      <main class="content">
        <Content screen={screen} />
      </main>
      {onSale && <TicketBar />}
      <Tabs tab={tab} />
      <Overlay screen={screen} />
    </div>
  );
}

function Screens() {
  // #176: un link de demo con algo que perder se confirma antes que nada.
  if (demoConfirmSignal.value !== null) return <DemoConfirmScreen />;
  // Sin conexión activa no hay otra pantalla posible (modo requerido, como en escritorio).
  if (connectionStateSignal.value !== 'active') return <ConfigScreen />;
  if (trainingScreenSignal.value !== null) return <TrainingScreen />;
  if (activeScreenSignal.value === 'config') return <ConfigScreen />;
  return <Shell />;
}

export function App() {
  return (
    <>
      <Screens />
      <EntryHost />
      <Toast />
    </>
  );
}
