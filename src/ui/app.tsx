import './tokens.css';
import { CheckoutScreen } from './screens/checkout-screen.tsx';
import { ConfigScreen } from './screens/config-screen.tsx';
import { ReceiptScreen } from './screens/receipt-screen.tsx';
import { SaleScreen } from './screens/sale-screen.tsx';
import { VoidSaleScreen } from './screens/void-sale-screen.tsx';
import { activeScreenSignal } from './state/screen.ts';

export function App() {
  switch (activeScreenSignal.value) {
    case 'checkout':
      return <CheckoutScreen />;
    case 'receipt':
      return <ReceiptScreen />;
    case 'void':
      return <VoidSaleScreen />;
    case 'config':
      return <ConfigScreen />;
    default:
      return <SaleScreen />;
  }
}
