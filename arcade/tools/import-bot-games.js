/* 別セッションで作ったゲーム（arcade/games/<id>/index.html ＋ games.js の登録）を、
   データベースの作品として取り込み、「さくらが作った作品」にする。
   取り込んだゲームはユーザーの作品と同じ扱い（隔離して再生・作者ページ・いいね・さくらタブでの付け替え）になる。

   使い方（リポジトリのルートで）:
     node arcade/tools/import-bot-games.js deadline=chikuwa_dmj tetris2=unchi_man   # ゲームID=さくらの@ID
     node arcade/tools/import-bot-games.js --auto deadline tetris2                    # さくらにばらして割り当て
   出力：arcade/supabase/sql/migrations/<番号>_import_games.sql（push すると自動で DB に入る）
         games.js から取り込んだゲームの登録を外す（一覧に二重に出ないように）。ファイル本体は元として残す。
   何度実行しても同じ作品を上書きするだけ（ID はゲームIDから決まる）。 */
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..");
const MIG = path.join(ROOT, "supabase/sql/migrations");
const BOT_HANDLES = ["aaaaa_a", "asdfghjk", "www_w", "ko_ko_ko", "mendoi_", "nanashi44", "ore_ore", "user8392", "unchi_man", "onara_ou",
  "kenta_0o", "yuu_ww", "chocopan_", "yuto_shogaku", "haha_desu", "bukatsu_owata", "akaten_math", "majimuri", "nemu_sugi", "issho_yaro",
  "kusa_kusa", "saikyou_desu", "jisho_no1", "dark_xx", "takashi_t", "yuna_xx", "mii_0305", "chikuwa_dmj", "jagaimo_me", "reizouko_"];

const args = process.argv.slice(2), auto = args.includes("--auto");
const jobs = args.filter((a) => a !== "--auto").map((a) => { const [id, h] = a.split("="); return { id, handle: (h || "").replace(/^@/, "") }; });
if (!jobs.length) { console.error("取り込むゲームIDを指定してください"); process.exit(1); }

// games.js を読む
const gjsPath = path.join(ROOT, "js/games.js");
let gjs = fs.readFileSync(gjsPath, "utf8");
const win = {}; new Function("window", gjs)(win);
const byId = Object.fromEntries((win.GAMES || []).map((g) => [g.id, g]));

let pool = BOT_HANDLES.slice().sort(() => Math.random() - 0.5);
const sq = (s) => "'" + String(s == null ? "" : s).replace(/'/g, "''") + "'";
const rows = [];
for (const j of jobs) {
  const meta = byId[j.id];
  const file = path.join(ROOT, "games", j.id, "index.html");
  if (!fs.existsSync(file)) { console.error("ファイルがありません:", file); process.exit(1); }
  if (!meta) console.warn("games.js に登録がありません（タイトル等は最低限で入れます）:", j.id);
  let html = fs.readFileSync(file, "utf8");
  // 公式用の SDK 読み込みは外す（隔離環境では、プレイ画面が同じ Arcade API を差し込む）
  html = html.replace(/<script[^>]*src=["'][^"']*arcade-sdk\.js[^"']*["'][^>]*>\s*<\/script>\s*/gi, "");
  if (html.length >= 200000) { console.error("大きすぎます（200KB 以上）:", j.id); process.exit(1); }
  if (html.includes("$vh$")) { console.error("本文に区切り記号 $vh$ が含まれています:", j.id); process.exit(1); }
  const handle = j.handle || (auto ? pool[rows.length % pool.length] : "");
  if (!handle) { console.error("さくらの@IDを指定するか --auto を付けてください:", j.id); process.exit(1); }
  const thumb = meta && meta.thumb ? "https://vappa.app/arcade/" + String(meta.thumb).replace(/\?.*$/, "") : null;
  const created = meta && meta.created ? meta.created : new Date().toISOString().slice(0, 10);
  rows.push({ id: j.id, handle, title: (meta && meta.title) || j.id, html, thumb, created,
    category: (meta && meta.category) || "その他", blurb: (meta && meta.blurb) || "", accent: (meta && meta.accent) || "#8b5cf6",
    stype: meta && meta.score && meta.score.type === "low" ? "low" : "high", sunit: (meta && meta.score && meta.score.unit) || "点" });
}

const num = String(Math.max(0, ...fs.readdirSync(MIG).map((f) => parseInt(f, 10)).filter((n) => !isNaN(n))) + 1).padStart(3, "0");
let sql = "-- 別セッションのゲームを、さくらの作品として取り込む（arcade/tools/import-bot-games.js で生成）\n";
for (const r of rows) {
  sql += `
insert into public.games (id, title, author, html, accent, description, thumb, category, published, hidden, owner, user_id, score_type, score_unit, created_at, updated_at)
select md5('vappa-import-' || ${sq(r.id)})::uuid, ${sq(r.title)}, p.display_name, $vh$${r.html}$vh$, ${sq(r.accent)}, ${sq(r.blurb)}, ${r.thumb ? sq(r.thumb) : "null"},
       ${sq(r.category)}, true, false, 'bot', p.user_id, ${sq(r.stype)}, ${sq(r.sunit)},
       ${sq(r.created)}::timestamptz + (random() * interval '20 hours'), now()
from public.profiles p join public.bots b on b.user_id = p.user_id where p.handle = ${sq(r.handle)}
on conflict (id) do update set title = excluded.title, html = excluded.html, accent = excluded.accent, description = excluded.description,
  thumb = excluded.thumb, category = excluded.category, score_type = excluded.score_type, score_unit = excluded.score_unit,
  user_id = excluded.user_id, author = excluded.author, owner = 'bot', updated_at = now();
`;
}
sql += `\nselect g.title, p.handle from public.games g join public.profiles p on p.user_id = g.user_id where g.id in (${rows.map((r) => `md5('vappa-import-' || ${sq(r.id)})::uuid`).join(", ")});\n`;
const out = path.join(MIG, num + "_import_games.sql");
fs.writeFileSync(out, sql);

// games.js から外す（一覧に公式として二重に出ないように）
for (const r of rows) {
  const re = new RegExp("\\n  \\{\\s*\\n\\s*id:\\s*[\"']" + r.id.replace(/[-]/g, "\\-") + "[\"'][\\s\\S]*?\\n  \\},?", "m");
  gjs = gjs.replace(re, "");
}
gjs = gjs.replace(/,(\s*\n\];)/, "$1");
fs.writeFileSync(gjsPath, gjs);
new Function("window", gjs)({});   // 壊れていないか確認

console.log("書き出し:", path.relative(path.join(ROOT, ".."), out));
for (const r of rows) console.log(`  ${r.id} → @${r.handle}（${r.title}・${r.stype === "low" ? "小さいほど良い" : "大きいほど良い"}・${r.sunit}）`);
console.log("games.js から外しました。push すると DB に取り込まれます。");
