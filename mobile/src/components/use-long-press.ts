import { useState } from 'preact/hooks';

/** Cuánto hay que sostener el dedo para el toque sostenido. */
export const LONG_PRESS_MS = 500;

/** El temporizador del toque sostenido y si ya se disparó (el `click` de después se ignora). */
class LongPressTracker {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private fired = false;

  start(onLongPress: () => void): void {
    this.fired = false;
    this.cancel();
    this.timer = setTimeout(() => {
      this.fired = true;
      this.timer = null;
      onLongPress();
    }, LONG_PRESS_MS);
  }

  cancel(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  /** `true` si el `click` que llega es el de soltar un toque sostenido (y lo olvida). */
  consumeFired(): boolean {
    const fired = this.fired;
    this.fired = false;
    return fired;
  }
}

/**
 * Un toque corto y uno sostenido sobre el mismo botón. El sostenido se dispara a los 500 ms sin
 * levantar el dedo; el `click` que llega al soltar se ignora. Sin el menú del navegador.
 */
export function useLongPress(onTap: () => void, onLongPress: () => void) {
  const [tracker] = useState(() => new LongPressTracker());
  const cancel = (): void => {
    tracker.cancel();
  };
  return {
    onPointerDown: (): void => {
      tracker.start(onLongPress);
    },
    onPointerUp: cancel,
    onPointerLeave: cancel,
    onPointerCancel: cancel,
    onContextMenu: (event: Event): void => {
      event.preventDefault();
    },
    onClick: (): void => {
      if (!tracker.consumeFired()) onTap();
    },
  };
}
