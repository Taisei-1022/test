/* 評価結果（results/<tag>）から「遊んで確かめる」ページ arcade/eval/ を作り直す。
   使い方: node tests/gamegen-eval/gallery.js --tag=prod_pro_flow --label="本番どおり（Pro）"
   - 自動採点は「動くか」しか見ないので、「面白いか・頼んだ通りか」は人が遊んで ○△× を付ける。
   - 評価は端末内に保存し、「評価をコピー」でまとめてコピーできる（チャットに貼って共有する用）。 */
const fs = require("fs"), path = require("path");
const SET = (process.argv.find((a) => a.startsWith("--set=")) || "").slice(6); const CASES = require(SET ? "./cases_" + SET + ".js" : "./cases.js"); // --set=rich / heavy: 別の設計書セット
const args = {};
process.argv.slice(2).forEach(a => { const m = /^--([^=]+)(?:=(.*))?$/.exec(a); if (m) args[m[1]] = m[2] === undefined ? true : m[2]; });
const TAG = args.tag; if (!TAG) { console.error("--tag が必要です"); process.exit(1); }
const LABEL = args.label || TAG;
const SRC = path.join(__dirname, "results", TAG), OUT = path.join(__dirname, "../../arcade/eval");
const report = JSON.parse(fs.readFileSync(path.join(SRC, "report.json"), "utf8"));
const ELEM = fs.existsSync(path.join(SRC, "elements.json")) ? JSON.parse(fs.readFileSync(path.join(SRC, "elements.json"), "utf8")) : {};  // elements.js の結果
const esc = s => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const NAMES = { struct: "構造", loads: "起動", starts: "スタート", animates: "動き", input: "操作反応", probe: "固有挙動", score: "スコア", layout: "レイアウト", errors: "エラー無", gameover: "終了到達", restart: "再開" };

