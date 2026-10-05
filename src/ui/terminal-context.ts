import { effect } from '@preact/signals';
import { isTrainingMode } from '../storage/training-mode.ts';
import { terminalIdentitySignal, type TerminalIdentity } from './state/sync.ts';

/** Encabezado de la venta (#193): la empresa como título y la caja debajo; sin empresa, la caja. */
export type TerminalHeading = { title: string; subtitle?: string };

/** Caja y sucursal, en ese orden (#193); se omite lo que falte. Pura. */
function identityText(identity: TerminalIdentity | null): string | null {
  if (identity === null) {
    return null;
  }
  const text = [identity.pointOfSale, identity.branch]
    .filter((part) => part.trim() !== '')
    .join(' - ');
  return text === '' ? null : text;
}

/** Título y subtítulo del encabezado (#193); `null` sin conexión activa. Pura. */
export function terminalHeading(
  identity: TerminalIdentity | null,
  company: string | undefined,
): TerminalHeading | null {
  const place = identityText(identity);
  if (place === null) {
    return null;
  }
  const name = company?.trim() ?? '';
  return name === '' ? { title: place } : { title: name, subtitle: place };
}

/** Título de la pestaña: caja y sucursal, sin la empresa (#193). Pura. */
export function terminalTitle(identity: TerminalIdentity | null): string | null {
  return identityText(identity);
}

/** En entrenamiento (#177) la pestaña lo dice primero, también si queda en segundo plano. Pura. */
export function trainingTitle(title: string, training: boolean): string {
  return training ? `ENTRENAMIENTO · ${title}` : title;
}

/**
 * Mantiene `document.title` al día con la terminal (#193); sin conexión activa, `baseTitle`. En
 * entrenamiento, con el prefijo (#177). Devuelve la función que lo detiene (tests).
 */
export function startTerminalTitle(baseTitle: string): () => void {
  return effect(() => {
    document.title = trainingTitle(
      terminalTitle(terminalIdentitySignal.value) ?? baseTitle,
      isTrainingMode(),
    );
  });
}
