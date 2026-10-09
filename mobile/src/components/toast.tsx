import { useEffect } from 'preact/hooks';
import {
  commandBarErrorSignal,
  commandBarNoticeSignal,
  commandBarWarningSignal,
} from '../../../src/ui/state/command-bar.ts';

const VISIBLE_MS = 4000;

/**
 * Los avisos que en escritorio van al slot de la barra de comandos ("Ticket #4 registrado.", "Stock
 * disponible: 2", un error de negocio): acá, un aviso flotante que se va solo. Lee y limpia los mismos
 * signals, así los controllers de escritorio avisan sin saber de esta vista.
 */
export function Toast() {
  const error = commandBarErrorSignal.value;
  const warning = commandBarWarningSignal.value;
  const notice = commandBarNoticeSignal.value;
  const text = error ?? warning ?? notice;
  const kind = error !== null ? 'error' : warning !== null ? 'warn' : 'info';

  useEffect(() => {
    if (text === null) {
      return;
    }
    const timer = setTimeout(() => {
      commandBarErrorSignal.value = null;
      commandBarWarningSignal.value = null;
      commandBarNoticeSignal.value = null;
    }, VISIBLE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [text]);

  if (text === null) {
    return null;
  }
  return (
    <div
      class={kind === 'info' ? 'toast' : `toast toast--${kind}`}
      role={kind === 'error' ? 'alert' : 'status'}
      onClick={() => {
        commandBarErrorSignal.value = null;
        commandBarWarningSignal.value = null;
        commandBarNoticeSignal.value = null;
      }}
    >
      {text}
    </div>
  );
}
