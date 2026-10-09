import { connectionStateSignal } from '../../src/ui/state/sync.ts';

/** Etapa 0: solo la base. Las pantallas llegan en las etapas siguientes. */
export function App() {
  return (
    <main class="full">
      <h1>POS mobile</h1>
      <p class="note">Conexión: {connectionStateSignal.value}</p>
    </main>
  );
}
