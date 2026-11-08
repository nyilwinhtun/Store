const CACHE_PREFIX = 'minimart-pos-';
const CACHE_NAME = `${CACHE_PREFIX}v320-preview6-release-readiness`;

function scopedUrl(path) {
  return new URL(path, self.registration.scope).toString();
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    const shell = [
      scopedUrl('index.html'),
      scopedUrl('manifest.webmanifest'),
      scopedUrl('icon.svg'),
      scopedUrl('icon-192.png'),
      scopedUrl('icon-512.png'),
    ];
    await cache.addAll(shell);

    // Vite creates this list at build time. Resolve every entry beneath the
    // registered GitHub Pages project scope, not the domain root.
    try {
      const response = await fetch(scopedUrl('precache-manifest.json'), { cache: 'no-cache' });
      if (response.ok) {
        const manifest = await response.json();
        const files = Array.isArray(manifest.files) ? manifest.files : [];
        const urls = files.map((file) => scopedUrl(file));
        if (urls.length) await cache.addAll(urls);
      }
    } catch (error) {
      // Shell caching remains useful if a hashed asset fails to precache.
      console.warn('Minimart asset precache was incomplete:', error);
    }

    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    // GitHub Pages project sites share one origin. Never delete another app's
    // caches; only retire caches owned by this Minimart PWA.
    await Promise.all(keys
      .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const requestUrl = new URL(request.url);
  const scopeUrl = new URL(self.registration.scope);
  if (requestUrl.origin !== scopeUrl.origin || !requestUrl.pathname.startsWith(scopeUrl.pathname)) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      const appShellUrl = scopedUrl('index.html');
      try {
        const response = await fetch(request);
        if (response.ok && (response.headers.get('content-type') || '').includes('text/html')) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(appShellUrl, response.clone());
          return response;
        }
        // GitHub Pages can return a 404 for an app launch URL. If the app shell
        // is already cached, serve the shell so the installed app can recover.
        const fallback = await caches.match(appShellUrl);
        return fallback || response;
      } catch (error) {
        const fallback = await caches.match(appShellUrl);
        if (fallback) return fallback;
        throw error;
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, response.clone());
    }
    return response;
  })());
});
