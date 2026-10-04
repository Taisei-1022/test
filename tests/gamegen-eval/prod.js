/* 本番の generate 関数で10ケースを生成し、run.js の採点形式で保存する（APIキー不要）。
   ユーザーが実際に受け取るゲーム（プランの時間上限・時間切れ時の2回目・保険を含む）を測る。
   使い方:
     node tests/gamegen-eval/prod.js --tag=prod_free [--cases=mole,jump] [--conc=10]
     DEEPSEEK_API_KEY=unused node tests/gamegen-eval/run.js --tag=prod_free --score-only
   各ケースの設計書(spec)をそのまま渡すので、AIが設計書を作る段は飛ばして本体の生成だけを比べる。
   --flow を付けると設計書を渡さず、相談の会話として送る＝本番どおりAIが設計書から作る（時間も本番どおり）。 */
const fs = require("fs"), path = require("path");
const SET = (process.argv.find((a) => a.startsWith("--set=")) || "").slice(6); const CASES = require(SET ? "./cases_" + SET + ".js" : "./cases.js"); // --set=rich / heavy: 別の設計書セット
const args = {};
process.argv.slice(2).forEach(a => { const m = /^--([^=]+)(?:=(.*))?$/.exec(a); if (m) args[m[1]] = m[2] === undefined ? true : m[2]; });
const TAG = args.tag || "prod";
const ONLY = args.cases ? String(args.cases).split(",") : null;
const CONC = parseInt(args.conc || "10", 10);
const OUT = path.join(__dirname, "results", TAG);
fs.mkdirSync(OUT, { recursive: true });
const cfgSrc = fs.readFileSync(path.join(__dirname, "../../arcade/js/config.js"), "utf8");
const URL_ = /supabaseUrl:\s*"([^"]+)"/.exec(cfgSrc)[1].replace(/\/$/, "") + "/functions/v1/generate";
const KEY = /supabaseKey:\s*"([^"]+)"/.exec(cfgSrc)[1];

let LIMIT_SEEN = 0;
async function post(body) {
  const r = await fetch(URL_, { method: "POST", headers: { apikey: KEY, "content-type": "application/json" }, body: JSON.stringify(body) });
  return r.json();
}
function tuneEntries(js) {
  const d = /(?:var|let|const)\s+TUNE\s*=\s*\{/.exec(js || ""); if (!d) return 0;
  let depth = 0, end = -1; const start = d.index + d[0].length - 1;
  for (let i = start; i < js.length && i < start + 5000; i++) { if (js[i] === "{") depth++; else if (js[i] === "}") { depth--; if (!depth) { end = i; break; } } }
  return end < 0 ? 0 : (js.slice(start, end).match(/[A-Za-z_$][\w$]*\s*:\s*\{/g) || []).length;
}
function validateJs(js) {
  const s = (js || "").trim();
  if (s.length < 300) return "too short";
  try { new Function(s); } catch (e) { return "syntax: " + String(e.message).slice(0, 80); }
  for (const [re, m] of [[/function\s+init\s*\(/, "no init"], [/function\s+update\s*\(/, "no update"], [/function\s+draw\s*\(/, "no draw"], [/Game\s*\.\s*over\s*\(/, "no Game.over"]]) if (!re.test(s)) return m;
  return null;
}
async function one(c) {
  const t0 = Date.now();
  const mf = path.join(OUT, c.id + ".meta.json"), hf = path.join(OUT, c.id + ".html");
  try {
    const body = args.flow
      ? { messages: [{ role: "user", content: c.title + "を作りたい" }, { role: "assistant", content: "どんな内容にする？" }, { role: "user", content: c.spec + "\nこれで作って" }], build: true, token: "eval-" + TAG + "-" + c.id }
      : { messages: [{ role: "user", content: c.title + "を作って" }], build: true, spec: c.spec, token: "eval-" + TAG + "-" + c.id };
    // 品質評価：GitHub Actions から、サーバーの鍵（EVAL_SRV）付きで送る＝ログイン・回数制限なしの管理者扱い
    if (process.env.EVAL_SRV) body.eval = process.env.EVAL_SRV;
    if (args.maxout) body.maxOut = parseInt(args.maxout, 10);   // 出力上限の試し値（例 90000）
    const start = await post(body);
    if (!start.job_id) throw new Error("start: " + JSON.stringify(start).slice(0, 160));
    let d = null;
    while (Date.now() - t0 < 900000) {
      await new Promise(r => setTimeout(r, 6000));
      try { d = await post({ job: start.job_id }); } catch (e) { continue; }
      if (d.limit && !LIMIT_SEEN) { LIMIT_SEEN = d.limit; console.log("[server] ジョブ全体の上限 =", d.limit + "秒", d.limit >= 800 ? "（400秒プラン設定が有効）" : "（150秒プランの値）"); }
      if (d.status !== "pending") break;
    }
    const sec = Math.round((Date.now() - t0) / 1000);
    if (!d || d.status !== "done") throw Object.assign(new Error((d && (d.error + " " + (d.detail || ""))) || "no result"), { diag: d && d.diag, sec });
    const js = (/\/\*__VAPPA_JS__\*\/([\s\S]*?)\/\*__VAPPA_JS_END__\*\//.exec(d.html) || [])[1] || "";
    const meta = { ok: true, validateErr: validateJs(js), tune: tuneEntries(js), sec, title: d.title, model: d.model, yen: d.cost && d.cost.jpy, diag: d.diag };
    fs.writeFileSync(hf, d.html); fs.writeFileSync(mf, JSON.stringify(meta));
    console.log("[gen]", c.id, sec + "s", d.model, "¥" + meta.yen, meta.validateErr || "ok");
  } catch (e) {
    fs.writeFileSync(mf, JSON.stringify({ ok: false, err: String(e.message).slice(0, 300), diag: e.diag, sec: e.sec }));
    console.log("[gen]", c.id, "FAIL", String(e.message).slice(0, 160));
  }
}
(async () => {
  const cases = ONLY ? CASES.filter(c => ONLY.includes(c.id)) : CASES;
  const q = cases.slice(); await Promise.all(Array.from({ length: Math.min(CONC, q.length) }, async () => { while (q.length) await one(q.shift()); }));
})();
