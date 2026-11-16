/* Offline service worker for 海立方 廿一點.
   HTML and JS are network-first so a published update is not stuck behind
   an older worker that cached play.html. Icons stay cache-first.
   Requests with a reload/no-cache mode go to the network, so the next
   worker can precache fresh files while this one is still in control. */
var PREFIX = 'oceanus-', CACHE = PREFIX + 'oce21-2026-11e';
var ASSETS = ["./", "./index.html", "./play.html", "./engine.js", "./manifest.webmanifest",
  "./apple-touch-icon.png", "./icon-192.png", "./icon-512.png", "./icon-maskable-512.png"];

function wantsNetwork(req) {
  return req.cache === 'reload' || req.cache === 'no-store' || req.cache === 'no-cache';
}
function isCode(url) {
  var path = url.pathname;
  return path.endsWith('.js') || path.endsWith('.html') || path.endsWith('/');
}
function put(req, res) {
  if (res.ok && res.type === 'basic') {
    var copy = res.clone();
    caches.open(CACHE).then(function (c) { c.put(req, copy); });
  }
  return res;
}

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) {
    return c.addAll(ASSETS.map(function (u) { return new Request(u, { cache: 'reload' }); }));
  }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k.indexOf(PREFIX) === 0 && k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (wantsNetwork(req)) {
    e.respondWith(fetch(req));
    return;
  }
  if (req.mode === 'navigate' || isCode(url)) {
    e.respondWith(fetch(req).then(function (res) { return put(req, res); }).catch(function () {
      return caches.match(req, { ignoreSearch: true }).then(function (cached) {
        return cached || caches.match('./index.html');
      });
    }));
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(function (cached) {
    return cached || fetch(req).then(function (res) { return put(req, res); });
  }));
});
