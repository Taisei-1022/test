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

  // 名前未設定のときの、かわいい自動ニックネーム（形容詞＋動物＋番号）。
  // 末尾番号は端末ごとの一意性確保用（ランキング/自己ベストが他人と混ざらないように）。
  // 以前は "ゲスト"+ランダム英字（例：ゲストhahn）で無機質だったのを置き換え。
  var ADJ = ["すばやい", "のんびり", "げんきな", "ゆかいな", "おだやかな", "やさしい", "まじめな", "ゆうかんな",
             "ほがらかな", "きまぐれな", "しずかな", "あかるい", "かしこい", "ねむそうな", "ちいさな", "おおきな",
             "まるい", "ふわふわ", "にこにこ", "わくわく", "もぐもぐ", "ぴょんぴょん"];
  var ANI = ["タヌキ", "コアラ", "パンダ", "キツネ", "ウサギ", "ネコ", "イヌ", "クマ", "ペンギン", "リス",
             "カワウソ", "ハリネズミ", "アザラシ", "フクロウ", "カピバラ", "シマウマ", "カエル", "ヒヨコ", "ラッコ", "イルカ"];
  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
  function genGuestName() { return pick(ADJ) + pick(ANI) + (Math.floor(Math.random() * 900) + 100); }

  // なまえは端末ごと（共有ランキングでも同じ）
  var nameApi = {
    name: function () { return localStorage.getItem(NAME) || ""; },
    setName: function (n) { localStorage.setItem(NAME, (n || "").slice(0, 16)); },
    // スコア記録・本人判定に使うID。名前未設定でも端末ごとに固有のかわいいゲスト名を返す。
    // （既存のゲスト端末IDは書き換えない＝過去の自己ベスト/記録との紐付けを壊さないため）
    player: function () {
      var n = (localStorage.getItem(NAME) || "").trim();
      if (n) return n;
      var g = localStorage.getItem(GID);
      if (!g) { g = genGuestName(); localStorage.setItem(GID, g); }
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
      },
      // 全ゲームのプレイ数(今日/週/年/累計)＋1位を「1リクエスト」で取得（feed_stats RPC）。
      // RPC未作成等で失敗したら null（呼び出し側は従来の個別取得にフォールバック）。
      feedStats: async function () {
        try {
          var res = await rq("rpc/feed_stats", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
          if (!res.ok) return null;
          var rows = await res.json();
          if (!Array.isArray(rows)) return null;
          var map = {};
          rows.forEach(function (r) {
            map[r.game_id] = {
              total: +r.plays || 0, today: +r.d_today || 0, week: +r.d_week || 0, year: +r.d_year || 0,
              hi: (r.hi_score != null ? { score: r.hi_score, player: r.hi_player } : null),
              lo: (r.lo_score != null ? { score: r.lo_score, player: r.lo_player } : null)
            };
          });
          return map;
        } catch (e) { console.warn("feedStats failed", e); return null; }
      }
    });
  }

  var impl = remote ? remoteStore() : localStore();
  impl.isRemote = remote;

  // 名前を変更し、共有ランキング側の自分の記録（旧名義の行）も新名義へ付け替える。
  // 端末ごとのID（名前 or ゲストID）を player として保存しているので、旧playerを新playerにUPDATEする。
  impl.rename = async function (newName) {
    var oldP = nameApi.player();
    nameApi.setName(newName);
    var newP = nameApi.player();
    if (remote && oldP && newP && oldP !== newP) {
      try {
        var h = { apikey: cfg.supabaseKey, "Content-Type": "application/json", Prefer: "return=minimal" };
        if (/^eyJ/.test(cfg.supabaseKey)) h.Authorization = "Bearer " + cfg.supabaseKey;
        await fetch(cfg.supabaseUrl.replace(/\/$/, "") + "/rest/v1/scores?player=eq." + encodeURIComponent(oldP),
          { method: "PATCH", headers: h, body: JSON.stringify({ player: newP }) });
      } catch (e) { console.warn("rename sync failed", e); }
    }
    return newP;
  };
  return impl;
})();
