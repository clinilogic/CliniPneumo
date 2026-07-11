// Service worker CliniPneumo — mise en cache pour usage hors-ligne
// Incrémenter CACHE_VERSION à chaque mise à jour du contenu pour forcer le rafraîchissement.
const CACHE_VERSION = 'clinipneumo-v1';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

// Installation : mise en cache des fichiers essentiels
self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(function(cache) {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  self.skipWaiting();
});

// Activation : suppression des anciens caches (versions précédentes)
self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(cacheNames) {
      return Promise.all(
        cacheNames.filter(function(name) {
          return name !== CACHE_VERSION;
        }).map(function(name) {
          return caches.delete(name);
        })
      );
    })
  );
  self.clients.claim();
});

// Récupération : cache d'abord, réseau en secours (et mise à jour du cache si réseau disponible)
self.addEventListener('fetch', function(event) {
  // ne pas intercepter les requêtes vers des domaines externes (CDN OCR, etc.)
  if (event.request.method !== 'GET' || !event.request.url.startsWith(self.location.origin)) {
    return;
  }
  event.respondWith(
    caches.match(event.request).then(function(cachedResponse) {
      const networkFetch = fetch(event.request).then(function(networkResponse) {
        if (networkResponse && networkResponse.status === 200) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_VERSION).then(function(cache) {
            cache.put(event.request, responseClone);
          });
        }
        return networkResponse;
      }).catch(function() {
        return cachedResponse;
      });
      return cachedResponse || networkFetch;
    })
  );
});
