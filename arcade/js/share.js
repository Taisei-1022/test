/* 共有モジュール（全画面共通）
   - Share.open({gameId, gameTitle}) でポップアップを表示。
   - 「このゲームを共有」= play.html?game=ID へのリンク。
   - 「Vappaを共有」= アプリ本体(index.html のディレクトリ)へのリンク。
   - 端末がWeb Share API対応ならネイティブの共有シート、非対応ならクリップボードへコピー。 */
window.Share = (function () {
  "use strict";

  // 配置ディレクトリ（…/arcade/）。index.html / play.html の土台。
  function baseDir() { return location.origin + location.pathname.replace(/[^/]*$/, ""); }
  function appUrl() { return baseDir(); }
  function gameUrl(id) { return baseDir() + "play.html?game=" + encodeURIComponent(id); }

  function toast(msg) {
    var t = document.createElement("div");
    t.textContent = msg;
    t.setAttribute("style", "position:fixed;left:50%;bottom:90px;transform:translateX(-50%);z-index:10000;" +
      "background:#2a2d3d;color:#fff;font-weight:700;font-size:14px;padding:10px 16px;border-radius:12px;box-shadow:0 6px 20px rgba(0,0,0,.45)");
    document.body.appendChild(t);
    setTimeout(function () { try { t.remove(); } catch (e) {} }, 1600);
  }

  async function doShare(title, text, url) {
    try {
      if (navigator.share) { await navigator.share({ title: title, text: text, url: url }); return; }
    } catch (e) { if (e && e.name === "AbortError") return; }
    try { await navigator.clipboard.writeText(url); toast("リンクをコピーしました"); return; } catch (e) {}
    try { window.prompt("リンクをコピーしてください", url); } catch (e) {}
  }

  function close() { var o = document.getElementById("__shareov"); if (o) o.remove(); }

  function btn(label, accent) {
    var b = document.createElement("button");
    b.textContent = label;
    b.setAttribute("style", "display:block;width:100%;text-align:center;font-weight:800;font-size:15px;" +
      "padding:15px 14px;margin:8px 0 0;border-radius:14px;border:1px solid " + (accent ? "#7b61ff" : "#3a3d52") + ";" +
      "background:" + (accent ? "#7b61ff" : "#23263a") + ";color:#fff;cursor:pointer");
    return b;
  }

  function open(opts) {
    opts = opts || {};
    close();
    var ov = document.createElement("div");
    ov.id = "__shareov";
    ov.setAttribute("style", "position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.55);" +
      "display:flex;align-items:flex-end;justify-content:center");
    var sheet = document.createElement("div");
    sheet.setAttribute("style", "width:100%;max-width:520px;background:#181a27;border-radius:20px 20px 0 0;" +
      "padding:16px 16px calc(18px + env(safe-area-inset-bottom));box-shadow:0 -10px 36px rgba(0,0,0,.55)");
    var head = document.createElement("div");
    head.textContent = "共有する";
    head.setAttribute("style", "font-weight:800;font-size:16px;color:#fff;margin:2px 2px 6px");
    sheet.appendChild(head);

    if (opts.gameId) {
      var sub = document.createElement("div");
      sub.textContent = "「" + (opts.gameTitle || "このゲーム") + "」";
      sub.setAttribute("style", "font-size:12px;font-weight:700;color:#9aa0b5;margin:0 2px 4px");
      sheet.appendChild(sub);
      var g = btn("🎮 このゲームを共有", true);
      g.addEventListener("click", function () {
        close();
        doShare((opts.gameTitle || "ゲーム") + "｜Vappa", "「" + (opts.gameTitle || "ゲーム") + "」で遊ぼう！", gameUrl(opts.gameId));
      });
      sheet.appendChild(g);
    }

    var a = btn("✨ Vappa（アプリ）を共有", !opts.gameId);
    a.addEventListener("click", function () {
      close();
      doShare("Vappa", "AIでミニゲームを作って遊べる Vappa", appUrl());
    });
    sheet.appendChild(a);

    var c = btn("キャンセル", false);
    c.style.marginTop = "12px";
    c.style.opacity = "0.85";
    c.addEventListener("click", close);
    sheet.appendChild(c);

    ov.appendChild(sheet);
    ov.addEventListener("click", function (e) { if (e.target === ov) close(); });
    document.body.appendChild(ov);
  }

  return { open: open, gameUrl: gameUrl, appUrl: appUrl };
})();
