import './tokens.css';
import { CashSessionScreen } from './screens/cash-session-screen.tsx';
import { CashSummaryScreen } from './screens/cash-summary-screen.tsx';
import { CheckoutScreen } from './screens/checkout-screen.tsx';
import { ConfigScreen } from './screens/config-screen.tsx';
import { DemoResetScreen } from './screens/demo-reset-screen.tsx';
import { DiagnosticoScreen } from './screens/diagnostico-screen.tsx';
import { ReceiptScreen } from './screens/receipt-screen.tsx';
import { SaleScreen } from './screens/sale-screen.tsx';
import { UnsupportedScreen } from './screens/unsupported-screen.tsx';
import { VoidSaleScreen } from './screens/void-sale-screen.tsx';
import { activeScreenSignal } from './state/screen.ts';
import { connectionStateSignal } from './state/sync.ts';
import { MIN_SUPPORTED_WIDTH_PX, viewportWidthSignal } from './state/viewport.ts';

function ActiveScreen() {
  // Etapa 2b (#76): sin una conexión activa no hay ninguna otra pantalla
  // posible — ni venta ni barra de comandos. La única salida es probar una
  // conexión en `/CONFIG` (modo requerido: sin Cancelar y Esc no sale).
  if (connectionStateSignal.value !== 'active') {
    return <ConfigScreen />;
  }
  switch (activeScreenSignal.value) {
    case 'checkout':
      return <CheckoutScreen />;
    case 'receipt':
      return <ReceiptScreen />;
    case 'void':
      return <VoidSaleScreen />;
    case 'config':
      return <ConfigScreen />;
    case 'cash':
      return <CashSessionScreen />;
    case 'cash-summary':
      return <CashSummaryScreen />;
    case 'demo-reset':
      return <DemoResetScreen />;
    case 'diagnostico':
      return <DiagnosticoScreen />;
    default:
      return <SaleScreen />;
  }
}

/**
 * Ciclo 8: por debajo de `MIN_SUPPORTED_WIDTH_PX`, `UnsupportedScreen`
 * reemplaza a toda la app — a propósito SIN `.app-zoom-wrapper`, así se
 * renderiza a tamaño real en vez de forzado al ancho de diseño (1024px)
 * zoomeado, que a esa altura ya no entraría en la ventana. Con ancho
 * suficiente, `.app-zoom-wrapper` (`tokens.css`) es lo que hace el zoom
 * responsive entre 600 y 1024px — ver ese archivo para el detalle.
 */
export function App() {
  if (viewportWidthSignal.value < MIN_SUPPORTED_WIDTH_PX) {
    return <UnsupportedScreen />;
  }
  return (
    <div class="app-zoom-wrapper">
      <ActiveScreen />
    </div>
  );
}
