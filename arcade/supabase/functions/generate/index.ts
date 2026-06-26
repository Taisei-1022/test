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

// 429 / 5xx / ネットワーク断は一時的なので最大3回までリトライ（503 upstream connect error 対策）
async function callClaude(key: string, system: string, messages: Msg[], schema: unknown, think: boolean) {
  const body: Record<string, unknown> = {
    model: "claude-opus-4-8",
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

// 相談 or 生成の本体。結果オブジェクト（成功 or {error,...}）を返す。
async function doWork(key: string, messages: Msg[], prevHtml: string) {
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const instruction = (lastUser?.content || "").trim();
  try {
    // --- 編集モード（既存HTMLあり）: 相談せず直接ビルド ---
    if (prevHtml) {
      const userContent = "次の既存ゲーム(HTML)を、下の指示に従って修正してください。修正後の完全な単一HTMLだけを返し、タイトルも内容に合わせて更新してOKです。\n\n【指示】\n" +
        instruction + "\n\n【既存HTML】\n" + prevHtml;
      const g = await callClaude(key, BUILD_SYSTEM, [{ role: "user", content: userContent }], GAME_SCHEMA, true);
      if (!g.html) return { error: "empty_html" };
      return { action: "build", reply: "直したよ！", title: g.title || "無題のゲーム", html: g.html, category: g.category || "その他" };
    }

    // --- 相談（プランナー: 軽量・質問役） ---
    const plan = await callClaude(key, PLAN_SYSTEM, messages, PLAN_SCHEMA, false);
    if (plan.action !== "build") {
      return { action: "ask", reply: plan.reply || "どんな感じにする？", options: Array.isArray(plan.options) ? plan.options.slice(0, 4) : [] };
    }

    // --- 本生成（thinkingあり） ---
    const transcript = messages.map((m) => (m.role === "user" ? "ユーザー: " : "AI: ") + m.content).join("\n");
    const userContent = "次の相談で決まった内容で、ミニゲームを作ってください。完全な単一HTMLだけを返す。\n\n【相談ログ】\n" + transcript;
    const g = await callClaude(key, BUILD_SYSTEM, [{ role: "user", content: userContent }], GAME_SCHEMA, true);
    if (!g.html) return { error: "empty_html" };
    return { action: "build", reply: plan.reply || "作ったよ！", title: g.title || "無題のゲーム", html: g.html, category: g.category || "その他" };
  } catch (e) {
    const s = String((e as Error)?.message || e);
    if (s.indexOf("refused") >= 0) return { error: "refused" };
    if (/credit balance is too low/i.test(s)) return { error: "insufficient_credit" };
    return { error: "generate_error", detail: s.slice(0, 200) };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return json({ error: "missing_api_key" }, 500);

  let messages: Msg[] = [], prevHtml = "";
  try {
    const b = await req.json();
    if (Array.isArray(b?.messages)) {
      messages = b.messages.filter((m: Msg) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
        .map((m: Msg) => ({ role: m.role, content: String(m.content).slice(0, 4000) }));
    } else if (b?.prompt) {
      messages = [{ role: "user", content: String(b.prompt).slice(0, 500) }];
    }
    prevHtml = String(b?.prevHtml ?? "").slice(0, 80000);
  } catch { /* ignore */ }

  if (!messages.length) return json({ error: "empty_prompt" }, 400);

  // 生成は最大~50秒かかり、モバイルSafariは無通信の長いfetchを切る。
  // 生成中はスペースを定期送信して接続を維持し、最後にJSONを流す（受信側はtrim()してparse）。
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      let done = false;
      const hb = setInterval(() => {
        if (done) return;
        try { controller.enqueue(encoder.encode(" ")); } catch { /* closed */ }
      }, 4000);
      (async () => {
        let result: unknown;
        try { result = await doWork(key, messages, prevHtml); }
        catch (e) { result = { error: "generate_error", detail: String((e as Error)?.message || e).slice(0, 200) }; }
        done = true;
        clearInterval(hb);
        try { controller.enqueue(encoder.encode("\n" + JSON.stringify(result))); } catch { /* closed */ }
        try { controller.close(); } catch { /* closed */ }
      })();
    },
  });
  return new Response(stream, { headers: { ...CORS, "content-type": "application/json; charset=utf-8", "cache-control": "no-cache" } });
});
