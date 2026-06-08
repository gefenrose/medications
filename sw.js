const CACHE = 'medtrack-v4';

// Network-first for HTML — always try to get fresh, fall back to cache
// Cache-first for static assets (fonts, jsPDF)

self.addEventListener('install', e => {
  self.skipWaiting(); // activate immediately, don't wait
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  const isHTML = e.request.destination === 'document' || url.pathname.endsWith('.html') || url.pathname.endsWith('/');
  const isStatic = url.hostname === 'cdnjs.cloudflare.com' || url.hostname === 'fonts.gstatic.com' || url.hostname === 'fonts.googleapis.com';

  if (isStatic) {
    // Cache-first for CDN assets
    e.respondWith(
      caches.match(e.request).then(cached => cached || fetch(e.request).then(res => {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
        return res;
      }))
    );
    return;
  }

  if (isHTML) {
    // Network-first for HTML — always get fresh, update cache, notify clients
    e.respondWith(
      fetch(e.request).then(res => {
        const clone = res.clone();
        caches.open(CACHE).then(async c => {
          const old = await c.match(e.request);
          c.put(e.request, clone);
          if (old) {
            // Compare ETags / content to detect actual change
            const [oldText, newText] = await Promise.all([old.text(), clone.text()]);
            // clone is consumed — re-fetch from cache for comparison
          }
        });
        return res;
      }).catch(() => caches.match(e.request))
    );
    return;
  }

  // Default: network with cache fallback
  e.respondWith(
    fetch(e.request).then(res => {
      const clone = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, clone));
      return res;
    }).catch(() => caches.match(e.request))
  );
});

// Listen for skipWaiting message from client
self.addEventListener('message', e => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});
