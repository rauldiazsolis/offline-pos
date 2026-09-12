import './tokens.css';
import { CheckoutScreen } from './screens/checkout-screen.tsx';
import { SaleScreen } from './screens/sale-screen.tsx';
import { activeScreenSignal } from './state/screen.ts';

export function App() {
  switch (activeScreenSignal.value) {
    case 'checkout':
      return <CheckoutScreen />;
    default:
      return <SaleScreen />;
  }
}
