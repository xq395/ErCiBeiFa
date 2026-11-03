const C = 'beifa-v10';
const FILES = ['./', 'index.html', 'style.css', 'syllabus.js', 'courses.js', 'core.js', 'ai.js', 'timetable.js', 'agent.js', 'memory.js', 'events.js', 'chatctl.js', 'goals.js', 'today.js', 'views.js', 'update.js', 'settings.js', 'kb.js', 'kbui.js', 'stars.js', 'threads.js', 'native.js', 'manifest.webmanifest', 'icon-192.png'];
self.addEventListener('install', e => e.waitUntil(caches.open(C).then(c => c.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys()
  .then(ks => Promise.all(ks.filter(k => k !== C).map(k => caches.delete(k)))).then(() => self.clients.claim())));
// 网络优先，断网用缓存；接口不缓存
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.includes('/api/')) return;
  e.respondWith(fetch(e.request).then(r => {
    const copy = r.clone();
    caches.open(C).then(c => c.put(e.request, copy));
    return r;
  }).catch(() => caches.match(e.request)));
});
