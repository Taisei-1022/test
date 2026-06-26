/* ゲーム登録（MVPは自分で仕込むシードのみ） */
window.GAMES = [
  {
    id: "railway",
    title: "新幹線 ポイント操作",
    author: "taisei",
    category: "パズル",
    path: "games/railway/index.html",
    score: { type: "high", unit: "点" },
    accent: "#e6b450",
    blurb: "行き交う新幹線を事故なく駅へ。"
  },
  {
    id: "reflex",
    title: "反射タップ",
    author: "taisei",
    category: "反射神経",
    path: "games/reflex/index.html",
    score: { type: "low", unit: "ms" },
    accent: "#4c8dff",
    blurb: "緑になった瞬間にタップ。速さ勝負。"
  },
  {
    id: "dodge",
    title: "よけろ",
    author: "taisei",
    category: "アクション",
    path: "games/dodge/index.html",
    score: { type: "high", unit: "秒" },
    accent: "#3fb950",
    blurb: "落ちてくるブロックを指でよけて生き残れ。"
  }
];
window.getGame = function (id) {
  for (var i = 0; i < window.GAMES.length; i++) if (window.GAMES[i].id === id) return window.GAMES[i];
  return null;
};
