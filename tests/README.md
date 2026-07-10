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

# 作り方モード（既定＝いきなり生成 / 上級者＝設計書確認）E2E

```
python3 -m http.server 8099   # リポジトリ直下で
node tests/direct-generate-default.js
```
既定（specmode未設定）で相談後に「🚀 この内容で作る」が出て makeSpec を呼ばず
いきなり生成すること、マイページのトグルをONにすると「📐 設計書を作る」ステップが
出ることを検証。※他のspec系テストは addInitScript で arcade.specmode='1' を立てている。

# 生成フローの状態機械（失敗後に設計書を作り直さない）E2E

```
python3 -m http.server 8099   # リポジトリ直下で
node tests/build-fail-reuse-spec.js
```
設計書作成→生成失敗→再生成 で、makeSpec（設計書作成）が1回しか呼ばれない
（＝失敗しても設計書を無駄に作り直さない）ことを検証。状態機械 chat/ready/spec/
building/done の遷移と、curSpec が失敗・会話をまたいで保持されることの回帰。

# チャット・設計書の永続化E2E

```
python3 -m http.server 8099   # リポジトリ直下で
node tests/chat-persist.js
```
ステートフルなREST モックで、ビルド後にページ再読み込み→作品を開き直して、
会話（ボットの生成結果・ステータス含む）と設計書が丸ごと復元され、
「設計書を見る」がビルド後もずっと開けることを検証。

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
