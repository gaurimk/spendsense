/**
 * SpendSense - Progressive Web App Service Worker
 * Caches application shell and static assets for fast mobile loading.
 * API requests always bypass the cache for real-time accuracy.
 */

const CACHE_NAME = 'spendsense-v2';
const STATIC_ASSETS = [
    '/',
    '/manifest.json',
    '/css/style.css',
    '/icons/icon-192.svg',
    '/icons/icon-512.svg',
    '/js/icons.js',
    '/js/utils.js',
    '/js/api.js',
    '/js/app.js',
    '/js/auth.js',
    '/js/bill-card.js',
    '/js/bill-modal.js',
    '/js/bills.js',
    '/js/budgets.js',
    '/js/chat.js',
    '/js/image-prep.js',
    '/js/insights.js',
    '/js/price-tracker.js',
    '/js/reminders.js',
    '/js/settings.js',
    '/js/firebase-config.js',
    '/js/firebase-auth.js',
    '/js/firebase-firestore.js',
    '/js/firebase-storage.js'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(STATIC_ASSETS);
        }).then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
            );
        }).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // Bypass cache for API calls, uploads, or non-GET requests
    if (url.pathname.startsWith('/api') || url.pathname.startsWith('/uploads') || event.request.method !== 'GET') {
        return;
    }

    // Network-first for navigation requests (HTML) to ensure fresh app shell
    if (event.request.mode === 'navigate') {
        event.respondWith(
            fetch(event.request).then((networkResponse) => {
                if (networkResponse && networkResponse.status === 200) {
                    const responseClone = networkResponse.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(event.request, responseClone);
                    });
                }
                return networkResponse;
            }).catch(() => {
                return caches.match('/');
            })
        );
        return;
    }

    // Stale-while-revalidate for static assets
    event.respondWith(
        caches.match(event.request).then((cachedResponse) => {
            const fetchPromise = fetch(event.request).then((networkResponse) => {
                if (networkResponse && networkResponse.status === 200) {
                    const responseClone = networkResponse.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(event.request, responseClone);
                    });
                }
                return networkResponse;
            }).catch(() => {
                // If offline and not in cache, fallback
                return cachedResponse;
            });

            return cachedResponse || fetchPromise;
        })
    );
});
