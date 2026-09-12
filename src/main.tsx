import { render } from 'preact';
import './index.css';
import { App } from './ui/app.tsx';

const container = document.getElementById('app');
if (!container) {
  // Invariante de infraestructura, no un caso de negocio: si falta, index.html está roto.
  throw new Error('#app element not found');
}

render(<App />, container);
