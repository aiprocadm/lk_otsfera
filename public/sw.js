 
/**
 * Промтехносфера PWA service worker.
 *
 * Strategies:
 *  - Precache app shell + icons on install
 *  - NetworkFirst with cache fallback for /api/partner GET (24h TTL)
 *  - CacheFirst for /_next/static (hashed assets, immutable)
 *  - Network-only for navigation requests (HTML pages); offline → cached /login
 *
 * Страницы кабинета НЕ кэшируются (v2, 19.10.2026). Прежнее «сначала из кэша,
 * потом обновить» показывало страницу с прошлого визита: после обновления
 * стенда человек видел старую версию экрана, а после входа под другой ролью
 * на том же адресе — страницу ПРЕДЫДУЩЕГО пользователя (кэш различает адрес,
 * но не того, кто вошёл). Поэтому страница всегда идёт с сервера.
 *
 * Bump CACHE_VERSION whenever this file or precached assets change —
 * old caches are dropped in the activate handler.
 */

// v2: при активации стираются кэши v1 вместе с сохранёнными страницами кабинета.
const CACHE_VERSION = 'v2';
const SHELL_CACHE = `otsfera-shell-${CACHE_VERSION}`;
const STATIC_CACHE = `otsfera-static-${CACHE_VERSION}`;
const API_CACHE = `otsfera-api-${CACHE_VERSION}`;

// Без '/': он перенаправляет, и при адресе, отличном от публичного, установка
// службы падала целиком (cache.addAll отвергает весь список).
const SHELL_ASSETS = [
  '/login',
  '/manifest.webmanifest',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png',
];

const API_TTL_MS = 24 * 60 * 60 * 1000;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith('otsfera-') && ![SHELL_CACHE, STATIC_CACHE, API_CACHE].includes(k))
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

function isStatic(url) {
  return url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/');
}

function isPartnerApiGet(req, url) {
  return req.method === 'GET' && url.pathname.startsWith('/api/partner/');
}

function isNavigation(req) {
  return req.mode === 'navigate' || (req.method === 'GET' && req.headers.get('accept')?.includes('text/html'));
}

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  if (cached) return cached;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}

async function networkFirstWithTtl(req, cacheName, ttlMs) {
  const cache = await caches.open(cacheName);
  try {
    const fresh = await fetch(req);
    if (fresh.ok) {
      const cloned = fresh.clone();
      const headers = new Headers(cloned.headers);
      headers.set('x-sw-cached-at', String(Date.now()));
      const body = await cloned.blob();
      await cache.put(req, new Response(body, { status: cloned.status, statusText: cloned.statusText, headers }));
    }
    return fresh;
  } catch (err) {
    const cached = await cache.match(req);
    if (cached) {
      const cachedAt = Number(cached.headers.get('x-sw-cached-at') || '0');
      if (!cachedAt || Date.now() - cachedAt < ttlMs) return cached;
    }
    throw err;
  }
}

async function networkOnlyNavigation(req) {
  try {
    return await fetch(req);
  } catch (err) {
    // Нет сети — показываем страницу входа, а не чужую или устаревшую страницу.
    const cache = await caches.open(SHELL_CACHE);
    const login = await cache.match('/login');
    if (login) return login;
    throw err;
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (isStatic(url)) {
    event.respondWith(cacheFirst(req, STATIC_CACHE));
    return;
  }
  if (isPartnerApiGet(req, url)) {
    event.respondWith(networkFirstWithTtl(req, API_CACHE, API_TTL_MS));
    return;
  }
  if (isNavigation(req)) {
    event.respondWith(networkOnlyNavigation(req));
    return;
  }
});
