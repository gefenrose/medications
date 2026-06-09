// sw.js — network-first, always fresh
const CACHE = 'medtrack-v8';
const CDN   = ['cdnjs.cloudflare.com','fonts.gstatic.com','fonts.googleapis.com','cdn.jsdelivr.net'];

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // CDN assets: cache-first (versioned, stable)
  if (CDN.includes(url.hostname)) {
    e.respondWith(
      caches.match(e.request).then(cached =>
        cached || fetch(e.request).then(res => {
          if (res.ok) caches.open(CACHE).then(c => c.put(e.request, res.clone()));
          return res;
        })
      )
    );
    return;
  }

  // App files: network-first, no cache delay
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' })
      .then(res => {
        if (res.ok) caches.open(CACHE).then(c => c.put(e.request, res.clone()));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});

self.addEventListener('message', e => {
  if (!e.data) return;
  if (e.data === 'skipWaiting') self.skipWaiting();
  if (e.data?.type === 'SHOW_NOTIFICATION') {
    self.registration.showNotification(e.data.title, {
      body: e.data.body, icon: './icons/icon-192.png',
      badge: './icons/icon-192.png', tag: e.data.tag || 'medtrack',
      vibrate: [200,100,200], data: { url: self.registration.scope }
    });
  }
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type:'window', includeUncontrolled:true }).then(list => {
      for (const c of list) if (c.url.includes(self.registration.scope) && 'focus' in c) return c.focus();
      return clients.openWindow(self.registration.scope);
    })
  );
});
// deployed 2026-06-09T11:25:09Z
