/* Service worker: offline shell + caching van statische EPG-data. */
const VERSION = 'tvgids-v3';
const CACHE = `tvgids-${VERSION}`;

// De scope (bv. "/tvgids/") bepaalt het base-pad; alle paden zijn daaraan gerelateerd.
const scope = self.registration.scope;

const PRECACHE = [
  scope,
  `${scope}instellingen`,
  `${scope}admin`,
  `${scope}manifest.webmanifest`,
  `${scope}icons/icon.svg`,
  `${scope}icons/icon-180.png`,
  `${scope}icons/icon-192.png`,
  `${scope}icons/icon-512.png`,
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE).catch(() => {}))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(request);
    if (res && res.ok) cache.put(request, res.clone());
    return res;
  } catch {
    return (await cache.match(request)) || Response.error();
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  const fetchPromise = fetch(request)
    .then((res) => {
      if (res && res.ok) cache.put(request, res.clone());
      return res;
    })
    .catch(() => cached);
  return cached || fetchPromise;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith(scope)) return;

  const path = url.pathname.slice(scope.length);

  // EPG/zoekdata: netwerk eerst, val terug op laatst opgehaalde data (offline).
  if (path.startsWith('data/')) {
    event.respondWith(networkFirst(request));
    return;
  }

  // Navigatie: netwerk eerst, offline shell als fallback.
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }

  // Statische assets en afbeeldingen: stale-while-revalidate.
  event.respondWith(staleWhileRevalidate(request));
});
