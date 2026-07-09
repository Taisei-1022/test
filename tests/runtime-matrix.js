const { chromium } = require('/opt/node22/lib/node_modules/playwright');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const results = [];
  const ok = (name, cond) => results.push((cond?'✅':'❌')+' '+name);

  // ===== A: 単体ページ（実タッチ操作の全マトリクス） =====
  const p = await b.newPage({ viewport: { width: 390, height: 700 }, hasTouch: true, isMobile: true });
  const errs=[]; p.on('pageerror', e => errs.push(e.message));
  const cdp = await p.context().newCDPSession(p);
  async function realDrag(x1,y1,x2,y2){
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:x1,y:y1,id:1}]});
    for(let k=1;k<=6;k++){ await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x1+(x2-x1)*k/6,y:y1+(y2-y1)*k/6,id:1}]}); }
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  }
  await p.goto('file://' + process.cwd() + '/harness-game.html');
  await p.waitForTimeout(300);

  // 1. スタート：実タッチ
  await p.tap('#vpstart');
  await p.waitForTimeout(400);
  ok('1 スタートボタン（実タッチ）', await p.evaluate(()=>document.getElementById('vpov').hidden));
  // 2. フィールドタップ → onDown
  await p.touchscreen.tap(200, 400);
  await p.waitForTimeout(200);
  ok('2 フィールドタップ→onDown', await p.evaluate(()=>window.__TAPS>=1));
  // 3. 実ドラッグ → onMove 追従
  await realDrag(80, 400, 320, 400);
  await p.waitForTimeout(200);
  ok('3 実ドラッグ→onMove', await p.evaluate(()=>window.__MX>250));
  // 4. ゲーム中のDOMボタン（click合成が生きてるか）
  await p.tap('#domBtn');
  await p.waitForTimeout(200);
  ok('4 ゲーム内DOMボタンclick', await p.evaluate(()=>window.__BTN>=1));
  // 5. ゲームオーバー→もういちど（実タッチ）
  for(let t=0;t<8;t++){
    const done = await p.evaluate(()=>!document.getElementById('vpov').hidden);
    if(done) break;
    await p.touchscreen.tap(200, 400+t*8); await p.waitForTimeout(150);
  }
  const overShown = await p.evaluate(()=>!document.getElementById('vpov').hidden);
  console.log('  (debug) taps=', await p.evaluate(()=>window.__TAPS), 'overShown=', overShown);
  await p.tap('#vpagain').catch(()=>{});
  await p.waitForTimeout(400);
  ok('5 ゲームオーバー→もういちど再開', overShown && await p.evaluate(()=>document.getElementById('vpov').hidden && window.__INITS>=2));
  // 6. クラッシュ画面→復帰
  await p.evaluate(()=>{window.__CRASH=1;});
  await p.waitForTimeout(300);
  const crashShown = await p.evaluate(()=>!document.getElementById('vpov').hidden && !!window.__VP_ERR);
  await p.tap('#vpagain').catch(()=>{});
  await p.waitForTimeout(300);
  ok('6 クラッシュ画面→もういちど復帰', crashShown && await p.evaluate(()=>document.getElementById('vpov').hidden));
  ok('7 実行中エラーなし', errs.length===0);

  // ===== B: touchのみ環境（pointer無し想定のフォールバック発火） =====
  const p2 = await b.newPage({ viewport: { width: 390, height: 700 }, hasTouch: true });
  await p2.goto('file://' + process.cwd() + '/harness-game.html');
  await p2.waitForTimeout(200);
  await p2.evaluate(()=>document.getElementById('vpstart').click());
  await p2.waitForTimeout(200);
  await p2.evaluate(async () => {
    function mk(x,y){return new Touch({identifier:9,target:document.body,clientX:x,clientY:y});}
    function ft(t,x,y){window.dispatchEvent(new TouchEvent(t,{changedTouches:[mk(x,y)],cancelable:true,bubbles:true}));}
    ft('touchstart',100,400); ft('touchmove',300,400); ft('touchend',300,400);
  });
  ok('8 touchフォールバック(onDown+onMove)', await p2.evaluate(()=>window.__TAPS>=1 && window.__MX>=300));

  // ===== C: srcdoc iframe埋め込み（play.html相当） =====
  const p3 = await b.newPage({ viewport: { width: 390, height: 700 }, hasTouch: true, isMobile: true });
  const errs3=[]; p3.on('pageerror', e => errs3.push(e.message));
  await p3.goto('file://' + process.cwd() + '/embed.html');
  await p3.waitForTimeout(500);
  const frame = p3.frames()[1];
  await frame.locator('#vpstart').tap();
  await p3.waitForTimeout(400);
  ok('9 iframe内スタート（実タッチ）', await frame.evaluate(()=>document.getElementById('vpov').hidden));
  const cdp3 = await p3.context().newCDPSession(p3);
  await cdp3.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:80,y:400,id:1}]});
  for(let k=1;k<=6;k++) await cdp3.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:80+40*k,y:400,id:1}]});
  await cdp3.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await p3.waitForTimeout(300);
  ok('10 iframe内ドラッグ→onMove', await frame.evaluate(()=>window.__MX>250));
  ok('11 iframeエラーなし', errs3.length===0);

  // ===== D: 実ゲーム（シューティング2のjs×新ランタイム）実タッチ =====
  const p4 = await b.newPage({ viewport: { width: 390, height: 700 }, hasTouch: true, isMobile: true });
  const errs4=[]; p4.on('pageerror', e => errs4.push(e.message));
  await p4.goto('file://' + process.cwd() + '/shooter-new.html');
  await p4.waitForTimeout(300);
  await p4.tap('#vpstart');
  await p4.waitForTimeout(500);
  const started4 = await p4.evaluate(()=>document.getElementById('vpov').hidden);
  const cdp4 = await p4.context().newCDPSession(p4);
  await cdp4.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:60,y:600,id:1}]});
  for(let k=1;k<=8;k++) await cdp4.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:60+35*k,y:600,id:1}]});
  await cdp4.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await p4.waitForTimeout(800);
  await p4.screenshot({path:'shooter-final.png'});
  ok('12 シューティング2：起動＋ドラッグ操作', started4 && errs4.length===0);

  console.log(results.join('\n'));
  const fails = results.filter(r=>r.startsWith('❌'));
  console.log(fails.length ? '\n*** '+fails.length+' FAILURES ***' : '\nALL PASS');
  await b.close();
})();
