/* Service worker CliniPneumo
 * ---------------------------------------------------------------
 * Contrainte principale : l'application est un fichier HTML unique
 * d'environ 12 Mo. Toute stratégie qui le retélécharge à chaque
 * ouverture coûte de la donnée mobile et du quota de cache.
 *
 * Principe retenu :
 *   - le document est servi depuis le cache, sans requête réseau ;
 *   - un fichier « version.json » de quelques octets est interrogé
 *     à la place, et le document n'est retéléchargé que si la
 *     version a changé ;
 *   - l'utilisateur est prévenu qu'une mise à jour est disponible
 *     plutôt que de la subir au milieu d'une consultation.
 *
 * Déploiement : incrémenter VERSION ci-dessous ET dans version.json.
 * --------------------------------------------------------------- */

const VERSION      = '0.9.1';
const CACHE_APP    = 'clinipneumo-app-' + VERSION;
const CACHE_STATIC = 'clinipneumo-static-' + VERSION;

/* Le document lui-même : une seule entrée, jamais dupliquée. */
const DOCUMENT = '/index.html';

/* Ressources légères. Volontairement séparées du document :
 * leur échec ne doit pas empêcher la mise en cache de l'application. */
const STATIQUES = [
  '/manifest.json',
  '/icon-180.png',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-192-maskable.png',
  '/icon-512-maskable.png'
];

/* ---------- Installation ---------- */
self.addEventListener('install', function (event) {
  event.waitUntil((async function () {
    /* 1. Le document, obligatoire. */
    const appCache = await caches.open(CACHE_APP);
    await appCache.add(new Request(DOCUMENT, { cache: 'reload' }));

    /* 2. Les ressources légères, une par une : un 404 sur une icône
     *    ne doit pas faire échouer toute l'installation. */
    const staticCache = await caches.open(CACHE_STATIC);
    await Promise.all(STATIQUES.map(function (url) {
      return staticCache.add(new Request(url, { cache: 'reload' }))
        .catch(function () { /* ressource absente : on continue */ });
    }));
  })());
  /* Pas de skipWaiting() ici : le nouveau service worker attend que
   * l'utilisateur accepte la mise à jour (voir message SKIP_WAITING). */
});

/* ---------- Activation ---------- */
self.addEventListener('activate', function (event) {
  event.waitUntil((async function () {
    const noms = await caches.keys();
    await Promise.all(noms.map(function (nom) {
      if (nom !== CACHE_APP && nom !== CACHE_STATIC) return caches.delete(nom);
    }));
    if (self.registration.navigationPreload) {
      await self.registration.navigationPreload.disable();
    }
    await self.clients.claim();
  })());
});

/* ---------- Interception ---------- */
self.addEventListener('fetch', function (event) {
  const req = event.request;

  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return;   /* CDN, polices, OCR */

  /* version.json : toujours le réseau, jamais mis en cache.
   * C'est ce fichier — quelques octets — qui remplace la
   * revalidation du document de 12 Mo. */
  if (url.pathname.endsWith('/version.json')) {
    event.respondWith(
      fetch(req, { cache: 'no-store' }).catch(function () {
        return new Response('{"version":"' + VERSION + '"}',
          { headers: { 'Content-Type': 'application/json' } });
      })
    );
    return;
  }

  /* Navigations : le document depuis le cache, sans requête réseau.
   * Toute URL de navigation retombe sur le document unique — l'appli
   * gère sa propre navigation par ancres. */
  if (req.mode === 'navigate') {
    event.respondWith((async function () {
      const cache = await caches.open(CACHE_APP);
      const doc = await cache.match(DOCUMENT);
      if (doc) return doc;
      try {
        return await fetch(req);
      } catch (e) {
        return new Response(
          '<!doctype html><meta charset="utf-8">' +
          '<title>CliniPneumo — hors ligne</title>' +
          '<body style="font-family:system-ui;padding:24px;color:#1a365d">' +
          '<h1 style="font-size:18px">Application indisponible</h1>' +
          '<p style="font-size:14px;line-height:1.6">Le contenu n\u2019a pas encore ' +
          '\u00e9t\u00e9 mis en cache. Reconnectez-vous une fois pour l\u2019installer, ' +
          'puis il restera accessible hors ligne.</p></body>',
          { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
        );
      }
    })());
    return;
  }

  /* Ressources légères : cache d'abord, réseau en secours.
   * Le document n'est jamais revalidé ici. */
  event.respondWith((async function () {
    const cached = await caches.match(req);
    if (cached) return cached;
    try {
      const rep = await fetch(req);
      if (rep && rep.status === 200 && rep.type === 'basic') {
        const cache = await caches.open(CACHE_STATIC);
        cache.put(req, rep.clone());
      }
      return rep;
    } catch (e) {
      return new Response('', { status: 504, statusText: 'Hors ligne' });
    }
  })());
});

/* ---------- Mise à jour pilotée par la page ---------- */
self.addEventListener('message', function (event) {
  if (!event.data) return;
  if (event.data.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data.type === 'VERSION') {
    if (event.ports && event.ports[0]) event.ports[0].postMessage(VERSION);
  }
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
