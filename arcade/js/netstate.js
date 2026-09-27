/* サーバー接続状態の見張り役（全画面共通）
   これが無いと store.js / catalog.js が失敗を握りつぶし、画面には一律
   「まだ記録がありません」「ゲームがありません」としか出ない。すると
   「本当にデータが無い」のか「サーバーが落ちている」のか区別できず、
   原因調査に時間が溶ける（Supabaseの無料プランは7日でまた一時停止するので必ず再発する）。

   使い方：store.js / catalog.js の通信ラッパから Net.fail(status) / Net.ok() を呼ぶだけ。
   失敗の種類を判定して、画面上部に小さく理由を出す。 */
window.Net = (function () {
  "use strict";
  var kind = null;        // null=正常 / "down" / "auth" / "config"
  var el = null;

  // 400は「任意列があるか探る」通常運用なので無視する（誤検知を出さない）
  function classify(status) {
    if (!status) return "down";                          // fetch自体が失敗（オフライン/DNS不可/遮断）
    if (status >= 500) return "down";                    // 502/503/521＝一時停止・起動中・障害
    if (status === 401 || status === 403) return "auth";
    if (status === 404) return "config";
    return null;
  }

  var MSG = {
    down:   "サーバーに接続できません。データを読み込めませんでした。",
    auth:   "サーバーにアクセスを拒否されました（キー設定を確認してください）。",
    config: "サーバーの設定に問題があります（テーブルが見つかりません）。"
  };

  function remove() { if (el) { try { el.remove(); } catch (e) {} el = null; } }

  function show(k) {
    if (el && el.dataset.kind === k) return;             // 同じ内容を出し直さない
    remove();
    el = document.createElement("div");
    el.dataset.kind = k;
    el.setAttribute("style", "position:fixed;left:8px;right:8px;top:calc(env(safe-area-inset-top) + 8px);" +
      "z-index:10001;background:#3a1d24;border:1px solid #f87171;border-radius:12px;" +
      "padding:9px 12px;display:flex;align-items:center;gap:8px;" +
      "box-shadow:0 6px 20px rgba(0,0,0,.45);font-size:12.5px;line-height:1.6;color:#ffe4e6");
    var tx = document.createElement("div");
    tx.setAttribute("style", "flex:1;min-width:0");
    tx.textContent = "⚠️ " + MSG[k];
    var rl = document.createElement("button");
    rl.textContent = "再読込";
    rl.setAttribute("style", "flex:none;background:#f87171;color:#3a1d24;border:0;border-radius:8px;" +
      "padding:6px 10px;font:inherit;font-weight:800;cursor:pointer");
    rl.addEventListener("click", function () { location.reload(); });
    var x = document.createElement("button");
    x.textContent = "×";
    x.setAttribute("style", "flex:none;background:transparent;color:#ffe4e6;border:0;font-size:17px;" +
      "font-weight:900;padding:0 2px;cursor:pointer");
    x.addEventListener("click", remove);
    el.appendChild(tx); el.appendChild(rl); el.appendChild(x);
    (document.body || document.documentElement).appendChild(el);
  }

  return {
    // 通信が失敗した：status は HTTP ステータス（fetch自体の失敗なら 0）
    fail: function (status) {
      var k = classify(status);
      if (!k) return;                                    // 無視してよい失敗
      kind = k;
      try { show(k); } catch (e) {}
    },
    // 1回でも成功したら「落ちている」表示は取り下げる（復帰した時に残さない）
    ok: function () { if (kind) { kind = null; remove(); } },
    kind: function () { return kind; },
    failed: function () { return !!kind; }
  };
})();
