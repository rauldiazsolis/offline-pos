/**
 * Un QR de conexión trae un link al POS: un link de demo (`?demo=true&backend=…`) o la vuelta del
 * alta o de una planilla (`#connect=…`). El POS mobile vive en otra carpeta que el de escritorio, así
 * que se queda con esos parámetros y los aplica a su propia dirección: `bootstrap` los procesa al
 * recargar, igual que si se hubiera abierto el link. Puro.
 */
export function connectionTargetFrom(scanned: string, here: string): string | null {
  let url: URL;
  let current: URL;
  try {
    url = new URL(scanned.trim());
    current = new URL(here);
  } catch {
    return null;
  }
  const isDemo = url.searchParams.get('demo') === 'true' && url.searchParams.has('backend');
  const isConnect = url.hash.startsWith('#connect=');
  if (!isDemo && !isConnect) {
    return null;
  }
  return `${current.origin}${current.pathname}${isDemo ? url.search : ''}${isConnect ? url.hash : ''}`;
}

/** Navega al link de conexión; si solo cambia el fragmento, recarga (si no, no se procesa). */
export function openConnectionTarget(target: string): void {
  const current = new URL(window.location.href);
  const next = new URL(target);
  window.location.assign(target);
  if (current.pathname === next.pathname && current.search === next.search) {
    window.location.reload();
  }
}
