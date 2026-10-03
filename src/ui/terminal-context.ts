import { effect } from '@preact/signals';
import { terminalIdentitySignal, type TerminalIdentity } from './state/sync.ts';

/** Caja, sucursal y empresa, en ese orden (#193); se omite lo que falte. Pura. */
export function terminalContextText(
  identity: TerminalIdentity | null,
  company: string | undefined,
): string | null {
  if (identity === null) {
    return null;
  }
  const text = [identity.pointOfSale, identity.branch, company]
    .filter((part): part is string => part !== undefined && part.trim() !== '')
    .join(' - ');
  return text === '' ? null : text;
}

/** Título de la pestaña: caja y sucursal, sin la empresa (#193). Pura. */
export function terminalTitle(identity: TerminalIdentity | null): string | null {
  return terminalContextText(identity, undefined);
}

/**
 * Mantiene `document.title` al día con la terminal (#193); sin conexión activa, `baseTitle`.
 * Devuelve la función que lo detiene (tests).
 */
export function startTerminalTitle(baseTitle: string): () => void {
  return effect(() => {
    document.title = terminalTitle(terminalIdentitySignal.value) ?? baseTitle;
  });
}
