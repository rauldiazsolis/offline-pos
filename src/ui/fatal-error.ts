/**
 * Manejador global de errores que ocurren fuera del árbol de componentes de
 * Preact (bootstrap, listeners globales — ver "Manejo de errores" en
 * CLAUDE.md). Todo lo que no es un error de negocio anticipado se deja
 * explotar como excepción real hasta acá. Por ahora siempre decide "no se
 * puede continuar" y muestra una pantalla bloqueante, sin retry silencioso.
 *
 * Usa DOM plano (no Preact) a propósito: tiene que funcionar aunque lo que
 * se haya roto sea el bootstrap de la propia app.
 */
export function renderFatalError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);

  document.body.textContent = '';

  const main = document.createElement('main');
  main.style.cssText =
    'min-height:100svh;display:flex;flex-direction:column;align-items:center;' +
    'justify-content:center;gap:8px;font-family:system-ui,sans-serif;background:#fff;' +
    'color:#18181b;padding:16px;text-align:center;';

  const title = document.createElement('h1');
  title.style.cssText = 'margin:0;font-size:20px;';
  title.textContent = 'Ocurrió un error inesperado';

  const detail = document.createElement('p');
  detail.style.cssText = 'margin:0;color:#71717a;max-width:480px;';
  detail.textContent = message;

  const hint = document.createElement('p');
  hint.style.cssText = 'margin:0;color:#71717a;';
  hint.textContent = 'Recargá la página para reintentar.';

  main.append(title, detail, hint);
  document.body.append(main);
}
