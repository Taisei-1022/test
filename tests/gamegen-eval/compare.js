/* 品質評価の比べ表：パターン（A / A90 / C …）ごとに、何回分かの結果をまとめる。
   使い方: node tests/gamegen-eval/compare.js --set=heavy A=heavy_A_r1,heavy_A_r2,heavy_A_r3 A90=heavy_A90_r1,...
   前提：各タグを results/<tag> に置き、run.js --score-only と elements.js を済ませておく（report.json / elements.json）。
   出力：表（標準出力）と results/compare_<set>.json */
const fs = require("fs"), path = require("path");
const args = process.argv.slice(2);
const SET = ((args.find((a) => a.startsWith("--set=")) || "--set=heavy").slice(6));
const CASES = require("./cases_" + SET + ".js");
const pats = args.filter((a) => !a.startsWith("--")).map((a) => { const [k, v] = a.split("="); return { name: k, tags: v.split(",") }; });
const R = path.join(__dirname, "results");
const read = (p) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch (e) { return null; } };

const out = {};
for (const p of pats) {
  let n = 0, ok = 0, score = 0, full = 0, codeHit = 0, scrHit = 0, elems = 0, sec = 0, yen = 0, budget = 0, timeouts = 0, stage1only = 0, perCase = {};
  for (const tag of p.tags) {
    const rep = read(path.join(R, tag, "report.json")) || {}, el = read(path.join(R, tag, "elements.json")) || {};
    for (const c of CASES) {
      n++;
      const meta = read(path.join(R, tag, c.id + ".meta.json")) || {};
      const r = rep[c.id] || { total: 0 };
      const pc = perCase[c.id] || (perCase[c.id] = { ok: 0, score: 0, code: 0, elems: 0, runs: 0 });
      pc.runs++;
      const d = (meta.diag || []).join(" ");
      if (/token_budget|finish=length/.test(d)) budget++;
      if (/timeout/.test(d)) timeouts++;
      if (meta.stages === 1) stage1only++;
      if (meta.ok) { ok++; pc.ok++; sec += meta.sec || 0; yen += +meta.yen || 0; }
      score += r.total || 0; pc.score += r.total || 0; if (r.total === 11) full++;
      const items = (el[c.id] && el[c.id].items) || c.adds.map(() => ({ code: false, screen: false }));
      for (const it of items) { elems++; pc.elems++; if (it.code) { codeHit++; pc.code++; } if (it.screen) scrHit++; }
    }
  }
  out[p.name] = {
    runs: n, completion: ok / n, avgScore: score / n, fullMarks: full, elemCode: codeHit / elems, elemScreen: scrHit / elems,
    avgSec: ok ? sec / ok : 0, avgYen: ok ? yen / ok : 0, totalYen: yen, budgetHits: budget, timeouts, stage1only,
    perCase: Object.fromEntries(Object.entries(perCase).map(([k, v]) => [k, { completion: v.ok / v.runs, avgScore: v.score / v.runs, elemCode: v.code / v.elems }])),
  };
}
fs.writeFileSync(path.join(R, "compare_" + SET + ".json"), JSON.stringify(out, null, 1));
const pct = (x) => (x * 100).toFixed(0) + "%";
console.log("パターン       完成率  採点(11点)  満点  要素:コード  要素:画面  平均秒  平均¥  合計¥  上限到達  時間切れ  第1段のみ");
for (const [k, v] of Object.entries(out)) {
  console.log(k.padEnd(12), pct(v.completion).padStart(6), v.avgScore.toFixed(1).padStart(10), String(v.fullMarks).padStart(5),
    pct(v.elemCode).padStart(11), pct(v.elemScreen).padStart(10), Math.round(v.avgSec).toString().padStart(7), v.avgYen.toFixed(1).padStart(6),
    v.totalYen.toFixed(0).padStart(6), String(v.budgetHits).padStart(9), String(v.timeouts).padStart(9), String(v.stage1only).padStart(10));
}
console.log("\nゲーム別（完成率 / 採点 / 要素:コード）");
for (const c of CASES) console.log(c.title.padEnd(16), Object.entries(out).map(([k, v]) => k + " " + pct(v.perCase[c.id].completion) + "/" + v.perCase[c.id].avgScore.toFixed(1) + "/" + pct(v.perCase[c.id].elemCode)).join("   "));
