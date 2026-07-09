/* Vappa Service Worker
   - ネットワーク優先（オンラインなら常に最新を取得＝自動アップデート）
   - 取得できない時だけキャッシュにフォールバック（オフライン対応）
   - 新バージョンはユーザーが「更新」を押すまで待機（勝手にリロードしない） */
// CACHE 名はアプリのバージョンに紐づける（＝毎デプロイで sw.js が変わり、更新が必ず検知される）。
// APP_VERSION を上げるたびにここも上げること。
var CACHE = "vappa-0.9.53";
var CORE = [
  "./", "./index.html", "./play.html", "./leaderboard.html",
  "./privacy.html", "./terms.html", "./about.html", "./contact.html",
  "./manifest.webmanifest", "./logo.png?v=1",
  "./css/app.css?v=29",
  "./js/games.js?v=9", "./js/assets.js?v=1", "./js/config.js?v=6", "./js/store.js?v=7",
  "./js/ai.js?v=15", "./js/catalog.js?v=10", "./js/share.js?v=5", "./js/arcade-embed.js?v=3", "./js/pwa.js?v=1"
];

self.addEventListener("install", function (e) {
  // 事前キャッシュ（失敗しても無視）。skipWaiting はしない＝ユーザー確認まで待機。
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(CORE).catch(function () {}); }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil((async function () {
    var keys = await caches.keys();
    await Promise.all(keys.map(function (k) { return k === CACHE ? null : caches.delete(k); }));
    await self.clients.claim();
  })());
});

self.addEventListener("message", function (e) {
  if (e.data && e.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  if (url.origin !== location.origin) return; // Supabase等の外部はそのまま
  e.respondWith((async function () {
    try {
      var fresh = await fetch(req);
      if (fresh && fresh.status === 200 && fresh.type === "basic") {
        var cache = await caches.open(CACHE);
        cache.put(req, fresh.clone());
      }
      return fresh;
    } catch (err) {
      var cached = await caches.match(req);
      if (cached) return cached;
      if (req.mode === "navigate") {
        var idx = await caches.match("./index.html");
        if (idx) return idx;
      }
      throw err;
    }
  })());
});
