// Service worker «Рациона»: кэширует интерфейс, чтобы приложение открывалось без сети.
// Данные хранятся отдельно (IndexedDB) и сюда не попадают.
const VERSION = 'ration-v0.3.2';
const SHELL = [
  './', 'index.html', 'css/app.css', 'manifest.webmanifest',
  'js/app.js', 'js/store.js', 'js/drive.js', 'js/sync.js', 'js/db.js', 'js/config.js',
  'js/util.js', 'js/ui.js', 'js/nutrition.js', 'js/migrate.js',
  'js/ingredients.js', 'js/groups.js', 'js/recipes.js', 'js/recipe.js', 'js/recipe-dnd.js',
  'js/plan-model.js', 'js/plan.js', 'js/plan-dnd.js', 'js/persons.js', 'js/tags.js',
  'data/seed.json', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  // cache: 'reload' — мимо HTTP-кэша браузера, чтобы новая версия не собралась из старых файлов
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Google-вход, Диск и Picker — только по сети, никогда из кэша
  if (/googleapis\.com$|google\.com$|gstatic\.com$/.test(url.hostname) &&
      !/^fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) return;

  // Шрифты: кэш, потом сеть
  if (/^fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) {
    e.respondWith(caches.open(VERSION).then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok || res.type === 'opaque') c.put(req, res.clone());
      return res;
    }));
    return;
  }

  if (url.origin !== location.origin) return;
  // Свои файлы: сразу из кэша, параллельно обновляем кэш из сети
  e.respondWith(caches.open(VERSION).then(async (c) => {
    const hit = await c.match(req, { ignoreSearch: true });
    const net = fetch(req).then((res) => { if (res.ok) c.put(req, res.clone()); return res; }).catch(() => null);
    if (hit) { e.waitUntil(net); return hit; }
    const res = await net;
    return res || (req.mode === 'navigate' ? c.match('index.html') : Response.error());
  }));
});
