# marketing/（ショート動画・SNS）

アプリ本体とは別の、宣伝用の置き場です。ここ以外のファイルは触りません。

- `videos/01-burger/` … 動画1本目（バーガータワー）と投稿文の案
- `x-plan.md` … X の運用方針（案）
- `tools/` … 動画を作る仕組み
  - `burger-capture.js`：ゲームを自動で遊ばせて、1コマずつ撮影する
  - `compose.js`：字幕・締めの画面・音を重ねて mp4 にする（字幕などは各動画の `plan.js` に書く）
  - `synth.py`：曲と効果音をその場で作る（著作権フリー）

## 作り直し方
```
node marketing/tools/burger-capture.js search                 # 動画向きの回を探す
node marketing/tools/burger-capture.js shoot 4 <作業フォルダ>  # 撮影
node marketing/tools/compose.js marketing/videos/01-burger <作業フォルダ> <作業フォルダ2>
```
