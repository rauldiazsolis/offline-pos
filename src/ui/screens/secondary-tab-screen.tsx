import { useState } from 'preact/hooks';
import { useFocusOnMount } from '../hooks/use-focus-on-mount.ts';
import { keepFocusOnMouseDown } from '../hooks/use-mouse-keeps-focus.ts';

type Props = {
  /** A esta pestaña la desplazaron desde otra (marca de `storage/tab-displaced.ts`). */
  displaced: boolean;
  onTakeOver: () => Promise<void>;
};

/**
 * Lo que ve una pestaña que no manda (#175): nada de la app está inicializado (ni signals, ni
 * Dexie, ni sync), así que la pantalla no depende de nada de eso. No hay link a la otra pestaña:
 * Chromium no deja traerla al frente (verificado en la spec). El botón tiene el foco, así que Enter
 * lo activa de forma nativa, igual que un click.
 */
export function SecondaryTabScreen({ displaced, onTakeOver }: Props) {
  const buttonRef = useFocusOnMount<HTMLButtonElement>();
  const [taking, setTaking] = useState(false);

  const takeOver = (): void => {
    if (taking) {
      return;
    }
    setTaking(true);
    void onTakeOver();
  };

  return (
    <div
      onMouseDown={keepFocusOnMouseDown}
      style={{
        height: '100svh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 'var(--space-3)',
        textAlign: 'center',
        padding: 'var(--space-4)',
        background: 'var(--color-bg)',
        color: 'var(--color-text)',
        fontFamily: 'var(--font-sans)',
      }}
    >
      {displaced && (
        <p role="status" style={{ margin: 0, fontWeight: 'bold' }}>
          Se empezó a usar el POS en otra pestaña.
        </p>
      )}
      <h1 style={{ margin: 0, fontSize: 'var(--font-size-xl)' }}>
        El POS está abierto en otra pestaña
      </h1>
      <p style={{ margin: 0, color: 'var(--color-text-muted)', maxWidth: '480px' }}>
        {
          'Este navegador ya lo está usando en otra pestaña o ventana. Volvé a esa, o usalo acá: la otra se recarga y queda sin usar.'
        }
      </p>
      <button
        ref={buttonRef}
        type="button"
        class="btn btn-primary"
        onClick={takeOver}
        disabled={taking}
      >
        {taking ? 'Tomando el control…' : 'Usar esta pestaña (Enter)'}
      </button>
    </div>
  );
}
