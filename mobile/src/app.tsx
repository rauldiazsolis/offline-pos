import { useEffect } from 'preact/hooks';
import { isTrainingMode } from '../../src/storage/training-mode.ts';
import { enterCashScreen } from '../../src/ui/keyboard/cash-controller.ts';
import { triggerCashSummary } from '../../src/ui/keyboard/cash-summary-controller.ts';
import { toggleTraining } from '../../src/ui/keyboard/training-controller.ts';
import { demoConfirmSignal } from '../../src/ui/state/demo-confirm.ts';
import { activeScreenSignal, type ActiveScreen } from '../../src/ui/state/screen.ts';
import { connectionStateSignal } from '../../src/ui/state/sync.ts';
import { trainingScreenSignal } from '../../src/ui/state/training.ts';
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

function Shell() {
  useEffect(() => startCatalogBrowse(), []);
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
