// Supabase Edge Function: ゲーム相談チャット / 生成 / 編集（Claude / Anthropic Messages API）
// deploy: conversational mode (planner + build with adaptive thinking)
// 入力:
//   { messages: [{role:'user'|'assistant', content}], prevHtml? }
//   （後方互換: { prompt } も可 → messages=[{role:'user',content:prompt}] とみなす）
// 出力（構造化）:
//   { action:'ask',   reply, options:[...] }            … まだ相談する（質問＋選択肢）
//   { action:'build', reply, title, html }              … ゲームを生成した
// 流れ:
//   - prevHtml あり → 既存ゲームを指示で修正（相談スキップ・thinkingあり）
//   - prevHtml なし → まずプランナー(軽量・質問役)。build判断なら本生成(thinkingあり)。

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// 相談役（コードは書かない・日本語で会話）
const PLAN_SYSTEM = `You are a friendly Japanese-speaking game-design partner for a casual one-screen mobile mini-game maker.
In THIS step you only TALK with the user to shape a simple, fun game — you do NOT write any code.

Rules:
- Always answer in Japanese, short and friendly.
- On the user's FIRST message you MUST ask exactly one clarifying question (action="ask") and propose about 3 concrete options. Never build on the first turn.
- Keep the conversation going one question at a time — core mechanic, goal, controls, theme, or difficulty — each with up to ~4 short tappable options when useful.
- REQUIRED: before building, you MUST clarify the RANKING SCORE — i.e., exactly what number goes on the leaderboard (例：点数 / 何秒生き残るか / 何個集めるか / 連続成功(コンボ) / 何段積めるか など). Ask this explicitly with concrete options, and make sure the score is something where HIGHER = BETTER (if the natural metric is "速さ/タイム", convert it so higher is better, e.g. スコア化). Do not switch to build until the ranking score is decided.
- Switch to action="build" only when the design AND the ranking score are clear, OR the user says things like 「これで」「作って」「おまかせ」「いいね」, OR after about 2–3 exchanges.
- Encourage variety; do not push everyone toward the same kind of game.
- Prefer a focused, clearly playable design, but it's fine to attempt more ambitious games when the user wants them — don't force over-simplification. (Just keep the result a single self-contained HTML that runs on a phone.)

Output (structured):
- action: "ask" or "build"
- reply: a short Japanese message to the user (for "build", a brief line like "じゃあ作るね！")
- options: 0–4 short Japanese choice strings the user can tap (for "ask"; empty for "build")`;

// 編集時の相談役（既存ゲームの質問に答え、修正依頼ならビルドへ。コードは下に添付される）
const PLAN_EDIT_SYSTEM = `You are a friendly Japanese-speaking helper. The user already has a finished mini-game. The game's full HTML/JS code is provided below, so you CAN see and understand exactly how it works. In THIS step you only TALK — you do NOT write or output code.
Rules:
- Always answer in Japanese, short and friendly.
- If the user asks a QUESTION about the game (どういう仕組み？ 当たり判定は？ スコアの計算は？ なぜこう動く？), read the code and answer accurately in plain Japanese (action="ask", no options). Do not paste raw code; explain in words. Numbers from the code (speeds, timers, probabilities) are welcome.
- If the user requests a CHANGE or reports a BUG, default to action="build" with a short reply confirming what you'll do (例：「"敵を速く" で直すね！」「敵と弾を濃く見やすくするね！」). You can read the code, so do NOT interrogate the user about details you can figure out yourself. At most ONE clarifying question per topic, and only when the request is truly impossible to act on. Never ask a second follow-up — make a sensible call and build.
- Never switch to build for a pure question.
Output (structured): action ("ask" or "build"), reply (short Japanese), options (0–4 short strings; empty for build).`;

// 相談ログ→仕様書（ビルド直前の1ステップ）。生ログをそのまま渡すと曖昧さが残るため、
// 賢いモデルに要件を整理・補完させてからビルダーに渡す（一発ヒット率を上げてやり直しを減らす）。
const SPEC_SYSTEM = `You are a senior mobile mini-game designer. You will receive a Japanese consultation log between a user and an assistant about a game idea. Write a clear, complete build specification IN JAPANESE for a single-file HTML mini-game based on what was decided.

Include these sections:
- ゲーム概要（1-2文）
- 操作方法（モバイルのタッチ操作前提。具体的に）
- コアメカニクス（何がどう動き、何をすると何が起きるか）
- 難易度の進行（時間や進行度でどう難しくなるか）
- スコア定義（ランキングに載る数値。高いほど良い形で明確に）
- 終了条件
- 見た目・テーマ（色、雰囲気、絵文字などの素材案）
- 特殊ルール・こだわり（ユーザーが明示した要望は一言一句漏らさない）

Rules: resolve ambiguities with sensible, fun choices yourself instead of leaving them open. Do NOT invent requirements that contradict the log. Do NOT write any code. Keep it concise but complete (aim ~300-600 Japanese characters per section max).`;
const SPEC_SCHEMA = {
  type: "object",
  properties: { spec: { type: "string" } },
  required: ["spec"],
  additionalProperties: false,
};

// 品質の手本（この構造・完成度を真似させる。丸写しはさせない）。
// 状態管理 / resize / Arcadeフック＆フォールバック / touch+pointer入力 / ループ / スコア / 演出 を網羅。
const GOLD_EXAMPLE = `<!DOCTYPE html>
<html lang="ja"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,user-scalable=no,maximum-scale=1">
<title>キャッチ</title>
<style>
*{margin:0;box-sizing:border-box;-webkit-tap-highlight-color:transparent;-webkit-user-select:none;user-select:none}
html,body{height:100%;background:#10131c;overflow:hidden;font-family:"Hiragino Maru Gothic ProN",system-ui,sans-serif;color:#fff;touch-action:none}
canvas{position:fixed;inset:0;width:100%;height:100%;display:block}
#ov{position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;background:rgba(8,10,18,.82);text-align:center;padding:24px}
#ov h1{font-size:28px} #ov p{color:#aeb6c8;font-size:15px;line-height:1.7} #ov .big{font-size:40px;font-weight:800;color:#ffd166}
#ov button{background:#ffd166;color:#3a2a00;border:0;border-radius:14px;padding:.8rem 1.6rem;font:inherit;font-weight:800;font-size:16px}
#ov[hidden]{display:none}
#hud{position:fixed;top:calc(env(safe-area-inset-top) + 10px);left:0;right:0;text-align:center;font-weight:800;font-size:20px;pointer-events:none;text-shadow:0 2px 6px rgba(0,0,0,.5)}
</style></head><body>
<canvas id="c"></canvas><div id="hud"></div>
<div id="ov"><h1>🍎 キャッチ</h1><p>かごを動かしてリンゴをキャッチ！<br>3回落とすと終わり。</p><button id="start">はじめる</button></div>
<script>
window.Arcade = window.Arcade || {ready:function(){},gameOver:function(){},submitScore:function(){},event:function(){},onPause:function(){},onResume:function(){},onRestart:function(){}};
(function(){
  "use strict";
  var cv=document.getElementById("c"),ctx=cv.getContext("2d"),ov=document.getElementById("ov"),hud=document.getElementById("hud");
  var W=0,H=0,DPR=Math.min(2,window.devicePixelRatio||1);
  function resize(){W=innerWidth;H=innerHeight;cv.width=W*DPR;cv.height=H*DPR;ctx.setTransform(DPR,0,0,DPR,0,0);}
  addEventListener("resize",resize);
  var basket,items,spawnT,spawnGap,score,miss,run,paused,last;
  function reset(){basket={x:0,w:84,y:0};items=[];spawnT=0;spawnGap=1.0;score=0;miss=0;run=false;paused=false;basket.x=innerWidth/2;}
  function start(){resize();reset();ov.hidden=true;run=true;last=performance.now();Arcade.ready();requestAnimationFrame(loop);}
  function over(){run=false;ov.innerHTML='<h1>おしまい</h1><div class="big">'+score+'</div><p>キャッチ数</p><button id="rb">リトライ</button>';ov.hidden=false;document.getElementById("rb").onclick=start;Arcade.gameOver(score);}
  function spawn(){items.push({x:40+Math.random()*(W-80),y:-30,v:160+score*4});}
  function loop(t){if(!run)return;var dt=Math.min(.05,(t-last)/1000);last=t;if(!paused)update(dt);draw();requestAnimationFrame(loop);}
  function update(dt){
    basket.y=H-90;
    spawnT+=dt;spawnGap=Math.max(.45,1.0-score*.02);
    if(spawnT>=spawnGap){spawnT=0;spawn();}
    for(var i=items.length-1;i>=0;i--){var it=items[i];it.y+=it.v*dt;
      if(it.y>basket.y-18&&it.y<basket.y+18&&Math.abs(it.x-basket.x)<basket.w/2+16){items.splice(i,1);score++;continue;}
      if(it.y>H+30){items.splice(i,1);miss++;if(miss>=3){over();return;}}
    }
    hud.textContent=score+"　❤×"+(3-miss);
  }
  function draw(){
    ctx.clearRect(0,0,W,H);
    var g=ctx.createLinearGradient(0,0,0,H);g.addColorStop(0,"#1b2236");g.addColorStop(1,"#0d1018");ctx.fillStyle=g;ctx.fillRect(0,0,W,H);
    ctx.font="30px serif";ctx.textAlign="center";ctx.textBaseline="middle";
    for(var i=0;i<items.length;i++)ctx.fillText("🍎",items[i].x,items[i].y);
    ctx.fillStyle="#c98a3a";ctx.fillRect(basket.x-basket.w/2,basket.y-10,basket.w,22);
    ctx.fillStyle="#e0a55a";ctx.fillRect(basket.x-basket.w/2,basket.y-14,basket.w,8);
  }
  function move(e){if(!run)return;var x=(e.touches?e.touches[0].clientX:e.clientX);basket.x=Math.max(basket.w/2,Math.min(W-basket.w/2,x));if(e.preventDefault)e.preventDefault();}
  cv.addEventListener("pointermove",move);cv.addEventListener("pointerdown",move);
  cv.addEventListener("touchmove",move,{passive:false});cv.addEventListener("touchstart",move,{passive:false});
  document.getElementById("start").addEventListener("click",start);
  Arcade.onRestart(start);Arcade.onPause(function(){paused=true;});Arcade.onResume(function(){paused=false;last=performance.now();});
  resize();reset();draw();
})();
</script></body></html>`;

