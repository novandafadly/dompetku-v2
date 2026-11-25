/* DompetKu v2 Service Worker (S18) — PWA offline-baca + pembersihan cache wajib saat logout. */
'use strict';

const STATIC_CACHE = 'dompetku-static-v1';
const PAGES_CACHE = 'dompetku-pages-v1';
const USER_CACHE_PREFIX = 'dompetku-pages-';

const SPACE_PATH_RE = /^\/(pribadi|bersama)(\/|$)/;
const NEVER_CACHE_PATH_RE = /\/(struk|ekspor)([^/]*(\/|$))/;
const STATIC_ASSET_RE =
  /^(\/_next\/static\/|\/icons\/|\/manifest\.webmanifest$|\/icon\.svg$|\/apple-icon\.png$)/;

const OFFLINE_HTML = `<!doctype html>
<html lang="id" data-theme="dark">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Sedang offline · DompetKu</title>
<style>
  body { margin:0; min-height:100vh; display:grid; place-items:center; padding:24px;
         background:#0c0f14; color:#e6edf3; font-family:system-ui,-apple-system,sans-serif; }
  main { max-width:360px; background:#141922; border:1px solid #263040; border-radius:16px; padding:24px; }
  h1 { margin:0 0 8px; font-size:18px; line-height:1.3; }
  p { margin:0 0 16px; font-size:14px; line-height:1.5; color:#9aa6b8; }
  a { display:inline-flex; align-items:center; justify-content:center; min-height:44px;
      padding:0 16px; border-radius:10px; border:1px solid #2d3a4d; background:#1b2330;
      color:#e6edf3; font-weight:600; font-size:14px; text-decoration:none; }
</style>
</head>
<body>
  <main>
    <h1>Sedang offline</h1>
    <p>Halaman ini belum tersimpan di perangkat. Hubungkan internet lalu muat ulang, atau buka halaman yang sempat dilihat.</p>
    <a href="">Coba muat ulang</a>
  </main>
</body>
</html>`;

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith('dompetku-') && k !== STATIC_CACHE && k !== PAGES_CACHE)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

async function clearUserCaches() {
  const keys = await caches.keys();
  await Promise.all(
    keys.filter((k) => k.startsWith(USER_CACHE_PREFIX)).map((k) => caches.delete(k)),
  );
}

self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || data.type !== 'CLEAR_USER_CACHES') return;
  const replyPort = event.ports && event.ports[0];
  event.waitUntil(
    clearUserCaches().finally(() => {
      if (replyPort) replyPort.postMessage({ ok: true });
    }),
  );
});

function isRscRequest(request, url) {
  return (
    request.headers.has('RSC') ||
    request.headers.has('Next-Action') ||
    request.headers.has('Next-Router-State-Tree') ||
    url.searchParams.has('_rsc')
  );
}

async function handleStatic(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const res = await fetch(request);
  if (res && res.status === 200 && res.type === 'basic') {
    cache.put(request, res.clone()).catch(() => undefined);
  }
  return res;
}

function stripSetCookie(res) {
  if (!res.headers.has('set-cookie')) return res;
  const headers = new Headers(res.headers);
  headers.delete('set-cookie');
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
}

async function handleSpaceNavigation(request, url) {
  const cache = await caches.open(PAGES_CACHE);
  try {
    const res = await fetch(request);
    if (res && res.status === 200 && res.type === 'basic' && !res.redirected) {
      const finalUrl = new URL(res.url || url.href);
      const ct = (res.headers.get('content-type') || '').toLowerCase();
      if (
        SPACE_PATH_RE.test(finalUrl.pathname) &&
        !NEVER_CACHE_PATH_RE.test(finalUrl.pathname) &&
        ct.includes('text/html')
      ) {
        cache.put(request, stripSetCookie(res.clone())).catch(() => undefined);
      }
    }
    return res;
  } catch {
    const cached = (await cache.match(request)) || (await cache.match(url.pathname));
    if (cached) return cached;
    return new Response(OFFLINE_HTML, {
      status: 503,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;
  if (NEVER_CACHE_PATH_RE.test(url.pathname)) return;
  if (isRscRequest(request, url)) return;

  if (STATIC_ASSET_RE.test(url.pathname)) {
    event.respondWith(handleStatic(request));
    return;
  }

  if (request.mode === 'navigate' && SPACE_PATH_RE.test(url.pathname)) {
    event.respondWith(handleSpaceNavigation(request, url));
  }
});
