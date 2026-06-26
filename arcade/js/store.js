/* スコア保存アダプタ
   - 今は localStorage 実装。すべて async なので、後で Supabase 等の
     共有DBに「中身だけ」差し替えれば、呼び出し側は無修正でいい。      */
window.Store = (function () {
  "use strict";
  var SCORES = "arcade.scores.v1";
  var NAME = "arcade.name";

  function load() { try { return JSON.parse(localStorage.getItem(SCORES)) || {}; } catch (e) { return {}; } }
  function save(o) { localStorage.setItem(SCORES, JSON.stringify(o)); }
  function sorter(type) { return function (a, b) { return type === "low" ? a.score - b.score : b.score - a.score; }; }
  function isBetter(type, a, b) { return type === "low" ? a < b : a > b; }

  return {
    name: function () { return localStorage.getItem(NAME) || ""; },
    setName: function (n) { localStorage.setItem(NAME, (n || "").slice(0, 16)); },

    // スコア記録 → そのゲームの上位配列(プレイヤーごとのベスト)を返す
    submit: async function (gameId, scoreType, player, score) {
      var db = load();
      var list = db[gameId] || [];
      list.push({ player: player || "ゲスト", score: score, at: Date.now() });
      var byPlayer = {};
      for (var i = 0; i < list.length; i++) {
        var r = list[i];
        if (!byPlayer[r.player] || isBetter(scoreType, r.score, byPlayer[r.player].score)) byPlayer[r.player] = r;
      }
      var arr = Object.keys(byPlayer).map(function (k) { return byPlayer[k]; });
      arr.sort(sorter(scoreType));
      db[gameId] = arr.slice(0, 100);
      save(db);
      return db[gameId];
    },

    top: async function (gameId, scoreType, n) {
      var arr = (load()[gameId] || []).slice();
      arr.sort(sorter(scoreType));
      return arr.slice(0, n || 10);
    },

    myBest: async function (gameId, scoreType, player) {
      var arr = load()[gameId] || [];
      var best = null;
      for (var i = 0; i < arr.length; i++) {
        if (arr[i].player !== player) continue;
        if (best === null || isBetter(scoreType, arr[i].score, best)) best = arr[i].score;
      }
      return best;
    },

    plays: async function (gameId) {
      // ざっくりプレイ数（投稿件数の総和）
      return (load()[gameId] || []).length;
    }
  };
})();
