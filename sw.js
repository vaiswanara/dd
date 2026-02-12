const CACHE_NAME = 'family-tree-v10';
const urlsToCache = [
  './index.html',
  './manifest.json',
  './family_data.csv'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const requestUrl = new URL(event.request.url);
  const isFamilyCsv = requestUrl.pathname.endsWith('/family_data.csv') || requestUrl.pathname.endsWith('family_data.csv');

  if (isFamilyCsv) {
    // Keep genealogy data fresh when online, but still work offline.
    event.respondWith(
      fetch(event.request)
        .then(networkResponse => {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, responseClone));
          return networkResponse;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then(response => response || fetch(event.request))
  );
});
