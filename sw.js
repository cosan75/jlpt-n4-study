// 오프라인 지원: 페이지는 항상 새 버전을 먼저 받고(인터넷이 없으면 저장본),
// 음성·아이콘은 한 번 받으면 저장해 두고 다시 쓴다. 번역은 인터넷이 필요하다.
const CACHE = 'n4-v3';
const CORE = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// 음성 재생은 Range 요청으로 오므로 저장된 전체 파일에서 잘라 206으로 돌려준다
async function rangeResponse(req, res) {
  const range = req.headers.get('range');
  if (!range) return res;
  const buf = await res.arrayBuffer();
  const m = /bytes=(\d+)-(\d*)/.exec(range);
  const start = m ? +m[1] : 0, end = m && m[2] ? Math.min(+m[2], buf.byteLength - 1) : buf.byteLength - 1;
  return new Response(buf.slice(start, end + 1), { status: 206, headers: {
    'Content-Type': res.headers.get('Content-Type') || 'audio/mpeg',
    'Content-Range': 'bytes ' + start + '-' + end + '/' + buf.byteLength,
    'Content-Length': String(end - start + 1), 'Accept-Ranges': 'bytes' } });
}

async function pageFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put('./index.html', res.clone());
    return res;
  } catch (err) {
    return (await cache.match('./index.html')) || Response.error();
  }
}

async function fileFirst(req) {
  const cache = await caches.open(CACHE);
  const url = req.url.split('#')[0];
  let res = await cache.match(url);
  if (!res) {
    // 브라우저 캐시의 일부 조각(206)이 아니라 전체 파일을 받아서 저장한다
    try {
      res = await fetch(url, { cache: 'reload' });
      if (res.status !== 200) return fetch(req);
      await cache.put(url, res.clone());
    } catch (err) {
      return fetch(req);
    }
  }
  return rangeResponse(req, res);
}

async function fontsStale(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  const net = fetch(req).then(res => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => hit);
  return hit || net;
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    if (req.mode === 'navigate' || url.pathname.endsWith('/') || url.pathname.endsWith('/index.html')) e.respondWith(pageFirst(req));
    else e.respondWith(fileFirst(req));
  } else if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(fontsStale(req));
  }
});
