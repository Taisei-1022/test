/* チャット・設計書の完全永続化テスト（100%残す＋設計書はずっと閲覧可能）
   前提: リポジトリ直下で `python3 -m http.server 8099` を起動しておくこと。

   ステートフルなSupabase RESTモックで games 行を実際にメモリ保存し、
   ビルド後にページを再読み込み→作品を開き直して、
   会話（ボットの生成結果・ステータスも含む）と設計書が丸ごと復元されることを検証する。 */
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
const SPEC_TEXT = '■概要\nこれはテスト用の設計書です。\n■ルール\nタップでスコア加算。';

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.addInitScript(() => { localStorage.setItem('arcade.player', JSON.stringify({ name: 'テスト太郎' })); localStorage.setItem('arcade.name.done', '1'); });

  // --- ステートフルな games ストア（Node側メモリ） ---
  // 注: Playwright は「後に登録したルートが優先」。汎用の rest/v1/** を先に、games** を後に登録する。
  await p.route('**/rest/v1/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  const store = {}; let seq = 0;
  await p.route('**/rest/v1/games**', async r => {
    const req = r.request(); const url = req.url(); const method = req.method();
    const idm = /id=eq\.([^&]+)/.exec(url);
    if (method === 'POST') {
      const row = JSON.parse(req.postData()); row.id = 'g' + (++seq); row.created_at = new Date().toISOString();
      store[row.id] = row;
      return r.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify([row]) });
    }
    if (method === 'PATCH') {
      const id = decodeURIComponent(idm[1]); const patch = JSON.parse(req.postData());
      store[id] = Object.assign(store[id] || { id }, patch);
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([store[id]]) });
    }
    // GET
    if (idm) { const id = decodeURIComponent(idm[1]); return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(store[id] ? [store[id]] : []) }); }
    const rows = Object.values(store).sort((a, c) => (c.created_at || '').localeCompare(a.created_at || ''));
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) });
  });
  await p.route('**/functions/v1/generate', async r => {
    const body = JSON.parse(r.request().postData());
    if (body.makeSpec) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ spec: SPEC_TEXT }) });
    if (body.usage) return r.fulfill({ status: 200, contentType: 'application/json', body: '{"enabled":false}' });
    if (body.build) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ action: 'build', reply: '作ったよ！', title: 'テストゲーム', html: GAME, category: 'その他' }) });
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ action: 'ready', reply: '準備OK！この内容で作り始めていい？' }) });
  });

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
  await p.waitForTimeout(700);
  await p.evaluate(() => { const b = [...document.querySelectorAll('.buildrow button')].find(x => /設計書を作る/.test(x.textContent)); if (b) b.click(); });
  await p.waitForTimeout(700);
  await p.evaluate(() => { const b = [...document.querySelectorAll('#specrow button')].find(x => /生成開始/.test(x.textContent)); if (b) b.click(); });
  for (let i = 0; i < 24; i++) { await p.waitForTimeout(500); if (await p.evaluate(() => !!document.querySelector('.gencard'))) break; }
  await p.waitForTimeout(600);

  const before = await p.evaluate(() => document.getElementById('chatlog').textContent);
  const storedRows = Object.keys(store).length;

  // --- ページを再読み込み（＝アプリを閉じて開き直す） → 作品を開く ---
  await p.reload();
  await p.waitForTimeout(900);
  await p.evaluate(() => { const b = [...document.querySelectorAll('button,a,[role=tab]')].find(x => /作る/.test(x.textContent.trim()) && x.textContent.trim().length <= 3); if (b) b.click(); });
  await p.waitForTimeout(700);
  // 作品一覧の「編集」ボタンを押す（editGame を発火）
  const opened = await p.evaluate(() => {
    const btn = document.querySelector('#creations [data-act="edit"]');
    if (btn) { btn.click(); return true; } return false;
  });
  await p.waitForTimeout(1000);

  const after = await p.evaluate(() => document.getElementById('chatlog').textContent);
  const hasUserMsg = /ねこがジャンプするゲーム/.test(after);
  const hasSpecMade = /設計書ができたよ/.test(after);
  const hasBuilt = /ができたよ！/.test(after);
  const specViewBtn = await p.evaluate(() => !!document.getElementById('specviewrow'));
  const cardBack = await p.evaluate(() => !!document.querySelector('.gencard'));
  // 設計書を開いて中身が戻るか
  let specOpens = false;
  if (specViewBtn) {
    await p.evaluate(() => document.querySelector('#specviewrow button').click());
    await p.waitForTimeout(300);
    specOpens = await p.evaluate(() => !document.getElementById('specov').hidden && /テスト用の設計書/.test(document.getElementById('specta').value));
  }

  await b.close();
  const checks = { storedRows, opened, hasUserMsg, hasSpecMade, hasBuilt, specViewBtn, specOpens, cardBack, pageErrors: errs };
  const ok = storedRows >= 1 && opened && hasUserMsg && hasSpecMade && hasBuilt && specViewBtn && specOpens && cardBack && errs.length === 0;
  console.log('before reload chatlog had 「できたよ」:', /ができたよ/.test(before));
  console.log(JSON.stringify(checks, null, 1));
  console.log(ok ? 'PASS' : 'FAIL');
  process.exit(ok ? 0 : 1);
})();
