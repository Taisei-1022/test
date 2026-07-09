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

## 過去に踏んだ地雷（雛形をいじる時はここを再確認）
- pointerイベントのみ依存 → iOSのiframeで死ぬ（touch/mouseフォールバック必須）
- touchstart/touchend で preventDefault → **click合成が死んでボタンが押せなくなる**
  → preventDefault は touchmove だけ（パン横取り防止はこれで十分）
- pointer環境では touch の発火だけ二重防止（seenPointerフラグ）。preventDefaultの
  判断とは分離すること
