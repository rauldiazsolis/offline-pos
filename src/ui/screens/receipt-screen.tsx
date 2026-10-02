import type { TargetedKeyboardEvent } from 'preact';
import { paperFormat } from '../../storage/printer-config.ts';
import { useFocusOnMount } from '../hooks/use-focus-on-mount.ts';
import { keepFocusOnMouseDown } from '../hooks/use-mouse-keeps-focus.ts';
import { printReceipt } from '../print/after-close.ts';
import { ReceiptView } from '../print/ReceiptView.tsx';
import { receiptDocumentFor } from '../print/resolve-receipt.ts';
import { printerConfigSignal } from '../state/printer.ts';
import { receiptSignal } from '../state/receipt.ts';
import { activeScreenSignal } from '../state/screen.ts';

function closeReceipt(): void {
  const returnTo = receiptSignal.value?.returnTo ?? 'sale';
  receiptSignal.value = null;
  activeScreenSignal.value = returnTo;
}

/**
 * Solo si la pantalla sigue siendo esta: al cerrar, `closeReceipt` ya eligió a dónde volver (la
 * venta o `/RESUMEN`), y un último render antes de desmontar no lo tiene que pisar.
 */
function leaveWithoutReceipt(): void {
  if (activeScreenSignal.peek() === 'receipt') {
    activeScreenSignal.value = 'sale';
  }
}

/**
 * El comprobante de la venta recién cerrada, de la cobranza recién registrada (#101) o de una copia
 * pedida desde `/RESUMEN` (#174), dibujado en el formato de `/IMPRESORA`. Enter imprime si hay
 * papel; Esc vuelve a la venta o a `/RESUMEN`.
 */
export function ReceiptScreen() {
  const containerRef = useFocusOnMount<HTMLDivElement>();
  const current = receiptSignal.value;
  const config = printerConfigSignal.value;
  const canPrint = config.format !== 'none';

  if (current === null) {
    // Invariante: no se llega acá sin un comprobante; si pasa, se vuelve a la venta.
    leaveWithoutReceipt();
    return null;
  }

  const print = () => {
    printReceipt(current.source);
  };

  const handleKeyDown = (event: TargetedKeyboardEvent<HTMLDivElement>) => {
    // Un botón enfocado con Tab se activa solo con Enter (nativo): no duplicar el atajo.
    if (event.key === 'Enter' && event.target instanceof HTMLButtonElement) {
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (canPrint) print();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      closeReceipt();
    }
  };

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      // Teclado + mouse (Etapa 2 de #94): ver ui/hooks/use-mouse-keeps-focus.ts.
      onMouseDown={keepFocusOnMouseDown}
      style={{
        height: 'var(--app-height)',
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: 'var(--space-4)',
        gap: 'var(--space-4)',
        background: 'var(--color-bg)',
        color: 'var(--color-text)',
        fontFamily: 'var(--font-sans)',
      }}
    >
      <div style={{ boxShadow: 'var(--shadow-card)', border: '1px solid var(--color-border)' }}>
        <ReceiptView
          document={receiptDocumentFor(current.source, config)}
          format={paperFormat(config.format)}
        />
      </div>
      <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
        {canPrint && (
          <button type="button" class="btn btn-primary" onClick={print}>
            Imprimir (Enter)
          </button>
        )}
        <button type="button" class="btn" onClick={closeReceipt}>
          Continuar (Esc)
        </button>
      </div>
    </div>
  );
}
