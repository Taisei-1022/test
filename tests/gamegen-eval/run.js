/* DeepSeek生成品質の評価ランナー（PDCA用）
   使い方:
     node tests/gamegen-eval/run.js --tag=baseline [--cases=mole,jump] [--model=deepseek-v4-flash]
       [--effort=high] [--conc=3] [--reuse=タグ名] [--score-only]
   - index.ts から RUNTIME_TPL / BUILD2_SYSTEM / GOLD_JS を毎回抽出（＝プロンプト改善が即反映）
   - 生成は DeepSeek API を curl で直叩き（プロキシ都合）。結果は results/<tag>/ に保存
   - 採点は Playwright 実プレイ。10チェック×10ケース＝100点満点
   - --reuse=旧タグ で生成をスキップし旧タグのHTMLを再採点（チェック改善時用） */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const CASES = require('./cases.js');

const args = {};
process.argv.slice(2).forEach(a => { const m = /^--([^=]+)(?:=(.*))?$/.exec(a); if (m) args[m[1]] = m[2] === undefined ? true : m[2]; });
const TAG = args.tag || 'run';
const MODEL = args.model || 'deepseek-v4-flash';
const EFFORT = args.effort === 'none' ? null : (args.effort || 'high');
const CONC = parseInt(args.conc || '3', 10);
const ONLY = args.cases ? String(args.cases).split(',') : null;
const OUT = path.join(__dirname, 'results', TAG);
fs.mkdirSync(OUT, { recursive: true });