// 本生成（自己完結の単一HTMLゲーム）
const BUILD_SYSTEM = `You generate a complete, self-contained single-file HTML5 mini-game.

Hard requirements:
- Output ONLY through the structured format: "title" (short, Japanese) and "html" (the full game).
- "html" is a complete standalone document (<!DOCTYPE html> ... </html>) with ALL CSS and JS inline.
  No external resources, no CDN, no <link>/<img src> to the network, no fetch, no imports, no audio files.
- Mobile-first: works with touch (touchstart/touchmove), fills the screen, portrait friendly, no page scrolling.
- The game is immediately playable: a brief start screen ("タップで開始"), then play, then a game-over with restart.
- Scoring: use the RANKING SCORE decided in the conversation. It must be a non-negative integer where HIGHER = BETTER. Call window.Arcade.gameOver(finalScore) with EXACTLY the score the player sees on screen at game over — never pass level/lives/some other variable. Keep the on-screen score and the submitted score identical.
- Platform hooks (IMPORTANT): call window.Arcade.ready() once when the game is ready,
  and window.Arcade.gameOver(finalScore) every time a play ends. Support restarting via window.Arcade.onRestart(fn).
  Include this exact fallback near the top of your script so it also runs standalone:
    window.Arcade = window.Arcade || {ready:function(){},gameOver:function(){},submitScore:function(){},event:function(){},onPause:function(){},onResume:function(){},onRestart:function(){}};
- Use Canvas or DOM. Keep it light. No heavy loops that freeze the tab.
- Make it genuinely fun and polished: clear goal, responsive controls, juicy feedback, difficulty that ramps up.
- Japanese UI text. Dark, clean look. No emoji as UI icons (menus/buttons stay text).
- When editing an existing game, keep what already works and apply ONLY the requested change; return the FULL updated HTML.
- Do NOT include explanations or markdown fences — the "html" field is raw HTML only.

Quality & self-check (IMPORTANT — the game must actually run):
- Before finalizing, mentally simulate a full playthrough: start screen → several seconds of play → game over → restart. The game MUST be controllable and able to end.
- Ensure there are NO runtime errors: every variable/function is defined before use, no typos, no undefined references, no calls to APIs that don't exist. Balanced brackets/parentheses.
- Output the COMPLETE document. Never truncate. It MUST end with </html>.
- Keep the code reasonably small and robust so it can't freeze the tab.
- Write efficient, not-bloated code so the game runs smoothly on phones. You may implement richer mechanics when the design calls for it; just keep performance reasonable (avoid needless heavy loops or huge object counts).

Characters / sprites (IMPORTANT for looks):
- Do NOT use plain rectangles for characters. Give them a real look using EMOJI drawn on the canvas — they render natively, need no files, and work offline.
- Draw an emoji as a sprite like this:
    ctx.save(); ctx.font = size + "px serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("🐱", x, y); ctx.restore();
  (Set "size" to the sprite's pixel size; recompute on resize.)
- You MAY use any emoji that fits the game. A reliable palette to choose from:
  🐱 ねこ / 🐶 いぬ / 🐸 かえる / 🐤 ひよこ / 🦊 きつね / 🐙 たこ / 🐢 かめ / 🐝 はち /
  🍣 すし / 🍎 りんご / 🍩 ドーナツ / 🍄 きのこ / ⭐ スター / 💎 ジェム / 🪙 コイン /
  🔥 ほのお / ⚡ いなずま / 💣 ばくだん / 🚀 ロケット / ⚽ ボール
- If the conversation says the user picked specific 素材 (emoji), use THOSE as the main characters/objects.

Category:
- Also choose ONE best-fitting "category" from: アクション / パズル / シューティング / 反射神経 / よける / タイミング / 記憶 / レース / その他.

Reference example — study its STRUCTURE and POLISH and emulate it (states, resize, Arcade hooks + the fallback shim, touch+pointer input, the rAF loop, score, juicy feedback). Make a DIFFERENT game per the user's request; do NOT copy it verbatim:
` + "```html\n" + GOLD_EXAMPLE + "\n```";

const PLAN_SCHEMA = {
  type: "object",
  properties: {
    action: { type: "string", enum: ["ask", "build"] },
    reply: { type: "string" },
    options: { type: "array", items: { type: "string" } },
  },
  required: ["action", "reply"],
  additionalProperties: false,
};
const GAME_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    html: { type: "string" },
    category: {
      type: "string",
      enum: ["アクション", "パズル", "シューティング", "反射神経", "よける", "タイミング", "記憶", "レース", "その他"],
    },
  },
  required: ["title", "html", "category"],
  additionalProperties: false,
};

