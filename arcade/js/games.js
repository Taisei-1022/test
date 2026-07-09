/* ゲーム登録（MVPは自分で仕込むシードのみ） */
window.GAMES = [
  {
    id: "city",
    title: "ひとながれシティ",
    author: "Vappa公式",
    category: "シミュレーション",
    path: "games/city/index.html?v=1",
    thumb: "games/city/thumb.png?v=1",
    score: { type: "high", unit: "人" },
    accent: "#60a5fa",
    created: "2026-07-09",
    blurb: "道路をひいて人の流れをデザイン。渋滞したら拡張！クレーム10件で市長解任。"
  },
  {
    id: "train",
    title: "満員電車、降ります！",
    author: "Vappa公式",
    category: "アクション",
    path: "games/train/index.html?v=1",
    thumb: "games/train/thumb.png?v=1",
    score: { type: "high", unit: "駅" },
    accent: "#2dd4bf",
    created: "2026-06-30",
    blurb: "人をかき分け、ドアが閉まる前に降りろ。降りるほど超満員！"
  },
  {
    id: "railway",
    title: "新幹線 ポイント操作",
    author: "taisei",
    category: "パズル",
    path: "games/railway/index.html",
    thumb: "games/railway/thumb.png?v=1",
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
    thumb: "games/reflex/thumb.png?v=1",
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
    thumb: "games/dodge/thumb.png?v=1",
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
    thumb: "games/royale/thumb.png?v=1",
    score: { type: "high", unit: "撃破" },
    accent: "#8b5cf6",
    blurb: "エリクサーをためてユニット出撃。敵タワーを壊せ！"
  },
  {
    id: "burger",
    title: "バーガータワー",
    author: "うどん",
    category: "タイミング",
    path: "games/burger/index.html?v=3",
    thumb: "games/burger/thumb.png?v=1",
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
    thumb: "games/pingpong/thumb.png?v=1",
    score: { type: "high", unit: "回" },
    accent: "#34d399",
    blurb: "打つほど加速。何回ラリーが続く？"
  }
];
window.getGame = function (id) {
  for (var i = 0; i < window.GAMES.length; i++) if (window.GAMES[i].id === id) return window.GAMES[i];
  return null;
};
