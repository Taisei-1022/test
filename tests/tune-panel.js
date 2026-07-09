/* 難易度調整パネル（TUNEスライダー）のE2Eテスト
   生成JS冒頭の var TUNE={key:{v,label,min,max,step},...} をプレビューの⚙️パネルが
   読み取り、スライダーで v を書き換え→srcdoc 再組み立て→即反映できることを検証。

   前提: リポジトリ直下で `python3 -m http.server 8099` を起動しておくこと。
   1. 管理者: ⚙️表示→パネルにTUNEの全項目→ドラッグで値変更→srcdocに新値が入る
      →変更後もゲームがエラーなく起動する→リセットで元の値に戻る
   2. 非管理者: ⚙️が出ない */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const path = require('path');

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
const TUNE_JS = `
var TUNE = {
  speed: { v: 150, label: "敵の速さ", min: 60, max: 400, step: 10 },
  lives: { v: 3, label: "ライフ数", min: 1, max: 9, step: 1 },
  badRate: { v: 0.18, label: "爆弾の割合", min: 0, max: 0.6, step: 0.02 }
};
var t=0, taps=0, lives=0;
function init(){ t=0; taps=0; lives=TUNE.lives.v; Game.score(0); Game.hud("❤️".repeat(lives)); }
function update(dt){ t+=dt; if(t>60) Game.over(taps); }
function draw(){ ctx.fillStyle="#123"; ctx.fillRect(0,0,W,H); ctx.fillStyle="#fff"; ctx.font="20px sans-serif"; ctx.fillText("spd:"+TUNE.speed.v, 20, 40); }
function onDown(x,y,id){ taps++; Game.score(taps); }
function onMove(x,y,id){}
function onUp(x,y,id){}
function onResize(){}
`;
const GAME = assemble('チューンゲーム', TUNE_JS);

async function boot(admin) {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.addInitScript(a => {
    localStorage.setItem('arcade.player', JSON.stringify({ name: 'テスト太郎' }));
    localStorage.setItem('arcade.name.done', '1');
    if (a) localStorage.setItem('arcade.admincode', 'test-admin');
  }, admin);
  await p.route('**/functions/v1/generate', async r => {
    const body = JSON.parse(r.request().postData());
    if (body.makeSpec) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ spec: '■概要\nテスト' }) });
    if (body.usage) return r.fulfill({ status: 200, contentType: 'application/json', body: '{"enabled":false}' });
    if (body.build) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ action: 'build', reply: '作ったよ！', title: 'チューンゲーム', html: GAME, category: 'その他' }) });
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
  await p.fill('#chatInput', 'タップゲーム');
  await p.click('#chatSend');
  await p.waitForTimeout(800);
  await p.evaluate(() => { const b = [...document.querySelectorAll('.buildrow button')].find(x => /設計書を作る/.test(x.textContent)); if (b) b.click(); });
  await p.waitForTimeout(800);
  await p.evaluate(() => { const b = [...document.querySelectorAll('#specrow button')].find(x => /生成開始/.test(x.textContent)); if (b) b.click(); });
  for (let i = 0; i < 24; i++) { await p.waitForTimeout(500); if (await p.evaluate(() => !!document.querySelector('.gencard'))) break; }
  await p.evaluate(() => { document.querySelector('.gencard .toPv').click(); });
  await p.waitForTimeout(600);
  return { b, p, errs };
}

(async () => {
  // --- シナリオ1: 管理者 ---
  const { b, p, errs } = await boot(true);
  const gearShown = await p.evaluate(() => !document.getElementById('pvTune').hidden);
  await p.click('#pvTune');
  await p.waitForTimeout(200);
  const labels = await p.evaluate(() => [...document.querySelectorAll('#tuneBody .tctrl .k')].map(n => n.textContent));
  const vals0 = await p.evaluate(() => [...document.querySelectorAll('#tuneBody .tctrl .v')].map(n => n.textContent));
  // 1本目（敵の速さ）を右端までドラッグ → max=400
  const sl = await p.locator('#tuneBody .tsl').first().boundingBox();
  await p.mouse.move(sl.x + sl.width * 0.4, sl.y + sl.height / 2);
  await p.mouse.down();
  await p.mouse.move(sl.x + sl.width + 5, sl.y + sl.height / 2, { steps: 8 });
  await p.mouse.up();
  await p.waitForTimeout(400);
  const val1 = await p.evaluate(() => document.querySelector('#tuneBody .tctrl .v').textContent);
  const srcHasNew = await p.evaluate(() => /speed:\s*\{\s*v:\s*400/.test(document.getElementById('pvFrame').srcdoc));
  // 変更後もゲームが起動してエラーなし（スタート→タップ→__VP_ERR確認）
  await p.waitForTimeout(600);
  const gameOk = await p.evaluate(async () => {
    const w = document.getElementById('pvFrame').contentWindow;
    const btn = w.document.getElementById('vpstart'); if (!btn) return 'no-start';
    btn.click();
    await new Promise(r => setTimeout(r, 800));
    if (w.__vpTap) w.__vpTap();
    await new Promise(r => setTimeout(r, 800));
    return w.__VP_ERR ? ('err:' + w.__VP_ERR) : 'ok';
  });
  // リセット → 元の150に戻る
  await p.click('#tuneReset');
  await p.waitForTimeout(300);
  const valReset = await p.evaluate(() => document.querySelector('#tuneBody .tctrl .v').textContent);
  const srcReset = await p.evaluate(() => /speed:\s*\{\s*v:\s*150/.test(document.getElementById('pvFrame').srcdoc));
  await b.close();
  const ok1 = gearShown && labels.join(',') === '敵の速さ,ライフ数,爆弾の割合' && vals0[0] === '150'
    && val1 === '400' && srcHasNew && gameOk === 'ok' && valReset === '150' && srcReset && errs.length === 0;
  console.log('1. 管理者→⚙️→ドラッグ→反映→リセット:', ok1 ? 'PASS' : 'FAIL',
    JSON.stringify({ gearShown, labels, vals0, val1, srcHasNew, gameOk, valReset, srcReset, errs }));

  // --- シナリオ2: 非管理者は⚙️非表示 ---
  const s2 = await boot(false);
  const gearHidden = await s2.p.evaluate(() => document.getElementById('pvTune').hidden);
  await s2.b.close();
  const ok2 = gearHidden && s2.errs.length === 0;
  console.log('2. 非管理者→⚙️なし:', ok2 ? 'PASS' : 'FAIL', JSON.stringify({ gearHidden, errs: s2.errs }));
  process.exit(ok1 && ok2 ? 0 : 1);
})();