// 古いゲームファイルを消してから書き出す
for (const f of fs.readdirSync(OUT)) if (f.endsWith(".html") && f !== "index.html") fs.unlinkSync(path.join(OUT, f));
let cards = "";
for (const c of CASES) {
  const r = report[c.id] || { total: 0, checks: {}, gen: {} }, g = r.gen || {};
  const hf = path.join(SRC, c.id + ".html"), has = fs.existsSync(hf) && g.ok;
  if (has) fs.copyFileSync(hf, path.join(OUT, c.id + ".html"));
  const badges = Object.keys(NAMES).map(k => `<span class="b ${r.checks[k] === true ? "ok" : "ng"}">${r.checks[k] === true ? "✓" : "✗"} ${NAMES[k]}</span>`).join("");
  const meta = has ? `${esc(g.model)}／${g.sec}秒／¥${g.yen}` : `生成失敗：${esc((g.err || "").slice(0, 120))}`;
  cards += `<div class="card" data-id="${c.id}">
  <div class="hd"><b>${esc(c.title)}</b><span class="cat">${esc(c.category)}</span><span class="sc ${r.total === 11 ? "full" : ""}">${r.total}/11</span></div>
  ${has && g.title ? `<div class="gt">できたゲーム：「${esc(g.title)}」</div>` : ""}
  <div class="badges">${badges}</div>
  <div class="meta">${meta}</div>
  ${ELEM[c.id] && ELEM[c.id].items ? `<div class="adds"><b>足した要素</b>${ELEM[c.id].items.map(it => `<div>${it.code ? "✓" : "✗"} ${esc(it.name)}<span>${it.screen ? "画面でも確認" : "コードのみ確認"}</span></div>`).join("")}</div>` : ""}
  <div class="acts">${has ? `<a class="play" href="${c.id}.html">▶ 遊んでみる</a>` : `<span class="play off">生成できなかった</span>`}
    <div class="rate" role="group" aria-label="${esc(c.title)} の評価">
      <span class="rl">遊んだ感想</span>
      <button data-v="○">○ 使える</button><button data-v="△">△ 惜しい</button><button data-v="×">× ゴミ</button>
    </div>
    <input class="memo" placeholder="ひとこと（例：操作が分かりにくい）" maxlength="80">
    <details><summary>入力した設計書</summary><pre>${esc(c.spec)}</pre></details></div>
</div>`;
}
const html = `<!DOCTYPE html>
<html lang="ja"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex,nofollow">
<title>生成品質チェック | Vappa</title>
<style>
:root{--bg:#141221;--ink:#f1eefb;--dim:#9a93b5;--rule:#2c2740;--plate:#1d1a2e;--gold:#8b5cf6}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
body{margin:0;background:var(--bg);color:var(--ink);font-family:"Hiragino Maru Gothic ProN","Hiragino Sans",system-ui,sans-serif;padding:18px 14px 40px}
h1{font-size:20px;margin:4px 0 2px} .sub{color:var(--dim);font-size:12.5px;line-height:1.7;margin-bottom:14px}
.total{display:inline-block;background:var(--gold);color:#fff;font-weight:900;border-radius:99px;padding:4px 14px;font-size:15px;margin-bottom:14px}
.card{background:var(--plate);border:1px solid var(--rule);border-radius:14px;padding:12px 14px;margin-bottom:12px}
.hd{display:flex;align-items:center;gap:8px} .hd b{font-size:15px;flex:1}
.cat{font-size:10.5px;color:var(--dim);border:1px solid var(--rule);border-radius:99px;padding:2px 8px;flex:none}
.sc{font-weight:900;font-size:15px;color:#fbbf24;flex:none} .sc.full{color:#34d399}
.gt{font-size:12px;color:var(--dim);margin-top:4px}
.badges{display:flex;flex-wrap:wrap;gap:4px;margin:8px 0 6px}
.b{font-size:10px;font-weight:700;border-radius:6px;padding:2px 6px}
.b.ok{background:rgba(52,211,153,.13);color:#34d399} .b.ng{background:rgba(248,113,113,.15);color:#f87171}
.adds{font-size:12px;line-height:1.7;margin-bottom:8px}.adds b{display:block;font-size:11px;color:var(--dim)}.adds span{color:var(--dim);font-size:10.5px;margin-left:6px}
.meta{font-size:11px;color:var(--dim);margin-bottom:8px}
.acts{display:flex;flex-direction:column;gap:8px}
.play{display:block;text-align:center;background:var(--gold);color:#fff;text-decoration:none;font-weight:900;border-radius:12px;padding:11px;font-size:15px}
.play.off{background:var(--rule);color:var(--dim)}
.rate{display:flex;gap:6px;align-items:center;flex-wrap:wrap}.rl{font-size:12px;color:var(--dim);margin-right:2px}
.rate button{flex:1;min-width:76px;background:transparent;border:1px solid var(--rule);color:var(--ink);border-radius:10px;padding:9px 4px;font:inherit;font-size:13px;font-weight:800}
.rate button.on[data-v="○"]{background:#34d399;color:#062a1c;border-color:#34d399}
.rate button.on[data-v="△"]{background:#fbbf24;color:#2a1d00;border-color:#fbbf24}
.rate button.on[data-v="×"]{background:#f87171;color:#2a0606;border-color:#f87171}
.memo{background:var(--bg);border:1px solid var(--rule);color:var(--ink);border-radius:10px;padding:9px 10px;font:inherit;font-size:13px}
details summary{font-size:12.5px;color:var(--dim);cursor:pointer;font-weight:700}
pre{white-space:pre-wrap;font-size:11.5px;line-height:1.7;color:var(--ink);background:var(--bg);border:1px solid var(--rule);border-radius:10px;padding:10px;margin:8px 0 0}
.bar{position:sticky;bottom:0;background:var(--bg);padding:10px 0 4px;display:flex;gap:8px;align-items:center}
.bar button{flex:1;background:var(--gold);color:#fff;border:0;border-radius:12px;padding:12px;font:inherit;font-weight:900;font-size:15px}
#cnt{font-size:12px;color:var(--dim);flex:none}
</style></head><body>
<h1>生成品質チェック（管理者用）</h1>
<p class="sub">${esc(LABEL)}。${CASES[0].adds ? "要素を足した10本の設計書から" : "いつもの10本の設計書から"}、本番のサーバーで生成したもの。<br>バッジは自動テストプレイの採点（<b>動くかどうか</b>）。<b>面白いか・頼んだ通りか</b>は、遊んで ○△× を付けてください。</p>
<div class="total">自動採点 ${esc(report.__grand)}</div>
${cards}
<div class="bar"><span id="cnt"></span><button id="copy">評価をコピー</button></div>
<script>
(function(){
  var KEY="vappa.evalrate.${TAG}", st={};
  try{ st=JSON.parse(localStorage.getItem(KEY))||{}; }catch(e){}
  function save(){ try{ localStorage.setItem(KEY, JSON.stringify(st)); }catch(e){} count(); }
  function count(){ var n=Object.keys(st).filter(function(k){return st[k]&&st[k].v;}).length; document.getElementById("cnt").textContent=n+"/10 評価済み"; }
  document.querySelectorAll(".card").forEach(function(card){
    var id=card.getAttribute("data-id"), s=st[id]||{}, memo=card.querySelector(".memo");
    card.querySelectorAll(".rate button").forEach(function(b){
      if(s.v===b.getAttribute("data-v")) b.classList.add("on");
      b.addEventListener("click", function(){
        card.querySelectorAll(".rate button").forEach(function(x){x.classList.remove("on");});
        b.classList.add("on"); st[id]=Object.assign(st[id]||{}, {v:b.getAttribute("data-v")}); save();
      });
    });
    memo.value=s.m||"";
    memo.addEventListener("input", function(){ st[id]=Object.assign(st[id]||{}, {m:memo.value}); save(); });
  });
  count();
  document.getElementById("copy").addEventListener("click", function(){
    var lines=["生成品質チェック ${TAG} の評価"];
    document.querySelectorAll(".card").forEach(function(card){
      var id=card.getAttribute("data-id"), s=st[id]||{};
      lines.push(card.querySelector(".hd b").textContent+"："+(s.v||"未")+(s.m?"（"+s.m+"）":""));
    });
    var t=lines.join("\\n"), btn=document.getElementById("copy");
    var done=function(){ btn.textContent="コピーしました"; setTimeout(function(){btn.textContent="評価をコピー";},1600); };
    if(navigator.clipboard&&navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(done, function(){ window.prompt("コピーしてください", t); });
    else window.prompt("コピーしてください", t);
  });
})();
</script>
</body></html>`;
fs.writeFileSync(path.join(OUT, "index.html"), html);
console.log("arcade/eval を", TAG, "で作り直しました:", report.__grand);
