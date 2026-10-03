/* 「足した要素が本当に入っているか」の自動チェック（cases_rich.js の adds を使う）。
   使い方: node tests/gamegen-eval/elements.js --tag=prod_rich
   ①コード：生成部分（共通の実行枠を除いた部分）に手がかり ev が書かれているか
   ②画面：時間を3倍速にして約45秒（ゲーム内2分強）遊ばせ、canvas に描かれた文字（絵文字・「コンボ」等）に
     手がかりが出てきたか。後半のボスや段階変化は、腕前（自動操作）次第で到達しないことがある。 */
const fs = require("fs"), path = require("path");
const { chromium } = require("/opt/node22/lib/node_modules/playwright");
const CASES = require("./cases_rich.js");
const args = {};
process.argv.slice(2).forEach(a => { const m = /^--([^=]+)(?:=(.*))?$/.exec(a); if (m) args[m[1]] = m[2] === undefined ? true : m[2]; });
const TAG = args.tag || "prod_rich", SEC = parseInt(args.sec || "45", 10), SPEED = parseFloat(args.speed || "3");
const DIR = path.join(__dirname, "results", TAG);

// 共通の実行枠（どのゲームにも入っている行）を、2本以上のゲームに共通する行として求めて除く
const htmls = Object.fromEntries(CASES.map(c => [c.id, fs.existsSync(path.join(DIR, c.id + ".html")) ? fs.readFileSync(path.join(DIR, c.id + ".html"), "utf8") : null]));
const lineCount = {};
for (const h of Object.values(htmls)) if (h) new Set(h.split("\n").map(l => l.trim())).forEach(l => { lineCount[l] = (lineCount[l] || 0) + 1; });
const own = h => h.split("\n").filter(l => (lineCount[l.trim()] || 0) < 4 || l.trim().length < 3).join("\n");

const HOOK = (speed) => `(() => {
  const S = ${speed}; window.__drawn = new Set();
  const ft = CanvasRenderingContext2D.prototype.fillText, st = CanvasRenderingContext2D.prototype.strokeText;
  CanvasRenderingContext2D.prototype.fillText = function (t) { try { window.__drawn.add(String(t)); } catch (e) {} return ft.apply(this, arguments); };
  CanvasRenderingContext2D.prototype.strokeText = function (t) { try { window.__drawn.add(String(t)); } catch (e) {} return st.apply(this, arguments); };
  const pn = performance.now.bind(performance), t0 = pn(), dn = Date.now, d0 = dn();
  performance.now = () => t0 + (pn() - t0) * S; Date.now = () => d0 + (dn() - d0) * S;
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = cb => raf(() => cb(performance.now()));
  const si = window.setInterval, sto = window.setTimeout;
  window.setInterval = (f, ms, ...a) => si(f, (ms || 0) / S, ...a); window.setTimeout = (f, ms, ...a) => sto(f, (ms || 0) / S, ...a);
})();`;

async function playOne(browser, c, html) {
  const ctx = await browser.newContext({ viewport: { width: 480, height: 720 }, hasTouch: true, isMobile: true });
  const p = await ctx.newPage(); await p.addInitScript(HOOK(SPEED));
  const cdp = await ctx.newCDPSession(p); let restarts = 0;
  const touch = async (type, x, y) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1 }] });
  try {
    await p.route("http://game.local/", r => r.fulfill({ contentType: "text/html; charset=utf-8", body: html }));
    await p.goto("http://game.local/", { timeout: 15000 });  // setContent だと addInitScript が効かないため await p.waitForTimeout(500);
    try { await p.tap("#vpstart", { timeout: 3000 }); } catch (e) {}
    const end = Date.now() + SEC * 1000; let i = 0;
    while (Date.now() < end) {
      const over = await p.evaluate(() => { const o = document.getElementById("vpov"); return !!(o && !o.hidden); });
      if (over) { restarts++; try { await p.tap("#vpstart", { timeout: 1500 }); } catch (e) {} await p.waitForTimeout(300); continue; }
      i++;
      if (c.play === "tapTargets") {
        const t = await p.evaluate(() => { const out = []; for (const k of Object.keys(window)) { try { const v = window[k]; if (Array.isArray(v)) for (const o of v) if (o && typeof o.x === "number" && typeof o.y === "number" && o.y > 60 && o.y < 700) out.push([o.x, o.y]); } catch (e) {} } return out; });
        const q = t.length ? t[i % t.length] : [80 + (i % 3) * 160, 180 + (i % 4) * 120];
        await p.touchscreen.tap(q[0], q[1]); await p.waitForTimeout(120);
      } else if (c.play === "dragMove") {
        await touch("touchStart", 240, 620); const to = 60 + Math.random() * 360;
        for (let k = 1; k <= 6; k++) await touch("touchMove", 240 + (to - 240) * k / 6, 620);
        await touch("touchEnd"); await p.waitForTimeout(200);
      } else if (c.play === "tapAnywhere") { await p.touchscreen.tap(240, 400); await p.waitForTimeout(150 + Math.random() * 300); }
      else if (c.play === "tapSides") { await p.touchscreen.tap(Math.random() < .5 ? 110 : 370, 420); await p.waitForTimeout(250); }
      else if (c.play === "tapGrid") { const pts = [[140, 300], [340, 300], [140, 520], [340, 520]]; const q = pts[(Math.random() * 4) | 0]; await p.touchscreen.tap(q[0], q[1]); await p.waitForTimeout(200); }
      else if (c.play === "holdRelease") { await touch("touchStart", 240, 400); await p.waitForTimeout(150 + Math.random() * 500); await touch("touchEnd"); await p.waitForTimeout(500); }
    }
    const drawn = await p.evaluate(() => Array.from(window.__drawn || []));
    await ctx.close(); return { drawn, restarts };
  } catch (e) { await ctx.close(); return { drawn: [], restarts, err: String(e.message).slice(0, 100) }; }
}

(async () => {
  const browser = await chromium.launch(); const out = {};
  await Promise.all(CASES.map(async c => {
    const h = htmls[c.id]; if (!h) { out[c.id] = { missing: true }; return; }
    const code = own(h), run = await playOne(browser, c, h), drawnText = run.drawn.join(" ");
    out[c.id] = { restarts: run.restarts, err: run.err, drawn: run.drawn.slice(0, 80), items: c.adds.map(a => {
      const res = a.ev.map(e => new RegExp(e, "i"));
      return { name: a.name, k: a.k, code: res.every(r => r.test(code)), screen: res.some(r => r.test(drawnText)) };
    }) };
  }));
  await browser.close();
  fs.writeFileSync(path.join(DIR, "elements.json"), JSON.stringify(out, null, 1));
  let nc = 0, ns = 0, n = 0;
  for (const c of CASES) {
    const r = out[c.id]; if (r.missing) { console.log(`■ ${c.title}: 生成なし`); n += c.adds.length; continue; }
    console.log(`■ ${c.title}（自動プレイ中のゲームオーバー→再開 ${r.restarts}回${r.err ? "／" + r.err : ""}）`);
    for (const it of r.items) { n++; if (it.code) nc++; if (it.screen) ns++; console.log(`   コード${it.code ? "○" : "×"} 画面${it.screen ? "○" : "－"}  ${it.name}`); }
  }
  console.log(`=== コードに入っていた: ${nc}/${n}　自動プレイ中に画面で確認: ${ns}/${n} ===`);
})();
