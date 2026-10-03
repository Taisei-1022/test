/* 動画2本目：バーガータワーの「作る → できた → 挑戦状を送る → 超えられる」
   コマ数は 30コマ＝1秒。文言を変えたいときはここを書きかえて作り直す。 */
module.exports = {
  me: "ゆう", friend: "たくみ", myScore: 8, friendScore: 12, unit: "段", game: "バーガータワー", gameId: "burger",
  request: "ハンバーガーやポテトを積み上げて、崩れたら終わりのゲーム作って",
  // ④ 友だちとのやりとり
  friendFirst: "は？8段とか余裕でしょ",
  skip: "1時間後",
  friendBeat: "お前を超えたよ",
  myLast: "は？？？",
  // 上の字幕（場面ごと）
  cap: {
    ask: "AIに「ゲーム作って」<br>って頼むと…",
    done: "できた！",
    play: "遊んでみたら…",
    result: "8段！<br>友だちに挑戦状",
    sent: "送った",
    beat: "…超えてきた",
    last: "くやしい"
  },
  end: { catch: "この点数抜ける？", url: "vappa.app", sub: "AIと話すだけでミニゲームが作れる", note: "※画面はイメージです" }
};
