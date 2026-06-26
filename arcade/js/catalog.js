/* 生成ゲームのカタログ（保存・一覧・取得）
   - Supabase の games テーブルが本体。設定が無ければ localStorage にフォールバック。
   - resolve(id): シードゲーム(games.js)も生成ゲームも、同じ形の記述子で返す。 */
window.Catalog = (function () {
  "use strict";
  var cfg = window.ARCADE_CONFIG || {};
  var remote = !!(cfg.supabaseUrl && cfg.supabaseKey);
  var LS = "arcade.games.v1";
  var enc = encodeURIComponent;

  function rq(path, opts) {
    opts = opts || {};
    var h = { apikey: cfg.supabaseKey, "Content-Type": "application/json" };
    if (/^eyJ/.test(cfg.supabaseKey)) h.Authorization = "Bearer " + cfg.supabaseKey; // 旧anon(JWT)のみ
    opts.headers = Object.assign(h, opts.headers || {});
    return fetch(cfg.supabaseUrl.replace(/\/$/, "") + "/rest/v1/" + path, opts);
  }
  function loadLS() { try { return JSON.parse(localStorage.getItem(LS)) || []; } catch (e) { return []; } }
  function saveLS(a) { localStorage.setItem(LS, JSON.stringify(a)); }

  return {
    isRemote: remote,

    // 生成ゲームを公開（保存）。新しい行（id付き）を返す。
    publish: async function (g) {
      var row = { title: g.title, author: g.author || "ゲスト", html: g.html, accent: g.accent || "#e6b450" };
      if (remote) {
        var res = await rq("games", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(row) });
        if (!res.ok) { var t = ""; try { t = await res.text(); } catch (e) {} throw new Error("publish_failed:" + res.status + ":" + t.slice(0, 120)); }
        var arr = await res.json();
        return arr[0];
      }
      row.id = "gen-" + Date.now() + "-" + Math.floor(Math.random() * 1000);
      row.created_at = new Date().toISOString();
      var a = loadLS(); a.unshift(row); saveLS(a);
      return row;
    },

    // 公開済み生成ゲームの一覧（HTML本体は含めない）
    listGenerated: async function () {
      if (remote) {
        try {
          var res = await rq("games?select=id,title,author,accent,created_at&order=created_at.desc&limit=50");
          return await res.json();
        } catch (e) { console.warn("listGenerated failed", e); return []; }
      }
      return loadLS().map(function (g) { return { id: g.id, title: g.title, author: g.author, accent: g.accent, created_at: g.created_at }; });
    },

    getGenerated: async function (id) {
      if (remote) {
        try {
          var res = await rq("games?id=eq." + enc(id) + "&select=id,title,author,html,accent&limit=1");
          var arr = await res.json(); return arr[0] || null;
        } catch (e) { console.warn("getGenerated failed", e); return null; }
      }
      var f = loadLS().filter(function (g) { return g.id === id; });
      return f[0] || null;
    },

    // シード or 生成、どちらの id でも統一記述子で返す
    resolve: async function (id) {
      var s = (window.getGame ? window.getGame(id) : null);
      if (s) return { source: "seed", id: s.id, title: s.title, accent: s.accent, score: s.score, path: s.path };
      var g = await this.getGenerated(id);
      if (!g) return null;
      return { source: "gen", id: g.id, title: g.title, accent: g.accent, score: { type: "high", unit: "点" }, html: g.html };
    }
  };
})();
