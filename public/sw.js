const CACHE_NAME = 'minimart-pos-v281-pwa-launch-fix';
const APP_SHELL = ['./', './index.html', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_SHELL);
    // Vite writes this manifest at build time so the app's hashed JS/CSS files
    // are cached during installation, including on GitHub Pages sub-paths.
    try {
      const response = await fetch('./precache-manifest.json');
      if (response.ok) {
        const manifest = await response.json();
        const files = Array.isArray(manifest.files) ? manifest.files : [];
        await cache.addAll(files.map((file) => new URL(file, self.registration.scope).toString()));
      }
    } catch (error) {
      console.warn('Precache manifest was not available:', error);
    }
  })());
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      const appShellUrl = new URL('./index.html', self.registration.scope).toString();
      try {
        const response = await fetch(request);
        if (response.ok) {
          const contentType = response.headers.get('content-type') || '';
          if (contentType.includes('text/html')) {
            const cache = await caches.open(CACHE_NAME);
            await cache.put(appShellUrl, response.clone());
          }
          return response;
        }
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
  event.respondWith(caches.match(request).then((cached) => cached || fetch(request).then((response) => {
    if (response.ok) {
      const copy = response.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
    }
    return response;
  })));
});
