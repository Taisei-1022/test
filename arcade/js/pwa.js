/* 「ホーム画面に追加 / インストール」案内（アプリっぽく全画面で使えるようにする）
   - すでにスタンドアロン（ホームから起動）なら何も出さない
   - Android/Chrome: beforeinstallprompt を捕まえて「追加」ボタンでインストール
   - iOS Safari: 追加方法を案内（共有 → ホーム画面に追加）
   - ×で閉じたら覚えておく（localStorage） */
(function () {
  "use strict";
  var KEY = "arcade.a2hs.v1";
  function standalone() {
    return (window.matchMedia && matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true;
  }
  if (standalone()) return;
  if (localStorage.getItem(KEY) === "dismissed") return;

  var isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
  var deferred = null, shown = false;

  function dismiss(bar) {
    try { localStorage.setItem(KEY, "dismissed"); } catch (e) {}
    if (bar) { bar.classList.remove("show"); setTimeout(function () { bar.remove(); }, 300); }
  }
  function showBar(ios) {
    if (shown || standalone()) return; shown = true;
    var bar = document.createElement("div");
    bar.className = "a2hs";
    if (ios) {
      bar.innerHTML =
        '<div class="a2hs-ic"><svg viewBox="0 0 24 24" width="22" height="22"><path d="M12 3v11M12 3l-3.5 3.5M12 3l3.5 3.5" fill="none" stroke="#e6b450" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><rect x="5" y="10" width="14" height="10" rx="2.5" fill="none" stroke="#e6b450" stroke-width="2"/></svg></div>' +
        '<div class="a2hs-tx"><b>アプリのように使う</b><span>下の<strong>共有</strong>から「ホーム画面に追加」</span></div>' +
        '<button class="a2hs-x" aria-label="閉じる">×</button>';
    } else {
      bar.innerHTML =
        '<div class="a2hs-ic"><img src="icon-192.png" alt="" width="34" height="34" style="border-radius:9px"></div>' +
        '<div class="a2hs-tx"><b>ホーム画面に追加</b><span>全画面で快適に遊べます</span></div>' +
        '<button class="a2hs-add">追加</button><button class="a2hs-x" aria-label="閉じる">×</button>';
    }
    document.body.appendChild(bar);
    requestAnimationFrame(function () { bar.classList.add("show"); });
    bar.querySelector(".a2hs-x").addEventListener("click", function () { dismiss(bar); });
    var add = bar.querySelector(".a2hs-add");
    if (add) add.addEventListener("click", function () {
      if (deferred) { deferred.prompt(); try { deferred.userChoice.finally(function(){}); } catch (e) {} deferred = null; }
      dismiss(bar);
    });
  }

  window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault(); deferred = e;
    if (!shown) showBar(false);
  });
  // iOSはイベントが無いので、少し待ってから案内（初回描画の邪魔をしない）
  if (isIOS) setTimeout(function () { if (!shown && !standalone()) showBar(true); }, 1800);
})();
