import type { ComponentChildren } from 'preact';

type Props = {
  title: string;
  /** Sin `onClose` no hay "Cerrar" ni se cierra tocando afuera (una hoja que exige decidir). */
  onClose?: () => void;
  closeLabel?: string;
  footer?: ComponentChildren;
  /** Ocupa todo el alto disponible (listas largas, teclado de letras). */
  full?: boolean;
  children: ComponentChildren;
  testId?: string;
};

/**
 * Hoja inferior: todo lo que en escritorio es un modal. Se anima solo al montarse; los cambios de
 * contenido (cada tecla de un teclado) re-renderizan sin volver a animar.
 */
export function Sheet({ title, onClose, closeLabel, footer, full, children, testId }: Props) {
  return (
    <>
      <div class="backdrop" onClick={onClose} />
      <section
        class={full === true ? 'sheet sheet--full' : 'sheet'}
        role="dialog"
        aria-label={title}
        data-testid={testId}
      >
        <header class="sheet-head">
          <h2>{title}</h2>
          {onClose !== undefined && (
            <button type="button" class="close" onClick={onClose}>
              {closeLabel ?? 'Cerrar'}
            </button>
          )}
        </header>
        <div class="sheet-body">{children}</div>
        {footer !== undefined && <footer class="sheet-foot">{footer}</footer>}
      </section>
    </>
  );
}
