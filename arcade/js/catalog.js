/* 生成ゲームのカタログ（保存・一覧・取得・編集・複製・削除）
   - Supabase の games テーブルが本体。設定が無ければ localStorage にフォールバック。
   - 端末ごとの owner トークンで「自分の作品」を判定（簡易・MVP）。
   - resolve(id): シードゲーム(games.js)も生成ゲームも、同じ形の記述子で返す。 */
window.Catalog = (function () {
  "use strict";
  var cfg = window.ARCADE_CONFIG || {};
  var remote = !!(cfg.supabaseUrl && cfg.supabaseKey);
  var LS = "arcade.games.v1";
  var OWN = "arcade.owner";
  var enc = encodeURIComponent;

  function owner() {
    var v = localStorage.getItem(OWN);
    if (!v) { v = "u-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8); localStorage.setItem(OWN, v); }
    return v;
  }
  function rq(path, opts) {
    opts = opts || {};
    var h = { apikey: cfg.supabaseKey, "Content-Type": "application/json" };
    if (/^eyJ/.test(cfg.supabaseKey)) h.Authorization = "Bearer " + cfg.supabaseKey; // 旧anon(JWT)のみ
    opts.headers = Object.assign(h, opts.headers || {});
    return fetch(cfg.supabaseUrl.replace(/\/$/, "") + "/rest/v1/" + path, opts);
  }
  function loadLS() { try { return JSON.parse(localStorage.getItem(LS)) || []; } catch (e) { return []; } }
  function saveLS(a) { localStorage.setItem(LS, JSON.stringify(a)); }
  function fields(g) {
    return {
      title: g.title, author: g.author || "ゲスト", html: g.html,
      accent: g.accent || "#e6b450", description: g.description || "", thumb: g.thumb || null
    };
  }

  return {
    isRemote: remote,
    owner: owner,
    mine: function (g) { return g && g.owner && g.owner === owner(); },

    // 新規公開。新しい行（id付き）を返す。
    publish: async function (g) {
      var row = fields(g); row.owner = owner();
      if (remote) {
        var res = await rq("games", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(row) });
        if (!res.ok) { var t = ""; try { t = await res.text(); } catch (e) {} throw new Error("publish_failed:" + res.status + ":" + t.slice(0, 120)); }
        return (await res.json())[0];
      }
      row.id = "gen-" + Date.now() + "-" + Math.floor(Math.random() * 1000);
      row.created_at = new Date().toISOString();
      var a = loadLS(); a.unshift(row); saveLS(a);
      return row;
    },

    // 既存を上書き保存（編集）
    update: async function (id, g) {
      var patch = fields(g);
      if (remote) {
        var res = await rq("games?id=eq." + enc(id), { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(patch) });
        if (!res.ok) { var t = ""; try { t = await res.text(); } catch (e) {} throw new Error("update_failed:" + res.status + ":" + t.slice(0, 120)); }
        return (await res.json())[0];
      }
      var a = loadLS(); for (var i = 0; i < a.length; i++) if (a[i].id === id) { Object.assign(a[i], patch); }
      saveLS(a); return a.filter(function (x) { return x.id === id; })[0];
    },

    remove: async function (id) {
      if (remote) {
        var res = await rq("games?id=eq." + enc(id), { method: "DELETE" });
        if (!res.ok && res.status !== 204) { throw new Error("remove_failed:" + res.status); }
        return true;
      }
      saveLS(loadLS().filter(function (g) { return g.id !== id; })); return true;
    },

    // 複製（自分の作品として新規公開）
    copy: async function (id) {
      var g = await this.getGenerated(id);
      if (!g) throw new Error("not_found");
      return this.publish({ title: (g.title || "ゲーム") + " のコピー", html: g.html, accent: g.accent, description: g.description, thumb: g.thumb, author: g.author });
    },

    // 一覧（HTML本体は含めない・サムネは含む）
    listGenerated: async function () {
      if (remote) {
        try {
          var res = await rq("games?select=id,title,author,accent,description,thumb,owner,created_at&order=created_at.desc&limit=50");
          return await res.json();
        } catch (e) { console.warn("listGenerated failed", e); return []; }
      }
      return loadLS().map(function (g) {
        return { id: g.id, title: g.title, author: g.author, accent: g.accent, description: g.description, thumb: g.thumb, owner: g.owner, created_at: g.created_at };
      });
    },

    getGenerated: async function (id) {
      if (remote) {
        try {
          var res = await rq("games?id=eq." + enc(id) + "&select=id,title,author,html,accent,description,thumb,owner&limit=1");
          return (await res.json())[0] || null;
        } catch (e) { console.warn("getGenerated failed", e); return null; }
      }
      return loadLS().filter(function (g) { return g.id === id; })[0] || null;
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
