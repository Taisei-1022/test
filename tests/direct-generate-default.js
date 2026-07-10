/* 既定（設計書モードOFF）＝いきなり生成モードのE2E
   前提: リポジトリ直下で `python3 -m http.server 8099` を起動しておくこと。

   arcade.specmode を設定しない（＝既定OFF）状態で：
   - 相談ready後のボタンが「🚀 この内容で作る」（設計書ステップなし）
   - それを押すと makeSpec は呼ばれず、いきなり build（1回）でゲーム完成
   - #specrow（設計書行）は一度も出ない
   併せて、マイページのトグルをONにすると設計書ステップが出ることも確認。 */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '../arcade/supabase/functions/generate/index.ts'), 'utf8');
const TPL = /const RUNTIME_TPL = `([\s\S]*?)`;\n\n/.exec(src)[1].replace(/\\`/g, '`').replace(/\\\$\{/g, '${');
const GOOD_JS = `
var t=0,s=0;
function init(){ t=0; s=0; Game.score(0); }
function update(dt){ t+=dt; if(t>60) Game.over(s); }
function draw(){ ctx.fillStyle="#123"; ctx.fillRect(0,0,W,H); }
function onDown(x,y,id){ s++; Game.score(s); }
function onMove(x,y,id){}
function onUp(x,y,id){}
function onResize(){}
`.repeat(3);
const GAME = (function () {
  const meta = encodeURIComponent(JSON.stringify({ t: 'テストゲーム', h: 't', u: '点' }));
  return TPL.split('__META__').join(meta).split('__TITLE__').join('テストゲーム').split('__HOWTO__').join('t')
    .split('__UNIT__').join('点').split('__GAME_CSS__').join('').split('__GAME_JS__').join(GOOD_JS);
})();

async function newChat(p) {
  await p.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'はじめる'); if (b) b.click(); });
  await p.waitForTimeout(300);
  await p.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => /新規作成/.test(x.textContent)); if (b) b.click(); });
  await p.waitForTimeout(600);
  await p.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => /作成してはじめる/.test(x.textContent)); if (b) b.click(); });
  await p.waitForTimeout(800);
}

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.addInitScript(() => { localStorage.setItem('arcade.player', JSON.stringify({ name: 'テスト太郎' })); localStorage.setItem('arcade.name.done', '1'); });   // specmode は未設定＝OFF
  let specCalls = 0, buildCalls = 0;
  await p.route('**/functions/v1/generate', async r => {
    const body = JSON.parse(r.request().postData());
    if (body.makeSpec) { specCalls++; return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ spec: '■概要\nテスト' }) }); }
    if (body.usage) return r.fulfill({ status: 200, contentType: 'application/json', body: '{"enabled":false}' });
    if (body.build) { buildCalls++; return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ action: 'build', reply: '作ったよ！', title: 'テストゲーム', html: GAME, category: 'その他' }) }); }
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ action: 'ready', reply: '準備OK！この内容で作り始めていい？' }) });
  });
  await p.route('**/rest/v1/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));

  await p.goto('http://localhost:8099/arcade/#create');
  await p.waitForTimeout(800);
  if (await p.$('#nameGate:not([hidden])')) { await p.fill('#nameGateInput', 'テスト'); await p.click('#nameGateOk'); }
  await newChat(p);

  // 相談 → ready。既定OFFなら「🚀 この内容で作る」が出る（設計書を作る ではない）
  await p.fill('#chatInput', 'ねこがジャンプするゲーム');
  await p.click('#chatSend');
  await p.waitForTimeout(700);
  const readyLabels = await p.evaluate(() => [...document.querySelectorAll('.buildrow button')].map(x => x.textContent));
  const directBtn = readyLabels.some(t => /この内容で作る/.test(t));
  const noSpecBtn = !readyLabels.some(t => /設計書を作る/.test(t));

  // 押す → いきなり build（makeSpec呼ばれない、#specrow出ない）
  await p.evaluate(() => { const b = [...document.querySelectorAll('.buildrow button')].find(x => /この内容で作る/.test(x.textContent)); if (b) b.click(); });
  let specRowAppeared = false;
  for (let i = 0; i < 24; i++) { await p.waitForTimeout(300); if (await p.evaluate(() => !!document.querySelector('#specrow'))) specRowAppeared = true; if (await p.evaluate(() => !!document.querySelector('.gencard'))) break; }
  const built = await p.evaluate(() => !!document.querySelector('.gencard'));
  const directSpecCalls = specCalls, directBuildCalls = buildCalls;

  // トグルをONにする → マイページ経由。新規チャットで「📐 設計書を作る」に変わる
  await p.evaluate(() => { const b = [...document.querySelectorAll('button,a,[role=tab]')].find(x => /マイページ/.test(x.textContent)); if (b) b.click(); });
  await p.waitForTimeout(400);
  await p.evaluate(() => { const t = document.getElementById('specModeToggle'); if (t && !t.checked) { t.checked = true; t.dispatchEvent(new Event('change', { bubbles: true })); } });
  await p.waitForTimeout(200);
  const toggleSaved = await p.evaluate(() => localStorage.getItem('arcade.specmode'));
  // 作るへ戻って新規チャット
  await p.evaluate(() => { const b = [...document.querySelectorAll('button,a,[role=tab]')].find(x => /作る/.test(x.textContent.trim()) && x.textContent.trim().length <= 3); if (b) b.click(); });
  await p.waitForTimeout(400);
  await newChat(p);
  await p.fill('#chatInput', 'べつのゲーム');
  await p.click('#chatSend');
  await p.waitForTimeout(700);
  const proLabels = await p.evaluate(() => [...document.querySelectorAll('.buildrow button')].map(x => x.textContent));
  const specBtnWhenOn = proLabels.some(t => /設計書を作る/.test(t));

  await b.close();
  const checks = { directBtn, noSpecBtn, specRowAppeared, built, directSpecCalls, directBuildCalls, toggleSaved, specBtnWhenOn, pageErrors: errs };
  const ok = directBtn && noSpecBtn && !specRowAppeared && built
    && directSpecCalls === 0 && directBuildCalls === 1
    && toggleSaved === '1' && specBtnWhenOn && errs.length === 0;
  console.log(JSON.stringify(checks, null, 1));
  console.log(ok ? 'PASS' : 'FAIL');
  process.exit(ok ? 0 : 1);
})();
