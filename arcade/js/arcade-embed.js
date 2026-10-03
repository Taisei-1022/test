/* 生成ゲーム（AI製・持ち込み）を iframe(srcdoc) で安全に走らせるための埋め込みシム。
   - 親(プレイ画面)へ postMessage する Arcade を、生成HTMLの先頭に注入する。
   - 生成HTML側の `window.Arcade = window.Arcade || {...}` より先に定義されるので、
     殻に乗っている時はこちらが使われ、単体では no-op フォールバックになる。

   ★隔離：生成ゲームは iframe に sandbox="allow-scripts"（GAME_SANDBOX）を付けて動かす。
     付けないと srcdoc はアプリと同じ扱いになり、ゲームのプログラムから管理者コードや
     作者トークン（localStorage）が読め、アプリの画面も書き換えられた（2026-10 実地で確認）。
     隔離するとそれらは全て不可になり、Vappa とのやり取りは postMessage だけになる。
     さらに CSP で外部への通信・外部読み込みを止める（情報の持ち出し・外部スクリプト防止）。
   ★隔離するとゲーム内の localStorage は例外を投げるので、メモリ上の代替を差し込む
     （ゲームが自前で自己ベストを保存していても落ちない。保存はそのプレイ中だけ有効）。 */
window.GAME_SANDBOX = "allow-scripts";

window.GAME_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' 'unsafe-eval' blob:",
  "style-src 'unsafe-inline'",
  "img-src data: blob:",
  "font-src data:",
  "media-src data: blob:",
  "worker-src blob:",
  "connect-src 'none'",
  "frame-src 'none'",
  "form-action 'none'",
  "base-uri 'none'"
].join("; ");

window.ARCADE_SHIM = [
  "(function(){",
  "  var inFrame = window.parent && window.parent !== window;",
  "  var h = {}, firstErr = null;",
  "  function send(call, p){ if(inFrame) window.parent.postMessage({__arcade:true, call:call, payload:p||{}}, '*'); }",
  // 隔離下では localStorage/sessionStorage が例外になるので、メモリ上の代替に差し替える
  "  function mem(){ var d={}; return { getItem:function(k){ return Object.prototype.hasOwnProperty.call(d,k)?d[k]:null; },",
  "    setItem:function(k,v){ d[k]=String(v); }, removeItem:function(k){ delete d[k]; }, clear:function(){ d={}; },",
  "    key:function(i){ return Object.keys(d)[i]||null; }, get length(){ return Object.keys(d).length; } }; }",
  "  ['localStorage','sessionStorage'].forEach(function(n){ try{ void window[n].length; }catch(e){",
  "    try{ Object.defineProperty(window, n, { value: mem(), configurable: true }); }catch(e2){} } });",
  // 実行時エラーを最初の1件だけ覚えておく（自動テストプレイで報告する）
  "  window.addEventListener('error', function(ev){ if(!firstErr) firstErr = String((ev && ev.message) || 'error'); });",
  "  window.Arcade = {",
  "    ready:function(){ send('ready'); },",
  "    submitScore:function(s){ send('submitScore',{score:s}); },",
  "    gameOver:function(s){ send('gameOver',{score:s}); },",
  "    event:function(n,d){ send('event',{name:n,data:d}); },",
  "    onPause:function(f){ h.pause=f; },",
  "    onResume:function(f){ h.resume=f; },",
  "    onRestart:function(f){ h.restart=f; }",
  "  };",
  // 自動テストプレイ：親から 'smoke' が来たら、開始ボタンを押す→タップを1回流す→
  // 約3秒後に最初の実行時エラー（または共通ランタイムが捕まえたクラッシュ）を報告する。
  // 以前は親が iframe の中に直接手を入れていたが、隔離後は postMessage でしか触れないため。
  "  function smoke(){",
  "    setTimeout(function(){ try{ var b=document.getElementById('vpstart'); if(b) b.click(); }catch(e){} }, 400);",
  "    setTimeout(function(){ try{ if(window.__vpTap) window.__vpTap(); }catch(e){} }, 1200);",
  "    setTimeout(function(){ var err=firstErr; try{ if(!err && window.__VP_ERR) err=String(window.__VP_ERR); }catch(e){}",
  "      send('smoke', { err: err || null, hasStart: !!document.getElementById('vpstart') }); }, 3000);",
  "  }",
  "  window.addEventListener('message', function(e){",
  "    var d=e.data; if(!d||!d.__arcadeCtl) return;",
  "    if(d.call==='pause'&&h.pause) h.pause();",
  "    if(d.call==='resume'&&h.resume) h.resume();",
  "    if(d.call==='restart'&&h.restart) h.restart();",
  "    if(d.call==='smoke') smoke();",
  "  });",
  "})();"
].join("\n");

// 生成HTMLに CSP とシムを差し込んで srcdoc 用の文字列を作る（CSP は最初に置かないと効かない）
window.buildSrcdoc = function (html) {
  var csp = '<meta http-equiv="Content-Security-Policy" content="' + window.GAME_CSP + '">';
  var shim = "<script>" + window.ARCADE_SHIM + "<\/script>";
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, function (m) { return m + csp + shim; });
  return csp + shim + (html || "");
};

// iframe を隔離して生成HTMLを載せる（sandbox は srcdoc を入れる前に付ける必要がある）
window.loadGameFrame = function (frame, html) {
  frame.setAttribute("sandbox", window.GAME_SANDBOX);
  frame.srcdoc = window.buildSrcdoc(html);
};
