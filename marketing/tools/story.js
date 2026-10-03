/* 動画2本目（物語仕立て）を作る：①AIに頼む ②できた→遊ぶ→結果 ③挑戦状を送る（トーク画面） ④友だちに超えられる → 締め
   使い方: node marketing/tools/story.js <planのフォルダ> <バーガー撮影フォルダ(burger-capture.js shoot の出力)> <作業フォルダ>
   ① はアプリ本体（arcade/index.html）を手元で開いて、会話を流し込んで撮る（本体のファイルは読むだけで変更しない）。
   ② の結果画面・③ の共有画面は本体と同じ見た目で再現（共有画面は本体の js/share.js をそのまま使う）。
   ③④ のトーク画面は「よくあるメッセージアプリ風」の作り物（特定のアプリの名前・ロゴは使わない）。 */
const fs = require("fs"), path = require("path"), { execSync, execFileSync } = require("child_process");
const { chromium } = require("/opt/node22/lib/node_modules/playwright");
const [planDir, takeDir, work] = process.argv.slice(2).map(p => path.resolve(p));
const P = require(path.join(planDir, "plan.js"));
const ARCADE = path.join(__dirname, "..", "..", "arcade");
const FPS = 30, W = 405, H = 720;          // スマホ画面（CSS の大きさ）
const INNER = 0.8, IN_W = Math.round(1080 * INNER); // 動画の中で、スマホ画面を 80% の大きさで置く
const inDir = path.join(work, "inner"), outDir = path.join(work, "out");
for (const d of [inDir, outDir]) { fs.rmSync(d, { recursive: true, force: true }); fs.mkdirSync(d, { recursive: true }); }

const frames = [];   // 1コマずつ：{ img, cap, tap, sfx }
let innerN = 0;
const ev = { taps: [], msgs: [], lands: [], crash: null, bgmStop: null, bgmResume: null };
const now = () => frames.length / FPS;

