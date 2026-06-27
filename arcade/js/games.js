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
  },
  {
    id: "royale",
    title: "ミニロワイヤル",
    author: "ぴこ",
    category: "アクション",
    path: "games/royale/index.html",
    score: { type: "high", unit: "撃破" },
    accent: "#8b5cf6",
    blurb: "エリクサーをためてユニット出撃。敵タワーを壊せ！"
  },
  {
    id: "burger",
    title: "バーガータワー",
    author: "うどん",
    category: "タイミング",
    path: "games/burger/index.html",
    score: { type: "high", unit: "段" },
    accent: "#ffb02e",
    blurb: "具材をタップで落として高く積む。バランス注意！"
  },
  {
    id: "pingpong",
    title: "たっきゅう",
    author: "みどり",
    category: "反射神経",
    path: "games/pingpong/index.html",
    score: { type: "high", unit: "回" },
    accent: "#34d399",
    blurb: "打つほど加速。何回ラリーが続く？"
  }
];
window.getGame = function (id) {
  for (var i = 0; i < window.GAMES.length; i++) if (window.GAMES[i].id === id) return window.GAMES[i];
  return null;
};
