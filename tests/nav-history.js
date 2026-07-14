/* ナビゲーション履歴のE2E（スワイプ戻る事故の回帰）
   前提: リポジトリ直下で `python3 -m http.server 8099` を起動しておくこと。

   セオリー：下タブ切替は履歴に積まない（replace）。ドリルダウンだけ積む。
   1. 遊ぶ→作る→マイページ とタブ移動しても履歴は増えない
      （戻る＝スワイプでタブをまたいで戻らない）
   2. 作る内のドリルダウン（一覧→チャット）は履歴に積まれ、
      back で「1つ上（一覧）」に戻る。タブ移動の過去には戻らない */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.addInitScript(() => { localStorage.setItem('arcade.player', JSON.stringify({ name: 'テスト太郎' })); localStorage.setItem('arcade.name.done', '1'); localStorage.setItem('arcade.howto.v1', '1'); });
  await p.route('**/functions/v1/generate', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"enabled":false}' }));
  await p.route('**/rest/v1/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));

  await p.goto('http://localhost:8099/arcade/');
  await p.waitForTimeout(800);
  const hist0 = await p.evaluate(() => history.length);

  function tab(name) {
    return p.evaluate(n => { const t = [...document.querySelectorAll('.tabbar button,[data-tab]')].find(x => x.dataset && x.dataset.tab === n); if (t) t.click(); }, name);
  }
  const activeTab = () => p.evaluate(() => { const v = document.querySelector('.view.active'); return v ? v.id.replace('view-', '') : null; });
  const activeCr = () => p.evaluate(() => { const on = document.querySelector('#view-create .crscreen.on'); return on ? on.id.replace('cr-', '') : null; });

  // 1. タブを3回またいでも履歴が増えない
  await tab('create'); await p.waitForTimeout(300);
  await tab('mypage'); await p.waitForTimeout(300);
  await tab('play'); await p.waitForTimeout(300);
  const histAfterTabs = await p.evaluate(() => history.length);
  const tabsNoPush = histAfterTabs === hist0;

  // 2. 作る→新規作成（ドリルダウン=push）→ back で作る一覧へ（遊ぶには戻らない）
  await tab('create'); await p.waitForTimeout(300);
  await p.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => /新規作成/.test(x.textContent)); if (b) b.click(); });
  await p.waitForTimeout(400);
  await p.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => /作成してはじめる/.test(x.textContent)); if (b) b.click(); });
  await p.waitForTimeout(600);
  const inChat = (await activeCr()) === 'chat';
  await p.goBack();   // ＝スワイプ戻ると同じ
  await p.waitForTimeout(500);
  const backTab = await activeTab();
  const backCr = await activeCr();
  const backToList = backTab === 'create' && backCr === 'list';

  await b.close();
  const checks = { hist0, histAfterTabs, tabsNoPush, inChat, backTab, backCr, backToList, pageErrors: errs };
  const ok = tabsNoPush && inChat && backToList && errs.length === 0;
  console.log(JSON.stringify(checks, null, 1));
  console.log(ok ? 'PASS' : 'FAIL');
  process.exit(ok ? 0 : 1);
})();
