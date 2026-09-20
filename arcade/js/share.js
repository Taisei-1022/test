/* 共有モジュール（全画面共通）
   - Share.open({gameId, gameTitle, score?, unit?, by?}) でポップアップを表示。
   - score を渡すと「挑戦状」モード：リンクに &ch=スコア&by=名前 を付け、
     受け取った相手の play.html に「◯◯が123点！抜ける？」を出す（＝張り合いループの核）。
   - 「このゲームを共有」= play.html?game=ID（＋挑戦状ならスコア付き）。
   - 「Vappaを共有」= アプリ本体(index.html のディレクトリ)へのリンク。
   - 端末がWeb Share API対応ならネイティブの共有シート、非対応ならクリップボードへコピー。 */
window.Share = (function () {
  "use strict";

  // 配置ディレクトリ（…/arcade/）。index.html / play.html の土台。
  function baseDir() { return location.origin + location.pathname.replace(/[^/]*$/, ""); }
  // 共有リンクのバージョン。OG画像を変えてもLINE等はページURL単位でプレビューを
  // キャッシュするため、ここを上げてURLを変える＝再取得させてサムネを更新する。
  var SHARE_V = "4";
  function appUrl() { return baseDir() + "?v=" + SHARE_V; }
  // ch＝挑戦スコア、by＝挑戦者名 を任意で付与（挑戦状リンク）。
  function gameUrl(id, ch) {
    var u = baseDir() + "play.html?game=" + encodeURIComponent(id) + "&v=" + SHARE_V;
    if (ch && ch.score != null && isFinite(ch.score)) {
      u += "&ch=" + encodeURIComponent(Math.round(ch.score));
      if (ch.by) u += "&by=" + encodeURIComponent(String(ch.by).slice(0, 16));
    }
    return u;
  }

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
    // Web Share 非対応：テキスト＋URLをまとめてコピー（挑戦状の文言も一緒に渡る）
    var payload = (text ? text + "\n" : "") + url;
    try { await navigator.clipboard.writeText(payload); toast("リンクをコピーしました"); return; } catch (e) {}
    try { window.prompt("リンクをコピーしてください", payload); } catch (e) {}
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
    var hasScore = opts.score != null && isFinite(opts.score);
    var sc = hasScore ? Math.round(opts.score) : null;
    var unit = opts.unit || "点";
    var title = opts.gameTitle || "ゲーム";

    var ov = document.createElement("div");
    ov.id = "__shareov";
    ov.setAttribute("style", "position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.55);" +
      "display:flex;align-items:flex-end;justify-content:center");
    var sheet = document.createElement("div");
    sheet.setAttribute("style", "width:100%;max-width:520px;background:#181a27;border-radius:20px 20px 0 0;" +
      "padding:16px 16px calc(18px + env(safe-area-inset-bottom));box-shadow:0 -10px 36px rgba(0,0,0,.55)");
    var head = document.createElement("div");
    head.textContent = hasScore ? "挑戦状を送る" : "共有する";
    head.setAttribute("style", "font-weight:800;font-size:16px;color:#fff;margin:2px 2px 6px");
    sheet.appendChild(head);

    if (opts.gameId) {
      var sub = document.createElement("div");
      sub.textContent = hasScore
        ? "「" + title + "」であなたの " + sc + unit + " を添えて送る"
        : "「" + title + "」";
      sub.setAttribute("style", "font-size:12px;font-weight:700;color:#9aa0b5;margin:0 2px 6px");
      sheet.appendChild(sub);

      if (hasScore) {
        // 挑戦状（スコア付き）：これが張り合いループの主ボタン
        var chb = btn("🔥 挑戦状を送る（" + sc + unit + "）", true);
        chb.addEventListener("click", function () {
          close();
          doShare(
            title + "｜Vappa",
            "「" + title + "」で " + sc + unit + "！抜ける？💪",
            gameUrl(opts.gameId, { score: sc, by: opts.by })
          );
        });
        sheet.appendChild(chb);
        // スコアなしで「ゲームだけ」共有したい人向けのサブ導線
        var gp = btn("🎮 ゲームだけ共有", false);
        gp.addEventListener("click", function () {
          close();
          doShare(title + "｜Vappa", "「" + title + "」で遊ぼう！", gameUrl(opts.gameId));
        });
        sheet.appendChild(gp);
      } else {
        var g = btn("🎮 このゲームを共有", true);
        g.addEventListener("click", function () {
          close();
          doShare(title + "｜Vappa", "「" + title + "」で遊ぼう！", gameUrl(opts.gameId));
        });
        sheet.appendChild(g);
      }
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
    // ボタン以外のどこをタップしても閉じる（シートの余白＝デッドゾーンで固まらないように）。
    ov.addEventListener("click", function (e) { if (!(e.target.closest && e.target.closest("button"))) close(); });
    document.body.appendChild(ov);
  }

  return { open: open, gameUrl: gameUrl, appUrl: appUrl };
})();