// ===== v2: 共通ランタイム方式 =====
// 定型部（キャンバス/ループ/オーバーレイ/入力/Arcade連携/エラー捕捉）はこちらが提供し、
// AIはゲームロジック(js)だけを書く。バグの温床を排除しつつ出力トークンも減らす。
const RUNTIME_TPL = `<!DOCTYPE html>
<html lang="ja"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,user-scalable=no,maximum-scale=1">
<title>__TITLE__</title>
<!--VAPPA_TPL1 __META__-->
<style>
*{margin:0;padding:0;box-sizing:border-box;-webkit-tap-highlight-color:transparent;-webkit-user-select:none;user-select:none;touch-action:none}
html,body{height:100%;overflow:hidden;background:#0f1322;font-family:"Hiragino Maru Gothic ProN",system-ui,sans-serif;color:#fff}
#vpc{position:fixed;inset:0;width:100%;height:100%;display:block;z-index:0}
/* vpstage＝論理480x720（2:3）の箱。HUD・オーバーレイ・ゲームDOMを全部この中に入れ、
   箱ごと実画面へ拡縮する（座標系はゲーム内で常に1つ） */
#vpstage{position:fixed;left:0;top:0;width:480px;height:720px;transform-origin:0 0;z-index:1;overflow:hidden}
#vpdom{position:absolute;inset:0;z-index:2;pointer-events:none;overflow:hidden}
#vpdom *{pointer-events:auto}
.vp-hud{position:absolute;top:0;left:0;right:0;display:flex;justify-content:space-between;align-items:center;padding:10px 12px 6px;pointer-events:none;z-index:5;font-weight:800;font-size:15px;text-shadow:0 2px 6px rgba(0,0,0,.6)}
.vp-hud span{background:rgba(8,12,26,.55);border:1px solid rgba(255,255,255,.13);border-radius:999px;padding:4px 12px}
.vp-hud span:empty{display:none}
.vp-ov{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;background:rgba(7,9,18,.86);text-align:center;padding:26px;z-index:10}
.vp-ov h1{font-size:28px}
.vp-ov p{color:#b9c1de;font-size:14.5px;line-height:1.8;max-width:340px;white-space:pre-line}
.vp-ov .vp-big{font-size:44px;font-weight:900;color:#ffd166}
.vp-btn{background:#ffd166;color:#3a2a00;border:0;border-radius:14px;padding:.85rem 1.9rem;font:inherit;font-weight:900;font-size:17px;box-shadow:0 5px 0 rgba(0,0,0,.25);touch-action:manipulation}
.vp-btn:active{transform:translateY(3px);box-shadow:0 2px 0 rgba(0,0,0,.25)}
.vp-toast{position:absolute;top:52px;left:50%;transform:translateX(-50%);background:rgba(18,24,44,.92);border:1px solid rgba(255,255,255,.16);border-radius:12px;padding:7px 15px;font-size:13px;font-weight:800;z-index:6;opacity:0;transition:opacity .25s;pointer-events:none;white-space:nowrap}
[hidden]{display:none!important}
</style>
<style id="vpcss">
/*__VAPPA_CSS__*/
__GAME_CSS__
/*__VAPPA_CSS_END__*/
</style>
</head><body>
<canvas id="vpc"></canvas>
<div id="vpstage">
  <div id="vpdom"></div>
  <div class="vp-hud" id="vphud" hidden><span id="vphl">0__UNIT__</span><span id="vphr"></span></div>
  <div class="vp-toast" id="vptoast"></div>
  <div class="vp-ov" id="vpov">
    <h1>__TITLE__</h1>
    <p>__HOWTO__</p>
    <button class="vp-btn" id="vpstart">スタート</button>
  </div>
</div>
<script id="vpimgs">
/* ユーザー素材画像 {名前:dataURL}。中身はビルド後にアプリが注入（AIには名前だけ渡る） */
window.__VP_IMGS=/*__VAPPA_IMGS__*/{}/*__VAPPA_IMGS_END__*/;
</script>
<script>
window.Arcade=window.Arcade||{ready:function(){},gameOver:function(){},submitScore:function(){},event:function(){},onPause:function(){},onResume:function(){},onRestart:function(){}};
var cv=document.getElementById("vpc"),ctx=cv.getContext("2d");
// iOS Safari は fillStyle がグラデーション/パターンのオブジェクトのままだと
// カラー絵文字を fillText できない（何も描かれない）。生成コードは
// 「背景をグラデで塗る→そのまま絵文字を描く」形を高頻度で書くため、
// 絵文字を含む fillText の間だけ fillStyle を単色に退避して確実に描く。
(function(){
  var _ft=ctx.fillText;
  function hasEmo(s){
    for(var i=0;i<s.length;i++){
      var c=s.charCodeAt(i);
      if((c>=0x2100&&c<=0x2BFF)||(c>=0xD800&&c<=0xDFFF)||c===0xFE0F)return true;
    }
    return false;
  }
  ctx.fillText=function(t,x,y,mw){
    var s=String(t);
    if(typeof this.fillStyle!=="string"&&hasEmo(s)){
      var f=this.fillStyle;this.fillStyle="#000";
      try{mw===undefined?_ft.call(this,s,x,y):_ft.call(this,s,x,y,mw);}
      finally{this.fillStyle=f;}
    }else{
      mw===undefined?_ft.call(this,s,x,y):_ft.call(this,s,x,y,mw);
    }
  };
})();
// 論理画面は 480x720（2:3）固定。全端末でこのサイズとして描き、ランタイムが
// vpstage（HUD・オーバーレイ・ゲームDOMを含む箱）ごと実画面へ拡縮する。
// ゲームコードは端末差を一切考えなくてよい（入力座標も論理系で届く）。
var W=480,H=720;
var __SC=1,__OX=0,__OY=0;   // 実画面変換：scale と余白オフセット（入力の逆変換にも使う）
(function(){
"use strict";
var DPR=Math.min(2,window.devicePixelRatio||1);
function rs(){
  var vw=window.innerWidth,vh=window.innerHeight;
  __SC=Math.min(vw/W,vh/H);
  __OX=(vw-W*__SC)/2;__OY=(vh-H*__SC)/2;
  cv.width=vw*DPR;cv.height=vh*DPR;
  ctx.setTransform(DPR*__SC,0,0,DPR*__SC,DPR*__OX,DPR*__OY);
  ctx.beginPath();ctx.rect(0,0,W,H);ctx.clip();   // 論理画面の外（レターボックス帯）には描かせない
  var st=document.getElementById("vpstage");
  if(st){st.style.transform="scale("+__SC+")";st.style.left=__OX+"px";st.style.top=__OY+"px";}
  if(typeof window.onResize==="function"){try{window.onResize();}catch(e){}}
}
window.addEventListener("resize",rs);rs();
// 実画面座標→論理座標（タッチ入力用）
function toLX(x){return (x-__OX)/__SC;}
function toLY(y){return (y-__OY)/__SC;}
var playing=false,paused=false,ended=false,crashed=false,floats=[],unit="__UNIT__";
// ユーザー素材画像のプリロード（Game.img(名前) で <img> を返す）
var IMGS={};(function(){var d=window.__VP_IMGS||{};for(var k in d){var m=new Image();m.src=d[k];IMGS[k]=m;}})();
var hud=document.getElementById("vphud"),hl=document.getElementById("vphl"),hr=document.getElementById("vphr");
var ov=document.getElementById("vpov"),toastEl=document.getElementById("vptoast"),tt=null,last=performance.now();
window.Game={
  img:function(n){return IMGS[n]||null;},
  score:function(n){hl.textContent=(n|0)+unit;},
  hud:function(t){hr.textContent=t==null?"":String(t);},
  float:function(x,y,t,c){floats.push({x:x,y:y,t:String(t),c:c||"#fff",age:0});},
  toast:function(t){toastEl.textContent=t;toastEl.style.opacity=1;clearTimeout(tt);tt=setTimeout(function(){toastEl.style.opacity=0;},2000);},
  over:function(s){
    if(!playing||ended)return;ended=true;playing=false;s=Math.max(0,Math.floor(Number(s)||0));
    ov.innerHTML='<h1>おわり！</h1><div class="vp-big">'+s+'<small style="font-size:20px">'+unit+'</small></div><button class="vp-btn" id="vpagain">もういちど</button>';
    ov.hidden=false;
    document.getElementById("vpagain").addEventListener("click",start);
    try{window.Arcade.gameOver(s);}catch(e){}
  }
};
function crash(e){
  if(crashed)return;crashed=true;playing=false;
  try{window.__VP_ERR=String(e&&(e.stack||e.message)||e).slice(0,600);}catch(x){}
  ov.innerHTML='<h1>😢 エラーが発生</h1><p>ゲームにエラーが起きました。<br>作成チャットで「エラーを直して」と伝えると修理できるよ。</p><button class="vp-btn" id="vpagain">もういちど</button>';
  ov.hidden=false;
  document.getElementById("vpagain").addEventListener("click",start);
}
function start(){
  floats=[];ended=false;crashed=false;
  try{window.init();}catch(e){crash(e);return;}
  window.Game.score(0);ov.hidden=true;hud.hidden=false;playing=true;last=performance.now();
}
document.getElementById("vpstart").addEventListener("click",start);
function fire(fn,x,y,id){
  if(!playing||paused)return;
  if(typeof window[fn]==="function"){try{window[fn](x,y,id);}catch(err){crash(err);}}
}
// pointer と touch を両対応（iOSのiframe内などpointerが飛ばない環境へのフォールバック）。
// pointerが一度でも来たらtouchは無視して二重発火を防ぐ。
var seenPointer=false;
window.addEventListener("pointerdown",function(e){seenPointer=true;fire("onDown",toLX(e.clientX),toLY(e.clientY),e.pointerId);fire("onMove",toLX(e.clientX),toLY(e.clientY),e.pointerId);});
window.addEventListener("pointermove",function(e){fire("onMove",toLX(e.clientX),toLY(e.clientY),e.pointerId);});
window.addEventListener("pointerup",function(e){fire("onUp",toLX(e.clientX),toLY(e.clientY),e.pointerId);});
// タッチの扱い（iOS対策の要点）：
//  - touchstart は preventDefault しない
//  - touchmove は非passiveで preventDefault → パン/スクロール横取りはこれで止まる
//  - touchend はボタン類「以外」でだけ preventDefault → iOSのダブルタップズーム
//    （touch-action:noneでは止まらない端末がある）を殺しつつ、ボタンの click 合成は守る
//  - pointerイベントが来る環境では発火だけ二重防止（seenPointer）
function tfire(fn,e){
  if(seenPointer)return;
  for(var i=0;i<e.changedTouches.length;i++){var t=e.changedTouches[i];fire(fn,toLX(t.clientX),toLY(t.clientY),t.identifier);
    if(fn==="onDown")fire("onMove",toLX(t.clientX),toLY(t.clientY),t.identifier);}
}
function uiTouch(e){var t=e.target;return !!(t&&t.closest&&t.closest("button,a,input,select,label"));}
window.addEventListener("touchstart",function(e){tfire("onDown",e);},{passive:true});
window.addEventListener("touchmove",function(e){if(e.cancelable)e.preventDefault();tfire("onMove",e);},{passive:false});
window.addEventListener("touchend",function(e){if(e.cancelable&&!uiTouch(e))e.preventDefault();tfire("onUp",e);},{passive:false});
document.addEventListener("gesturestart",function(e){e.preventDefault();});
window.addEventListener("mousedown",function(e){if(!seenPointer)fire("onDown",toLX(e.clientX),toLY(e.clientY),0);});
window.addEventListener("mousemove",function(e){if(!seenPointer)fire("onMove",toLX(e.clientX),toLY(e.clientY),0);});
window.addEventListener("mouseup",function(e){if(!seenPointer)fire("onUp",toLX(e.clientX),toLY(e.clientY),0);});
window.Arcade.onPause(function(){paused=true;});
window.Arcade.onResume(function(){paused=false;last=performance.now();});
window.Arcade.onRestart(start);
document.addEventListener("visibilitychange",function(){if(document.hidden){paused=true;}else{paused=false;last=performance.now();}});
function loop(now){
  requestAnimationFrame(loop);
  var dt=Math.min(0.05,(now-last)/1000);last=now;
  if(crashed)return;
  if(playing&&!paused){try{window.update(dt);}catch(e){crash(e);return;}}
  if(playing||ended){try{window.draw();}catch(e){crash(e);return;}}
  for(var i=floats.length-1;i>=0;i--){var f=floats[i];f.age+=dt;
    if(f.age>1){floats.splice(i,1);continue;}
    ctx.save();ctx.globalAlpha=Math.max(0,1-f.age);ctx.font="bold 16px sans-serif";ctx.textAlign="center";
    ctx.fillStyle=f.c;ctx.fillText(f.t,f.x,f.y-f.age*30);ctx.restore();}
}
requestAnimationFrame(loop);
window.Arcade.ready();
// 自動テストプレイ用フック：親(アプリ)がスモークテストで入力を一発流すのに使う
window.__vpTap=function(){
  fire("onDown",W/2,H/2,1);fire("onMove",W/2+40,H/2,1);fire("onUp",W/2+40,H/2,1);
};
})();
</script>
<script id="vpgame">
/*__VAPPA_JS__*/
__GAME_JS__
/*__VAPPA_JS_END__*/
</script>
</body></html>`;

