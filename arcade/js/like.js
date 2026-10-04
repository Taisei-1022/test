/* いいねボタン（共通部品）。プレイ画面の上・結果画面・ゲーム一覧のカードで使う。
   押した時の動きは X / Instagram を参考に：文字のお知らせは出さず、ハート自体で伝える。
   - いいね：線のハートがピンクに塗られながら一度ふくらんで戻る＋輪が広がり粒が飛ぶ＋数字が下から入れ替わる＋軽い振動
   - 取り消し：演出なしで静かに戻る
   使い方：Like.html(gameId, count, liked, "sm"|"md"|"lg") で HTML を作り、Like.bind(親要素) で押せるようにする。
   同じゲームのボタンが画面に複数あっても（上部と結果画面など）、全部いっしょに切り替わる。 */
window.Like = (function () {
  "use strict";
  var state = {};   // gameId → { liked, count }
  var CSS =
    ".vlike{position:relative;display:inline-flex;align-items:center;gap:5px;background:none;border:0;padding:4px 6px;margin:0;color:inherit;font:inherit;font-weight:800;cursor:pointer;-webkit-tap-highlight-color:transparent;touch-action:manipulation}" +
    ".vlike:focus-visible{outline:2px solid #cdbcff;outline-offset:2px;border-radius:8px}" +
    ".vlike .vh{position:relative;display:inline-flex;width:20px;height:20px}" +
    ".vlike.md .vh{width:22px;height:22px}.vlike.lg .vh{width:24px;height:24px}" +
    ".vlike svg{width:100%;height:100%;overflow:visible}" +
    ".vlike .hp{fill:none;stroke:currentColor;stroke-width:2;transition:fill .15s,stroke .15s}" +
    ".vlike.on .hp{fill:#f91880;stroke:#f91880}" +
    ".vlike .cnt{position:relative;display:inline-block;min-width:1ch;height:1.2em;line-height:1.2em;overflow:hidden;font-variant-numeric:tabular-nums;font-size:12.5px}" +
    ".vlike.md .cnt{font-size:13.5px}.vlike.lg .cnt{font-size:15px}" +
    ".vlike.on .cnt{color:#f91880}" +
    ".vlike .cnt i{display:block;font-style:normal}" +
    ".vlike .cnt i.in{animation:vlIn .3s ease-out both}" +
    ".vlike .ring{position:absolute;left:50%;top:50%;width:100%;height:100%;margin:-50% 0 0 -50%;border-radius:50%;border:2px solid #f91880;opacity:0;pointer-events:none}" +
    ".vlike .dot{position:absolute;left:50%;top:50%;width:4px;height:4px;margin:-2px 0 0 -2px;border-radius:50%;opacity:0;pointer-events:none}" +
    ".vlike.pop svg{animation:vlPop .45s cubic-bezier(.17,.89,.32,1.49)}" +
    ".vlike.pop .ring{animation:vlRing .45s ease-out}" +
    ".vlike.pop .dot{animation:vlDot .55s ease-out}" +
    "@keyframes vlPop{0%{transform:scale(.5)}45%{transform:scale(1.3)}100%{transform:scale(1)}}" +
    "@keyframes vlRing{0%{transform:scale(.3);opacity:.9;border-width:6px}100%{transform:scale(1.9);opacity:0;border-width:0}}" +
    "@keyframes vlDot{0%{transform:rotate(var(--a)) translateY(0) scale(1);opacity:0}15%{opacity:1}100%{transform:rotate(var(--a)) translateY(-17px) scale(.3);opacity:0}}" +
    "@keyframes vlIn{0%{transform:translateY(90%);opacity:0}100%{transform:translateY(0);opacity:1}}" +
    "@media (prefers-reduced-motion:reduce){.vlike.pop svg,.vlike.pop .ring,.vlike.pop .dot,.vlike .cnt i.in{animation:none}}";
  var DOT_COLORS = ["#f91880", "#ff7a59", "#ffb347", "#a78bfa", "#38bdf8", "#f91880"];
  (function inject() {
    if (document.getElementById("vlike-css")) return;
    var st = document.createElement("style"); st.id = "vlike-css"; st.textContent = CSS;
    (document.head || document.documentElement).appendChild(st);
  })();
  function fmt(n) { n = +n || 0; return n >= 10000 ? (Math.floor(n / 1000) / 10) + "万" : String(n); }
  function heart() { return '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="hp" d="M12 20.3s-7.2-4.5-9.4-9.1C1.1 8 3 4.6 6.4 4.4c2.1-.1 3.7 1.1 4.6 2.7.4.6 1.6.6 2 0 .9-1.6 2.5-2.8 4.6-2.7 3.4.2 5.3 3.6 3.8 6.8-2.2 4.6-9.4 9.1-9.4 9.1z"/></svg>'; }
  function html(gameId, count, liked, size) {
    if (gameId == null) return "";
    var s = state[gameId] || (state[gameId] = { liked: !!liked, count: +count || 0 });
    var dots = DOT_COLORS.map(function (c, i) { return '<span class="dot" style="--a:' + (i * 60) + 'deg;background:' + c + '"></span>'; }).join("");
    return '<button type="button" class="vlike ' + (size || "sm") + (s.liked ? " on" : "") + '" data-like="' + String(gameId).replace(/"/g, "") + '" aria-pressed="' + s.liked + '" aria-label="いいね">' +
      '<span class="vh">' + heart() + '<span class="ring"></span>' + dots + '</span><span class="cnt"><i>' + fmt(s.count) + '</i></span></button>';
  }
  function paint(gameId, animate) {
    var s = state[gameId];
    document.querySelectorAll('.vlike[data-like="' + gameId + '"]').forEach(function (b) {
      b.classList.toggle("on", s.liked); b.setAttribute("aria-pressed", String(s.liked));
      var c = b.querySelector(".cnt");
      if (c) { c.innerHTML = '<i class="' + (animate ? "in" : "") + '">' + fmt(s.count) + "</i>"; }
      if (animate) { b.classList.remove("pop"); void b.offsetWidth; b.classList.add("pop"); setTimeout(function () { b.classList.remove("pop"); }, 600); }
    });
  }
  function toggle(gameId) {
    if (!window.Store || !Store.like) return;
    var s = state[gameId] || (state[gameId] = { liked: false, count: 0 });
    var want = !s.liked;
    s.liked = want; s.count = Math.max(0, s.count + (want ? 1 : -1));
    paint(gameId, want);   // 先に見た目を変える（待たせない）
    if (want && navigator.vibrate) { try { navigator.vibrate(12); } catch (e) {} }
    Store.like(gameId, want).then(function (d) { s.liked = d.liked; s.count = d.total; paint(gameId, false); })
      .catch(function () { s.liked = !want; s.count = Math.max(0, s.count + (want ? -1 : 1)); paint(gameId, false); });
  }
  function bind(root) {
    (root || document).addEventListener("click", function (e) {
      var b = e.target.closest && e.target.closest(".vlike[data-like]"); if (!b) return;
      e.preventDefault(); e.stopPropagation();
      toggle(b.getAttribute("data-like"));
    }, true);
  }
  // 数や状態を外から更新（いいね数の読み込み後など）。押した直後の見た目は上書きしない
  function set(gameId, count, liked) {
    var s = state[gameId] || (state[gameId] = { liked: !!liked, count: +count || 0 });
    if (count != null) s.count = +count || 0;
    if (liked != null) s.liked = !!liked;
    paint(gameId, false);
  }
  return { html: html, bind: bind, set: set, toggle: toggle };
})();
