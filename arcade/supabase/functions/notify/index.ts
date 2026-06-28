// Supabase Edge Function: Slack 通知
// Supabase の Database Webhook から呼ばれる。INSERT/UPDATE のたびに起動し、
// 内容を整形して Slack の Incoming Webhook に送る。
//
// 通知できるイベント:
//   - プレイ（scores テーブルに INSERT）         … 「○○さんが□□で N点」
//   - ゲーム公開（games の published が true に）  … 「○○さんが□□を公開」
//
// 設定（Supabase ダッシュボードの Edge Function Secrets で後から変更可）:
//   SLACK_WEBHOOK_URL  … 必須。Slack の Incoming Webhook URL
//   NOTIFY_PLAYS       … "off" でプレイ通知を止める（既定: on）
//   NOTIFY_PUBLISH     … "off" で公開通知を止める（既定: on）
//   NOTIFY_SECRET      … 設定すると、Webhook のヘッダ x-notify-secret と一致したものだけ受理
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY … ゲーム名の引き当てに使用（自動付与）

const SUPA_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPA_SRV = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const SLACK = Deno.env.get("SLACK_WEBHOOK_URL") || "";
const SECRET = Deno.env.get("NOTIFY_SECRET") || "";

function on(name: string) { return (Deno.env.get(name) || "on").toLowerCase() !== "off"; }

function ok(body = "ok") { return new Response(body, { status: 200 }); }

async function postSlack(text: string) {
  if (!SLACK) { console.warn("SLACK_WEBHOOK_URL not set"); return; }
  try {
    await fetch(SLACK, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
  } catch (e) { console.warn("slack post failed", e); }
}

// scores には game_id しか無いので、games からタイトルを引く
async function gameTitle(gameId: string): Promise<string> {
  if (!gameId || !SUPA_URL || !SUPA_SRV) return "ゲーム";
  try {
    const r = await fetch(
      SUPA_URL.replace(/\/$/, "") + "/rest/v1/games?id=eq." + encodeURIComponent(gameId) + "&select=title&limit=1",
      { headers: { apikey: SUPA_SRV, Authorization: "Bearer " + SUPA_SRV } },
    );
    const rows = await r.json();
    return (rows && rows[0] && rows[0].title) || "ゲーム";
  } catch (_e) { return "ゲーム"; }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return ok();
  if (SECRET && req.headers.get("x-notify-secret") !== SECRET) return new Response("forbidden", { status: 403 });

  let body: any;
  try { body = await req.json(); } catch (_e) { return ok(); }

  const table = body.table;
  const type = body.type;          // "INSERT" | "UPDATE" | "DELETE"
  const rec = body.record || {};
  const old = body.old_record || {};

  // --- プレイ通知（scores への INSERT） ---
  if (table === "scores" && type === "INSERT" && on("NOTIFY_PLAYS")) {
    const title = await gameTitle(rec.game_id);
    const player = rec.player || "ゲスト";
    const score = rec.score;
    await postSlack(`🎮 *${player}* さんが「${title}」をプレイ（${score}点）`);
    return ok();
  }

  // --- 公開通知（games の published が true になった） ---
  if (table === "games" && on("NOTIFY_PUBLISH")) {
    const nowPub = rec.published === true && rec.html && String(rec.html).length > 0;
    const wasPub = old.published === true;
    const justPublished = nowPub && (type === "INSERT" || (type === "UPDATE" && !wasPub));
    if (justPublished) {
      const author = rec.author || "ゲスト";
      const title = rec.title || "無題のゲーム";
      await postSlack(`✨ *${author}* さんが「${title}」を公開しました`);
      return ok();
    }
  }

  return ok();
});
