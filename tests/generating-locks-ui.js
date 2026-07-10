/* 生成中はアクションボタンを出さない＋並行操作を止める（スクショのバグの回帰）
   前提: リポジトリ直下で `python3 -m http.server 8099` を起動しておくこと。

   ポーリング方式のビルド（job→pending…→done）を再生成し、生成中に：
   - アクション行（.buildrow：この設計書で生成／直し始める 等）が一切出ていない
   - チャット送信が弾かれる（生成中トースト）
   を検証。完了後は done 状態でボタンが戻ることも確認。 */
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
  await p.addInitScript(() => { localStorage.setItem('arcade.player', JSON.stringify({ name: 'テスト太郎' })); localStorage.setItem('arcade.name.done', '1'); localStorage.setItem('arcade.specmode', '1'); });

  let polls = 0;
  await p.route('**/functions/v1/generate', async r => {
    const body = JSON.parse(r.request().postData());
    if (body.makeSpec) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ spec: '■概要\nテスト設計書' }) });
    if (body.usage) return r.fulfill({ status: 200, contentType: 'application/json', body: '{"enabled":false}' });
    if (body.job) {   // ポーリング：最初の3回は pending、その後 done
      polls++;
      if (polls <= 3) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'pending' }) });
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'done', action: 'build', reply: '作ったよ！', title: 'テストゲーム', html: GAME, category: 'その他' }) });
    }
    if (body.build) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ action: 'job', job_id: 'j1' }) });
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
  await p.fill('#chatInput', 'カーレースのゲーム');
  await p.click('#chatSend');
  await p.waitForTimeout(700);
  await p.evaluate(() => { const b = [...document.querySelectorAll('.buildrow button')].find(x => /設計書を作る/.test(x.textContent)); if (b) b.click(); });
  await p.waitForTimeout(700);
  await p.evaluate(() => { const b = [...document.querySelectorAll('#specrow button')].find(x => /設計書で生成/.test(x.textContent)); if (b) b.click(); });

  // 生成中（ポーリング中）：genbar が出ていて、アクション行が1つも無い
  await p.waitForTimeout(1500);
  const genbarOn = await p.evaluate(() => !document.getElementById('genBar').hidden);
  const rowsDuringGen = await p.evaluate(() => document.querySelectorAll('.buildrow').length);
  // 生成中にチャット送信を試す → 弾かれる（履歴に増えない）
  const beforeUserMsgs = await p.evaluate(() => [...document.querySelectorAll('#chatlog .msg.user')].length);
  await p.fill('#chatInput', '割り込みメッセージ');
  await p.click('#chatSend');
  await p.waitForTimeout(400);
  const afterUserMsgs = await p.evaluate(() => [...document.querySelectorAll('#chatlog .msg.user')].length);
  const sendBlocked = afterUserMsgs === beforeUserMsgs;

  // 完了まで待つ
  for (let i = 0; i < 30; i++) { await p.waitForTimeout(500); if (await p.evaluate(() => !!document.querySelector('.gencard'))) break; }
  await p.waitForTimeout(500);
  const genbarOffAfter = await p.evaluate(() => document.getElementById('genBar').hidden);
  const built = await p.evaluate(() => !!document.querySelector('.gencard'));
  // 完了後は done：設計書ビューが1つ出て、ビルド系ゴールドボタンは出ていない
  const specViewAfter = await p.evaluate(() => !!document.getElementById('specviewrow'));
  const noBuildBtnAfter = await p.evaluate(() => ![...document.querySelectorAll('.buildrow button')].some(x => /この設計書で生成|直し始める|設計書を作る/.test(x.textContent)));

  await b.close();
  const checks = { genbarOn, rowsDuringGen, sendBlocked, genbarOffAfter, built, specViewAfter, noBuildBtnAfter, pageErrors: errs };
  const ok = genbarOn && rowsDuringGen === 0 && sendBlocked && genbarOffAfter && built && specViewAfter && noBuildBtnAfter && errs.length === 0;
  console.log(JSON.stringify(checks, null, 1));
  console.log(ok ? 'PASS' : 'FAIL');
  process.exit(ok ? 0 : 1);
})();
