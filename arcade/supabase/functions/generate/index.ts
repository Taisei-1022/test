// Supabase Edge Function: ゲーム生成 / 編集（Claude / Anthropic Messages API）
// - APIキーはサーバー側の環境変数 ANTHROPIC_API_KEY に置く（クライアントには出さない）
// - { prompt }            → 新規生成
// - { prompt, prevHtml }  → 既存ゲームを指示で修正（案A）
// - 構造化出力で { title, html } を受け取る

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SYSTEM = `You generate a complete, self-contained single-file HTML5 mini-game.

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
- Make it genuinely fun and a little polished: a clear goal, simple controls, gradually increasing difficulty.
- Japanese UI text. Dark, clean look. No emoji as UI icons.
- When editing an existing game, keep what already works and apply ONLY the requested change; return the FULL updated HTML.
- Do NOT include explanations or markdown fences — the "html" field is raw HTML only.`;

const SCHEMA = {
  type: "object",
  properties: { title: { type: "string" }, html: { type: "string" } },
  required: ["title", "html"],
  additionalProperties: false,
};

function json(o: unknown, status = 200) {
  return new Response(JSON.stringify(o), {
    status,
    headers: { ...CORS, "content-type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return json({ error: "missing_api_key" }, 500);

  let prompt = "", prevHtml = "";
  try {
    const b = await req.json();
    prompt = String(b?.prompt ?? "");
    prevHtml = String(b?.prevHtml ?? "");
  } catch { /* ignore */ }
  prompt = prompt.slice(0, 500).trim();
  prevHtml = prevHtml.slice(0, 80000);
  if (!prompt) return json({ error: "empty_prompt" }, 400);

  const userContent = prevHtml
    ? "次の既存ゲーム(HTML)を、下の指示に従って修正してください。修正後の完全な単一HTMLだけを返し、タイトルも内容に合わせて更新してOKです。\n\n【指示】\n" + prompt + "\n\n【既存HTML】\n" + prevHtml
    : "作りたいゲーム: " + prompt;

  const body = {
    model: "claude-opus-4-8",
    max_tokens: 16000,
    system: SYSTEM,
    messages: [{ role: "user", content: userContent }],
    output_config: { format: { type: "json_schema", schema: SCHEMA } },
  };

  let r: Response;
  try {
    r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    return json({ error: "network", detail: String(e).slice(0, 200) }, 502);
  }

  if (!r.ok) {
    const t = await r.text();
    return json({ error: "anthropic_error", status: r.status, detail: t.slice(0, 300) }, 502);
  }

  const data = await r.json();
  if (data.stop_reason === "refusal") return json({ error: "refused" }, 422);

  const text = (data.content || [])
    .filter((b: { type: string }) => b.type === "text")
    .map((b: { text: string }) => b.text)
    .join("");

  let parsed: { title?: string; html?: string };
  try { parsed = JSON.parse(text); } catch {
    return json({ error: "parse_failed", raw: text.slice(0, 200) }, 502);
  }
  if (!parsed.html) return json({ error: "empty_html" }, 502);

  return json({ title: parsed.title || "無題のゲーム", html: parsed.html });
});
