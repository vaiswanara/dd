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

const CACHE_NAME = 'family-tree-cache-v10.0.1';

// All the files and assets the app needs to function offline.
const URLS_TO_CACHE = [
    './',
    './index.html',
    './ADM/admin.html',
    './app.js',
    './config.json',
    './icon-192.png',
    './icon-512.png',
    './ftree.jpg',
    './logo.png',
    './dateUtils.js',
    './relationship.js'
];

// =================================================================================
// SECTION 1: INSTALL Event
// Caches all the app shell assets when the service worker is installed.
// =================================================================================
self.addEventListener('install', event => {
    console.log('[Service Worker] Install');
    event.waitUntil(
        caches.open(CACHE_NAME).then(async cache => {
                console.log('[Service Worker] Caching app shell');
                await cache.addAll(URLS_TO_CACHE);

                // Dynamically cache data files defined in config.json.
                // We fetch with a timestamp to ensure we get the LATEST config (bypassing HTTP cache),
                // but we store it as './config.json' so the app finds it offline.
                try {
                    const configReq = new Request(`./config.json?t=${Date.now()}`);
                    const response = await fetch(configReq);
                    const config = await response.clone().json(); // Clone because we read body twice (json + put)
                    
                    // Store the fresh config in cache using the standard key
                    await cache.put('./config.json', response);

                    const dataFiles = [
                        config.data_files.persons,
                        config.data_files.families,
                        config.data_files.places,
                        config.data_files.contacts,
                        config.data_files.manifest,
                        config.data_files.photos,
                        config.data_files.updates,
                        config.data_files.relationshipDictionary,
                        config.data_files.transit,
                        config.data_files.transit_moon
                    ].filter(path => path) // Filter out undefined paths to prevent errors
                     .map(path => './' + path);
                    
                    console.log('[Service Worker] Caching dynamic data files');
                    return cache.addAll(dataFiles);
                } catch (error) {
                    console.error('[Service Worker] Failed to cache dynamic files:', error);
                }
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

    // EXCLUDE Google Sheets from Cache (Network Only)
    // This ensures we never store the welcome message and always fetch it live.
    if (event.request.url.includes('docs.google.com')) {
        event.respondWith(fetch(event.request));
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
