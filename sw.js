const CACHE_NAME = 'ministering-v3';
const urlsToCache = [
    '/',
    '/index.html',
    '/app.js',
    '/styles.css',
    '/manifest.json',
    '/icon-192.png',
    '/icon-512.png'
];

// Install Event
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(urlsToCache))
            .then(() => self.skipWaiting())
    );
});

// Activate Event
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    if (cacheName !== CACHE_NAME) {
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

// Fetch Event - Network first, fallback to cache
self.addEventListener('fetch', event => {
    if (event.request.method !== 'GET') {
        return;
    }

    event.respondWith(
        fetch(event.request)
            .then(response => {
                if (!response || response.status !== 200 || response.type === 'error') {
                    return response;
                }

                // Clone the response
                const responseToCache = response.clone();

                caches.open(CACHE_NAME)
                    .then(cache => {
                        cache.put(event.request, responseToCache);
                    });

                return response;
            })
            .catch(() => {
                return caches.match(event.request)
                    .then(response => response || new Response('Offline - Unable to load resource', { status: 503 }));
            })
    );
});

// Handle Share Target POST
self.addEventListener('message', event => {
    if (event.data && event.data.type === 'SHARE_DATA') {
        // Store shared data and notify all clients
        self.clients.matchAll().then(clients => {
            clients.forEach(client => {
                client.postMessage({
                    type: 'SHARE_RECEIVED',
                    data: event.data.payload
                });
            });
        });
    }
});

// Handle POST requests from share target
self.addEventListener('fetch', event => {
    if (event.request.method === 'POST' && event.request.url.includes('/share')) {
        event.respondWith(
            event.request.clone().text().then(body => {
                // Parse form data
                const formData = new URLSearchParams(body);
                const text = formData.get('text') || '';
                const url = formData.get('url') || '';
                const title = formData.get('title') || '';

                // Notify all clients about the share
                self.clients.matchAll().then(clients => {
                    clients.forEach(client => {
                        client.postMessage({
                            type: 'SHARE_RECEIVED',
                            data: { text, url, title }
                        });
                    });
                });

                // Redirect to app with share data
                return new Response(
                    `<!DOCTYPE html>
                    <html>
                    <head>
                        <meta charset="utf-8">
                        <meta name="viewport" content="width=device-width, initial-scale=1">
                        <script>
                            // Redirect to app with share parameters
                            const params = new URLSearchParams({
                                text: '${encodeURIComponent(text)}',
                                url: '${encodeURIComponent(url)}',
                                title: '${encodeURIComponent(title)}'
                            });
                            window.location.href = '/?${params}';
                        </script>
                    </head>
                    <body>
                        <p>Redirecting...</p>
                    </body>
                    </html>`,
                    {
                        headers: { 'Content-Type': 'text/html' }
                    }
                );
            })
        );
    }
});
