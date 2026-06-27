/* 賑わい演出モジュール（運営用・継続利用前提）
   - 偽のスコア行を Supabase の scores に挿入して、ランキング＆プレイ数を“賑わってる風”にする。
   - スコア1件＝1プレイなので、これだけで「○プレイ」も「ランキング」も埋まる。
   - アプリ本体からは読み込まない。運営ページ(admin.html)や手動から呼ぶ。
   使い方:  SeedActivity.seedGame("royale","high",12).then(...)
            SeedActivity.seedAll(GAMES, 8)   // GAMES配列に一括
*/
window.SeedActivity = (function () {
  "use strict";
  var cfg = window.ARCADE_CONFIG || {};

  // サクラのプレイヤー名（必要に応じて増やす）
  var PLAYERS = [
    "ぴこ","うどん","みどり","くま","リク","なな","ハル","そら","マロン","ゲンキ",
    "ぽち","チョコ","ユウ","あお","コーン","しお","モカ","テン","リン","かい",
    "ニケ","タロ","ぷりん","みかん","ゆず","らて","のっち","ばや","きなこ","しろ"
  ];

  // ゲームごとの“それっぽい”スコア基準（base＝平均的な良スコア / spread＝ばらつき）
  // 未登録IDは default を使う。type が low(小さいほど良い)なら base 付近で小さめに散らす。
  var RANGES = {
    railway:  { base: 3000, spread: 6000 },
    reflex:   { base: 230,  spread: 140  },  // low(ms)
    dodge:    { base: 18,   spread: 45   },
    royale:   { base: 3,    spread: 9    },
    burger:   { base: 7,    spread: 20   },
    pingpong: { base: 9,    spread: 34   },
    _default: { base: 600,  spread: 3500 }
  };

  function rq(path, opts) {
    opts = opts || {};
    var h = { apikey: cfg.supabaseKey, "Content-Type": "application/json" };
    if (/^eyJ/.test(cfg.supabaseKey)) h.Authorization = "Bearer " + cfg.supabaseKey;
    opts.headers = Object.assign(h, opts.headers || {});
    return fetch(cfg.supabaseUrl.replace(/\/$/, "") + "/rest/v1/" + path, opts);
  }
  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
  function shuffle(a) { a = a.slice(); for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; } return a; }

  function genScore(type, r) {
    var v;
    if (type === "low") {           // 小さいほど良い（ms等）
      v = r.base * (0.6 + Math.random() * 0.9);   // base前後で散らす
    } else {                        // 大きいほど良い
      var t = Math.pow(Math.random(), 1.7);       // 高スコアほどレア
      v = r.base * 0.3 + t * r.spread;
    }
    return Math.max(1, Math.round(v));
  }

  // 指定ゲームに count 件のサクラスコアを入れる（日付は過去 days 日にばらす）
  async function seedGame(gameId, type, count, opts) {
    opts = opts || {};
    var days = opts.days || 12;
    var r = (opts.range) || RANGES[gameId] || RANGES._default;
    var names = shuffle(PLAYERS).slice(0, Math.min(count, PLAYERS.length));
    var rows = [];
    for (var i = 0; i < count; i++) {
      rows.push({
        game_id: gameId,
        player: names[i % names.length] || pick(PLAYERS),
        score: genScore(type, r),
        created_at: new Date(Date.now() - Math.random() * days * 864e5).toISOString()
      });
    }
    // まず created_at つきで挿入。列が受け付けない等で失敗したら created_at 抜きで再試行。
    var res = await rq("scores", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(rows) });
    if (!res.ok) {
      var rows2 = rows.map(function (x) { return { game_id: x.game_id, player: x.player, score: x.score }; });
      res = await rq("scores", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(rows2) });
    }
    return { gameId: gameId, ok: res.ok, status: res.status, count: count };
  }

  // GAMES（games.js）配列にまとめて。1ゲームあたり count±3 件。
  async function seedAll(games, count) {
    count = count || 8;
    var out = [];
    for (var i = 0; i < games.length; i++) {
      var g = games[i];
      var n = Math.max(3, count + Math.floor(Math.random() * 7) - 3);
      out.push(await seedGame(g.id, (g.score && g.score.type) || "high", n));
    }
    return out;
  }

  return { PLAYERS: PLAYERS, RANGES: RANGES, seedGame: seedGame, seedAll: seedAll };
})();
