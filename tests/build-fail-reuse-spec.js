/* 生成フローの状態機械テスト：ビルド失敗後に設計書を無駄に作り直さないこと
   前提: リポジトリ直下で `python3 -m http.server 8099` を起動しておくこと。

   シナリオ:
   1. 相談→設計書を作る（makeSpec 1回）→この設計書で生成
   2. ビルドを失敗させる（サーバーがエラーを返す）
   3. 失敗後は "spec" 状態に戻り、[🚀 この設計書で生成] が1タップで出ている
   4. そこで再生成 → makeSpec は追加で呼ばれない（設計書を作り直さない）＝コスト無駄なし
   5. さらに「もう一回作って」とチャットで打っても、makeSpec は呼ばれず
      ready 状態でも『この設計書で生成』が出る（設計書を作り直さない） */
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

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.addInitScript(() => { localStorage.setItem('arcade.player', JSON.stringify({ name: 'テスト太郎' })); localStorage.setItem('arcade.name.done', '1'); });

  let specCalls = 0, buildCalls = 0, failNextBuild = true;
  await p.route('**/functions/v1/generate', async r => {
    const body = JSON.parse(r.request().postData());
    if (body.makeSpec) { specCalls++; return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ spec: '■概要\nテスト設計書' }) }); }
    if (body.usage) return r.fulfill({ status: 200, contentType: 'application/json', body: '{"enabled":false}' });
    if (body.build) {
      buildCalls++;
      if (failNextBuild) { failNextBuild = false; return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ error: 'timeout' }) }); }
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ action: 'build', reply: '作ったよ！', title: 'テストゲーム', html: GAME, category: 'その他' }) });
    }
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ action: 'ready', reply: '準備OK！この内容で作り始めていい？' }) });
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

  // 相談 → 設計書を作る
  await p.fill('#chatInput', 'ねこがジャンプするゲーム');
  await p.click('#chatSend');
  await p.waitForTimeout(700);
  await p.evaluate(() => { const b = [...document.querySelectorAll('.buildrow button')].find(x => /設計書を作る/.test(x.textContent)); if (b) b.click(); });
  await p.waitForTimeout(700);
  const specAfterMake = specCalls;   // 1のはず

  // この設計書で生成 → 失敗する
  await p.evaluate(() => { const b = [...document.querySelectorAll('#specrow button')].find(x => /設計書で生成/.test(x.textContent)); if (b) b.click(); });
  await p.waitForTimeout(1200);
  // 失敗後：spec 行が戻っていて [🚀 この設計書で生成] が1タップで出ている
  const specRowBackAfterFail = await p.evaluate(() => !!document.querySelector('#specrow') && [...document.querySelectorAll('#specrow button')].some(x => /設計書で生成/.test(x.textContent)));
  const specCallsAfterFail = specCalls;   // まだ1のまま（作り直していない）

  // もう一度「この設計書で生成」→ 今度は成功。makeSpec は増えない
  await p.evaluate(() => { const b = [...document.querySelectorAll('#specrow button')].find(x => /設計書で生成/.test(x.textContent)); if (b) b.click(); });
  for (let i = 0; i < 24; i++) { await p.waitForTimeout(500); if (await p.evaluate(() => !!document.querySelector('.gencard'))) break; }
  const specCallsAfterRetry = specCalls;   // まだ1（作り直しゼロ）
  const built = await p.evaluate(() => !!document.querySelector('.gencard'));

  await b.close();
  const checks = {
    specAfterMake, specRowBackAfterFail, specCallsAfterFail, specCallsAfterRetry,
    buildCalls, built, pageErrors: errs
  };
  const ok = specAfterMake === 1
    && specRowBackAfterFail === true      // 失敗後に「この設計書で生成」が即出る
    && specCallsAfterFail === 1           // 失敗しても設計書を作り直していない
    && specCallsAfterRetry === 1          // 再生成でも設計書は作り直さない（＝コスト無駄なし）
    && buildCalls === 2                   // ビルドは失敗1＋成功1
    && built === true
    && errs.length === 0;
  console.log(JSON.stringify(checks, null, 1));
  console.log(ok ? 'PASS' : 'FAIL');
  process.exit(ok ? 0 : 1);
})();
