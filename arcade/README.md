# ミニアーケード（MVP）

AIで作ったミニゲームを「遊ぶ → スコアで競う」ためのWebアプリ MVP。

## いまの仕様（MVP）
- **Webアプリ（PWA）**：ブラウザで動作。iPhoneは「ホーム画面に追加」でアプリ風に。
- **ゲームはシード（自分で登録）**：`js/games.js` に定義。
- **ランキングは端末内（localStorage）**：`js/store.js`。すべて async なので、
  あとで Supabase 等の共有DBに**中身だけ**差し替えれば呼び出し側は無修正。

## 構成
```
arcade/
├─ index.html            … ゲーム一覧（フィード）
├─ play.html?game=<id>   … プレイ画面（iframeで起動＋ランキング）
├─ css/app.css
├─ js/
│  ├─ games.js           … ゲーム登録（メタ情報）
│  ├─ store.js           … スコア保存アダプタ（今はlocalStorage）
│  └─ arcade-sdk.js      … ゲーム側に読ませる薄い殻（postMessage）
├─ games/<id>/index.html … 各ゲーム（生HTML＋SDKを1行読むだけ）
├─ manifest.webmanifest / icon.svg … PWA
```

## ゲーム側の「薄い規約」
ゲームは普通のHTML/JSでよく、以下を呼ぶだけ（殻の外では自動的に無効化＝単体でも動く）：
- `Arcade.ready()` … 起動時
- `Arcade.gameOver(score)` … 1プレイ終了＋スコア（**実質これだけでランキング成立**）
- 任意：`Arcade.onRestart(fn)` / `onPause(fn)` / `onResume(fn)`

`js/games.js` の `score.type` が `"high"`（高いほど上位）/ `"low"`（タイムアタック等）を決める。

## あとで独立リポジトリへ
このフォルダ一式をそのまま新リポジトリ（例: `mini-arcade`）のルートに移すだけで独立可。
共有ランキングにする時は `js/store.js` の中身を差し替える。
