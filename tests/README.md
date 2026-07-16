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

# DeepSeek生成品質の評価ハーネス（PDCA用）

```
node tests/gamegen-eval/run.js --tag=名前 [--cases=mole,jump] [--model=deepseek-v4-flash]
  [--effort=high] [--conc=3] [--reuse=旧タグ] [--score-only]
```
10ジャンルの設計書からDeepSeekで実生成→Playwright実プレイで11項目×10本=110点満点の
自動採点（cycle5でレイアウト検査を追加）。プロンプト（BUILD2_SYSTEM/GOLD_JS）は
index.tsから毎回抽出されるので、プロンプト改善→再実行で効果を数字で確認できる。
ビューポートは480×720（＝固定ステージと論理1:1）。
スコア推移: baseline 74 → cycle1 88 → cycle2 86 → cycle3 83 → **cycle4 96**（/100）
→ cycle5 102/110（レイアウト検査追加） → **final23 103/110**（2:3固定ステージ480×720）
（残る減点はボットのプレイスキル起因。生成失敗はゼロを維持）
主な学び: ①JSON修復パーサ必須（不正エスケープ・生改行・内側生クォートの3段修復）
②JS文字列はシングルクォート統一ルール ③絵文字フォント指定は正確な例文を提示
④絵文字は**リテラル文字で書かせる**（\u エスケープ/codePoint 禁止。禁止しないと
バックスラッシュ回避ルールの副作用で「U0001fa99」等の文字列がそのまま描画される）
⑤スコア/残り時間/ライフの自前描画を禁止（HUDがあるのに独自表示を作って
「0001 99」のような数字ゴミを出す）⑥レイアウトは数値で指示（固定480×720、
コンテンツは x:0-480 / y:56-712、幅85%以上を中央使用、グリッドはセル計算式を明記）。

# ナビゲーション履歴（スワイプ戻る）E2E

```
node tests/nav-history.js
```
タブ切替が履歴に積まれないこと／ドリルダウンからのbackが同タブの1つ上に戻ること。

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
- 固定ステージ（480×720）では**座標系は3つ全部を同じ変換で揃える**：canvasは
  ctx.setTransform(DPR*__SC,...,DPR*__OX,DPR*__OY)＋clip、DOM(#vpstage)は
  transform:scale(__SC)+left/top、入力は toLX/toLY で論理座標へ逆変換。
  どれか1つでも素通しにすると「canvasだけ帯付き・HUDだけ等倍」のズレが再発する
- テスト側の物理座標が要る時は window.__SC/__OX/__OY を使う（user-images.js の
  ピクセル検査が論理座標のままだとスケール導入で壊れた実績あり）
- **iOS Safariは fillStyle がグラデーション/パターンのままだとカラー絵文字を
  fillTextできない**（何も描かれない。普通の文字は描ける）。AIは「背景グラデ→
  そのまま絵文字」を高頻度で書くため実機で船や敵が全部消える。Chromiumは
  fillStyleを無視して色付き絵文字を描くので**自動テストでは検出不可能**。
  → RUNTIME_TPL の fillText ラッパ（絵文字を含む時だけ単色に退避→復元）で
  恒久ガード済み。実機切り分けは arcade/diag/emoji*.html（3段の二分探索）参照
