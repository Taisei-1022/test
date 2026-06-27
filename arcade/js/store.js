/* スコア保存アダプタ
   - window.ARCADE_CONFIG に Supabase の URL/キーがあれば「共有ランキング」、
     無ければ「端末内(localStorage)」で動作する。
   - 公開APIは共通： name/setName/submit/top/myBest/plays（すべて async）。
     呼び出し側(index.html / play.html)はどちらでも無修正で動く。            */
window.Store = (function () {
  "use strict";
  var cfg = window.ARCADE_CONFIG || {};
  var remote = !!(cfg.supabaseUrl && cfg.supabaseKey);
  var NAME = "arcade.name", GID = "arcade.guestid";

  // なまえは端末ごと（共有ランキングでも同じ）
  var nameApi = {
    name: function () { return localStorage.getItem(NAME) || ""; },
    setName: function (n) { localStorage.setItem(NAME, (n || "").slice(0, 16)); },
    // スコア記録・本人判定に使うID。名前未設定でも端末ごとに固有のゲスト名を返す。
    // （以前は全員 "ゲスト" で、自己ベスト/ランキングが他人と混ざっていた。その対策）
    player: function () {
      var n = (localStorage.getItem(NAME) || "").trim();
      if (n) return n;
      var g = localStorage.getItem(GID);
      if (!g) { g = "ゲスト" + Math.random().toString(36).slice(2, 6); localStorage.setItem(GID, g); }
      return g;
    }
  };

  // 人気順の集計ウィンドウ（今日=24h / 週間=7日 / 年間=365日 のローリング）
  function wins() { var n = Date.now(); return { day: n - 864e5, week: n - 6048e5, year: n - 31536e6 }; }
  function countWindows(times) {
    var w = wins(), s = { total: times.length, today: 0, week: 0, year: 0 };
    for (var i = 0; i < times.length; i++) { var t = times[i]; if (t >= w.year) s.year++; if (t >= w.week) s.week++; if (t >= w.day) s.today++; }
    return s;
  }

  function sorter(type) { return function (a, b) { return type === "low" ? a.score - b.score : b.score - a.score; }; }
  function isBetter(type, a, b) { return type === "low" ? a < b : a > b; }
  function dedupBest(rows) { // すでにソート済み前提：プレイヤーごとに最初(=最良)を残す
    var seen = {}, out = [];
    for (var i = 0; i < rows.length; i++) { var p = rows[i].player; if (!seen[p]) { seen[p] = 1; out.push(rows[i]); } }
    return out;
  }

  /* ---------- 端末内(localStorage) ---------- */
  function localStore() {
    var SCORES = "arcade.scores.v1", PLAYS = "arcade.plays.v1";
    function load() { try { return JSON.parse(localStorage.getItem(SCORES)) || {}; } catch (e) { return {}; } }
    function save(o) { localStorage.setItem(SCORES, JSON.stringify(o)); }
    function loadLog() { try { return JSON.parse(localStorage.getItem(PLAYS)) || {}; } catch (e) { return {}; } }
    function saveLog(o) { localStorage.setItem(PLAYS, JSON.stringify(o)); }
    return Object.assign({}, nameApi, {
      submit: async function (gameId, type, player, score) {
        var lg = loadLog(); (lg[gameId] = lg[gameId] || []).push(Date.now());
        if (lg[gameId].length > 5000) lg[gameId] = lg[gameId].slice(-5000);
        saveLog(lg);
        var db = load(), list = db[gameId] || [];
        list.push({ player: player || "ゲスト", score: score, at: Date.now() });
        var byP = {};
        for (var i = 0; i < list.length; i++) { var r = list[i]; if (!byP[r.player] || isBetter(type, r.score, byP[r.player].score)) byP[r.player] = r; }
        var arr = Object.keys(byP).map(function (k) { return byP[k]; });
        arr.sort(sorter(type)); db[gameId] = arr.slice(0, 100); save(db); return db[gameId];
      },
      top: async function (gameId, type, n) { var a = (load()[gameId] || []).slice(); a.sort(sorter(type)); return a.slice(0, n || 10); },
      myBest: async function (gameId, type, player) {
        var a = load()[gameId] || [], best = null;
        for (var i = 0; i < a.length; i++) { if (a[i].player !== player) continue; if (best === null || isBetter(type, a[i].score, best)) best = a[i].score; }
        return best;
      },
      plays: async function (gameId) { return (loadLog()[gameId] || []).length; },
      playStats: async function (gameId) { return countWindows(loadLog()[gameId] || []); }
    });
  }

  /* ---------- 共有(Supabase / PostgREST) ---------- */
  function remoteStore() {
    function rq(path, opts) {
      opts = opts || {};
      var h = { apikey: cfg.supabaseKey, "Content-Type": "application/json" };
      // 旧 anon(JWT, eyJ...) のときだけ Authorization を付ける。
      // 新 publishable key(sb_publishable_...) は apikey ヘッダだけでよい。
      if (/^eyJ/.test(cfg.supabaseKey)) h.Authorization = "Bearer " + cfg.supabaseKey;
      opts.headers = Object.assign(h, opts.headers || {});
      return fetch(cfg.supabaseUrl.replace(/\/$/, "") + "/rest/v1/" + path, opts);
    }
    var enc = encodeURIComponent;
    return Object.assign({}, nameApi, {
      submit: async function (gameId, type, player, score) {
        try {
          await rq("scores", { method: "POST", headers: { Prefer: "return=minimal" },
            body: JSON.stringify({ game_id: gameId, player: player || "ゲスト", score: score }) });
        } catch (e) { console.warn("submit failed", e); }
        return this.top(gameId, type, 100);
      },
      top: async function (gameId, type, n) {
        try {
          var order = type === "low" ? "score.asc" : "score.desc";
          var res = await rq("scores?game_id=eq." + enc(gameId) + "&select=player,score&order=" + order + "&limit=300");
          var rows = await res.json();
          return dedupBest(rows).slice(0, n || 10);
        } catch (e) { console.warn("top failed", e); return []; }
      },
      myBest: async function (gameId, type, player) {
        try {
          var order = type === "low" ? "score.asc" : "score.desc";
          var res = await rq("scores?game_id=eq." + enc(gameId) + "&player=eq." + enc(player) + "&select=score&order=" + order + "&limit=1");
          var rows = await res.json();
          return rows.length ? rows[0].score : null;
        } catch (e) { console.warn("myBest failed", e); return null; }
      },
      plays: async function (gameId) {
        try {
          var res = await rq("scores?game_id=eq." + enc(gameId) + "&select=id", { headers: { Prefer: "count=exact", Range: "0-0" } });
          var cr = res.headers.get("content-range") || "/0";
          return parseInt(cr.split("/")[1], 10) || 0;
        } catch (e) { console.warn("plays failed", e); return 0; }
      },
      // 時間帯別の人気（今日/週間/年間）。直近1年分の打刻を取得してJSで集計。
      playStats: async function (gameId) {
        try {
          var since = new Date(wins().year).toISOString();
          var res = await rq("scores?game_id=eq." + enc(gameId) + "&created_at=gte." + enc(since) +
            "&select=created_at&order=created_at.desc&limit=5000");
          var rows = await res.json();
          var times = (rows || []).map(function (r) { return new Date(r.created_at).getTime(); });
          return countWindows(times);
        } catch (e) { console.warn("playStats failed", e); return { total: 0, today: 0, week: 0, year: 0 }; }
      }
    });
  }

  var impl = remote ? remoteStore() : localStore();
  impl.isRemote = remote;
  return impl;
})();
