// Scope-aware app-shell cache for WYPHA Studio & Customer Microsites V20.1
const PREFIX = 'wypha-v13.3.0';
const CACHE = PREFIX + '-portal-v20-1-valid-pwa-icons-20261113-' + encodeURIComponent(self.registration.scope);
const SHELL = ['./', 'index.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'].map(p => new URL(p, self.registration.scope).href);

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(c => Promise.allSettled(SHELL.map(u => c.add(new Request(u, { cache: 'reload' })))))
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k.startsWith(PREFIX) && k !== CACHE).map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  const root = new URL(self.registration.scope);
  if (url.origin !== root.origin) return;
  if (url.pathname.startsWith('/api/')) return;
  const isIndex = url.pathname === root.pathname || url.pathname === new URL('index.html', root).pathname;
  const isCustomerHtml = /\.html$/i.test(url.pathname);
  const key = isIndex ? SHELL[1] : url.href;
  if (!isIndex && !isCustomerHtml && !SHELL.includes(key)) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const response = await fetch(e.request);
      if (response && response.ok) {
        await cache.put(key, response.clone());
        return response;
      }
      return (await cache.match(key)) || response;
    } catch (err) {
      return (await cache.match(key)) || (await cache.match(SHELL[1])) || Response.error();
    }
  })());
});
