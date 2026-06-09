// ─────────────────────────────────────────────────────────────────────────────
// Service Worker — medtrack
// Strategy: stale-while-revalidate for HTML (instant load + background update)
//           cache-first for static CDN assets
//           skipWaiting always → new SW takes over immediately
// ─────────────────────────────────────────────────────────────────────────────
const CACHE = 'medtrack-v7';
const CDN_HOSTS = ['cdnjs.cloudflare.com','fonts.gstatic.com','fonts.googleapis.com','cdn.jsdelivr.net'];

// ── Install: skip waiting immediately so new SW activates without tab close ──
self.addEventListener('install', () => self.skipWaiting());

// ── Activate: delete old caches, claim all open clients ──────────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())   // ← take over existing open tabs/windows
  );
});

// ── Fetch ─────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', e => {
  const { request } = e;
  const url = new URL(request.url);

  // CDN assets: cache-first (they're versioned, never change)
  if (CDN_HOSTS.includes(url.hostname)) {
    e.respondWith(
      caches.match(request).then(cached =>
        cached || fetch(request).then(res => {
          if (res.ok) caches.open(CACHE).then(c => c.put(request, res.clone()));
          return res;
        })
      )
    );
    return;
  }

  // App shell (HTML/JS/icons): stale-while-revalidate
  //   → serve cached version instantly (no delay on startup)
  //   → fetch fresh copy in the background
  //   → on next open the fresh version is served
  //   + also post a message so the page can reload if the content changed
  if (request.destination === 'document' ||
      url.pathname.endsWith('.html') || url.pathname.endsWith('/') ||
      url.pathname.endsWith('.js')   || url.pathname.endsWith('.json') ||
      url.pathname.endsWith('.png')) {

    e.respondWith(
      caches.open(CACHE).then(async cache => {
        const cached = await cache.match(request);

        const fetchPromise = fetch(request).then(async networkRes => {
          if (!networkRes.ok) return networkRes;

          // Check if content changed
          const newClone   = networkRes.clone();
          const newText    = await newClone.text();
          const cachedText = cached ? await cached.clone().text() : null;

          await cache.put(request, new Response(newText, {
            status: networkRes.status,
            headers: networkRes.headers
          }));

          // Notify all clients that a new version is cached
          if (cachedText !== null && cachedText !== newText) {
            const clients = await self.clients.matchAll({ includeUncontrolled: true });
            clients.forEach(c => c.postMessage({ type: 'SW_UPDATED' }));
          }

          return new Response(newText, {
            status: networkRes.status,
            headers: networkRes.headers
          });
        }).catch(() => cached);

        // Return cached immediately; background revalidation happens in parallel
        return cached || fetchPromise;
      })
    );
    return;
  }

  // Everything else: network with cache fallback
  e.respondWith(
    fetch(request)
      .then(res => {
        if (res.ok) caches.open(CACHE).then(c => c.put(request, res.clone()));
        return res;
      })
      .catch(() => caches.match(request))
  );
});

// ── Messages from page ────────────────────────────────────────────────────────
self.addEventListener('message', e => {
  if (!e.data) return;
  if (e.data === 'skipWaiting') { self.skipWaiting(); return; }
  if (e.data.type === 'FORCE_UPDATE') { self.skipWaiting(); return; }

  if (e.data.type === 'SHOW_NOTIFICATION') {
    self.registration.showNotification(e.data.title, {
      body:     e.data.body,
      icon:     './icons/icon-192.png',
      badge:    './icons/icon-192.png',
      tag:      e.data.tag || 'medtrack',
      renotify: false,
      vibrate:  [200, 100, 200],
      data:     { url: self.registration.scope }
    });
  }
});

// ── Notification click: open / focus app ──────────────────────────────────────
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if (c.url.includes(self.registration.scope) && 'focus' in c) return c.focus();
      }
      return clients.openWindow(e.notification.data?.url || self.registration.scope);
    })
  );
});
