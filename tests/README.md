# ランタイム入力テストハーネス

生成ゲームの共通ランタイム（arcade/supabase/functions/generate/index.ts の RUNTIME_TPL）の
入力まわり回帰テスト。**すべて実タッチイベント**で検証する（click()直呼びは禁止：
iOSのclick合成抑止バグを見逃すため）。

## 実行方法
```
node tests/runtime-matrix.js   # 事前に scratchpad でテストページ組み立てが必要（下記）
```
テストページの組み立て（RUNTIME_TPLからharness-game.html等を生成）は
セッションのscratchpadにある assemble スニペット参照。

## テスト項目（12）
1. スタートボタン（実タッチ） 2. フィールドタップ→onDown 3. 実ドラッグ→onMove
4. ゲーム内DOMボタンのclick合成 5. ゲームオーバー→もういちど 6. クラッシュ画面→復帰
7. 実行時エラーなし 8. touchのみ環境フォールバック 9-11. srcdoc iframe埋め込み（play.html相当）
12. 実ゲーム（シューティング2のjs）

# 自動テストプレイ→自動修理（A案）のE2E

```
python3 -m http.server 8099   # リポジトリ直下で
node tests/smoke-autofix.js
```
生成直後の非表示iframeスモークテスト（arcade/index.html の smokeTest/handleBuildResult と
RUNTIME_TPL の window.__vpTap）の回帰テスト。壊れたゲームで自動修理が1回だけ走ること、
正常なゲームで余計な再ビルドが走らないことを確認する。

# 素材画像アップロードのE2E

```
python3 -m http.server 8099   # リポジトリ直下で
node tests/user-images.js
```
画像追加→AIには名前と説明だけ渡る（base64がmessagesに混ざらない）→ビルド後に
クライアントがdataURLをマーカーへ注入→Game.imgで実描画→編集ビルドでも画像が
往復して残る、の一連を検証。

# 難易度調整パネル（TUNEスライダー）のE2E

```
python3 -m http.server 8099   # リポジトリ直下で
node tests/tune-panel.js
```
生成JS冒頭の TUNE オブジェクトをプレビューの⚙️パネル（管理者のみ）が読み取り、
スライダーで値を書き換えて即反映・リセットできることの回帰テスト。

## 過去に踏んだ地雷（雛形をいじる時はここを再確認）
- pointerイベントのみ依存 → iOSのiframeで死ぬ（touch/mouseフォールバック必須）
- touchstart/touchend で preventDefault → **click合成が死んでボタンが押せなくなる**
  → preventDefault は touchmove だけ（パン横取り防止はこれで十分）
- pointer環境では touch の発火だけ二重防止（seenPointerフラグ）。preventDefaultの
  判断とは分離すること
- **touch-action:none ではiOSのダブルタップズームを止められない**（manipulationなら
  止まるというWebKitの癖）→ ボタン類（button,a,input,select,label）以外の touchend
  だけ preventDefault する。ボタンまで preventDefault すると click合成が死ぬ（上の地雷）
