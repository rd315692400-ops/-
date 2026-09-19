const CACHE = 'financial-manager-pwa-v2';

const SHELL = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icon-192.png',
  '/icon-512.png'
];

self.addEventListener('install', e => {
  self.skipWaiting();

  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(SHELL))
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    (async () => {
      for (const k of await caches.keys()) {
        if (k !== CACHE) {
          await caches.delete(k);
        }
      }

      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);

  // בקשות Open Finance תמיד נמשכות ישירות מהשרת
  if (u.pathname.startsWith('/api/')) {
    return;
  }

  e.respondWith(
    (async () => {
      try {
        const r = await fetch(e.request);

        if (
          e.request.method === 'GET' &&
          r.ok
        ) {
          const c = await caches.open(CACHE);
          c.put(e.request, r.clone());
        }

        return r;

      } catch (err) {
        return (
          await caches.match(e.request)
        ) || (
          await caches.match('/index.html')
        );
      }
    })()
  );
});
