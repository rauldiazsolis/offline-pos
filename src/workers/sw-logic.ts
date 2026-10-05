import { z } from 'zod';
import { storageNamespaceFor } from '../storage/namespace-rules.ts';

/**
 * Lógica pura del service worker (#54), sin eventos ni `caches`: la capa fina es `sw.ts`. La Cache
 * Storage es una sola por origen, así que el nombre de caché sale de la carpeta del `scope` con el
 * mismo criterio que el almacenamiento (`/v4/` → `offline-pos@/v4/`): un canal nunca toca la caché
 * de otro.
 */
export function swCachePrefix(scopeUrl: string): string {
  return `${storageNamespaceFor(new URL(scopeUrl).pathname)}:sw:`;
}

export function swCacheName(scopeUrl: string, hash: string): string {
  return `${swCachePrefix(scopeUrl)}${hash}`;
}

export type SwRoute =
  { kind: 'navigation' } | { kind: 'precached'; url: string } | { kind: 'network' };

/**
 * Solo GET del mismo origen y dentro del `scope`. Una navegación a la carpeta (o a su `index.html`)
 * recibe el `index.html` (la query, como `?demo=…`, la lee la app); un archivo del build, su copia;
 * todo lo demás (el backend, `version.json`, las docs de `docs/`, otra carpeta) va a la red sin
 * tocarlo. La app no tiene rutas propias: una navegación a otra página de la carpeta nunca es el POS.
 */
export function routeRequest(
  request: { method: string; url: string; mode: string },
  scopeUrl: string,
  precached: ReadonlySet<string>,
): SwRoute {
  if (request.method !== 'GET') {
    return { kind: 'network' };
  }
  const url = new URL(request.url);
  const scope = new URL(scopeUrl);
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) {
    return { kind: 'network' };
  }
  const isAppPage =
    url.pathname === scope.pathname || url.pathname === `${scope.pathname}index.html`;
  if (request.mode === 'navigate' && isAppPage) {
    return { kind: 'navigation' };
  }
  const bare = `${url.origin}${url.pathname}`;
  return precached.has(bare) ? { kind: 'precached', url: bare } : { kind: 'network' };
}

/** Las cachés de esta carpeta que no son la actual: nunca las de otra carpeta ni las ajenas. */
export function staleCaches(
  cacheNames: readonly string[],
  scopeUrl: string,
  currentName: string,
): string[] {
  const prefix = swCachePrefix(scopeUrl);
  return cacheNames.filter((name) => name.startsWith(prefix) && name !== currentName);
}

const swMessageSchema = z.object({ type: z.literal('skip-waiting') });
export type SwMessage = z.infer<typeof swMessageSchema>;

/** El único mensaje que atiende: aplicar la versión en espera (`/ACTUALIZAR`). */
export function parseSwMessage(data: unknown): SwMessage | null {
  const parsed = swMessageSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}
