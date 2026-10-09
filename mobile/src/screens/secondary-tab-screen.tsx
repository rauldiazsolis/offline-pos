import { useState } from 'preact/hooks';

type Props = {
  /** A esta pestaña la desplazaron desde otra (marca de `storage/tab-displaced.ts`). */
  displaced: boolean;
  onTakeOver: () => Promise<void>;
};

/**
 * Lo que ve una pestaña que no manda (#175). Nada de la app está inicializado, así que no depende
 * de ningún signal. "Usar esta pestaña" le pide a la otra que suelte, como en escritorio.
 */
export function SecondaryTabScreen({ displaced, onTakeOver }: Props) {
  const [taking, setTaking] = useState(false);
  return (
    <main class="full">
      {displaced && (
        <p role="status" class="note">
          Se empezó a usar el POS en otra pestaña.
        </p>
      )}
      <h1>El POS está abierto en otra pestaña</h1>
      <p class="note">
        Este navegador ya lo está usando en otra pestaña o ventana. Volvé a esa, o usalo acá: la
        otra se recarga y queda sin usar.
      </p>
      <button
        class="btn btn-primary btn-block"
        disabled={taking}
        onClick={() => {
          setTaking(true);
          void onTakeOver();
        }}
      >
        {taking ? 'Pasando el control…' : 'Usar esta pestaña'}
      </button>
    </main>
  );
}
