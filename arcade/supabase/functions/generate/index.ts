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
- Switch to action="build" only when the design is clear enough, OR the user says things like 「これで」「作って」「おまかせ」「いいね」, OR after about 2–3 exchanges.
- Encourage variety; do not push everyone toward the same kind of game.

Output (structured):
- action: "ask" or "build"
- reply: a short Japanese message to the user (for "build", a brief line like "じゃあ作るね！")
- options: 0–4 short Japanese choice strings the user can tap (for "ask"; empty for "build")`;

// 本生成（自己完結の単一HTMLゲーム）
const BUILD_SYSTEM = `You generate a complete, self-contained single-file HTML5 mini-game.

Hard requirements:
- Output ONLY through the structured format: "title" (short, Japanese) and "html" (the full game).
- "html" is a complete standalone document (<!DOCTYPE html> ... </html>) with ALL CSS and JS inline.
  No external resources, no CDN, no <link>/<img src> to the network, no fetch, no imports, no audio files.
- Mobile-first: works with touch (touchstart/touchmove), fills the screen, portrait friendly, no page scrolling.
- The game is immediately playable: a brief start screen ("タップで開始"), then play, then a game-over with restart.
- Scoring: higher is better; the score is a non-negative integer.
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
- Also choose ONE best-fitting "category" from: アクション / パズル / シューティング / 反射神経 / よける / タイミング / 記憶 / レース / その他.`;

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

function json(o: unknown, status = 200) {
  return new Response(JSON.stringify(o), { status, headers: { ...CORS, "content-type": "application/json" } });
}

type Msg = { role: string; content: string };

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

// ===== レート制限（コスト/不正対策）=====
// 値はここで調整可。req=全リクエスト（相談含む）、bld=ゲーム生成/編集（高コスト）。
const LIMITS = {
  cooldownSec: 3,                          // 連打クールダウン（端末ごと）
  reqUser: 150, reqIp: 250, reqGlobal: 4000,   // 1日あたりのリクエスト上限
  bldUser: 15, bldIp: 25, bldGlobal: 120,      // 1日あたりのゲーム生成上限（全体=予算ガード）
};
const SUPA_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPA_SRV = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

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
const today = () => new Date().toISOString().slice(0, 10);

// req gate / build gate の結果を、クライアント向けの理由に変換
function limitReason(scope: "req" | "bld", g: { reason?: string } | null) {
  const r = g?.reason || "";
  if (r === "cooldown") return "cooldown";
  if (r === "global_daily") return "global_busy";
  if (scope === "bld") return "daily_limit";       // user/ip の作成上限
  return "rate";                                    // req の user/ip 上限
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
  return null;
}

// 本生成（重い1回）。生成→自動チェック→ダメなら1回だけ自動修正。
async function buildOnce(key: string, messages: Msg[], prevHtml: string) {
  let userContent: string, reply: string;
  if (prevHtml) {
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    const instruction = (lastUser?.content || "").trim();
    userContent = "次の既存ゲーム(HTML)を、下の指示に従って修正してください。修正後の完全な単一HTMLだけを返し、タイトルも内容に合わせて更新してOKです。\n\n【指示】\n" +
      instruction + "\n\n【既存HTML】\n" + prevHtml;
    reply = "直したよ！";
  } else {
    const transcript = messages.map((mm) => (mm.role === "user" ? "ユーザー: " : "AI: ") + mm.content).join("\n");
    userContent = "次の相談で決まった内容で、ミニゲームを作ってください。完全な単一HTMLだけを返す。\n\n【相談ログ】\n" + transcript;
    reply = "作ったよ！";
  }
  const g = await callClaude(key, BUILD_SYSTEM, [{ role: "user", content: userContent }], GAME_SCHEMA, true);
  if (!g.html) return { error: "empty_html" };
  let title = g.title || "無題のゲーム", html = g.html, category = g.category || "その他";

  // 自動チェック → 問題があれば1回だけAIに直させる
  const problem = validateGame(html);
  if (problem) {
    try {
      const fixUser = "あなたが作った次のHTMLゲームに問題が見つかりました：「" + problem +
        "」。原因を必ず直し、最後まで完結した完全な単一HTMLだけを返してください（</html>まで）。タイトルは維持。\n\n【HTML】\n" + html;
      const g2 = await callClaude(key, BUILD_SYSTEM, [{ role: "user", content: fixUser }], GAME_SCHEMA, true);
      if (g2.html) { html = g2.html; title = g2.title || title; category = g2.category || category; }
    } catch { /* 修正に失敗したら元の生成結果をそのまま返す */ }
  }
  return { action: "build", reply, title, html, category };
}
// callClaude 例外をクライアント向けエラーへ変換
function buildErr(e: unknown) {
  const s = String((e as Error)?.message || e);
  if (s.indexOf("refused") >= 0) return { error: "refused" };
  if (/credit balance is too low/i.test(s)) return { error: "insufficient_credit" };
  return { error: "generate_error", detail: s.slice(0, 200) };
}

// フェーズごとのモデル（コスト最適化）：
//   相談・質問役（think=false）→ Haiku（安い・速い）
//   ゲーム本生成・修正（think=true）→ Sonnet（品質と価格のバランス）
const MODELS = { plan: "claude-haiku-4-5-20251001", build: "claude-opus-4-8" };

// 429 / 5xx / ネットワーク断は一時的なので最大3回までリトライ（503 upstream connect error 対策）
async function callClaude(key: string, system: string, messages: Msg[], schema: unknown, think: boolean) {
  const body: Record<string, unknown> = {
    model: think ? MODELS.build : MODELS.plan,
    max_tokens: think ? 16000 : 1024,
    system,
    messages,
    output_config: think
      ? { effort: "medium", format: { type: "json_schema", schema } }
      : { format: { type: "json_schema", schema } },
  };
  if (think) body.thinking = { type: "adaptive" };

  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    let r: Response;
    try {
      r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (e) {
      lastErr = new Error("network:" + String(e).slice(0, 120));
      await sleep(700 * (attempt + 1));
      continue;
    }
    if (r.status === 429 || r.status >= 500) {
      const t = await r.text();
      lastErr = new Error("anthropic:" + r.status + ":" + t.slice(0, 160));
      await sleep(700 * (attempt + 1));
      continue;
    }
    if (!r.ok) { const t = await r.text(); throw new Error("anthropic:" + r.status + ":" + t.slice(0, 200)); }
    const data = await r.json();
    if (data.stop_reason === "refusal") throw new Error("refused");
    const text = (data.content || []).filter((b: { type: string }) => b.type === "text").map((b: { text: string }) => b.text).join("");
    return JSON.parse(text);
  }
  throw lastErr || new Error("ai_unavailable");
}

// 受付：レート制限＋相談（プランナー）。結果がすぐ返せるものは immediate、
// 重いビルドへ進む場合は { build:true } を返す。
async function startFlow(key: string, messages: Msg[], prevHtml: string, token: string, ip: string): Promise<{ immediate?: unknown; build?: boolean }> {
  const d = today();
  const rg = await gate("u:req:" + token + ":" + d, "i:req:" + ip + ":" + d, "g:req:" + d, LIMITS.reqUser, LIMITS.reqIp, LIMITS.reqGlobal, LIMITS.cooldownSec);
  if (rg && rg.allowed === false) return { immediate: { error: "rate_limited", reason: limitReason("req", rg), retry_sec: rg.retry_sec } };

  if (!prevHtml) {
    // 相談（プランナー：軽量・速い）
    let plan;
    try { plan = await callClaude(key, PLAN_SYSTEM, messages, PLAN_SCHEMA, false); }
    catch (e) { return { immediate: buildErr(e) }; }
    if (plan.action !== "build") {
      return { immediate: { action: "ask", reply: plan.reply || "どんな感じにする？", options: Array.isArray(plan.options) ? plan.options.slice(0, 4) : [] } };
    }
  }
  // ビルドに進む前に作成上限チェック
  const d2 = today();
  const bgt = await gate("u:bld:" + token + ":" + d2, "i:bld:" + ip + ":" + d2, "g:bld:" + d2, LIMITS.bldUser, LIMITS.bldIp, LIMITS.bldGlobal, 0);
  if (bgt && bgt.allowed === false) return { immediate: { error: "rate_limited", reason: limitReason("bld", bgt) } };
  return { build: true };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return json({ error: "missing_api_key" }, 500);

  let messages: Msg[] = [], prevHtml = "", token = "?", jobId = "", wantUsage = false;
  try {
    const b = await req.json();
    if (typeof b?.job === "string") jobId = b.job;
    if (b?.usage === true) wantUsage = true;
    if (Array.isArray(b?.messages)) {
      messages = b.messages.filter((m: Msg) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
        .map((m: Msg) => ({ role: m.role, content: String(m.content).slice(0, 4000) }));
    } else if (b?.prompt) {
      messages = [{ role: "user", content: String(b.prompt).slice(0, 500) }];
    }
    prevHtml = String(b?.prevHtml ?? "").slice(0, 80000);
    token = String(b?.token ?? "?").slice(0, 80) || "?";
  } catch { /* ignore */ }

  // ---- 使用量の確認（加算しない・上限チェックもしない）----
  if (wantUsage) {
    const d = today();
    const used = await readUsage("u:bld:" + token + ":" + d);
    if (used === null) return json({ enabled: false });   // rate_limit.sql 未実行 = 無制限
    return json({ enabled: true, bldUsed: used, bldLimit: LIMITS.bldUser, bldRemaining: Math.max(0, LIMITS.bldUser - used) });
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
    if (age > 175) return json({ status: "error", error: "timeout" });
    return json({ status: "pending" });
  }

  if (!messages.length) return json({ error: "empty_prompt" }, 400);
  const ip = (req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "?").split(",")[0].trim() || "?";

  // ---- 受付：ゲート＋相談（速い）----
  let flow;
  try { flow = await startFlow(key, messages, prevHtml, token, ip); }
  catch (e) { return json(buildErr(e)); }
  if (flow.immediate) return json(flow.immediate);

  // ---- ビルド：非同期ジョブで開始。テーブルが無ければ同期ストリーミングにフォールバック ----
  const id = await createJob(token);
  if (id) {
    const work = (async () => {
      let r; try { r = await buildOnce(key, messages, prevHtml); } catch (e) { r = buildErr(e); }
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
        let result; try { result = await buildOnce(key, messages, prevHtml); } catch (e) { result = buildErr(e); }
        done = true; clearInterval(hb);
        try { controller.enqueue(encoder.encode("\n" + JSON.stringify(result))); } catch { /* closed */ }
        try { controller.close(); } catch { /* closed */ }
      })();
    },
  });
  return new Response(stream, { headers: { ...CORS, "content-type": "application/json; charset=utf-8", "cache-control": "no-cache" } });
});
