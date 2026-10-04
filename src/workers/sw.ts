import { parseSwMessage, routeRequest, staleCaches, swCacheName } from './sw-logic.ts';

/**
 * Service worker del POS (#54). Lo compila `build/sw-plugin.ts` como script clásico, con la lista de
 * archivos del build y su hash inyectados. Nunca se activa solo si ya hay una versión andando: espera
 * a `/ACTUALIZAR` (mensaje `skip-waiting`) o a que no quede ninguna pestaña del POS abierta.
 */
declare const self: ServiceWorkerGlobalScope;
declare const __PRECACHE_FILES__: string[];
declare const __PRECACHE_HASH__: string;

const scope = self.registration.scope;
const cacheName = swCacheName(scope, __PRECACHE_HASH__);
const precacheUrls = __PRECACHE_FILES__.map((file) => new URL(file, self.location.href).href);
const precached = new Set(precacheUrls);
const indexUrl = new URL('index.html', self.location.href).href;

self.addEventListener('install', (event) => {
  // Todo o nada: si falla un archivo, falla la instalación y queda la versión anterior. `reload`
  // saltea la caché HTTP, así nunca se guarda un archivo viejo con el nombre de uno nuevo.
  event.waitUntil(
    caches
      .open(cacheName)
      .then((cache) =>
        cache.addAll(precacheUrls.map((url) => new Request(url, { cache: 'reload' }))),
      ),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(staleCaches(names, scope, cacheName).map((name) => caches.delete(name))),
      ),
  );
});

self.addEventListener('fetch', (event) => {
  const { method, url, mode } = event.request;
  const route = routeRequest({ method, url, mode }, scope, precached);
  if (route.kind === 'network') {
    return;
  }
  const target = route.kind === 'navigation' ? indexUrl : route.url;
  event.respondWith(
    caches
      .open(cacheName)
      .then((cache) => cache.match(target))
      .then((cached) => cached ?? fetch(event.request)),
  );
});

self.addEventListener('message', (event) => {
  if (parseSwMessage(event.data) !== null) {
    void self.skipWaiting();
  }
});
