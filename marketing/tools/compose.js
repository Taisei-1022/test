/* 撮影したコマに、字幕・締めの画面・音を重ねて、縦長 mp4（1080x1920）にする。
   使い方: node marketing/tools/compose.js <planのフォルダ> <撮影フォルダ> <作業フォルダ>
   出力: <planのフォルダ>/video.mp4 */
const fs = require("fs"), path = require("path"), { execSync, execFileSync } = require("child_process");
const { chromium } = require("/opt/node22/lib/node_modules/playwright");
const [planDir, rawDir, work] = process.argv.slice(2).map(p => path.resolve(p));
const plan = require(path.join(planDir, "plan.js"));
const FPS = 30, W = 405, H = 720;
const outFrames = path.join(work, "out"); fs.rmSync(outFrames, { recursive: true, force: true }); fs.mkdirSync(outFrames, { recursive: true });

// 1) 速度を反映した「どの撮影コマを使うか」の並び
const seq = [];
for (const s of plan.segments) for (let j = 0; ; j++) { const r = s.from + Math.floor(j * s.speed); if (r > s.to) break; seq.push(r); }
const tOf = raw => { const i = seq.findIndex(r => r >= raw); return (i < 0 ? seq.length : i) / FPS; };

// 2) 字幕用の丸ゴシック（Google Fonts の M PLUS Rounded 1c、使う文字だけ取り寄せる）
const allText = plan.captions.map(c => c.text).concat(Object.values(plan.end)).join("").replace(/<br>/g, "") + "0123456789";
const fontFile = path.join(work, "font.woff2");
const css = execFileSync("curl", ["-sS", "-A", "Mozilla/5.0 Chrome/120", "https://fonts.googleapis.com/css2?family=M+PLUS+Rounded+1c:wght@800&text=" + encodeURIComponent([...new Set(allText)].join(""))]).toString();
execFileSync("curl", ["-sS", "-o", fontFile, /url\((https:[^)]+)\)/.exec(css)[1]]);
const font64 = fs.readFileSync(fontFile).toString("base64");

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:R;src:url(data:font/woff2;base64,${font64}) format("woff2");font-weight:800}
*{margin:0;box-sizing:border-box} html,body{width:${W}px;height:${H}px;overflow:hidden;background:#15101f;font-family:R,sans-serif;font-weight:800}
#bg{position:absolute;inset:0;width:100%;height:100%}
#cap{position:absolute;left:0;right:0;top:112px;text-align:center;color:#fff;font-size:34px;line-height:1.25;
  -webkit-text-stroke:9px #1a0f2a;paint-order:stroke fill;text-shadow:0 4px 0 #1a0f2a;transform-origin:50% 50%}
#cap.big{font-size:50px;color:#ffcf5c}
#cap.low{top:440px}
#end{position:absolute;inset:0;display:none;flex-direction:column;align-items:center;justify-content:flex-start;padding-top:150px;gap:10px;
  background:rgba(14,9,24,.62);color:#fff;text-align:center}
#end .game{font-size:15px;color:#d8c9b6;letter-spacing:.04em}
#end .score{font-size:92px;color:#ffcf5c;-webkit-text-stroke:8px #1a0f2a;paint-order:stroke fill;line-height:1.1}
#end .catch{font-size:40px;-webkit-text-stroke:8px #1a0f2a;paint-order:stroke fill}
#end .url{margin-top:18px;font-size:38px;color:#3a2400;background:#ffb02e;border-radius:22px;padding:8px 26px;box-shadow:0 6px 0 #a8660d}
#end .sub{margin-top:10px;font-size:15px;color:#f3e9dc}
#end>*{transform-origin:50% 50%}
</style></head><body><img id="bg"><div id="cap"></div>
<div id="end"><div class="game"></div><div class="score"></div><div class="catch"></div><div class="url"></div><div class="sub"></div></div></body></html>`;

// ぽんっと出る動き（0→1 の進み具合から大きさを返す）
const pop = k => k >= 1 ? 1 : k < .6 ? .55 + .6 * (k / .6) : 1.15 - .15 * ((k - .6) / .4);

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1080 / W });
  const p = await ctx.newPage();
  await p.route("http://f.local/**", r => r.fulfill({ path: path.join(rawDir, "frames", path.basename(new URL(r.request().url()).pathname)) }));
  await p.route("http://c.local/", r => r.fulfill({ contentType: "text/html; charset=utf-8", body: PAGE }));
  await p.goto("http://c.local/"); await p.evaluate(() => document.fonts.ready);
  const setBg = async (raw, blur) => p.evaluate(async ([src, blur]) => { const i = document.getElementById("bg"); i.style.filter = blur ? "blur(5px)" : ""; if (i.dataset.src !== src) { i.dataset.src = src; i.src = src; await i.decode(); } },
    ["http://f.local/" + String(raw).padStart(4, "0") + ".png", blur]);
  let n = 0; const shot = async () => p.screenshot({ path: path.join(outFrames, String(++n).padStart(4, "0") + ".png") });

  for (const raw of seq) {
    await setBg(raw, false);
    const c = plan.captions.find(c => raw >= c.from && raw <= c.to);
    const k = c ? (raw - c.from) / 5 : 0;   // 字幕が出てからの進み（最初の数コマで弾む）
    await p.evaluate(([c, s]) => { const e = document.getElementById("cap"); e.innerHTML = c ? c.text : ""; e.className = c ? [c.big && "big", c.low && "low"].filter(Boolean).join(" ") : ""; e.style.transform = `scale(${s}) rotate(-2deg)`; }, [c || null, pop(k)]);
    await shot();
  }
  // 締めの画面：最後のコマをぼかした上に、文字を順番にぽんっと出す
  const E = plan.end, endN = Math.round(E.seconds * FPS), lastRaw = seq[seq.length - 1];
  await setBg(lastRaw, true);
  await p.evaluate(E => { document.getElementById("cap").innerHTML = ""; const d = document.getElementById("end"); d.style.display = "flex";
    d.querySelector(".game").textContent = E.game; d.querySelector(".score").textContent = E.score; d.querySelector(".catch").textContent = E.catch;
    d.querySelector(".url").textContent = E.url; d.querySelector(".sub").textContent = E.sub; }, E);
  const order = [".game", ".score", ".catch", ".url", ".sub"], delay = [0, 3, 9, 15, 18];
  for (let f = 0; f < endN; f++) {
    await p.evaluate(([order, delay, f]) => order.forEach((s, i) => { const k = (f - delay[i]) / 6, el = document.querySelector("#end " + s);
      el.style.opacity = k < 0 ? 0 : 1; const sc = k >= 1 ? 1 : k < .6 ? .55 + .6 * (Math.max(0, k) / .6) : 1.15 - .15 * ((k - .6) / .4);
      el.style.transform = `scale(${s === ".url" && f > 30 ? sc * (1 + .03 * Math.sin((f - 30) / 4)) : sc})`; }), [order, delay, f]);
    await shot();
  }
  await browser.close();

  // 3) 音（自作の短い曲と効果音。著作権の心配なし）
  const tl = JSON.parse(fs.readFileSync(path.join(rawDir, "timeline.json")));
  const ev = { total: n / FPS, lands: tl.lands.filter(r => r <= plan.bgmStopRaw).map(tOf), bgmStop: tOf(plan.bgmStopRaw), crash: tOf(plan.crashRaw), end: seq.length / FPS };
  fs.writeFileSync(path.join(work, "events.json"), JSON.stringify(ev));
  execFileSync("python3", [path.join(__dirname, "synth.py"), path.join(work, "events.json"), path.join(work, "audio.wav")], { stdio: "inherit" });

  // 4) mp4 に書き出し（スマホでそのまま投稿できる形式）
  const out = path.join(planDir, "video.mp4");
  execSync(`ffmpeg -v error -y -framerate ${FPS} -i "${outFrames}/%04d.png" -i "${work}/audio.wav" -c:v libx264 -preset slow -crf 21 -pix_fmt yuv420p -r ${FPS} -c:a aac -b:a 160k -shortest -movflags +faststart "${out}"`, { stdio: "inherit" });
  console.log("done", out, (fs.statSync(out).size / 1e6).toFixed(1) + "MB", ev.total.toFixed(1) + "s");
})();
