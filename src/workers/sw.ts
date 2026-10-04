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

/**
 * Una copia con el contenido ya leído y sin la marca de redirección. Cloudflare Pages redirige
 * `index.html` a la carpeta, y Chrome rechaza (`ERR_FAILED`) una respuesta redirigida para una
 * navegación: guardada tal cual, el POS no abría (0.3.0). Leer el contenido enseguida, y no recién al
 * guardar, también importa: con HTTP/1.1 un cuerpo sin leer retiene la conexión, y con más archivos
 * que conexiones la instalación quedaba colgada.
 */
async function readCopy(response: Response): Promise<Response> {
  return new Response(await response.blob(), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

async function precache(): Promise<void> {
  // Todo o nada: se baja todo antes de guardar nada; si falla un archivo, falla la instalación y
  // queda la versión anterior. `reload` saltea la caché HTTP, así nunca se guarda un archivo viejo
  // con el nombre de uno nuevo.
  const responses = await Promise.all(
    precacheUrls.map(async (url) => {
      const response = await fetch(new Request(url, { cache: 'reload' }));
      if (!response.ok) {
        throw new Error(`No se pudo guardar ${url}: ${String(response.status)}`);
      }
      return [url, await readCopy(response)] as const;
    }),
  );
  const cache = await caches.open(cacheName);
  await Promise.all(responses.map(([url, response]) => cache.put(url, response)));
}

self.addEventListener('install', (event) => {
  event.waitUntil(precache());
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
