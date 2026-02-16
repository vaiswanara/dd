/**
 * =====================================================================================
 * Service Worker (sw.js)
 * =====================================================================================
 * This service worker makes the Family Tree app a Progressive Web App (PWA)
 * by enabling offline functionality.
 *
 * Key features:
 * 1. Caching App Shell: On install, it caches all necessary files (HTML, CSS, JS, manifest).
 * 2. Cache-First Strategy: It serves assets from the cache first, falling back to the
 *    network if an asset is not cached. This makes the app load instantly and work offline.
 * 3. Caching Network Requests: Any new request (like the FamilyTree.js CDN script)
 *    is fetched from the network once and then stored in the cache for future offline use.
 * 4. Cache Management: The 'activate' event cleans up old, unused caches to save space.
 * =====================================================================================
 */

const CACHE_NAME = 'family-tree-cache-v3.7.2';

// All the files and assets the app needs to function offline.
const URLS_TO_CACHE = [
    './',
    './index.html',
    './app.js',
    './FamilyTree.js',
    './json_data/persons.json',
    './json_data/families.json',
    './json_data/places.json',
    './json_data/contacts.json',
    './manifest.json',
    './photos.json',
    './welcome.json',
    './logo.png'
];

// =================================================================================
// SECTION 1: INSTALL Event
// Caches all the app shell assets when the service worker is installed.
// =================================================================================
self.addEventListener('install', event => {
    console.log('[Service Worker] Install');
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('[Service Worker] Caching app shell');
                return cache.addAll(URLS_TO_CACHE);
            })
            .then(() => self.skipWaiting()) // Activate worker immediately
    );
});

// =================================================================================
// SECTION 2: ACTIVATE Event
// Cleans up old caches.
// =================================================================================
self.addEventListener('activate', event => {
    console.log('[Service Worker] Activate');
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    if (cacheName !== CACHE_NAME) {
                        console.log(`[Service Worker] Clearing old cache: ${cacheName}`);
                        return caches.delete(cacheName);
                    }
                })
            );
        })
        .then(() => self.clients.claim()) // Take control of all open clients
    );
});

// =================================================================================
// SECTION 3: FETCH Event
// Implements a "Cache-First, then Network" strategy.
// =================================================================================
self.addEventListener('fetch', event => {
    // We only want to cache GET requests.
    if (event.request.method !== 'GET') {
        return;
    }

    event.respondWith(
        caches.match(event.request)
            .then(cachedResponse => {
                // If the resource is in the cache, return it.
                if (cachedResponse) {
                    // console.log(`[Service Worker] Serving from cache: ${event.request.url}`);
                    return cachedResponse;
                }

                // If the resource is not in the cache, fetch it from the network.
                // console.log(`[Service Worker] Fetching from network: ${event.request.url}`);
                return fetch(event.request).then(networkResponse => {
                    // After fetching, put a copy in the cache for next time, but only for valid responses.
                    if (networkResponse && networkResponse.status === 200 && !event.request.url.startsWith('chrome-extension://')) {
                        const responseToCache = networkResponse.clone();
                        caches.open(CACHE_NAME).then(cache => {
                            cache.put(event.request, responseToCache);
                        });
                    }
                    return networkResponse;
                }).catch(error => {
                    console.error('[Service Worker] Fetch failed; user is likely offline.', error);
                    // Optional: You could return a fallback offline page here if you had one.
                });
            })
    );
});
