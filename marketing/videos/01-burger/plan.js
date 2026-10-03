/* 動画1本目：バーガータワー（撮影した回：乱数 4 番、8段で崩壊）
   raw は撮影したコマ番号（30コマ＝1秒）。speed は再生速度（1.25＝少し早送り、0.6＝スロー）。 */
module.exports = {
  seed: 4,
  segments: [
    { from: 1, to: 369, speed: 1.25 },
    { from: 370, to: 430, speed: 0.6 },   // 崩れる瞬間はスロー
    { from: 431, to: 456, speed: 1 }
  ],
  captions: [          // 字幕（raw のコマ番号で指定。low は画面の下寄りに出す＝積んでいる物に重ねない）
    { from: 1, to: 66, text: "バーガー、<br>何段積める？", big: true },
    { from: 107, to: 160, text: "まだ余裕", low: true },
    { from: 318, to: 360, text: "ケチャップの上に<br>ドリンク！？", low: true },
    { from: 364, to: 384, text: "仕上げにチキン…", low: true },
    { from: 388, to: 424, text: "あっ", big: true, low: true }
  ],
  bgmStopRaw: 386,     // ここで音楽を止める（崩れる前の「間」）
  crashRaw: 398,       // 崩れる音
  end: {               // 締めの画面
    seconds: 4.2,
    score: "8段",
    game: "今日のゲーム：バーガータワー",
    catch: "この点数抜ける？",
    url: "vappa.app",
    sub: "AIと話すだけでミニゲームが作れる"
  }
};
