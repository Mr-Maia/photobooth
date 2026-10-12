// Service worker simples: guarda a cabine em cache para continuar a funcionar
// se a rede do local falhar e alguém recarregar a página no iPad.
// Estratégia "rede primeiro" — com internet usa sempre a versão mais recente.
const CACHE = 'photobooth-v2';
const BASE = [
  './', 'index.html', 'css/style.css', 'js/config.js', 'js/booth.js', 'js/effects.js', 'js/storage.js', 'js/lampadas.js',
  'vendor/qrcode.min.js', 'manifest.webmanifest', 'icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(BASE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  // Nunca mexer nos pedidos ao Firebase Storage
  if (url.hostname.includes('firebasestorage') || url.hostname.includes('googleapis.com') && !url.hostname.startsWith('fonts')) return;
  e.respondWith(
    fetch(request)
      .then((res) => {
        if (res.ok || res.type === 'opaque') {
          const copia = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copia));
        }
        return res;
      })
      .catch(() => caches.match(request, { ignoreSearch: url.origin === location.origin }))
  );
});
