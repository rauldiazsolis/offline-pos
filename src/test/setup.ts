import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/preact';

// Desmonta cualquier componente renderizado entre tests — sin esto, cada
// archivo de test con componentes tendría que llamar cleanup() a mano.
afterEach(() => {
  cleanup();
});
