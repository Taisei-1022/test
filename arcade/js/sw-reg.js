/* Service Worker 登録＋アップデート導線
   - 新バージョンを検知したら「更新があります → 更新」バーを表示
   - ユーザーが押したら新SWを有効化してリロード（勝手にはリロードしない）
   - 起動時・前面復帰時に更新チェック（ホーム画面アプリでも入れ直し不要に） */
(function () {
  "use strict";
  if (!("serviceWorker" in navigator)) return;

  var doReload = false;
  navigator.serviceWorker.addEventListener("controllerchange", function () {
    if (doReload) location.reload();
  });

  function showUpdateBar(reg) {
    if (document.getElementById("updbar")) return;
    var bar = document.createElement("div");
    bar.id = "updbar"; bar.className = "updbar";
    bar.innerHTML = '<span>新しいバージョンがあります</span>' +
      '<button id="updbtn" type="button">更新</button>' +
      '<button id="updx" type="button" aria-label="閉じる">×</button>';
    document.body.appendChild(bar);
    requestAnimationFrame(function () { bar.classList.add("show"); });
    document.getElementById("updbtn").addEventListener("click", function () {
      var w = reg.waiting;
      if (w) { doReload = true; w.postMessage({ type: "SKIP_WAITING" }); }
      else { location.reload(); }
    });
    document.getElementById("updx").addEventListener("click", function () {
      bar.classList.remove("show"); setTimeout(function () { bar.remove(); }, 300);
    });
  }

  navigator.serviceWorker.register("sw.js").then(function (reg) {
    if (reg.waiting && navigator.serviceWorker.controller) showUpdateBar(reg);
    reg.addEventListener("updatefound", function () {
      var nw = reg.installing; if (!nw) return;
      nw.addEventListener("statechange", function () {
        if (nw.state === "installed" && navigator.serviceWorker.controller) showUpdateBar(reg);
      });
    });
    function check() { reg.update().catch(function () {}); }
    setTimeout(check, 3000);
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", function () { if (!document.hidden) check(); });
  }).catch(function () {});
})();
