/* 生成ゲームを iframe(srcdoc) で安全に走らせるための埋め込みシム。
   - 親(プレイ画面)へ postMessage する Arcade を、生成HTMLの先頭に注入する。
   - 生成HTML側の `window.Arcade = window.Arcade || {...}` より先に定義されるので、
     殻に乗っている時はこちらが使われ、単体では no-op フォールバックになる。      */
window.ARCADE_SHIM = [
  "(function(){",
  "  var inFrame = window.parent && window.parent !== window;",
  "  var h = {};",
  "  function send(call, p){ if(inFrame) window.parent.postMessage({__arcade:true, call:call, payload:p||{}}, '*'); }",
  "  window.Arcade = {",
  "    ready:function(){ send('ready'); },",
  "    submitScore:function(s){ send('submitScore',{score:s}); },",
  "    gameOver:function(s){ send('gameOver',{score:s}); },",
  "    event:function(n,d){ send('event',{name:n,data:d}); },",
  "    onPause:function(f){ h.pause=f; },",
  "    onResume:function(f){ h.resume=f; },",
  "    onRestart:function(f){ h.restart=f; }",
  "  };",
  "  window.addEventListener('message', function(e){",
  "    var d=e.data; if(!d||!d.__arcadeCtl) return;",
  "    if(d.call==='pause'&&h.pause) h.pause();",
  "    if(d.call==='resume'&&h.resume) h.resume();",
  "    if(d.call==='restart'&&h.restart) h.restart();",
  "  });",
  "})();"
].join("\n");

// 生成HTMLにシムを差し込んで srcdoc 用の文字列を作る
window.buildSrcdoc = function (html) {
  var shim = "<script>" + window.ARCADE_SHIM + "<\/script>";
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, function (m) { return m + shim; });
  return shim + (html || "");
};