// AIが返した部品を最終HTMLへ組み立てる。imgs はユーザー素材画像のJSON文字列（編集時に前の版から引き継ぐ）
function assembleGame(title: string, howto: string, unit: string, css: string, js: string, imgs?: string): string {
  const escH = (s: string) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const u = String(unit || "点").replace(/["'\\<>&]/g, "").slice(0, 6) || "点";
  const meta = encodeURIComponent(JSON.stringify({ t: title, h: howto, u: u }));
  let out = RUNTIME_TPL
    .split("__META__").join(meta)
    .split("__TITLE__").join(escH(title))
    .split("__HOWTO__").join(escH(howto))
    .split("__UNIT__").join(u)
    .split("__GAME_CSS__").join(css || "")
    .split("__GAME_JS__").join(js || "");
  // 画像JSONの差し込み（dataURLはbase64なので </script> 等は含まれ得ない。念のため検査）
  if (imgs && imgs !== "{}" && imgs.indexOf("</") < 0) {
    out = out.replace(/\/\*__VAPPA_IMGS__\*\/[\s\S]*?\/\*__VAPPA_IMGS_END__\*\//, "/*__VAPPA_IMGS__*/" + imgs + "/*__VAPPA_IMGS_END__*/");
  }
  return out;
}
// テンプレ形式のHTMLから部品を取り出す（編集用）。テンプレ形式でなければ null（旧方式で編集）
function extractTpl(html: string): { js: string; css: string; title: string; howto: string; unit: string; imgs: string } | null {
  const j = /\/\*__VAPPA_JS__\*\/([\s\S]*?)\/\*__VAPPA_JS_END__\*\//.exec(html);
  if (!j) return null;
  const c = /\/\*__VAPPA_CSS__\*\/([\s\S]*?)\/\*__VAPPA_CSS_END__\*\//.exec(html);
  const im = /\/\*__VAPPA_IMGS__\*\/([\s\S]*?)\/\*__VAPPA_IMGS_END__\*\//.exec(html);
  let meta: { t?: string; h?: string; u?: string } = {};
  const m = /<!--VAPPA_TPL1 ([^>]*?)-->/.exec(html);
  if (m) { try { meta = JSON.parse(decodeURIComponent(m[1])); } catch { /* noop */ } }
  return { js: j[1].trim(), css: c ? c[1].trim() : "", title: meta.t || "", howto: meta.h || "", unit: meta.u || "点", imgs: im ? im[1].trim() : "{}" };
}
// ゲームロジック(js)の静的チェック
function validateJs(js: string): string | null {
  const s = (js || "").trim();
  if (s.length < 300) return "ロジックが短すぎて未完成です";
  if (/<\/?(script|html|body|head)\b/i.test(s)) return "jsフィールドにHTMLタグが混入しています（純粋なJSコードのみ）";
  try { new Function(s); } catch (e) { return "JavaScriptの構文エラー: " + String((e as Error)?.message || e).slice(0, 120); }
  if (!/function\s+init\s*\(/.test(s)) return "function init() が定義されていません";
  if (!/function\s+update\s*\(/.test(s)) return "function update(dt) が定義されていません";
  if (!/function\s+draw\s*\(/.test(s)) return "function draw() が定義されていません";
  if (!/Game\s*\.\s*over\s*\(/.test(s)) return "Game.over(スコア) が呼ばれていません";
  const hasHook = /function\s+on(Down|Move|Up)\s*\(/.test(s);
  const hasTouchListener = /addEventListener\s*\(\s*["'](click|pointer|touch|mouse)/.test(s);
  if (!hasHook && !hasTouchListener) {
    return /key(down|up)/.test(s)
      ? "キーボード操作になっています。スマホでは操作できないので、onDown/onMove/onUp のタッチ操作に直してください"
      : "操作の入力（onDown/onMove/onUp）が見当たりません";
  }
  return null;
}

const GOLD_JS = `/* Example game logic (a catch game). Study the structure & polish; make a DIFFERENT game. */
var TUNE = {
  fallSpeed: { v: 150,  label: '落下の速さ',   min: 60,   max: 400,  step: 10 },
  accel:     { v: 7,    label: '加速ペース',   min: 0,    max: 30,   step: 1 },
  badRate:   { v: 0.18, label: '爆弾の割合',   min: 0,    max: 0.6,  step: 0.02 },
  spawnMin:  { v: 0.35, label: '出現間隔の下限', min: 0.15, max: 1,  step: 0.05 },
  lives:     { v: 3,    label: 'ライフ数',     min: 1,    max: 9,    step: 1 }
};
var basket, items, lives, score, fallSpeed, spawnT, shake;
function init(){
  basket = { x: W/2, w: Math.max(70, W*0.2) };
  items = []; lives = TUNE.lives.v; score = 0; fallSpeed = TUNE.fallSpeed.v; spawnT = 0.5; shake = 0;
  Game.hud('❤️'.repeat(lives));
}
function update(dt){
  spawnT -= dt;
  if (spawnT <= 0){
    items.push({ x: 30+Math.random()*(W-60), y: -20, r: 16, bad: Math.random() < TUNE.badRate.v });
    spawnT = Math.max(TUNE.spawnMin.v, 0.9 - score*0.008);
  }
  fallSpeed += dt*TUNE.accel.v;
  var by = H - 90;
  for (var i = items.length-1; i >= 0; i--){
    var it = items[i]; it.y += fallSpeed*dt;
    if (it.y > by-14 && it.y < by+24 && Math.abs(it.x-basket.x) < basket.w/2 + it.r){
      if (it.bad){ lives--; shake = 0.3; Game.hud('❤️'.repeat(Math.max(0,lives)));
        Game.float(it.x, by-22, '💥', '#f87171');
        if (lives <= 0){ Game.over(score); return; } }
      else { score++; Game.score(score); Game.float(it.x, by-24, '+1', '#ffd166'); }
      items.splice(i,1); continue;
    }
    if (it.y > H+30) items.splice(i,1);
  }
  if (shake > 0) shake -= dt;
}
function draw(){
  ctx.fillStyle = '#101528'; ctx.fillRect(0,0,W,H);
  var ox = shake > 0 ? (Math.random()*6-3) : 0;
  ctx.save(); ctx.translate(ox,0);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = "28px 'Apple Color Emoji','Noto Color Emoji',sans-serif";
  for (var i = 0; i < items.length; i++){ var it = items[i]; ctx.fillText(it.bad ? '💣' : '🍎', it.x, it.y); }
  ctx.font = "44px 'Apple Color Emoji','Noto Color Emoji',sans-serif";
  ctx.fillText('🧺', basket.x, H-78);
  ctx.restore();
}
function onDown(x,y){ basket.x = x; }
function onMove(x,y){ basket.x = Math.max(basket.w/2, Math.min(W-basket.w/2, x)); }`;

const BUILD2_SYSTEM = `You write ONLY the game-specific logic for a mobile HTML5 mini-game. The platform runtime already provides everything else — fullscreen canvas with devicePixelRatio handling, resize, the requestAnimationFrame loop, start/game-over/restart screens, score HUD, pause/resume, unified touch input, error capture, and score submission. Do NOT write any of that boilerplate.

Runtime globals you can use:
- cv, ctx : the game <canvas> and its 2d context.
- W, H : the logical screen size — ALWAYS exactly W=480, H=720 (2:3 portrait) on every device. The runtime scales your rendering to fit any real screen, so design for this one fixed canvas and never think about other sizes. Touch input arrives already converted to this 480x720 space.
- Game.score(n) : update the HUD score (non-negative integer).
- Game.over(finalScore) : end the play. MUST eventually be called, exactly with the same integer score the player sees. Higher = better.
- Game.hud(text) : right HUD slot for lives/level etc (e.g. "❤️❤️❤️"). Optional.
- Game.float(x,y,text,color) : small rising feedback text like "+1". Optional juice.
- Game.toast(text) : brief centered message. Optional.
- Game.img(name) : user-supplied image sprite as an <img> element, or null. ONLY when the conversation lists 素材画像 names (e.g. img1＝主人公の猫), draw them like:
    var m = Game.img("img1"); if (m) { ctx.drawImage(m, x-24, y-24, 48, 48); } else { /* emoji fallback */ }
  Use EXACTLY the listed names — never invent names. Keep aspect ratio sensible; images are square-ish sprites.

You MUST define these as top-level function declarations in "js":
- function init() { }        // (re)set ALL game state; called on start AND every restart — assign initial values here, not only at declaration
- function update(dt) { }    // advance simulation; dt is seconds (max 0.05)
- function draw() { }        // render; paint the full background first (runtime does not clear)
Optional hooks:
- function onDown(x,y,id) / onMove(x,y,id) / onUp(x,y,id)   // unified pointer input (works for touch)
- function onResize() { }    // recompute layout-dependent sizes

Output fields (structured):
- "title": short Japanese title
- "howto": 1-2 short Japanese lines for the start screen (how to play, goal)
- "unit": score unit shown in HUD/result, e.g. 点 / 秒 / 個 / 匹 / 人 / 段
- "css": extra CSS if needed, or "". The page is already a dark fullscreen canvas (#0f1322).
- "js": ONLY the game logic. No <script> tags, no HTML, no Arcade.* calls, no requestAnimationFrame, no canvas/resize setup, no start screens, no event registration for pointer (use the hooks). Plain ES5-compatible JavaScript.
- "category": one of アクション / パズル / シューティング / 反射神経 / よける / タイミング / 記憶 / レース / その他

Rules:
- Mobile-first touch gameplay via onDown/onMove/onUp. Big touch targets. Portrait friendly.
- INPUT IS TOUCH ONLY. Players are on phones: NEVER use keyboard events (keydown/keyup) as the primary control. Do NOT register your own pointer/touch listeners on window/canvas — the runtime already normalizes them into onDown/onMove/onUp (multi-touch: each finger calls the hook with its own id). DOM buttons you create may use click.
- Continuous actions (auto-fire, holding to move) belong in update(dt) driven by state that onDown/onUp toggles — don't rely on event repetition.
- Scoring uses the RANKING SCORE decided in the conversation; on-screen score and Game.over(score) must match.
- LAYOUT (screen is FIXED 480x720 — obey these numbers):
  - Keep ALL content inside x:0-480, y:56-712. The top 56px belongs to the HUD; NEVER place anything above y=56.
  - The playfield must actually USE the screen: spread content across at least 85% of the width and center it horizontally ((480-totalWidth)/2). Grids/panels: compute cell size from the available box, e.g. 3 columns → cell = (480 - margins*2 - gaps) / 3. Don't leave the bottom half empty — either extend the playfield or center the content block vertically.
  - Text: min font 14px, keep at least 16px from every edge.
  - NEVER draw your own score/time/lives readout on the canvas — the HUD already shows them (Game.score for score, Game.hud for time/lives). Hand-drawn digit displays are the #1 cause of broken-looking screens.
- No external resources, no network, no audio files, no imports. If the game is UI-heavy you MAY create DOM elements, but prefer canvas. DOM rules: append them to document.getElementById('vpdom') (a fixed 480x720 layer that scales with the canvas), position:absolute with coordinates in the SAME 480x720 space, z-index 1-4, create in init() and remove stale ones first (vpdom.innerHTML=''). Anything clickable MUST be a real <button> element (click on other elements is suppressed on touch devices).
- Characters/objects: do NOT use plain rectangles. Draw EMOJI sprites on canvas:
    ctx.font = size + "px 'Apple Color Emoji','Noto Color Emoji',sans-serif"; ctx.textAlign="center"; ctx.textBaseline="middle"; ctx.fillText("🐱", x, y);
  Write every emoji as a literal character (🐱 🪙 💣) — NEVER as a unicode escape or codepoint (no \\u, no String.fromCodePoint; they render as garbage text). If the conversation picked specific 素材 (emoji), use THOSE.
- Difficulty tuning: put EVERY gameplay-balance number (speeds, spawn intervals, lives, thresholds, ramp rates…) into ONE top-level TUNE object as the FIRST statement of "js":
    var TUNE = { key: { v: 150, label: "日本語ラベル", min: 60, max: 400, step: 10 }, ... };
  4-8 entries, label in Japanese, min/max = sensible playable range, step = adjustment granularity. Read values ONLY via TUNE.key.v (never repeat the literal elsewhere). The platform renders sliders from this object so humans can hand-tune difficulty without AI. When EDITING, keep the existing TUNE keys (current v values included) unless the request says otherwise.
- Make it genuinely fun and polished: clear goal, responsive controls, juicy feedback (Game.float / shake / particles), difficulty that ramps up.
- Japanese in-game text. Keep performance smooth on phones (no huge object counts).
- JSON safety: your ENTIRE output is one JSON object and "js" is a JSON string value. Keep the code JSON-friendly:
  - Use SINGLE quotes (') for every JS string literal — e.g. ctx.fillStyle = 'hsl(330,80%,' + l + '%)'. Then you never need to escape quotes inside the JSON.
  - The ONLY exception is the emoji font. Copy it EXACTLY like this (outer double quotes, escaped as \" in your JSON): ctx.font = "28px 'Apple Color Emoji','Noto Color Emoji',sans-serif"; — NEVER nest single quotes inside a single-quoted string.
  - Do NOT use regex literals or backslash escapes like \\d \\( in code (find another way); no literal newlines inside JS string literals. Emoji are fine.
- Self-check before finalizing: mentally run start → play → game over → restart. Every variable defined before use (restart calls init() again — stale state must be reset there). No undefined references. Balanced brackets.
- When EDITING an existing game: keep what works, apply ONLY the requested change, and return ALL fields complete (full js, not a diff).

` + "Example \"js\" field:\n```js\n" + GOLD_JS + "\n```";

const GAME_SCHEMA2 = {
  type: "object",
  properties: {
    title: { type: "string" },
    howto: { type: "string" },
    unit: { type: "string" },
    css: { type: "string" },
    js: { type: "string" },
    category: {
      type: "string",
      enum: ["アクション", "パズル", "シューティング", "反射神経", "よける", "タイミング", "記憶", "レース", "その他"],
    },
  },
  required: ["title", "howto", "unit", "css", "js", "category"],
  additionalProperties: false,
};

function json(o: unknown, status = 200) {
  return new Response(JSON.stringify(o), { status, headers: { ...CORS, "content-type": "application/json" } });
}

type Msg = { role: string; content: string };

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

// ===== レート制限（コスト/不正対策）=====
// 値はここで調整可。req=全リクエスト（相談含む）、bld=ゲーム生成/編集（高コスト）。
const LIMITS = {
  cooldownSec: 3,                          // 連打クールダウン（端末ごと）
  reqUser: 150, reqIp: 500, reqGlobal: 4000,   // 1日あたりのリクエスト上限
  bldUser: 15, bldIp: 60, bldGlobal: 250,      // 1日あたりのゲーム生成上限（IP=同一回線/全体=予算ガード）
};
const SUPA_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPA_SRV = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
// 管理者コード。リクエストの admin がこれと一致したらレート制限を全スキップ（=無制限）。
// 未設定なら管理者機能は無効（誰も無制限にならない）。Secretで設定・変更する。
const ADMIN_CODE = Deno.env.get("ADMIN_CODE") || "";

// ---- インスタンス寿命 ----
// Supabaseの実行上限(400秒)は「リクエストごと」ではなく「インスタンス起動から」の壁時計。
// 相談ターンで温まったインスタンスがビルドを拾うと持ち時間が目減りしており、
// 上限到達で黙って殺されると結果もエラーも書けない（=ユーザーに何も届かない）。
// そこで残り寿命を常に把握し、(1)自前タイムアウトを残り寿命内に収めて必ずエラーを書く、
// (2)ビルドは自己呼び出しで新しいインスタンスに回してフルの持ち時間を確保する。
const BOOT = Date.now();
const WALL_MS = 400000;
function remainMs(buffer = 20000) { return WALL_MS - (Date.now() - BOOT) - buffer; }

// Supabaseの ai_gate(RPC) を service_role で呼ぶ。テーブル/関数が無い等で失敗したら
// null を返す（=フェイルオープン：保護は効かないがアプリは止めない）。
async function gate(ub: string, ib: string, gb: string, umax: number, imax: number, gmax: number, cooldown: number) {
  if (!SUPA_URL || !SUPA_SRV) return null;
  try {
    const r = await fetch(SUPA_URL.replace(/\/$/, "") + "/rest/v1/rpc/ai_gate", {
      method: "POST",
      headers: { apikey: SUPA_SRV, Authorization: "Bearer " + SUPA_SRV, "content-type": "application/json" },
      body: JSON.stringify({ ub, ib, gb, umax, imax, gmax, cooldown }),
    });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}
// 日付バケットは日本時間(JST=UTC+9)基準。これでユーザー感覚どおり「日本の深夜0時」にリセットされる。
// （以前は toISOString=UTC基準で、リセットが実質 朝9時JST になっていた）
const today = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);

// req gate / build gate の結果を、クライアント向けの理由に変換
function limitReason(scope: "req" | "bld", g: { reason?: string } | null) {
  const r = g?.reason || "";
  if (r === "cooldown") return "cooldown";
  if (r === "global_daily") return "global_busy";
  if (r === "ip_daily") return "ip_limit";         // 同一回線（IP）の上限
  if (scope === "bld") return "daily_limit";       // 端末ごとの作成上限
  return "rate";                                    // req の user 上限
}

// ===== 生成ジョブ（非同期化）=====
// gen_jobs テーブルに service_role で読み書き。テーブルが無ければ null を返し、
// 呼び出し側は従来の同期（ストリーミング）にフォールバックする。
const JOBS_URL = SUPA_URL ? SUPA_URL.replace(/\/$/, "") + "/rest/v1/gen_jobs" : "";
const jobHeaders = { apikey: SUPA_SRV, Authorization: "Bearer " + SUPA_SRV, "content-type": "application/json" };
async function createJob(token: string): Promise<string | null> {
  if (!JOBS_URL || !SUPA_SRV) return null;
  try {
    const r = await fetch(JOBS_URL, { method: "POST", headers: { ...jobHeaders, Prefer: "return=representation" }, body: JSON.stringify({ token }) });
    if (!r.ok) return null;
    const rows = await r.json();
    return Array.isArray(rows) && rows[0] ? rows[0].id : null;
  } catch { return null; }
}
async function finishJob(id: string, result: unknown) {
  if (!JOBS_URL || !SUPA_SRV) return;
  try {
    await fetch(JOBS_URL + "?id=eq." + encodeURIComponent(id), { method: "PATCH", headers: jobHeaders, body: JSON.stringify({ result }) });
  } catch { /* ignore */ }
}
async function getJob(id: string): Promise<{ result: unknown; created_at: string } | null> {
  if (!JOBS_URL || !SUPA_SRV) return null;
  try {
    const r = await fetch(JOBS_URL + "?id=eq." + encodeURIComponent(id) + "&select=result,created_at", { headers: jobHeaders });
    if (!r.ok) return null;
    const rows = await r.json();
    return Array.isArray(rows) && rows[0] ? rows[0] : null;
  } catch { return null; }
}
// ai_usage の当日カウントを読む（加算しない）。テーブルが無ければ null。
async function readUsage(bucket: string): Promise<number | null> {
  if (!SUPA_URL || !SUPA_SRV) return null;
  try {
    const r = await fetch(SUPA_URL.replace(/\/$/, "") + "/rest/v1/ai_usage?bucket=eq." + encodeURIComponent(bucket) + "&select=n", { headers: jobHeaders });
    if (!r.ok) return null;
    const rows = await r.json();
    return Array.isArray(rows) ? (rows[0] ? (rows[0].n || 0) : 0) : null;
  } catch { return null; }
}

// 生成HTMLの自動チェック（実行はしないが「全く動かない」系を静的に検出）。
// 問題があれば理由を返す。OKなら null。
function validateGame(html: string): string | null {
  const h = (html || "").trim();
  if (h.length < 300) return "出力が短すぎて未完成です";
  if (!/<\/html>\s*$/i.test(h)) return "HTMLが途中で切れています（</html>で終わっていない）";
  // <script src=...> を除く、インラインscriptのJS構文をチェック
  const scripts: string[] = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(h)) !== null) { if (!/\bsrc\s*=/i.test(m[1])) scripts.push(m[2]); }
  if (!scripts.length) return "ゲームのスクリプトがありません";
  for (const code of scripts) {
    if (!code.trim()) continue;
    try { new Function(code); }                    // コンパイルのみ（実行はしない）＝構文エラー/途中切れを検出
    catch (e) { return "JavaScriptの構文エラー: " + String((e as Error)?.message || e).slice(0, 120); }
  }
  if (!/Arcade\s*\.\s*gameOver/.test(h)) return "ゲーム終了の通知(Arcade.gameOver)が呼ばれていません";
  if (!/Arcade\s*\.\s*ready/.test(h)) return "開始通知(Arcade.ready)が呼ばれていません";
  // 操作できる入力が無いゲームは壊れ（タップ/スワイプ/キー等のいずれか必須）
  if (!/(touchstart|touchmove|touchend|pointerdown|pointermove|pointerup|mousedown|mousemove|keydown|click)/i.test(h))
    return "操作の入力（タップ/スワイプ/キー等）が見当たりません";
  // canvasを使うのに描画コンテキストを取っていない＝高確率で壊れ
  if (/<canvas/i.test(h) && !/getContext/.test(h)) return "canvasがありますが getContext を取得していません";
  // アニメ/タイマーが全く無い＝動かない可能性（イベント駆動のみは稀なので緩めに）
  if (!/(requestAnimationFrame|setInterval|setTimeout)/.test(h)) return "ゲームループ/タイマーが見当たりません";
  return null;
}

// 本生成（重い1回）。生成→自動チェック→ダメなら1回だけ自動修正。
// spec で使用モデルを差し替え可能（管理者テスト用。既定は本番モデル）。
async function buildOnce(key: string, messages: Msg[], prevHtml: string, spec?: ModelSpec, userSpec?: string) {
  const mspec = spec || specFor();
  const t0 = Date.now();
  const acc: Array<{ model: string; usage: Usage }> = [];   // トークン使用量を集計（コスト算出用）
  const done = (reply: string, title: string, html: string, category: string, specText: string) => ({
    action: "build", reply, title, html, category, model: specLabel(mspec), cost: computeCost(acc),
    sec: Math.round((Date.now() - t0) / 1000), spec: specText || undefined,
  });
  // 実行上限(400秒)まで黙って殺される前に、インスタンスの残り寿命内で自前タイムアウトさせる。
  const mainTmo = Math.max(30000, Math.min(380000, remainMs()));
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const instruction = (lastUser?.content || "").trim();
  const tpl = prevHtml ? extractTpl(prevHtml) : null;

  // ---- 旧形式ゲーム（テンプレ導入前）の編集：従来どおりHTML全文を書き直す ----
  if (prevHtml && !tpl) {
    const uc = "次の既存ゲーム(HTML)を、下の指示に従って修正してください。修正後の完全な単一HTMLだけを返し、タイトルも内容に合わせて更新してOKです。\n\n【指示】\n" +
      instruction + "\n\n【既存HTML】\n" + prevHtml;
    const g = await callBuild(key, mspec, BUILD_SYSTEM, [{ role: "user", content: uc }], GAME_SCHEMA, mainTmo, acc);
    if (!g.html) return { error: "empty_html" };
    let title = g.title || "無題のゲーム", html = g.html, category = g.category || "その他";
    const problem = validateGame(html);
    const fixTmo0 = Math.min(150000, remainMs());
    if (problem && (Date.now() - t0) < 180000 && fixTmo0 > 45000) {
      try {
        const fixUser = "あなたが作った次のHTMLゲームに問題が見つかりました：「" + problem +
          "」。原因を必ず直し、最後まで完結した完全な単一HTMLだけを返してください（</html>まで）。タイトルは維持。\n\n【HTML】\n" + html;
        const g2 = await callBuild(key, mspec, BUILD_SYSTEM, [{ role: "user", content: fixUser }], GAME_SCHEMA, fixTmo0, acc);
        if (g2.html) { html = g2.html; title = g2.title || title; category = g2.category || category; }
      } catch { /* 修正に失敗したら元の生成結果をそのまま返す */ }
    }
    return done("直したよ！", title, html, category, "");
  }

  // ---- v2：共通ランタイム方式（新規作成／テンプレ形式ゲームの編集） ----
  let userContent: string, reply: string, specText = "";
  if (tpl) {
    userContent = "プラットフォームのランタイム上で動く既存ミニゲームのロジックを、指示に従って修正してください。" +
      "動いている部分は保ち、指示された変更だけを適用。全フィールド（title/howto/unit/css/js）を完全な形で返す。\n\n【指示】\n" + instruction +
      "\n\n【現在のtitle】" + tpl.title + "\n【現在のhowto】" + tpl.howto + "\n【現在のunit】" + tpl.unit +
      "\n\n【現在のcss】\n" + (tpl.css || "(なし)") + "\n\n【現在のjs】\n" + tpl.js;
    reply = "直したよ！";
  } else {
    const transcript = messages.map((mm) => (mm.role === "user" ? "ユーザー: " : "AI: ") + mm.content).join("\n");
    // 設計書：ユーザーが確認・編集済みのものがあればそれを最優先。
    // 無ければ相談ログを賢いモデルで設計書に整理してからビルド（一発ヒット率を上げる）。
    if (userSpec) { specText = userSpec; }
    else {
      try {
        const sres = await callClaude(key, SPEC_SYSTEM, [{ role: "user", content: transcript }], SPEC_SCHEMA, true, 60000, acc,
          { provider: "anthropic", model: "claude-sonnet-5", effort: "low" });
        specText = String(sres.spec || "").slice(0, 6000);
      } catch { /* noop */ }
    }
    userContent = specText
      ? "次の仕様書どおりに、ミニゲームのロジックを作ってください。\n\n【仕様書】\n" + specText +
        "\n\n【元の相談ログ（仕様書に無い点の補足として参照）】\n" + transcript
      : "次の相談で決まった内容で、ミニゲームのロジックを作ってください。\n\n【相談ログ】\n" + transcript;
    reply = "作ったよ！";
  }
  let g = await callBuild(key, mspec, BUILD2_SYSTEM, [{ role: "user", content: userContent }], GAME_SCHEMA2, mainTmo, acc);
  if (!g || !g.js) return { error: "empty_html" };
  // 自動チェック → 問題があれば1回だけAIに直させる（jsだけなので修正も安い）
  const problem2 = validateJs(g.js);
  const fixTmo = Math.min(150000, remainMs());
  if (problem2 && (Date.now() - t0) < 180000 && fixTmo > 45000) {
    try {
      const fixUser = "あなたが書いたゲームロジック(js)に問題が見つかりました：「" + problem2 +
        "」。原因を必ず直し、全フィールド（title/howto/unit/css/js/category）を完全な形で返してください。\n\n【title】" + (g.title || "") +
        "\n【howto】" + (g.howto || "") + "\n【unit】" + (g.unit || "") + "\n\n【css】\n" + (g.css || "") + "\n\n【js】\n" + g.js;
      const g2 = await callBuild(key, mspec, BUILD2_SYSTEM, [{ role: "user", content: fixUser }], GAME_SCHEMA2, fixTmo, acc);
      if (g2 && g2.js && !validateJs(g2.js)) g = g2;
    } catch { /* 修正に失敗したら元の生成結果をそのまま返す */ }
  }
  const title2 = g.title || "無題のゲーム";
  const html2 = assembleGame(title2, g.howto || "ハイスコアを目指そう！", g.unit || "点", g.css || "", g.js, tpl ? tpl.imgs : "{}");
  return done(reply, title2, html2, g.category || "その他", specText);
}
// callClaude 例外をクライアント向けエラーへ変換
function buildErr(e: unknown) {
  const s = String((e as Error)?.message || e);
  if (s.indexOf("refused") >= 0) return { error: "refused" };
  if (s === "timeout") return { error: "timeout" };   // 自前タイムアウト＝時間切れとして通知
  if (/credit balance is too low/i.test(s)) return { error: "insufficient_credit" };
  // テストモデルのAPIキー未設定（管理者向け：Supabase Secrets に該当キーを追加する）
  if (s.indexOf("missing_env:") >= 0) return { error: "generate_error", detail: s.slice(0, 200) };
  return { error: "generate_error", detail: s.slice(0, 200) };
}

// フェーズごとのモデル（コスト最適化）：
//   相談・質問役（think=false）→ Haiku（安い・速い）
//   ゲーム本生成・修正（think=true）→ 既定は specFor() = DeepSeek V4 Flash・思考high
//   （MODELS.build は anthropic 呼び出しの後方互換フォールバックとして残す）
const MODELS = { plan: "claude-haiku-4-5-20251001", build: "claude-opus-4-8" };

// ---- モデル一覧（管理者はチャットから差替え可能。既定は specFor() を参照）----
// provider ごとに呼び出しを実装（anthropic / openai / gemini / deepseek）。
// anthropic 以外は envKey のシークレット（Supabase の Edge Function Secrets）が必要。
// モデルIDが変わったらここを書き換えるだけでよい。
type ModelSpec = { provider: "anthropic" | "openai" | "gemini" | "deepseek" | "xai"; model: string; effort?: string; envKey?: string };
const TEST_MODELS: Record<string, ModelSpec> = {
  "opus":     { provider: "anthropic", model: "claude-opus-4-8", effort: "medium" },
  "opus-h":   { provider: "anthropic", model: "claude-opus-4-8", effort: "high" },
  "opus-x":   { provider: "anthropic", model: "claude-opus-4-8", effort: "xhigh" },
  "sonnet-m": { provider: "anthropic", model: "claude-sonnet-5", effort: "medium" },
  "sonnet-h": { provider: "anthropic", model: "claude-sonnet-5", effort: "high" },
  "sonnet-x": { provider: "anthropic", model: "claude-sonnet-5", effort: "xhigh" },   // 安い×最高effortの検証用
  // DeepSeek V4：2モデル（flash 激安 / pro 上位）× 思考オフ・high・max の6択。
  // effort 未指定＝思考オフ（thinking disabled）、effort ありは reasoning_effort として送る。
  "ds-flash":   { provider: "deepseek", model: "deepseek-v4-flash", envKey: "DEEPSEEK_API_KEY" },                    // Flash・思考オフ（最速最安）
  "ds-flash-h": { provider: "deepseek", model: "deepseek-v4-flash", effort: "high", envKey: "DEEPSEEK_API_KEY" },   // Flash・思考high
  "ds-flash-x": { provider: "deepseek", model: "deepseek-v4-flash", effort: "max",  envKey: "DEEPSEEK_API_KEY" },   // Flash・思考max
  "ds-pro":     { provider: "deepseek", model: "deepseek-v4-pro",   envKey: "DEEPSEEK_API_KEY" },                    // Pro・思考オフ
  "ds-pro-h":   { provider: "deepseek", model: "deepseek-v4-pro",   effort: "high", envKey: "DEEPSEEK_API_KEY" },   // Pro・思考high
  "ds-pro-x":   { provider: "deepseek", model: "deepseek-v4-pro",   effort: "max",  envKey: "DEEPSEEK_API_KEY" },   // Pro・思考max（全力）
  "gemini":   { provider: "gemini",    model: "gemini-2.5-pro",  envKey: "GEMINI_API_KEY" },
  "gpt":      { provider: "openai",    model: "gpt-5.1",         envKey: "OPENAI_API_KEY" },
  "grok":     { provider: "xai",       model: "grok-4.3",        envKey: "XAI_API_KEY" },   // フラッグシップ（$1.25/$2.5）
  "grok-b":   { provider: "xai",       model: "grok-build-0.1",  envKey: "XAI_API_KEY" },   // アプリ構築特化（$1/$2）
  "grok-45":  { provider: "xai",       model: "grok-4.5",        envKey: "XAI_API_KEY" },   // 最新上位（$2/$6）
};
// 管理者の指定キーを ModelSpec に解決（未指定/不明/非管理者は本番モデル）
// 本番既定 = DeepSeek V4 Flash・思考high（PDCA計測 102-103/110・1本約¥1）
function specFor(testModel?: string): ModelSpec {
  return (testModel && TEST_MODELS[testModel]) || TEST_MODELS["ds-flash-h"];
}
// 表示用ラベル（モデル名＋思考レベル）。チャットのモデル表記と管理者のコスト表示に使う
function specLabel(s: ModelSpec): string {
  if (s.provider === "anthropic" && s.effort) return s.model + "（effort: " + s.effort + "）";
  if (s.provider === "deepseek") return s.model + (s.effort ? "（思考: " + s.effort + "）" : "（思考なし）");
  return s.model;
}

// 1ドル=円（コスト表示用の概算レート）
const USD_JPY = 160;
// モデル別の単価（1Mトークンあたり、入力/出力ドル）。cache_read=入力×0.1, cache_write=入力×1.25。
const PRICES: Record<string, { in: number; out: number }> = {
  "claude-opus-4-8": { in: 5, out: 25 },
  // Sonnet 5 は導入割引中：入力$2/出力$10（2026-08-31まで）。以降は $3/$15 に戻すこと。
  "claude-sonnet-5": { in: 2, out: 10 },
  "claude-sonnet-4-6": { in: 3, out: 15 },
  "claude-haiku-4-5-20251001": { in: 1, out: 5 },
  // 他社モデル（概算単価。改定されたらここを更新）
  "gemini-2.5-pro": { in: 1.25, out: 10 },
  "gpt-5.1": { in: 1.25, out: 10 },
  // DeepSeek V4（公式 pricing。cache_read は入力×0.02 相当だが概算は cache_read=入力×0.1 の共通式に委ねる）
  "deepseek-v4-flash": { in: 0.14, out: 0.28 },
  "deepseek-v4-pro": { in: 0.435, out: 0.87 },
  // xAI（/v1/models の実売単価。改定されたらここを更新）
  "grok-4.3": { in: 1.25, out: 2.5 },
  "grok-build-0.1": { in: 1, out: 2 },
  "grok-4.5": { in: 2, out: 6 },
};
type Usage = { input_tokens?: number; output_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number };
function computeCost(acc: Array<{ model: string; usage: Usage }>) {
  let usd = 0, tin = 0, tout = 0, tcr = 0, tcw = 0;
  for (const c of acc) {
    const p = PRICES[c.model] || { in: 5, out: 25 };
    const u = c.usage || {};
    const inp = u.input_tokens || 0, out = u.output_tokens || 0;
    const cw = u.cache_creation_input_tokens || 0, cr = u.cache_read_input_tokens || 0;
    usd += (inp * p.in + cw * p.in * 1.25 + cr * p.in * 0.1 + out * p.out) / 1e6;
    tin += inp; tout += out; tcw += cw; tcr += cr;
  }
  return { usd: Math.round(usd * 1e4) / 1e4, jpy: Math.round(usd * USD_JPY * 100) / 100, in: tin, out: tout, cache_w: tcw, cache_r: tcr };
}

// 429 / 5xx / ネットワーク断は一時的なので最大3回までリトライ（503 upstream connect error 対策）
// spec を渡すと think時のモデル/effort を差し替えられる（管理者テスト用）
async function callClaude(key: string, system: string, messages: Msg[], schema: unknown, think: boolean, timeoutMs?: number, acc?: Array<{ model: string; usage: Usage }>, spec?: ModelSpec) {
  const tmo = timeoutMs || (think ? 100000 : 30000);
  const body: Record<string, unknown> = {
    model: (spec && spec.model) || (think ? MODELS.build : MODELS.plan),
    max_tokens: think ? 16000 : 1024,
    // システムプロンプト（見本込みで長い）はプロンプトキャッシュに載せ、2回目以降の入力コストを大幅減
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    messages,
    output_config: think
      ? { effort: (spec && spec.effort) || "medium", format: { type: "json_schema", schema } }
      : { format: { type: "json_schema", schema } },
  };
  if (think) body.thinking = { type: "adaptive" };

  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    let r: Response;
    // 1回の呼び出しが長すぎてジョブ全体が実行上限を超えないよう、各試行にタイムアウトを付ける
    const ctrl = new AbortController();
    const timer = setTimeout(() => { try { ctrl.abort(); } catch { /* noop */ } }, tmo);
    try {
      r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
    } catch (e) {
      if ((e as Error)?.name === "AbortError") throw new Error("timeout");  // 自前タイムアウトはリトライせず即終了
      lastErr = new Error("network:" + String(e).slice(0, 120));
      await sleep(700 * (attempt + 1));
      continue;
    } finally { clearTimeout(timer); }
    if (r.status === 429 || r.status >= 500) {
      const t = await r.text();
      lastErr = new Error("anthropic:" + r.status + ":" + t.slice(0, 160));
      await sleep(700 * (attempt + 1));
      continue;
    }
    if (!r.ok) { const t = await r.text(); throw new Error("anthropic:" + r.status + ":" + t.slice(0, 200)); }
    const data = await r.json();
    if (acc && data && data.usage) acc.push({ model: String(body.model), usage: data.usage });
    if (data.stop_reason === "refusal") throw new Error("refused");
    const text = (data.content || []).filter((b: { type: string }) => b.type === "text").map((b: { text: string }) => b.text).join("");
    return JSON.parse(text);
  }
  throw lastErr || new Error("ai_unavailable");
}

// ---- 他社プロバイダ用の共通部品 ----
// マークダウンのフェンス等が混ざっても JSON を取り出せる緩いパーサ
function parseJsonLoose(text: string) {
  const t = String(text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const s = t.indexOf("{"), e = t.lastIndexOf("}");
  if (s < 0 || e <= s) throw new Error("no_json_in_response");
  const body = t.slice(s, e + 1);
  try { return JSON.parse(body); } catch { /* 下で修復を試みる */ }
  // 修復1: 不正なバックスラッシュエスケープ（例: コード中の \d \( 等をそのまま出してくる）を \\ に直す。
  // 有効なエスケープ(\\ \" \/ \b \f \n \r \t \uXXXX)はそのまま残す。
  let fixed = body.replace(/\\(?![\\"/bfnrtu])/g, "\\\\");
  try { return JSON.parse(fixed); } catch { /* 修復2へ */ }
  // 修復2: 文字列内の生改行/タブをエスケープ ＋ 修復3: エスケープ漏れの内側クォート
  // （例: コメントに "跳び越えると+1点" と生の二重引用符で引用してくる）。
  // 文字列中の " は、直後の非空白が , } ] : か終端なら「閉じ」、それ以外は内側の生クォートとみなして \" に直す。
  let out = "", inStr = false, esc = false;
  for (let i = 0; i < fixed.length; i++) {
    const ch = fixed[i];
    if (esc) { out += ch; esc = false; continue; }
    if (ch === "\\") { out += ch; esc = true; continue; }
    if (ch === '"') {
      if (!inStr) { inStr = true; out += ch; continue; }
      let j = i + 1;
      while (j < fixed.length && (fixed[j] === " " || fixed[j] === "\n" || fixed[j] === "\r" || fixed[j] === "\t")) j++;
      const nx = j < fixed.length ? fixed[j] : "";
      if (nx === "," || nx === "}" || nx === "]" || nx === ":" || nx === "") { inStr = false; out += ch; }
      else { out += '\\"'; }   // 内側の生クォート
      continue;
    }
    if (inStr && ch === "\n") { out += "\\n"; continue; }
    if (inStr && ch === "\r") { out += "\\r"; continue; }
    if (inStr && ch === "\t") { out += "\\t"; continue; }
    out += ch;
  }
  return JSON.parse(out);
}
// スキーマ遵守の指示（他社はAnthropicの json_schema 相当が無い/形式が違うのでプロンプトで指定）
function schemaNote(schema: unknown) {
  return "\n\n【出力形式】必ず次のJSONスキーマに一致する単一のJSONオブジェクトのみを返すこと。マークダウンのコードフェンスや前置きは禁止。\n" + JSON.stringify(schema);
}
// 429/5xx を1回だけリトライする小さなfetch（テスト経路なのでシンプルに）
async function postOnce(url: string, headers: Record<string, string>, body: unknown, tmo: number): Promise<Record<string, unknown>> {
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => { try { ctrl.abort(); } catch { /* noop */ } }, tmo);
    try {
      const r = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal: ctrl.signal });
      if (r.status === 429 || r.status >= 500) { lastErr = new Error("upstream:" + r.status + ":" + (await r.text()).slice(0, 160)); await sleep(800); continue; }
      if (!r.ok) throw new Error("upstream:" + r.status + ":" + (await r.text()).slice(0, 200));
      return await r.json();
    } catch (e) {
      if ((e as Error)?.name === "AbortError") throw new Error("timeout");
      if (String((e as Error)?.message || "").startsWith("upstream:4")) throw e;
      lastErr = e as Error; await sleep(800);
    } finally { clearTimeout(timer); }
  }
  throw lastErr || new Error("ai_unavailable");
}

// OpenAI / DeepSeek / xAI（chat completions 互換）
async function callOpenAICompat(spec: ModelSpec, system: string, messages: Msg[], schema: unknown, timeoutMs: number, acc?: Array<{ model: string; usage: Usage }>) {
  const key = Deno.env.get(spec.envKey || "");
  if (!key) throw new Error("missing_env:" + spec.envKey);
  const url = spec.provider === "deepseek" ? "https://api.deepseek.com/chat/completions"
    : spec.provider === "xai" ? "https://api.x.ai/v1/chat/completions"
    : "https://api.openai.com/v1/chat/completions";
  const body: Record<string, unknown> = {
    model: spec.model,
    messages: [{ role: "system", content: system + schemaNote(schema) }, ...messages],
    response_format: { type: "json_object" },   // DeepSeek V4・xAI・GPT いずれも JSON 構造化出力に対応
  };
  if (spec.provider === "deepseek") {
    // V4：effort ありは思考ON（reasoning_effort）、なしは思考OFF。どちらも response_format 対応。
    if (spec.effort) body.reasoning_effort = spec.effort;
    else body.thinking = { type: "disabled" };
    body.max_tokens = 16000;   // 思考分も含むので広めに
  } else if (spec.provider === "xai") {
    body.max_tokens = 16000;   // xAI は max_tokens（思考分も含む）
  } else {
    body.max_completion_tokens = 16000;   // GPT-5系は max_completion_tokens（temperature等は送らない）
  }
  const data = await postOnce(url, { "content-type": "application/json", "authorization": "Bearer " + key }, body, timeoutMs);
  const u = (data as { usage?: { prompt_tokens?: number; completion_tokens?: number } }).usage;
  if (acc && u) acc.push({ model: spec.model, usage: { input_tokens: u.prompt_tokens || 0, output_tokens: u.completion_tokens || 0 } });
  const choices = (data as { choices?: Array<{ message?: { content?: string } }> }).choices;
  return parseJsonLoose(choices?.[0]?.message?.content || "");
}

// Google Gemini（generateContent）
async function callGemini(spec: ModelSpec, system: string, messages: Msg[], schema: unknown, timeoutMs: number, acc?: Array<{ model: string; usage: Usage }>) {
  const key = Deno.env.get(spec.envKey || "");
  if (!key) throw new Error("missing_env:" + spec.envKey);
  const url = "https://generativelanguage.googleapis.com/v1beta/models/" + spec.model + ":generateContent";
  const body = {
    systemInstruction: { parts: [{ text: system + schemaNote(schema) }] },
    contents: messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
    generationConfig: { responseMimeType: "application/json", maxOutputTokens: 32000 },
  };
  const data = await postOnce(url, { "content-type": "application/json", "x-goog-api-key": key }, body, timeoutMs);
  const um = (data as { usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number } }).usageMetadata;
  if (acc && um) acc.push({ model: spec.model, usage: { input_tokens: um.promptTokenCount || 0, output_tokens: (um.candidatesTokenCount || 0) + (um.thoughtsTokenCount || 0) } });
  const cands = (data as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }).candidates;
  return parseJsonLoose((cands?.[0]?.content?.parts || []).map((p) => p.text || "").join(""));
}

// build 呼び出しのディスパッチ（provider ごとに振り分け）
function callBuild(key: string, spec: ModelSpec, system: string, messages: Msg[], schema: unknown, timeoutMs: number, acc?: Array<{ model: string; usage: Usage }>) {
  if (spec.provider === "gemini") return callGemini(spec, system, messages, schema, timeoutMs, acc);
  if (spec.provider === "openai" || spec.provider === "deepseek" || spec.provider === "xai") return callOpenAICompat(spec, system, messages, schema, timeoutMs, acc);
  return callClaude(key, system, messages, schema, true, timeoutMs, acc, spec);
}

// 受付：レート制限＋相談（プランナー）。結果がすぐ返せるものは immediate、
// 重いビルドへ進む場合は { build:true } を返す。
async function startFlow(key: string, messages: Msg[], prevHtml: string, token: string, ip: string, isAdmin: boolean, forceBuild: boolean): Promise<{ immediate?: unknown; build?: boolean }> {
  const d = today();

  // 「作り始める」ボタンが押された＝ここで初めて Opus ビルドへ進む（生成カウント消費）。
  if (forceBuild) {
    if (!isAdmin) {
      const bgt = await gate("u:bld:" + token + ":" + d, "i:bld:" + ip + ":" + d, "g:bld:" + d, LIMITS.bldUser, LIMITS.bldIp, LIMITS.bldGlobal, 0);
      if (bgt && bgt.allowed === false) return { immediate: { error: "rate_limited", reason: limitReason("bld", bgt) } };
    }
    return { build: true };
  }

  // 相談ターン（軽量）。管理者はレート制限スキップ。
  if (!isAdmin) {
    const rg = await gate("u:req:" + token + ":" + d, "i:req:" + ip + ":" + d, "g:req:" + d, LIMITS.reqUser, LIMITS.reqIp, LIMITS.reqGlobal, LIMITS.cooldownSec);
    if (rg && rg.allowed === false) return { immediate: { error: "rate_limited", reason: limitReason("req", rg), retry_sec: rg.retry_sec } };
  }
  // 新規も編集も、まずプランナー(Haiku)で相談。準備OKでも自動ではビルドしない。
  // 編集時は現在のゲームのコードをシステムプロンプト側に添付（cache_controlの後ろ側に
  // 乗るので、同じゲームについての2ターン目以降はキャッシュ読みでほぼタダになる）。
  const planSystem = prevHtml
    ? PLAN_EDIT_SYSTEM + "\n\n===== 現在のゲームのコード（HTML/JS 全文）=====\n" + prevHtml
    : PLAN_SYSTEM;
  let plan;
  try { plan = await callClaude(key, planSystem, messages, PLAN_SCHEMA, false); }
  catch (e) { return { immediate: buildErr(e) }; }
  if (plan.action === "build") {
    // 準備完了。ここでは作らず、クライアントに「作り始める」ボタンを出させる。
    return { immediate: { action: "ready", reply: plan.reply || "準備OK！この内容で作り始めていい？" } };
  }
  return { immediate: { action: "ask", reply: plan.reply || "どんな感じにする？", options: Array.isArray(plan.options) ? plan.options.slice(0, 4) : [] } };
}

// ---- ビルドの自己呼び出し（内部プロトコル）----
// 受付インスタンスは相談ターンで寿命を消費していることが多いので、ビルド本体は
// 自分自身をもう一度呼び出して新しいインスタンスに任せる（フルの持ち時間を確保）。
// k にサービスロールキーを要求するので外部からは実行できない。
type IRun = { k?: string; job?: string; messages?: Msg[]; prevHtml?: string; spec?: ModelSpec; uspec?: string; hop?: number };
const FN_SELF = SUPA_URL ? SUPA_URL.replace(/\/$/, "") + "/functions/v1/generate" : "";
async function dispatchRun(payload: IRun): Promise<boolean> {
  if (!FN_SELF || !SUPA_SRV) return false;
  try {
    const r = await fetch(FN_SELF, {
      method: "POST",
      headers: { "content-type": "application/json", apikey: SUPA_SRV, Authorization: "Bearer " + SUPA_SRV },
      body: JSON.stringify({ irun: payload }),
    });
    return r.ok;
  } catch { return false; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return json({ error: "missing_api_key" }, 500);

  let messages: Msg[] = [], prevHtml = "", token = "?", jobId = "", wantUsage = false, isAdmin = false, forceBuild = false, testModel = "";
  let irun: IRun | null = null, wantSpec = false, uspec = "";
  try {
    const b = await req.json();
    if (b && typeof b.irun === "object" && b.irun) irun = b.irun as IRun;
    if (b?.makeSpec === true) wantSpec = true;               // 設計書だけ作る（生成カウント消費なし）
    if (typeof b?.spec === "string") uspec = b.spec.slice(0, 8000);   // ユーザー確認・編集済みの設計書
    if (typeof b?.job === "string") jobId = b.job;
    if (b?.usage === true) wantUsage = true;
    if (b?.build === true) forceBuild = true;   // 「作り始める」ボタン＝ここでだけ Opus が動く
    if (typeof b?.model === "string") testModel = b.model.slice(0, 30);   // 管理者のみ有効（下で判定）
    // 管理者判定：コードが設定済みで、リクエストの admin と一致したときだけ true
    if (ADMIN_CODE && typeof b?.admin === "string" && b.admin === ADMIN_CODE) isAdmin = true;
    if (Array.isArray(b?.messages)) {
      messages = b.messages.filter((m: Msg) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
        .map((m: Msg) => ({ role: m.role, content: String(m.content).slice(0, 4000) }));
    } else if (b?.prompt) {
      messages = [{ role: "user", content: String(b.prompt).slice(0, 500) }];
    }
    prevHtml = String(b?.prevHtml ?? "").slice(0, 80000);
    token = String(b?.token ?? "?").slice(0, 80) || "?";
  } catch { /* ignore */ }

  const ip = (req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "?").split(",")[0].trim() || "?";

  // ---- 内部ラン：自己呼び出しされたビルド本体（サービスロールキー必須）----
  if (irun) {
    if (!SUPA_SRV || irun.k !== SUPA_SRV || typeof irun.job !== "string") return json({ error: "forbidden" }, 403);
    const hop = irun.hop || 0;
    // このインスタンスも寿命が残り少なければ、さらに新しいインスタンスへ回す（最大2回）
    if (remainMs() < 330000 && hop < 2) {
      const moved = await dispatchRun({ ...irun, hop: hop + 1 });
      if (moved) return json({ ok: true, moved: true });
    }
    const rSpec = (irun.spec && typeof irun.spec === "object") ? irun.spec : specFor();
    const rMsgs = Array.isArray(irun.messages) ? irun.messages : [];
    const rPrev = typeof irun.prevHtml === "string" ? irun.prevHtml : "";
    const rUspec = typeof irun.uspec === "string" ? irun.uspec : "";
    const rJob = irun.job;
    const rWork = (async () => {
      let r; try { r = await buildOnce(key, rMsgs, rPrev, rSpec, rUspec); } catch (e) { r = buildErr(e); }
      await finishJob(rJob, r);
    })();
    try {
      const ER = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
      if (ER && ER.waitUntil) ER.waitUntil(rWork); else await rWork;
    } catch { await rWork; }
    return json({ ok: true });
  }

  // ---- 使用量の確認（加算しない・上限チェックもしない）----
  if (wantUsage) {
    // 管理者はテストモデル選択を反映した「実際に使われるモデル」を返す（チャット画面の表記と実生成を一致させる）
    if (isAdmin) return json({ enabled: true, admin: true, model: specLabel(specFor(testModel)) });
    const d = today();
    const used = await readUsage("u:bld:" + token + ":" + d);
    if (used === null) return json({ enabled: false, model: specLabel(specFor()) });   // rate_limit.sql 未実行 = 無制限
    const ipU = await readUsage("i:bld:" + ip + ":" + d);
    const gU = await readUsage("g:bld:" + d);
    return json({
      enabled: true, model: specLabel(specFor()),
      bldUsed: used, bldLimit: LIMITS.bldUser, bldRemaining: Math.max(0, LIMITS.bldUser - used),
      ipUsed: ipU || 0, ipLimit: LIMITS.bldIp,
      globalUsed: gU || 0, globalLimit: LIMITS.bldGlobal,
    });
  }

  // ---- ポーリング：ジョブの状態確認（軽い・短い）----
  if (jobId) {
    const row = await getJob(jobId);
    if (!row) return json({ status: "error", error: "job_not_found" });
    if (row.result) {
      const res = row.result as { error?: string };
      return json(res && res.error ? { status: "error", ...res } : { status: "done", ...(res as object) });
    }
    const age = (Date.now() - new Date(row.created_at).getTime()) / 1000;
    if (age > 390) return json({ status: "error", error: "timeout" });
    return json({ status: "pending" });
  }

  if (!messages.length) return json({ error: "empty_prompt" }, 400);

  // ---- 設計書のみ生成（ビルド前の確認・編集用。生成カウントは消費しない）----
  if (wantSpec) {
    if (!isAdmin) {
      const d0 = today();
      const rg = await gate("u:req:" + token + ":" + d0, "i:req:" + ip + ":" + d0, "g:req:" + d0, LIMITS.reqUser, LIMITS.reqIp, LIMITS.reqGlobal, LIMITS.cooldownSec);
      if (rg && rg.allowed === false) return json({ error: "rate_limited", reason: limitReason("req", rg), retry_sec: rg.retry_sec });
    }
    const transcript = messages.map((mm) => (mm.role === "user" ? "ユーザー: " : "AI: ") + mm.content).join("\n");
    try {
      const sres = await callClaude(key, SPEC_SYSTEM, [{ role: "user", content: transcript }], SPEC_SCHEMA, true, 60000, undefined,
        { provider: "anthropic", model: "claude-sonnet-5", effort: "low" });
      return json({ spec: String(sres.spec || "").slice(0, 6000) });
    } catch (e) { return json(buildErr(e)); }
  }

  // ---- 受付：ゲート＋相談（速い）----
  let flow;
  try { flow = await startFlow(key, messages, prevHtml, token, ip, isAdmin, forceBuild); }
  catch (e) { return json(buildErr(e)); }
  if (flow.immediate) return json(flow.immediate);

  // ---- ビルド：非同期ジョブで開始。テーブルが無ければ同期ストリーミングにフォールバック ----
  // モデル差替えは管理者のみ（一般ユーザーの model 指定は無視して本番モデル）
  const buildSpec = specFor(isAdmin ? testModel : undefined);
  const id = await createJob(token);
  if (id) {
    const work = (async () => {
      // まず自己呼び出しで新しいインスタンスに任せる（受付までに消費した寿命を引き継がない）。
      // 失敗したらこのインスタンスで従来どおり生成（残り寿命内のタイムアウトが守る）。
      const moved = await dispatchRun({ k: SUPA_SRV, job: id, messages, prevHtml, spec: buildSpec, uspec });
      if (moved) return;
      let r; try { r = await buildOnce(key, messages, prevHtml, buildSpec, uspec); } catch (e) { r = buildErr(e); }
      await finishJob(id, r);
    })();
    try {
      const ER = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
      if (ER && ER.waitUntil) ER.waitUntil(work); else await work;
    } catch { await work; }
    return json({ action: "job", job_id: id });
  }

  // フォールバック：同期＋ストリーミング（モバイル対策のハートビート付き）
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      let done = false;
      try { controller.enqueue(encoder.encode(" ")); } catch { /* closed */ }
      const hb = setInterval(() => { if (done) return; try { controller.enqueue(encoder.encode(" ")); } catch { /* closed */ } }, 2000);
      (async () => {
        let result; try { result = await buildOnce(key, messages, prevHtml, buildSpec, uspec); } catch (e) { result = buildErr(e); }
        done = true; clearInterval(hb);
        try { controller.enqueue(encoder.encode("\n" + JSON.stringify(result))); } catch { /* closed */ }
        try { controller.close(); } catch { /* closed */ }
      })();
    },
  });
  return new Response(stream, { headers: { ...CORS, "content-type": "application/json; charset=utf-8", "cache-control": "no-cache" } });
});
