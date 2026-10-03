# 申し送り：Vappa の公式ゲームを増やす（⑤）

別セッションで並行して進めてもらうための引き継ぎ。アプリ本体の開発（ログイン、ID、作者ページなど）は別のセッションが同時に進めているので、**下の「触らないもの」を必ず守る**こと。

## 1. 目的
- Vappa（https://vappa.app/arcade/）の**公式ゲーム**を、Claude Code が直接書いて増やす。DeepSeek（アプリ内のAI生成）は使わない。
- 狙いは3つ：
  1. 「遊ぶ」一覧を面白いゲームで埋める
  2. ショート動画の素材にする（マーケティングは別セッション）
  3. AdSense 再審査の「中身」を増やす
- 方向性は「**送り合うくそげー**」。くだらないけど、つい友だちに「この点数抜ける？」と送りたくなるもの。日常のあるあるネタ（満員電車、締め切り、朝の支度など）が強い。
- **数より質。** 1本ずつ作り込む。同じ手触りのゲームを量産しない。

## 2. 公式ゲームの作り方（既存の形に合わせる）
- 置き場所：`arcade/games/<id>/index.html`（1ファイルで完結）と `arcade/games/<id>/thumb.png`（サムネ）。
  - 手本：`arcade/games/train/`（満員電車）、`arcade/games/city/`
- `<id>` は**英小文字・数字・ハイフン**（例 `deadline`）。サーバーのスコア登録はこの形のIDを受け付ける。
- ゲームの中で `js/arcade-sdk.js` を読み込み、次を呼ぶ（中身は `arcade/js/arcade-sdk.js` を参照）：
  - 遊べる状態になったら `Arcade.ready()`
  - 終わったら `Arcade.gameOver(score)`
  - `Arcade.onPause` / `onResume` / `onRestart` に対応する
- 前提：スマホの縦長1画面、タッチ操作。外部の画像・音声ファイルは使わず、Canvas や絵文字、CSS で描く。
- **登録**：`arcade/js/games.js` の `window.GAMES` に1件追加する。
  - 項目：`id`, `title`, `author: "Vappa公式"`, `category`, `path`, `thumb`, `score{type,unit}`, `accent`, `created`, `blurb`
  - `category` は `arcade/js/assets.js` の `ARCADE_CATEGORIES` から選ぶ。
  - `games.js` は**追加だけ**行い、既存の項目は変えない。
- **盛り要素**を必ず入れる（1本に3〜4個）：敵・障害物の種類／アイテム／展開（ボス・フィーバー・段階の変化）／コンボ・演出。
  - 詳しくは `arcade/tools/pages/guide.html` の「盛り要素」の章。
  - 要素を盛った設計書の見本：`tests/gamegen-eval/cases_rich.js`

## 3. 確認のしかた
- `tests/gamegen-eval/` の自動テストプレイの仕組みを使って、次を確かめる：
  - 起動するか、操作に反応するか
  - ゲームオーバーまで行けるか、エラーが出ないか
- この環境のブラウザは、プロキシの証明書を信頼しない。本番サイトを Playwright で開く時は、`context.route` で Node の `fetch` を通して中継する（TLS の検証は無効にしないこと）。
- Chromium はインストール済み。`playwright install` はしないこと。
- サムネは、ゲーム画面を Playwright で撮って作る。

## 4. 進め方
1. まず、ネタを**20本ほど一覧で提案**し、ユーザーに選んでもらう（タイトル、1行説明、操作、点数、盛り要素）。
2. 選ばれたものを1本ずつ作り、遊べるURL（`https://vappa.app/arcade/play.html?game=<id>`）を渡して、ユーザーに遊んでもらう。
3. ユーザーの評価（○△×）を聞いて直す。

## 5. 触らないもの（本体のセッションが同時に編集中）
- `arcade/index.html`、`play.html`、`manage.html`、`admin.html`、`leaderboard.html`、`js/*`（`games.js` への**追加だけ**は可）、`css/*`、`sw.js`
- `arcade/supabase/`（サーバーとデータベース）、`.github/workflows/`
- `sitemap.xml` への新しいゲームのURLの追加は可（追加だけ）。

## 6. Git のルール
- ブランチは `claude/railway-switching-game-4p5ijn`（本体と同じ）。push の前に必ず `git pull --rebase origin claude/railway-switching-game-4p5ijn` を実行する。
  - `games.js` がぶつかったら、両方の追加を残す。
- コミットメッセージ・コード・文書に、AIのモデル名を書かない。
- PR は作らない（頼まれた時だけ）。APIキーや秘密の値を、チャットやファイルに書かない。
- 返答は日本語で、専門用語を避けて書く。