function serveArcade(page) {
  return page.route("**/*", r => {
    const u = new URL(r.request().url());
    if (u.host === "app.local") { const f = path.join(ARCADE, decodeURIComponent(u.pathname)); return fs.existsSync(f) ? r.fulfill({ path: f }) : r.abort(); }
    if (u.host === "take.local") return r.fulfill({ path: path.join(takeDir, "frames", path.basename(u.pathname)) });
    return r.abort();
  });
}
async function snap(page, extra) {
  const f = path.join(inDir, String(++innerN).padStart(4, "0") + ".png");
  await page.screenshot({ path: f }); frames.push(Object.assign({ img: f }, extra || {}));
}
// タップした場所に指の丸を出す
const TAP = `(()=>{const t=document.createElement("div");t.id="__tap";t.style.cssText="position:fixed;z-index:99999;width:46px;height:46px;margin:-23px 0 0 -23px;border-radius:50%;background:rgba(255,255,255,.55);border:3px solid rgba(255,255,255,.9);box-shadow:0 0 0 6px rgba(139,92,246,.35);pointer-events:none;display:none";document.body.appendChild(t);
window.__tapAt=(x,y,k)=>{t.style.display=k<0||k>1?"none":"block";t.style.left=x+"px";t.style.top=y+"px";t.style.transform="scale("+(1.25-.35*Math.min(1,k*2))+")";t.style.opacity=String(1-k*.6);};})()`;
const center = (page, sel) => page.evaluate(s => { const r = document.querySelector(s).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }, sel);
async function tapAnim(page, xy, n) { for (let k = 0; k < n; k++) { await page.evaluate(([x, y, k]) => window.__tapAt(x, y, k), [xy[0], xy[1], k / (n - 1)]); await snap(page, { cap: curCap }); } await page.evaluate(() => window.__tapAt(0, 0, -1)); }
let curCap = null;

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: IN_W / W, isMobile: true, hasTouch: true });

  /* ===== ① AIに頼む（本物のアプリ画面） ===== */
  {
    const p = await ctx.newPage(); await serveArcade(p);
    await p.addInitScript(() => { try { localStorage.setItem("vappa_seen_howto", "1"); } catch (e) {} });
    await p.goto("http://app.local/index.html"); await p.waitForTimeout(1200);
    await p.evaluate(() => {
      // 手元ではサーバーにつながらないので、その表示と初回の名前入力を隠し、「作る（AI）」のチャット画面にする
      document.querySelectorAll("body *").forEach(el => { if (getComputedStyle(el).position === "fixed" && /サーバーに接続/.test(el.textContent) && el.textContent.length < 120) el.style.display = "none"; });
      document.getElementById("nameGate").hidden = true;
      document.querySelectorAll(".view").forEach(v => v.classList.toggle("active", v.id === "view-create"));
      document.querySelectorAll("#view-create .crscreen").forEach(s => s.classList.toggle("on", s.id === "cr-chat"));
      document.querySelectorAll(".tabbar button").forEach(b => b.classList.toggle("on", b.dataset.tab === "create"));
      document.getElementById("chatlog").innerHTML = ""; document.getElementById("modeltag").hidden = true;
      window.__msg = (cls, text) => { const d = document.createElement("div"); d.className = "msg " + cls; d.textContent = text; const l = document.getElementById("chatlog"); l.appendChild(d); l.scrollTop = l.scrollHeight; return d; };
    });
    await p.evaluate(TAP);
    curCap = P.cap.ask;
    for (let f = 0; f < 12; f++) await snap(p, { cap: curCap });
    const req = [...P.request];
    for (let i = 1; i <= req.length; i++) { await p.evaluate(t => { const a = document.getElementById("chatInput"); a.value = t; a.style.height = "auto"; a.style.height = a.scrollHeight + "px"; }, req.slice(0, i).join("")); await snap(p, { cap: curCap }); if (i % 2) await snap(p, { cap: curCap }); }
    const send = await center(p, "#chatSend"); ev.taps.push(now()); await tapAnim(p, send, 6);
    await p.evaluate(t => { const a = document.getElementById("chatInput"); a.value = ""; a.style.height = ""; document.getElementById("chips").style.display = "none"; window.__msg("user", t); window.__t = window.__msg("bot typing", "作っているよ…"); }, P.request);
    ev.msgs.push(now());
    for (let f = 0; f < 22; f++) await snap(p, { cap: curCap });
    // 実際は数分かかるので、時間を飛ばしたことをはっきり出す
    await p.evaluate(() => { const s = document.createElement("div"); s.id = "__skip"; s.textContent = "⏩ 数分後"; s.style.cssText = "position:fixed;left:50%;top:44%;transform:translate(-50%,-50%);z-index:9999;background:rgba(0,0,0,.72);color:#fff;font-weight:800;font-size:20px;padding:12px 22px;border-radius:999px"; document.body.appendChild(s); });
    for (let f = 0; f < 24; f++) await snap(p, { cap: curCap });
    await p.evaluate(g => { document.getElementById("__skip").remove(); window.__t.remove(); window.__msg("bot", "「" + g + "」ができたよ！下のボタンか右上の「プレビュー」で遊んでみて。\nさらに直したい時はそのまま話してね。"); document.getElementById("toPreview").classList.remove("off"); }, P.game);
    ev.msgs.push(now()); curCap = P.cap.done;
    for (let f = 0; f < 26; f++) await snap(p, { cap: curCap });
    const pv = await center(p, "#toPreview"); ev.taps.push(now()); await tapAnim(p, pv, 7);
    await p.close();
  }

  /* ===== ② 遊ぶ（撮影済みのプレイ）→ 結果 ===== */
  const tl = JSON.parse(fs.readFileSync(path.join(takeDir, "timeline.json")));
  const take = n => path.join(takeDir, "frames", String(n).padStart(4, "0") + ".png");
  curCap = P.cap.play;
  const seg = [[9, 395, 2.6], [396, 430, 0.8]];
  ev.bgmStop = null;
  for (const [a, b, sp] of seg) for (let j = 0; ; j++) {
    const r = a + Math.floor(j * sp); if (r > b) break;
    if (tl.lands.some(l => l > (frames.length ? frames[frames.length - 1].raw || 0 : 0) && l <= r)) ev.lands.push(now());
    if (r >= 398 && ev.crash === null) { ev.crash = now(); ev.bgmStop = now() - 0.25; }
    frames.push({ img: take(r), raw: r, cap: r >= 398 ? null : curCap });
  }
  {
    // 結果シートと共有シート：本体の play.html / js/share.js と同じ見た目
    const p = await ctx.newPage(); await serveArcade(p);
    await p.route("http://mock.local/", r => r.fulfill({ contentType: "text/html; charset=utf-8", body:
      `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%;background:#141221;font-family:system-ui,sans-serif}#bg{position:fixed;inset:0;width:100%;height:100%}</style></head>
       <body><img id="bg" src="http://take.local/0432.png"><script src="http://app.local/js/share.js"></script></body></html>` }));
    await p.goto("http://mock.local/"); await p.evaluate(() => document.getElementById("bg").decode());
    await p.evaluate(TAP);
    await p.evaluate(([sc, unit]) => {
      const ov = document.createElement("div"); ov.id = "__resultov";
      ov.setAttribute("style", "position:fixed;inset:0;z-index:9990;background:rgba(0,0,0,.55);display:flex;align-items:flex-end;justify-content:center");
      const btn = (l, a) => '<button style="display:block;width:100%;text-align:center;font-weight:800;font-size:15px;padding:15px 14px;margin:8px 0 0;border-radius:14px;border:1px solid ' + (a ? "#7b61ff" : "#3a3d52") + ";background:" + (a ? "#7b61ff" : "#23263a") + ';color:#fff"' + (a ? ' id="sendBtn"' : "") + ">" + l + "</button>";
      ov.innerHTML = '<div id="sheet" style="width:100%;background:#181a27;border-radius:20px 20px 0 0;padding:18px 16px 18px;box-shadow:0 -10px 36px rgba(0,0,0,.55);text-align:center">' +
        '<div style="margin:2px 0 4px"><span style="font-size:40px;font-weight:900;color:#ffd166">' + sc + '</span><span style="font-size:18px;font-weight:800;color:#ffd166;margin-left:2px">' + unit + "</span></div>" +
        '<div style="font-weight:900;font-size:16px;margin:2px 0 6px;color:#34d399">✨ 自己ベスト更新！</div>' + btn("🔥 スコアを添えて挑戦状を送る", true) +
        '<div style="display:flex;gap:8px">' + btn("🔄 もう一回").replace("display:block;", "display:block;flex:1;") + btn("🏆 ランキング").replace("display:block;", "display:block;flex:1;") + "</div></div>";
      document.body.appendChild(ov);
    }, [P.myScore, P.unit]);
    curCap = P.cap.result;
    const slide = async (sel, n) => { for (let k = 0; k <= n; k++) { await p.evaluate(([s, y]) => { document.querySelector(s).style.transform = "translateY(" + y + "%)"; }, [sel, 100 * Math.pow(1 - k / n, 3)]); await snap(p, { cap: curCap }); } };
    await slide("#sheet", 8);
    for (let f = 0; f < 22; f++) await snap(p, { cap: curCap });
    ev.taps.push(now()); await tapAnim(p, await center(p, "#sendBtn"), 6);
    // 本物の共有シート（Share.open）
    await p.evaluate(([id, t, sc, u, by]) => { document.getElementById("__resultov").remove(); Share.open({ gameId: id, gameTitle: t, score: sc, unit: u, by }); }, [P.gameId, P.game, P.myScore, P.unit, P.me]);
    const sheetSel = "#__shareov > div";
    await slide(sheetSel, 7);
    for (let f = 0; f < 14; f++) await snap(p, { cap: curCap });
    const chBtn = await p.evaluate(() => { const b = [...document.querySelectorAll("#__shareov button")].find(b => /挑戦状を送る/.test(b.textContent)); const r = b.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
    ev.taps.push(now()); await tapAnim(p, chBtn, 6);
    await p.close();
  }

  /* ===== ③④ トーク画面（よくあるメッセージアプリ風・作り物） ===== */
  {
    const p = await ctx.newPage(); await serveArcade(p);
    const card = (sc) => `<div class="card"><img src="http://app.local/og.png"><div class="ct">${P.game}｜Vappa</div><div class="cd">vappa.app</div></div>`;
    const shareText = sc => `「${P.game}」で ${sc}${P.unit}！抜ける？💪\nhttps://vappa.app/arcade/play.html?game=${P.gameId}&ch=${sc}…`;
    await p.route("http://talk.local/", r => r.fulfill({ contentType: "text/html; charset=utf-8", body: `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
      *{box-sizing:border-box;margin:0} html,body{height:100%;font-family:"IPAPGothic",system-ui,sans-serif;background:#a8bcd8;overflow:hidden}
      .top{position:fixed;top:0;left:0;right:0;height:52px;background:#a8bcd8;display:flex;align-items:center;padding:0 12px;gap:10px;color:#1b2333;font-weight:700;font-size:17px;border-bottom:1px solid rgba(0,0,0,.06)}
      .top .bk{font-size:28px;line-height:1;margin-top:-4px}
      .log{position:fixed;top:52px;bottom:58px;left:0;right:0;padding:12px 10px;display:flex;flex-direction:column;justify-content:flex-end;gap:10px;overflow:hidden}
      .row{display:flex;align-items:flex-end;gap:6px}
      .row.me{justify-content:flex-end}
      .av{width:34px;height:34px;border-radius:50%;background:#ffd8a8;display:flex;align-items:center;justify-content:center;font-size:20px;flex:none;align-self:flex-start}
      .nm{font-size:11px;color:#3b4a63;margin:0 0 3px 2px}
      .b{max-width:250px;padding:9px 12px;border-radius:18px;font-size:15px;line-height:1.45;white-space:pre-wrap;word-break:break-all;color:#111}
      .them .b{background:#fff;border-top-left-radius:4px}
      .me .b{background:#9be06f;border-top-right-radius:4px}
      .b .u{color:#1a55c4;text-decoration:underline}
      .meta{font-size:10px;color:#3b4a63;line-height:1.3;text-align:right;white-space:nowrap}
      .them .meta{text-align:left}
      .card{width:230px;background:#fff;border-radius:14px;overflow:hidden;margin-top:6px}
      .card img{width:100%;display:block;aspect-ratio:1200/630;object-fit:cover}
      .card .ct{font-size:13px;font-weight:700;padding:7px 10px 0;color:#111}
      .card .cd{font-size:11px;color:#777;padding:2px 10px 8px}
      .day{align-self:center;background:rgba(0,0,0,.18);color:#fff;font-size:11px;padding:3px 10px;border-radius:999px}
      .skip{align-self:center;background:rgba(0,0,0,.6);color:#fff;font-size:14px;font-weight:700;padding:6px 16px;border-radius:999px}
      .bar{position:fixed;left:0;right:0;bottom:0;height:58px;background:#fff;display:flex;align-items:center;gap:10px;padding:0 12px;color:#888;font-size:22px}
      .bar .in{flex:1;height:36px;border-radius:18px;background:#f1f2f4;font-size:14px;display:flex;align-items:center;padding:0 14px;color:#999}
      .pop{animation:none}
    </style></head><body>
      <div class="top"><span class="bk">‹</span><span>${P.friend}</span></div>
      <div class="log" id="log">
        <div class="day">昨日</div>
        <div class="row them"><div class="av">🧑</div><div><div class="nm">${P.friend}</div><div class="b">あしたの小テストどこまで？</div></div><div class="meta">22:41</div></div>
        <div class="row me"><div class="meta">既読<br>22:43</div><div class="b">p.30まで</div></div>
        <div class="day">今日</div>
      </div>
      <div class="bar"><span>＋</span><div class="in">Aa</div><span>☺</span></div>
    </body></html>` }));
    await p.goto("http://talk.local/"); await p.waitForTimeout(300);
    await p.evaluate(() => Promise.all([...document.images].map(i => i.decode().catch(() => {}))));
    await p.evaluate(() => {
      window.__add = (html, cls) => { const d = document.createElement("div"); d.innerHTML = html; const el = d.firstElementChild; el.style.transformOrigin = cls === "me" ? "100% 100%" : "0 100%"; document.getElementById("log").appendChild(el); return el; };
      window.__popk = (el, k) => { const s = k >= 1 ? 1 : k < .6 ? .6 + .55 * (k / .6) : 1.15 - .15 * ((k - .6) / .4); el.style.transform = "scale(" + s + ")"; el.style.opacity = Math.min(1, k * 2.5); };
    });
    const esc = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
    const linkify = t => esc(t).replace(/(https:\S+)/, '<span class="u">$1</span>');
    const meMsg = (t, extra, meta) => `<div class="row me"><div class="meta">${meta}</div><div><div class="b">${linkify(t)}</div>${extra || ""}</div></div>`;
    const themMsg = (t, extra, meta) => `<div class="row them"><div class="av">🧑</div><div><div class="nm">${P.friend}</div><div class="b">${linkify(t)}</div>${extra || ""}</div><div class="meta">${meta}</div></div>`;
    const add = async (html, cls, n, cap) => {
      if (cap !== undefined) curCap = cap;
      ev.msgs.push(now());
      await p.evaluate(([h, c]) => { window.__el = window.__add(h, c); }, [html, cls]);
      for (let k = 0; k < n; k++) { await p.evaluate(k => window.__popk(window.__el, k), Math.min(1, k / 6)); await snap(p, { cap: curCap }); }
    };
    curCap = P.cap.result;
    for (let f = 0; f < 6; f++) await snap(p, { cap: curCap });
    await add(meMsg(shareText(P.myScore), card(P.myScore), "19:02"), "me", 20, P.cap.sent);
    await p.evaluate(() => { const m = document.querySelector("#log .row.me:last-child .meta"); m.innerHTML = "既読<br>19:02"; });
    for (let f = 0; f < 10; f++) await snap(p, { cap: curCap });
    await add(themMsg(P.friendFirst, "", "19:03"), "them", 30);
    await add(`<div class="skip">⏩ ${P.skip}</div>`, "", 20);
    await add(themMsg(P.friendBeat, "", "20:11"), "them", 10, P.cap.beat);
    await add(themMsg(shareText(P.friendScore), card(P.friendScore), "20:11"), "them", 40);
    await add(meMsg(P.myLast, "", "既読<br>20:12"), "me", 32, P.cap.last);
    await p.close();
  }
  const endStart = now();

  /* ===== 動画の画面に合成（上に字幕、真ん中にスマホ画面、最後に締め） ===== */
  const allText = Object.values(P.cap).join("") + Object.values(P.end).join("") + `${P.myScore}${P.unit}`;
  const css = execFileSync("curl", ["-sS", "-A", "Mozilla/5.0 Chrome/120", "https://fonts.googleapis.com/css2?family=M+PLUS+Rounded+1c:wght@800&text=" + encodeURIComponent([...new Set(allText.replace(/<br>/g, ""))].join(""))]).toString();
  const fontFile = path.join(work, "font.woff2"); execFileSync("curl", ["-sS", "-o", fontFile, /url\((https:[^)]+)\)/.exec(css)[1]]);
  const font64 = fs.readFileSync(fontFile).toString("base64");
  const IW = Math.round(W * INNER), IH = Math.round(H * INNER), IX = Math.round((W - IW) / 2), IY = 128;
  const PAGE = `<!doctype html><html><head><meta charset="utf-8"><style>
    @font-face{font-family:R;src:url(data:font/woff2;base64,${font64}) format("woff2");font-weight:800}
    *{margin:0;box-sizing:border-box} html,body{width:${W}px;height:${H}px;overflow:hidden;font-family:R,sans-serif;font-weight:800;
      background:radial-gradient(120% 70% at 50% 0%,#3a2a66 0%,#1a1430 55%,#120e22 100%)}
    #ph{position:absolute;left:${IX}px;top:${IY}px;width:${IW}px;height:${IH}px;border-radius:22px;overflow:hidden;box-shadow:0 0 0 5px #0b0816,0 0 0 7px #3b3164,0 18px 40px rgba(0,0,0,.6)}
    #ph img{width:100%;height:100%;display:block;object-fit:cover}
    #cap{position:absolute;left:0;right:0;top:42px;height:84px;display:flex;align-items:center;justify-content:center;text-align:center;color:#fff;font-size:29px;line-height:1.2;
      -webkit-text-stroke:8px #1a0f2a;paint-order:stroke fill;text-shadow:0 3px 0 #1a0f2a}
    #cap span{display:inline-block;transform-origin:50% 50%}
    #end{position:absolute;inset:0;display:none;flex-direction:column;align-items:center;padding-top:170px;gap:12px;background:rgba(14,9,24,.72);color:#fff;text-align:center}
    #end .catch{font-size:40px;-webkit-text-stroke:8px #1a0f2a;paint-order:stroke fill}
    #end .url{margin-top:16px;font-size:40px;color:#fff;background:#8b5cf6;border-radius:22px;padding:8px 28px;box-shadow:0 6px 0 #5b35b8}
    #end .sub{margin-top:10px;font-size:15px;color:#efe9ff}
    #end .note{position:absolute;top:120px;font-size:11px;color:#b9b0d6}
  </style></head><body><div id="ph"><img id="im"></div><div id="cap"><span></span></div>
    <div id="end"><div class="note"></div><div class="catch"></div><div class="url"></div><div class="sub"></div></div></body></html>`;
  const octx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1080 / W });
  const o = await octx.newPage();
  await o.route("http://f.local/**", r => r.fulfill({ path: decodeURIComponent(new URL(r.request().url()).pathname) }));
  await o.route("http://c.local/", r => r.fulfill({ contentType: "text/html; charset=utf-8", body: PAGE }));
  await o.goto("http://c.local/"); await o.evaluate(() => document.fonts.ready);
  const pop = k => k >= 1 ? 1 : k < .6 ? .55 + .6 * (k / .6) : 1.15 - .15 * ((k - .6) / .4);
  let n = 0, lastCap = null, capStart = 0;
  const shot = () => o.screenshot({ path: path.join(outDir, String(++n).padStart(4, "0") + ".png") });
  for (let i = 0; i < frames.length; i++) {
    const fr = frames[i];
    if (fr.cap !== lastCap) { lastCap = fr.cap; capStart = i; }
    await o.evaluate(async ([src, cap, s]) => { const im = document.getElementById("im"); if (im.dataset.s !== src) { im.dataset.s = src; im.src = src; await im.decode(); }
      const c = document.querySelector("#cap span"); c.innerHTML = cap || ""; c.style.transform = "scale(" + s + ") rotate(-2deg)"; }, ["http://f.local" + fr.img, fr.cap, pop((i - capStart) / 5)]);
    await shot();
  }
  // 締め
  const E = P.end, endN = Math.round(3.6 * FPS);
  await o.evaluate(E => { document.querySelector("#cap span").innerHTML = ""; const d = document.getElementById("end"); d.style.display = "flex";
    for (const k of ["catch", "url", "sub", "note"]) d.querySelector("." + k).textContent = E[k]; }, E);
  const order = [".catch", ".url", ".sub", ".note"], delay = [0, 7, 12, 12];
  for (let f = 0; f < endN; f++) {
    await o.evaluate(([order, delay, f]) => order.forEach((s, i) => { const k = (f - delay[i]) / 6, el = document.querySelector("#end " + s);
      el.style.opacity = k < 0 ? 0 : 1; const sc = k >= 1 ? 1 : k < .6 ? .55 + .6 * (Math.max(0, k) / .6) : 1.15 - .15 * ((k - .6) / .4);
      el.style.transform = `scale(${s === ".url" && f > 24 ? sc * (1 + .03 * Math.sin((f - 24) / 4)) : sc})`; }), [order, delay, f]);
    await shot();
  }
  await browser.close();

  // 音
  Object.assign(ev, { total: n / FPS, end: endStart, bgmResume: ev.crash + 1.3 });
  fs.writeFileSync(path.join(work, "events.json"), JSON.stringify(ev));
  execFileSync("python3", [path.join(__dirname, "synth.py"), path.join(work, "events.json"), path.join(work, "audio.wav")], { stdio: "inherit" });
  const out = path.join(planDir, "video.mp4");
  execSync(`ffmpeg -v error -y -framerate ${FPS} -i "${outDir}/%04d.png" -i "${work}/audio.wav" -c:v libx264 -preset slow -crf 21 -pix_fmt yuv420p -r ${FPS} -c:a aac -b:a 160k -shortest -movflags +faststart "${out}"`, { stdio: "inherit" });
  console.log("done", out, (fs.statSync(out).size / 1e6).toFixed(1) + "MB", (n / FPS).toFixed(1) + "s");
})();