const DSKEY = 'sk-122da074beef4a7381e855c31016d592';
const IDX = fs.readFileSync(path.join(__dirname, '../../arcade/supabase/functions/generate/index.ts'), 'utf8');
function extract(re, name) { const m = re.exec(IDX); if (!m) throw new Error('extract fail: ' + name); return m[1].replace(/\\`/g, '`').replace(/\\\$\{/g, '${'); }
const RUNTIME_TPL = extract(/const RUNTIME_TPL = `([\s\S]*?)`;\n\n\/\/ AI/, 'RUNTIME_TPL');
const GOLD_JS = extract(/const GOLD_JS = `([\s\S]*?)`;\n\nconst BUILD2_SYSTEM/, 'GOLD_JS');
const BUILD2_BASE = extract(/const BUILD2_SYSTEM = `([\s\S]*?)`\s*\+\s*"Example/, 'BUILD2_SYSTEM');
const GAME_SCHEMA2 = {
  type: 'object',
  properties: {
    title: { type: 'string' }, howto: { type: 'string' }, unit: { type: 'string' },
    css: { type: 'string' }, js: { type: 'string' },
    category: { type: 'string', enum: ['アクション', 'パズル', 'シューティング', '反射神経', 'よける', 'タイミング', '記憶', 'レース', 'その他'] },
  },
  required: ['title', 'howto', 'unit', 'css', 'js', 'category'], additionalProperties: false,
};
const SYSTEM = BUILD2_BASE + 'Example "js" field:\n```js\n' + GOLD_JS + '\n```' +
  '\n\n【出力形式】必ず次のJSONスキーマに一致する単一のJSONオブジェクトのみを返すこと。マークダウンのコードフェンスや前置きは禁止。\n' + JSON.stringify(GAME_SCHEMA2);

function validateJs(js) {
  const s = (js || '').trim();
  if (s.length < 300) return 'too short';
  if (/<\/?(script|html|body|head)\b/i.test(s)) return 'html tags in js';
  try { new Function(s); } catch (e) { return 'syntax: ' + String(e.message).slice(0, 80); }
  if (!/function\s+init\s*\(/.test(s)) return 'no init';
  if (!/function\s+update\s*\(/.test(s)) return 'no update';
  if (!/function\s+draw\s*\(/.test(s)) return 'no draw';
  if (!/Game\s*\.\s*over\s*\(/.test(s)) return 'no Game.over';
  if (!/function\s+on(Down|Move|Up)\s*\(/.test(s) && !/addEventListener\s*\(\s*["'](click|pointer|touch|mouse)/.test(s)) return 'no input hooks';
  return null;
}
function tuneEntries(js) {
  const d = /(?:var|let|const)\s+TUNE\s*=\s*\{/.exec(js || ''); if (!d) return 0;
  let depth = 0, end = -1; const start = d.index + d[0].length - 1;
  for (let i = start; i < js.length && i < start + 5000; i++) { if (js[i] === '{') depth++; else if (js[i] === '}') { depth--; if (!depth) { end = i; break; } } }
  if (end < 0) return 0;
  return (js.slice(start, end).match(/[A-Za-z_$][\w$]*\s*:\s*\{/g) || []).length;
}
function assemble(g) {
  const escH = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const u = String(g.unit || '点').replace(/["'\\<>&]/g, '').slice(0, 6) || '点';
  const meta = encodeURIComponent(JSON.stringify({ t: g.title, h: g.howto, u }));
  return RUNTIME_TPL.split('__META__').join(meta).split('__TITLE__').join(escH(g.title))
    .split('__HOWTO__').join(escH(g.howto)).split('__UNIT__').join(u)
    .split('__GAME_CSS__').join(g.css || '').split('__GAME_JS__').join(g.js || '');
}

function callDeepSeek(c) {
  const userContent = '次の仕様書どおりに、ミニゲームのロジックを作ってください。\n\n【仕様書】\n' + c.spec +
    '\n\n【元の相談ログ（仕様書に無い点の補足として参照）】\nユーザー: ' + c.title + 'を作りたい\nAI: いいね、作ろう！';
  const body = { model: MODEL, messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: userContent }], response_format: { type: 'json_object' }, max_tokens: 16000 };
  if (EFFORT) body.reasoning_effort = EFFORT; else body.thinking = { type: 'disabled' };
  const bf = path.join(OUT, c.id + '.req.json'); fs.writeFileSync(bf, JSON.stringify(body));
  const t0 = Date.now();
  const raw = execFileSync('curl', ['-sS', '--max-time', '280', '-X', 'POST', 'https://api.deepseek.com/chat/completions',
    '-H', 'Authorization: Bearer ' + DSKEY, '-H', 'Content-Type: application/json', '--data-binary', '@' + bf],
    { env: { ...process.env, SSL_CERT_FILE: '/root/.ccr/ca-bundle.crt' }, maxBuffer: 64 * 1024 * 1024 }).toString();
  const sec = Math.round((Date.now() - t0) / 1000);
  const d = JSON.parse(raw);
  if (d.error) throw new Error('api: ' + JSON.stringify(d.error).slice(0, 150));
  const content = d.choices[0].message.content || '';
  let g;
  try { g = parseJsonLoose(content); }
  catch (e) { fs.writeFileSync(path.join(OUT, c.id + '.raw.txt'), content); throw e; }
  const u = d.usage || {};
  return { g, sec, tokens: { in: u.prompt_tokens || 0, out: u.completion_tokens || 0 } };
}
// サーバー(index.ts)の parseJsonLoose と同等（修復ロジック込み）。乖離したらサーバー側に合わせること。
function parseJsonLoose(text) {
  const t = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const s = t.indexOf('{'), e = t.lastIndexOf('}');
  if (s < 0 || e <= s) throw new Error('no_json_in_response');
  const body = t.slice(s, e + 1);
  try { return JSON.parse(body); } catch (e2) {}
  let fixed = body.replace(/\\(?![\\"/bfnrtu])/g, '\\\\');
  try { return JSON.parse(fixed); } catch (e2) {}
  let out = '', inStr = false, esc = false;
  for (let i = 0; i < fixed.length; i++) {
    const ch = fixed[i];
    if (esc) { out += ch; esc = false; continue; }
    if (ch === '\\') { out += ch; esc = true; continue; }
    if (ch === '"') {
      if (!inStr) { inStr = true; out += ch; continue; }
      let j = i + 1;
      while (j < fixed.length && (fixed[j] === ' ' || fixed[j] === '\n' || fixed[j] === '\r' || fixed[j] === '\t')) j++;
      const nx = j < fixed.length ? fixed[j] : '';
      if (nx === ',' || nx === '}' || nx === ']' || nx === ':' || nx === '') { inStr = false; out += ch; }
      else { out += '\\"'; }
      continue;
    }
    if (inStr && ch === '\n') { out += '\\n'; continue; }
    if (inStr && ch === '\r') { out += '\\r'; continue; }
    if (inStr && ch === '\t') { out += '\\t'; continue; }
    out += ch;
  }
  return JSON.parse(out);
}

async function pool(items, n, fn) {
  const q = items.slice(); const running = [];
  const results = [];
  async function next() { const it = q.shift(); if (!it) return; results.push(await fn(it)); return next(); }
  for (let i = 0; i < n; i++) running.push(next());
  await Promise.all(running); return results;
}

/* ---------- Playwright 採点 ---------- */
async function score(browser, c, html, genMeta) {
  const checks = {};
  checks.struct = !!(genMeta.ok && !genMeta.validateErr && genMeta.tune >= 4);
  if (!html) { return { checks, total: 0 }; }
  const ctx = await browser.newContext({ viewport: { width: 480, height: 720 }, hasTouch: true });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(String(e.message).slice(0, 120)));
  const cdp = await ctx.newCDPSession(p);
  async function touchDrag(x1, y1, x2, y2, steps = 6) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x1, y: y1, id: 1 }] });
    for (let k = 1; k <= steps; k++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x1 + (x2 - x1) * k / steps, y: y1 + (y2 - y1) * k / steps, id: 1 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }
  async function hold(x, y, ms) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
    await p.waitForTimeout(ms);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }
  const canvasHash = () => p.evaluate(() => {
    const cv = document.getElementById('vpc'); if (!cv) return 'x';
    const g = cv.getContext('2d'); let h = 0;
    try { const d = g.getImageData(0, 0, cv.width, cv.height).data;
      for (let i = 0; i < d.length; i += 397) h = (h * 31 + d[i] + d[i + 1] * 3 + d[i + 2] * 7) >>> 0;
    } catch (e) { return 'e'; }
    return String(h);
  });
  const hud = () => p.evaluate(() => (document.getElementById('vphl') || {}).textContent || '');
  const hudNum = async () => parseInt((await hud()).replace(/[^\d-]/g, ''), 10) || 0;
  const overVisible = () => p.evaluate(() => { const o = document.getElementById('vpov'); return o && !o.hidden && /おわり/.test(o.textContent); });
  const findTargets = () => p.evaluate(() => {
    const out = [];
    for (const k of Object.keys(window)) {
      try { const v = window[k];
        if (Array.isArray(v) && v.length && typeof v[0] === 'object' && v[0]) {
          for (const o of v) { const ox = (typeof o.x === 'number') ? o.x : o.cx, oy = (typeof o.y === 'number') ? o.y : o.cy;
            if (typeof ox === 'number' && typeof oy === 'number' && oy > 60 && oy < innerHeight - 40 && ox > 10 && ox < innerWidth - 10 && !o.bad && !o.bomb && o.type !== 'bomb') out.push({ x: ox, y: oy }); }
        }
      } catch (e) {}
    }
    return out.slice(0, 30);
  });
  const arraysSnapshot = () => p.evaluate(() => {
    // 位置が固定のゲーム（もぐらたたき等）でも変化を捉えられるよう、全スカラー値を含める
    const out = {};
    for (const k of Object.keys(window)) {
      try { const v = window[k];
        if (Array.isArray(v) && v.length && typeof v[0] === 'object' && v[0] && typeof v[0].x === 'number')
          out[k] = v.map(o => Object.keys(o).map(p2 => { const val = o[p2]; return (typeof val === 'number') ? Math.round(val * 10) : (typeof val === 'boolean' ? val : (typeof val === 'string' ? val.slice(0, 6) : '')); }).join(',')).join('|');
      } catch (e) {}
    }
    return JSON.stringify(out);
  });
  async function playAction(kind, rounds) {
    for (let i = 0; i < rounds; i++) {
      if (kind === 'tapTargets') {
        const t = await findTargets();
        if (t.length) await p.touchscreen.tap(t[i % t.length].x, t[i % t.length].y);
        else await p.touchscreen.tap(80 + (i % 3) * 160, 180 + (i % 4) * 120);
      } else if (kind === 'dragMove') {
        await touchDrag(240, 620, i % 2 ? 70 : 410, 620, 8);
      } else if (kind === 'tapAnywhere') {
        await p.touchscreen.tap(240, 400);
      } else if (kind === 'tapSides') {
        await p.touchscreen.tap(i % 2 ? 110 : 370, 420);
      } else if (kind === 'tapGrid') {
        const pts = [[140, 300], [340, 300], [140, 520], [340, 520]];
        await p.touchscreen.tap(pts[i % 4][0], pts[i % 4][1]);
      } else if (kind === 'holdRelease') {
        await hold(240, 400, 700);
      }
      await p.waitForTimeout(kind === 'holdRelease' ? 1200 : 380);
    }
  }
  try {
    await p.setContent(html, { timeout: 15000 });
    await p.waitForTimeout(700);
    checks.loads = errs.length === 0 && await p.evaluate(() => { const b = document.getElementById('vpstart'); return !!(b && b.offsetParent !== null); });
    // start
    try { await p.tap('#vpstart', { timeout: 3000 }); } catch (e) {}
    await p.waitForTimeout(500);
    checks.starts = await p.evaluate(() => document.getElementById('vpov').hidden);
    // animate（無操作で描画が変わるか）
    const h1 = await canvasHash(); await p.waitForTimeout(600);
    const h2 = await canvasHash(); await p.waitForTimeout(600);
    const h3 = await canvasHash();
    checks.animates = (h1 !== h2) || (h2 !== h3);
    if (!checks.animates && c.staticOk) checks.animates = 'defer-input';   // 入力があって初めて動くゲーム
    // input（操作で描画/HUDが変わるか）
    const hudBefore = await hud(); const hBefore = await canvasHash();
    await playAction(c.play, 4);
    checks.input = (await canvasHash()) !== hBefore || (await hud()) !== hudBefore;
    if (checks.animates === 'defer-input') checks.animates = checks.input;
    // probe（ケース固有）※ゲームがまだ生きているうちに実行する（採点順が後ろだと
    // 即死系ゲームでは死後の静止画面を測ってしまい不当に落ちる）
    try {
      if (c.probe === 'spawnCycle') { const a1 = await arraysSnapshot(); await p.waitForTimeout(1500); checks.probe = (await arraysSnapshot()) !== a1; }
      else if (c.probe === 'hudScoreGrows') { checks.probe = 'defer-hud'; }   // 追加プレイ後に判定（序盤4操作では稼げないことがある）
      else if (c.probe === 'reactsFast') { const hb = await canvasHash(); await playAction(c.play, 1); await p.waitForTimeout(250); checks.probe = (await canvasHash()) !== hb; }
      else if (c.probe === 'gridCells') {
        checks.probe = await p.evaluate(() => {
          const cv = document.getElementById('vpc'); const g = cv.getContext('2d');
          const pts = [[0.28, 0.4], [0.72, 0.4], [0.28, 0.68], [0.72, 0.68]]; const cols = new Set();
          for (const [fx, fy] of pts) { const d = g.getImageData(Math.floor(cv.width * fx), Math.floor(cv.height * fy), 1, 1).data; cols.add((d[0] >> 5) + ',' + (d[1] >> 5) + ',' + (d[2] >> 5)); }
          return cols.size >= 3;
        });
      }
      else if (c.probe === 'hudChanges') { checks.probe = await p.evaluate(() => { const r = document.getElementById('vphr'); return !!(r && r.textContent.trim()); }) || (await hudNum()) > 0; }
      else if (c.probe === 'holdGrows') {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 240, y: 400, id: 1 }] });
        const g1 = await canvasHash(); await p.waitForTimeout(400); const g2 = await canvasHash(); await p.waitForTimeout(400); const g3 = await canvasHash();
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        checks.probe = g1 !== g2 && g2 !== g3;
      }
      else if (c.probe === 'surviveScore') { checks.probe = 'defer'; }   // ゲームオーバー後に判定
      else checks.probe = true;
    } catch (e) { checks.probe = false; }
    // score（もう少し遊んでHUDのスコアが動くか）
    await playAction(c.play, 6);
    // scoreLoose: ボットが正しい手順を踏めないゲーム（記憶系）はスコア表示の存在だけ確認
    checks.score = c.scoreLoose ? /\d/.test(await hud())
      : ((await hudNum()) > 0 || (await hud()) !== hudBefore);
    if (checks.probe === 'defer-hud') checks.probe = (await hudNum()) > 0;
    // layout（見た目）：ゲームが作ったDOMが論理390x844からはみ出していないか＋描画の左右バランス
    try {
      checks.layout = await p.evaluate(() => {
        // DOM要素の containment（ベイカレント型の崩れ検出）
        const dom = document.getElementById('vpdom');
        const nodes = [...(dom ? dom.querySelectorAll('*') : [])];
        // 旧スタイル（body直下にDOMを作るゲーム）も見る
        for (const el of document.body.children) {
          if (!/^(vpc|vpdom|vphud|vptoast|vpov|vpgame|vpimgs)$/.test(el.id || '') && el.tagName !== 'SCRIPT') nodes.push(el, ...el.querySelectorAll('*'));
        }
        for (const el of nodes) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 && r.height === 0) continue;
          if (r.top < -2 || r.left < -2 || r.right > innerWidth + 2 || r.bottom > innerHeight + 2) return false;   // はみ出し
        }
        // キャンバスの左右バランス：左/中/右で「変化のあるピクセル」が極端に偏っていないか
        const cv2 = document.getElementById('vpc'); const g = cv2.getContext('2d');
        const d = g.getImageData(0, 0, cv2.width, cv2.height).data;
        const wpx = cv2.width, hpx = cv2.height, third = Math.floor(wpx / 3);
        const busy = [0, 0, 0];
        for (let y = Math.floor(hpx * 0.15); y < hpx * 0.95; y += 7) {
          for (let x = 0; x < wpx - 8; x += 7) {
            const i = (y * wpx + x) * 4, j = (y * wpx + x + 7) * 4;
            if (Math.abs(d[i] - d[j]) + Math.abs(d[i + 1] - d[j + 1]) + Math.abs(d[i + 2] - d[j + 2]) > 40) busy[Math.min(2, Math.floor(x / third))]++;
          }
        }
        const total = busy[0] + busy[1] + busy[2];
        if (total < 30) return true;   // ほぼ一様（ミニマルな絵）は判定対象外
        const mx = Math.max(...busy), mn = Math.min(...busy);
        return mn > mx * 0.05;   // どこか1列だけ空っぽ（極端な偏り）ならNG
      });
    } catch (e) { checks.layout = false; }
    // errors（ここまでの実プレイでエラーが出ていないか）
    const vperr = await p.evaluate(() => window.__VP_ERR || null);
    checks.errors = !vperr && errs.length === 0;
    // game over 到達
    const deadline = Date.now() + c.over.sec * 1000;
    let over = false;
    while (Date.now() < deadline) {
      if (await overVisible()) { over = true; break; }
      if (c.over.mode === 'spam') await playAction(c.play, 2);
      else await p.waitForTimeout(800);
    }
    checks.gameover = over;
    if (checks.probe === 'defer') { checks.probe = over && (await p.evaluate(() => { const b = document.querySelector('.vp-big'); return b ? parseInt(b.textContent, 10) || 0 : 0; })) > 0; }
    // restart（時間加算スコアのゲームは再開直後から増え始めるので、しきい値で「リセットされた」を判定）
    if (over) {
      const finalScore = await p.evaluate(() => { const b = document.querySelector('.vp-big'); return b ? (parseInt(b.textContent, 10) || 0) : 0; });
      try { await p.tap('#vpagain', { timeout: 2500 }); } catch (e) { try { await p.evaluate(() => { const b = document.getElementById('vpagain'); if (b) b.click(); }); } catch (e2) {} }
      await p.waitForTimeout(700);
      const hn = await hudNum();
      checks.restart = await p.evaluate(() => document.getElementById('vpov').hidden) && (hn <= Math.max(15, finalScore * 0.5));
    } else checks.restart = false;
  } catch (e) {
    checks.fatal = String(e.message).slice(0, 120);
  }
  await ctx.close();
  const names = ['struct', 'loads', 'starts', 'animates', 'input', 'score', 'errors', 'gameover', 'restart', 'probe', 'layout'];
  const total = names.reduce((s, n) => s + (checks[n] === true ? 1 : 0), 0);
  return { checks, total, errs: errs.slice(0, 3) };
}

(async () => {
  const cases = ONLY ? CASES.filter(c => ONLY.includes(c.id)) : CASES;
  // 1) 生成（--score-only ならスキップ、--reuse=tag なら旧タグからコピー）
  if (!args['score-only']) {
    await pool(cases, CONC, async c => {
      const hf = path.join(OUT, c.id + '.html'), mf = path.join(OUT, c.id + '.meta.json');
      if (args.reuse) {
        const src = path.join(__dirname, 'results', String(args.reuse));
        try { fs.copyFileSync(path.join(src, c.id + '.html'), hf); fs.copyFileSync(path.join(src, c.id + '.meta.json'), mf); console.log('[reuse]', c.id); return; } catch (e) {}
      }
      try {
        const { g, sec, tokens } = callDeepSeek(c);
        const verr = validateJs(g.js);
        const meta = { ok: true, validateErr: verr, tune: tuneEntries(g.js), sec, tokens, title: g.title };
        fs.writeFileSync(mf, JSON.stringify(meta));
        fs.writeFileSync(hf, assemble(g));
        console.log('[gen]', c.id, sec + 's', 'tune=' + meta.tune, verr ? ('VALIDATE_FAIL: ' + verr) : 'ok');
      } catch (e) {
        fs.writeFileSync(mf, JSON.stringify({ ok: false, err: String(e.message).slice(0, 200) }));
        console.log('[gen]', c.id, 'GEN_FAIL:', String(e.message).slice(0, 120));
      }
    });
  }
  // 2) 採点
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const report = {};
  for (const c of cases) {
    let html = null, meta = { ok: false };
    try { meta = JSON.parse(fs.readFileSync(path.join(OUT, c.id + '.meta.json'), 'utf8')); } catch (e) {}
    try { html = fs.readFileSync(path.join(OUT, c.id + '.html'), 'utf8'); } catch (e) {}
    const r = await score(browser, c, html, meta);
    report[c.id] = { total: r.total, checks: r.checks, gen: meta, errs: r.errs };
    console.log('[score]', c.id, r.total + '/10', JSON.stringify(r.checks));
  }
  await browser.close();
  const grand = Object.values(report).reduce((s, r) => s + r.total, 0);
  report.__grand = grand + '/' + (cases.length * 11);
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1));
  console.log('=== TOTAL', report.__grand, '(tag=' + TAG + ', model=' + MODEL + ', effort=' + (EFFORT || 'off') + ') ===');
})();
