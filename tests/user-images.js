/* 素材画像アップロードのE2Eテスト
   前提: リポジトリ直下で `python3 -m http.server 8099` を起動しておくこと。
   確認すること:
   1. 素材パネルから画像を追加→説明を入力→トレイに出る
   2. サーバーへ送るmessagesに base64（role:"imgs"）が混ざらない／
      ユーザー文には「素材画像: img1＝説明」のメモが入る
   3. ビルド結果のHTMLへクライアントがdataURLを注入し、ゲームが実際に描画する
   4. 編集ビルドでは prevHtml に注入済み画像が入って往復し、結果にも画像が残る */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '../arcade/supabase/functions/generate/index.ts'), 'utf8');
const TPL = /const RUNTIME_TPL = `([\s\S]*?)`;\n\n/.exec(src)[1].replace(/\\`/g, '`').replace(/\\\$\{/g, '${');
const GAME_JS = `
var t=0;
function init(){ t=0; Game.score(0); }
function update(dt){ t+=dt; if(t>60) Game.over(0); }
function draw(){ ctx.fillStyle="#000"; ctx.fillRect(0,0,W,H);
  var m=Game.img("img1"); if(m){ ctx.drawImage(m, 100, 100, 80, 80); } }
function onDown(x,y,id){}
function onMove(x,y,id){}
function onUp(x,y,id){}
function onResize(){}
`.repeat(2);
function assemble(js) {
  const meta = encodeURIComponent(JSON.stringify({ t: '画像テスト', h: 't', u: '点' }));
  return TPL.split('__META__').join(meta).split('__TITLE__').join('画像テスト').split('__HOWTO__').join('t')
    .split('__UNIT__').join('点').split('__GAME_CSS__').join('').split('__GAME_JS__').join(js);
}
const GAME = assemble(GAME_JS);   // 画像マーカーは空 {} のまま（注入はクライアントの仕事）
// 16x16 全面赤のPNG
const RED_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAHUlEQVR4nGP8z8Dwn4ECwESJ5lEDRg0YNWCQGAAAdWEDHZgYlEIAAAAASUVORK5CYII=', 'base64');

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  const posts = [];   // 全リクエストのボディを記録
  await p.addInitScript(() => { localStorage.setItem('arcade.player', JSON.stringify({ name: 'テスト太郎' })); localStorage.setItem('arcade.name.done', '1'); });
  await p.route('**/functions/v1/generate', async r => {
    const body = JSON.parse(r.request().postData());
    posts.push(body);
    if (body.makeSpec) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ spec: '■概要\nテスト' }) });
    if (body.usage) return r.fulfill({ status: 200, contentType: 'application/json', body: '{"enabled":false}' });
    if (body.build) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ action: 'build', reply: '作ったよ！', title: '画像テスト', html: GAME, category: 'その他' }) });
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

  // 1. 素材パネルを開いて画像をアップロード＋説明
  await p.click('#assetToggle');
  await p.waitForTimeout(200);
  await p.setInputFiles('#imgUp', { name: 'neko.png', mimeType: 'image/png', buffer: RED_PNG });
  await p.waitForTimeout(600);
  const cellShown = await p.evaluate(() => !!document.querySelector('.imgcell img'));
  await p.fill('.imglabel', '主人公のねこ');
  await p.evaluate(() => { document.querySelector('.imglabel').dispatchEvent(new Event('change', { bubbles: true })); });
  await p.waitForTimeout(200);
  const trayShown = await p.evaluate(() => !!document.querySelector('.traychip.imgchip'));

  // 2. チャット送信 → 設計書 → 生成開始
  await p.fill('#chatInput', 'ねこが走るゲーム');
  await p.click('#chatSend');
  await p.waitForTimeout(800);
  await p.evaluate(() => { const b = [...document.querySelectorAll('.buildrow button')].find(x => /設計書を作る/.test(x.textContent)); if (b) b.click(); });
  await p.waitForTimeout(800);
  await p.evaluate(() => { const b = [...document.querySelectorAll('#specrow button')].find(x => /生成開始/.test(x.textContent)); if (b) b.click(); });
  for (let i = 0; i < 24; i++) { await p.waitForTimeout(500); if (await p.evaluate(() => !!document.querySelector('.gencard'))) break; }

  const noteSent = posts.some(x => (x.messages || []).some(m => m.role === 'user' && /素材画像: img1＝主人公のねこ/.test(m.content)));
  const noImgsRole = posts.every(x => !(x.messages || []).some(m => m.role !== 'user' && m.role !== 'assistant'));
  const noBase64InMsgs = posts.every(x => !(x.messages || []).some(m => /data:image/.test(m.content || '')));

  // 3. プレビューで注入＋実描画を確認
  await p.evaluate(() => { document.querySelector('.gencard .toPv').click(); });
  await p.waitForTimeout(1200);
  const injected = await p.evaluate(() => /data:image\/(png|webp|jpeg)/.test(document.getElementById('pvFrame').srcdoc));
  const drew = await p.evaluate(async () => {
    const w = document.getElementById('pvFrame').contentWindow;
    const btn = w.document.getElementById('vpstart'); if (!btn) return 'no-start';
    btn.click();
    await new Promise(r => setTimeout(r, 700));
    const c = w.document.getElementById('vpc');
    const d = c.getContext('2d').getImageData(100, 100, 80, 80).data;
    let red = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] < 60) red++;
    return red > 500 ? 'ok' : 'few:' + red;
  });

  // 4. 編集ビルド：prevHtml に注入済み画像が入って往復するか
  await p.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => x.id === 'pvToChat'); if (b) b.click(); });
  await p.waitForTimeout(400);
  await p.fill('#chatInput', 'もっと速くして');
  await p.click('#chatSend');
  await p.waitForTimeout(800);
  await p.evaluate(() => { const b = [...document.querySelectorAll('.buildrow button')].find(x => /直し始める/.test(x.textContent)); if (b) b.click(); });
  for (let i = 0; i < 24; i++) { await p.waitForTimeout(500); if (await p.evaluate(() => document.querySelectorAll('.gencard').length >= 2)) break; }
  const editPost = posts.filter(x => x.build && x.prevHtml).pop();
  const prevHasImg = !!(editPost && /data:image\/(png|webp|jpeg)/.test(editPost.prevHtml));

  await b.close();
  const checks = { cellShown, trayShown, noteSent, noImgsRole, noBase64InMsgs, injected, drew, prevHasImg, pageErrors: errs };
  const ok = cellShown && trayShown && noteSent && noImgsRole && noBase64InMsgs && injected && drew === 'ok' && prevHasImg && errs.length === 0;
  console.log(JSON.stringify(checks, null, 1));
  console.log(ok ? 'ALL PASS' : 'FAIL');
  process.exit(ok ? 0 : 1);
})();
