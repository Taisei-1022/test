/* バーガータワーを自動で遊ばせ、縦長動画の「コマ」を1枚ずつ撮る。
   使い方:
     node marketing/tools/burger-capture.js search            … どの乱数の回が動画向きか探す（撮影なし）
     node marketing/tools/burger-capture.js shoot <seed> <out> … その回を 1080x1920 で撮影（out/frames/*.png と out/timeline.json）
   ゲームの時間はこちらで 1/30 秒ずつ進めるので、撮影が遅くても動画はなめらかになる。 */
const fs = require("fs"), path = require("path");
const { chromium } = require("/opt/node22/lib/node_modules/playwright");
const ARCADE = path.join(__dirname, "..", "..", "arcade");
const W = 405, H = 720, FPS = 30;

const INIT = seed => `(() => {
  let s = ${seed} >>> 0;
  Math.random = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  let vt = 1000; const d0 = Date.now();
  performance.now = () => vt; Date.now = () => d0 + vt;
  let q = []; window.requestAnimationFrame = cb => { q.push(cb); return q.length; };
  window.__advance = ms => { vt += ms; const run = q; q = []; run.forEach(cb => cb(vt)); };
})();`;

async function openGame(browser, seed, scale) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: scale });
  const p = await ctx.newPage();
  await p.addInitScript(INIT(seed));
  await p.route("http://game.local/**", r => {
    const u = new URL(r.request().url()); const f = path.join(ARCADE, u.pathname);
    r.fulfill({ path: f, contentType: f.endsWith(".js") ? "text/javascript" : "text/html; charset=utf-8" });
  });
  await p.goto("http://game.local/games/burger/index.html");
  await p.addStyleTag({ content: "#rotBtn{display:none!important}" });
  return { ctx, p };
}

const readState = p => p.evaluate(() => ({ hud: document.getElementById("hud").textContent, over: !document.getElementById("ov").hidden }));

/* 1回分を遊ぶ。onFrame(frameNo) があれば毎コマ呼ぶ（撮影用） */
async function play(p, seed, onFrame, maxFrames = 900) {
  let rnd = seed * 7919 + 1; const r = () => (rnd = (rnd * 16807) % 2147483647) / 2147483647;
  await p.evaluate(() => document.getElementById("startBtn").click());
  const tl = { lands: [], drops: [], collapse: null };
  let f = 0, score = 0, phase = "wait", t0 = 0, x = W / 2, target = W / 2, overAt = null;
  const step = async () => { await p.evaluate(ms => window.__advance(ms), 1000 / FPS); f++; if (onFrame) await onFrame(f); };
  for (let k = 0; k < 8; k++) await step();
  phase = "aim"; t0 = f; x = W / 2 + (r() - .5) * 120; target = W / 2 + (r() - .5) * 2 * 16;
  await p.mouse.move(x, 400); await p.mouse.down();
  while (f < maxFrames) {
    const st = await readState(p);
    const sc = parseInt(st.hud, 10) || 0;
    if (st.over && overAt === null) { overAt = f; tl.collapse = f; tl.score = score; }
    if (overAt !== null) { if (f - overAt >= 30) break; await step(); continue; }
    if (sc !== score) {
      score = sc; tl.lands.push(f);
      phase = "aim"; t0 = f; x = W / 2 + (r() - .5) * 120; target = W / 2 + (r() - .5) * 2 * 16;
      await p.mouse.move(x, 400); await p.mouse.down();
    }
    if (phase === "aim") {
      const k = f - t0, n = 9;   // 9コマかけて狙いを動かしてから離す
      if (k <= n) await p.mouse.move(x + (target - x) * k / n, 400);
      if (k === n + 2) { await p.mouse.up(); tl.drops.push(f); phase = "fall"; }
    }
    await step();
  }
  tl.frames = f; return tl;
}

(async () => {
  const [mode, a1, a2] = process.argv.slice(2);
  const browser = await chromium.launch();
  if (mode === "search") {
    const seeds = Array.from({ length: 24 }, (_, i) => i + 1), out = [];
    for (let i = 0; i < seeds.length; i += 6) {
      await Promise.all(seeds.slice(i, i + 6).map(async seed => {
        const { ctx, p } = await openGame(browser, seed, 1);
        const tl = await play(p, seed, null);
        out.push({ seed, score: tl.score, collapseSec: tl.collapse && +(tl.collapse / FPS).toFixed(1) });
        await ctx.close();
      }));
    }
    out.sort((a, b) => a.seed - b.seed).forEach(o => console.log(JSON.stringify(o)));
  } else if (mode === "shoot") {
    const seed = +a1, dir = path.resolve(a2), fd = path.join(dir, "frames");
    fs.mkdirSync(fd, { recursive: true });
    const { ctx, p } = await openGame(browser, seed, 1080 / W);
    const tl = await play(p, seed, async n => { await p.screenshot({ path: path.join(fd, String(n).padStart(4, "0") + ".png") }); });
    tl.seed = seed; tl.fps = FPS;
    fs.writeFileSync(path.join(dir, "timeline.json"), JSON.stringify(tl, null, 1));
    console.log(JSON.stringify(tl)); await ctx.close();
  }
  await browser.close();
})();
