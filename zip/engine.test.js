/*
 * エンジンの自己テスト:  node zip/engine.test.js
 *   - 生成した問題の解が一意であること
 *   - 保持している解答が本当にルールを満たすこと
 * を難易度ごとに確認する。
 */
const Z = require('./engine.js');

let failures = 0;
function check(cond, msg) {
  if (!cond) { failures++; console.error('  NG  ' + msg); }
  return cond;
}

function validateSolution(p) {
  const total = p.size * p.size;
  const wallSet = Z.wallSetOf(p.walls, total);
  const seen = new Set();
  let next = 1;
  for (let i = 0; i < p.solution.length; i++) {
    const cell = p.solution[i];
    if (seen.has(cell)) return '同じマスを 2 回通っている';
    seen.add(cell);
    if (i > 0) {
      const prev = p.solution[i - 1];
      const dr = Math.abs(Math.floor(cell / p.size) - Math.floor(prev / p.size));
      const dc = Math.abs((cell % p.size) - (prev % p.size));
      if (dr + dc !== 1) return '隣接していないマスに移動している';
      if (wallSet.has(Z.edgeId(prev, cell, total))) return '壁を通り抜けている';
    }
    const n = p.numbers[cell];
    if (n !== 0) {
      if (n !== next) return '番号の順序が違う';
      next++;
    }
  }
  if (seen.size !== total) return 'すべてのマスを通っていない';
  if (p.numbers[p.solution[total - 1]] !== p.dotCount) return '最大番号で終わっていない';
  return null;
}

for (const key of Z.DIFFICULTY_ORDER) {
  const cfg = Z.DIFFICULTIES[key];
  const t0 = Date.now();
  let dots = 0, walls = 0, worst = 0;
  const N = 10;
  for (let i = 0; i < N; i++) {
    const s0 = Date.now();
    const p = Z.generateWithRetry(key, Z.hashSeed('test|' + key + '|' + i));
    const ms = Date.now() - s0;
    worst = Math.max(worst, ms);
    if (!check(p, `${key}: 問題を生成できなかった (i=${i})`)) continue;

    const err = validateSolution(p);
    check(!err, `${key}: 解答が不正 (${err}) seed=${p.seed}`);

    const adj = Z.buildAdj(p.size, Z.wallSetOf(p.walls, p.size * p.size));
    const res = Z.countSolutions(p.size, adj, p.numbers, p.dotCount, 3, 5000000);
    check(!res.exceeded, `${key}: 一意性の再確認が打ち切られた seed=${p.seed}`);
    check(res.count === 1, `${key}: 解が ${res.count} 通りある seed=${p.seed}`);

    dots += p.dotCount; walls += p.walls.length;
  }
  const ms = Date.now() - t0;
  console.log(
    `${cfg.label.padEnd(7)} ${cfg.size}x${cfg.size}  ` +
    `番号 ${(dots / N).toFixed(1)} 個 / 壁 ${(walls / N).toFixed(1)} 本 / ` +
    `平均 ${(ms / N).toFixed(0)}ms (最大 ${worst}ms)`
  );
}

console.log(failures === 0 ? '\nすべて OK' : `\n${failures} 件の失敗`);
process.exit(failures === 0 ? 0 : 1);
