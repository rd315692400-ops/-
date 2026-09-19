const CACHE = 'financial-manager-pwa-v6';

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
      // מוחק גרסאות Cache ישנות
      for (const key of await caches.keys()) {
        if (key !== CACHE) {
          await caches.delete(key);
        }
      }

      // מפעיל מיד את הגרסה החדשה
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // לא שומרים API במטמון
  // נתוני Open Finance תמיד נמשכים מהשרת
  if (url.pathname.startsWith('/api/')) {
    return;
  }

  e.respondWith(
    (async () => {
      try {
        // קודם מנסים להביא את הגרסה החדשה מהשרת
        const response = await fetch(e.request);

        if (
          e.request.method === 'GET' &&
          response.ok
        ) {
          const cache = await caches.open(CACHE);

          await cache.put(
            e.request,
            response.clone()
          );
        }

        return response;

      } catch (error) {
        // רק אם אין אינטרנט משתמשים במטמון
        return (
          await caches.match(e.request)
        ) || (
          await caches.match('/index.html')
        );
      }
    })()
  );
});
