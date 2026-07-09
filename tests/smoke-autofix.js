/* A案（自動テストプレイ→自動修理）のE2Eテスト
   生成直後に非表示iframeでゲームを実走させ、実行時エラーを検出したら
   エラーメッセージ付きで1回だけ自動修理ビルドに回す仕組みの回帰テスト。

   前提: リポジトリ直下で `python3 -m http.server 8099` を起動しておくこと。
   シナリオ1: 壊れたゲーム（update内で未定義関数呼び出し）
     → スモークテストが検出 → 修理ビルド要求（本文に「実行時エラーが検出されました」、
        prevHtml=壊れた版）→ 修理版を反映（gencardのタイトルが修理版のもの）
   シナリオ2: 正常なゲーム → ビルド1回だけ・修理バブルなし
   共通: スモーク用iframeが後始末されていること・pageerrorゼロ */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const path = require('path');

// RUNTIME_TPL を index.ts から抽出してゲームを組み立てる（assembleGame相当）
const src = fs.readFileSync(path.join(__dirname, '../arcade/supabase/functions/generate/index.ts'), 'utf8');
const m = /const RUNTIME_TPL = `([\s\S]*?)`;\n\n\/\/ AIが返した部品/.exec(src);
if (!m) { console.error('RUNTIME_TPL not found'); process.exit(1); }
const TPL = m[1].replace(/\\`/g, '`').replace(/\\\$\{/g, '${');
function assemble(title, js) {
  const meta = encodeURIComponent(JSON.stringify({ t: title, h: 'タップしてね', u: '点' }));
  return TPL.split('__META__').join(meta).split('__TITLE__').join(title)
    .split('__HOWTO__').join('タップしてね').split('__UNIT__').join('点')
    .split('__GAME_CSS__').join('').split('__GAME_JS__').join(js);
}
const BASE_JS = `
var t=0, taps=0;
function init(){ t=0; taps=0; Game.score(0); }
function update(dt){ t+=dt; if(t>60) Game.over(taps); }
function draw(){ ctx.fillStyle="#123"; ctx.fillRect(0,0,W,H); ctx.fillStyle="#fff"; ctx.font="20px sans-serif"; ctx.fillText("taps:"+taps, 20, 40); }
function onDown(x,y,id){ taps++; Game.score(taps); }
function onMove(x,y,id){}
function onUp(x,y,id){}
function onResize(){}
`.repeat(3); // validateJsの300文字下限に合わせる
const GOOD = assemble('グッドゲーム', BASE_JS);
const BROKEN = assemble('ブロークンゲーム', BASE_JS + `
var _u=update; update=function(dt){ _u(dt); if(t>0.5) nonExistentFunction123(); };
`);

async function runScenario(firstHtml) {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  const buildBodies = [];
  await p.addInitScript(() => { localStorage.setItem('arcade.player', JSON.stringify({ name: 'テスト太郎' })); localStorage.setItem('arcade.name.done', '1'); });
  await p.route('**/functions/v1/generate', async r => {
    const body = JSON.parse(r.request().postData());
    if (body.makeSpec) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ spec: '■概要\nテスト用の設計書' }) });
    if (body.usage) return r.fulfill({ status: 200, contentType: 'application/json', body: '{"enabled":false}' });
    if (body.build) {
      buildBodies.push(body);
      const first = buildBodies.length === 1;
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ action: 'build', reply: '作ったよ！', title: first ? 'テストゲーム' : 'フィックス済み', html: first ? firstHtml : GOOD, category: 'その他' }) });
    }
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ action: 'ready', reply: '準備OK！' }) });
  });
  await p.route('**/rest/v1/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await p.goto('http://localhost:8099/arcade/#create');
  await p.waitForTimeout(800);
  if (await p.$('#nameGate:not([hidden])')) { await p.fill('#nameGateInput', 'テスト'); await p.click('#nameGateOk'); }
  await p.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'はじめる'); if (b) b.click(); });
  await p.waitForTimeout(300);
  await p.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => /新規作成/.test(x.textContent)); if (b) b.click(); });
  await p.waitForTimeout(600);
  await p.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => /作成してはじめる/.test(x.textContent)); if (b) b.click(); });
  await p.waitForTimeout(800);
  await p.fill('#chatInput', 'ねこがジャンプするゲーム');
  await p.click('#chatSend');
  await p.waitForTimeout(800);
  await p.evaluate(() => { const b = [...document.querySelectorAll('.buildrow button')].find(x => /設計書を作る/.test(x.textContent)); if (b) b.click(); });
  await p.waitForTimeout(800);
  await p.evaluate(() => { const b = [...document.querySelectorAll('#specrow button')].find(x => /生成開始/.test(x.textContent)); if (b) b.click(); });
  // ビルド→スモーク(約3秒)→(修理ビルド→再スモーク)→反映 を待つ
  for (let i = 0; i < 30; i++) {
    await p.waitForTimeout(500);
    if (await p.evaluate(() => !!document.querySelector('.gencard'))) break;
  }
  await p.waitForTimeout(500);
  const bubbles = await p.evaluate(() => document.getElementById('chatlog').textContent);
  const cardTitle = await p.evaluate(() => { const c = document.querySelector('.gencard b'); return c ? c.textContent : null; });
  const smokeLeft = await p.evaluate(() => [...document.querySelectorAll('iframe')].filter(f => f.style.opacity === '0').length);
  await b.close();
  return {
    buildCount: buildBodies.length,
    fixMsgSent: buildBodies.length > 1 && (buildBodies[1].messages || []).some(x => /実行時エラーが検出されました/.test(x.content)),
    fixPrevIsBroken: buildBodies.length > 1 && buildBodies[1].prevHtml === firstHtml,
    foundBubble: /テストプレイで実行時エラーを見つけたよ/.test(bubbles),
    fixedBubble: /修理できたよ/.test(bubbles),
    cardTitle, smokeIframeLeft: smokeLeft, pageErrors: errs
  };
}

(async () => {
  const r1 = await runScenario(BROKEN);
  const ok1 = r1.buildCount === 2 && r1.fixMsgSent && r1.fixPrevIsBroken && r1.foundBubble && r1.fixedBubble && r1.cardTitle === 'フィックス済み' && r1.smokeIframeLeft === 0 && r1.pageErrors.length === 0;
  console.log('1. 壊れたゲーム→自動修理:', ok1 ? 'PASS' : 'FAIL', JSON.stringify(r1));
  const r2 = await runScenario(GOOD);
  const ok2 = r2.buildCount === 1 && !r2.foundBubble && r2.cardTitle === 'テストゲーム' && r2.smokeIframeLeft === 0 && r2.pageErrors.length === 0;
  console.log('2. 正常なゲーム→再ビルドなし:', ok2 ? 'PASS' : 'FAIL', JSON.stringify(r2));
  process.exit(ok1 && ok2 ? 0 : 1);
})();
