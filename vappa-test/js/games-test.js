/* 試遊室のゲーム一覧（本番の games.js とは別。本番に出す時に games.js へ書き足す） */
window.TEST_GAMES = [
  { id:"beer",  title:"ビール注ぎ名人", emoji:"🍺", blurb:"長押しで注いで、点線で指をはなす。ジョッキがどんどん変になる。", unit:"点" },
  { id:"steak", title:"ステーキ等分",   emoji:"🥩", blurb:"指でなぞってステーキを切る。ぴったり等分できる？", unit:"点" },
  { id:"hata",  title:"旗あげ",         emoji:"🚩", blurb:"赤あげて、白さげない。指示がどんどんひねくれる。", unit:"回" },
  { id:"lturn", title:"L字路 切り返し", emoji:"🚗", blurb:"せまいL字路を切り返しで曲がれ。全5ステージの合計タイム勝負。", unit:"秒", low:true },
  { id:"darts", title:"ネコダーツ", emoji:"🎯", blurb:"的をねらうと、ネコがじゃまをする。理不尽すぎるダーツ。", unit:"点" },
  { id:"softcream", title:"ソフトクリーム職人", emoji:"🍦", blurb:"タップでうず巻きを重ねる。どこまで高く巻ける？", unit:"cm" },
  { id:"yuka", title:"落ちる床", emoji:"🟥", blurb:"言われた色の床へ逃げろ。ほかの床は落ちる。", unit:"点" },
  { id:"kazuate", title:"数字当て", emoji:"🔐", blurb:"かくれた数字を、ヒントだけで当てる金庫破り。", unit:"点" },
  { id:"shinkei", title:"神経衰弱タイムアタック", emoji:"🃏", blurb:"3面連続の神経衰弱。いたずら札がカードをまぜる。", unit:"秒", low:true },
  { id:"tsunagi", title:"一筆書きつなぎ", emoji:"🍡", blurb:"同じおもちを指でなぞってつなげる。長いほど大爆発。", unit:"点" },
  { id:"fukuwarai", title:"福笑い", emoji:"👺", blurb:"流れてくる目・鼻・口をタップで落とす。どんな顔になる？", unit:"点" },
  { id:"bowling", title:"へんてこボウリング", emoji:"🎳", blurb:"坂・氷・曲がり道・動く床。毎フレームでレーンが変わる。", unit:"点" }
];
window.TEST_READY = ["beer","steak","hata","lturn","yuka","darts","kazuate","softcream","shinkei","tsunagi","bowling","fukuwarai"];
