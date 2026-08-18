/*
 * Zip パズルのエンジン
 *
 *  ルール:
 *    - 番号 1 のマスから線を引き始め、番号を昇順に通りながら
 *      盤面のすべてのマスをちょうど 1 回ずつ通り、最大番号のマスで終わる。
 *    - 上下左右にのみ進める。壁のある辺は通れない。
 *
 *  ここでは
 *    - ランダムなハミルトン路を作る          -> randomHamiltonianPath()
 *    - 経路が使っていない辺に壁を置く        -> pickWalls()
 *    - 解が一意になるまで番号を追加する      -> generate()
 *    - 余分な番号を削って難度を上げる        -> pruneDots()
 *  という手順で問題を作る。解の数え上げは countSolutions() が行う。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ZipEngine = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DIFFICULTIES = {
    easy:   { key: 'easy',   label: 'かんたん',     size: 5, wallDensity: 0.10, extraDots: 2 },
    normal: { key: 'normal', label: 'ふつう',       size: 6, wallDensity: 0.14, extraDots: 1 },
    hard:   { key: 'hard',   label: 'むずかしい',   size: 7, wallDensity: 0.18, extraDots: 0 },
    expert: { key: 'expert', label: 'エキスパート', size: 8, wallDensity: 0.20, extraDots: 0 }
  };
  var DIFFICULTY_ORDER = ['easy', 'normal', 'hard', 'expert'];

  var UNIQUE_BUDGET = 400000;   // 一意性判定で辿るノード数の上限
  var PRUNE_BUDGET = 250000;    // 番号削除の可否判定で辿るノード数の上限
  var PATH_BUDGET = 300000;     // ハミルトン路探索の上限

  // ---------------------------------------------------------------- 乱数

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hashSeed(str) {
    var h = 2166136261 >>> 0;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function shuffle(arr, rng) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  // ---------------------------------------------------------------- 盤面

  function edgeId(a, b, total) {
    return a < b ? a * total + b : b * total + a;
  }

  function buildAdj(size, wallSet) {
    var total = size * size;
    var adj = new Array(total);
    for (var r = 0; r < size; r++) {
      for (var c = 0; c < size; c++) {
        var i = r * size + c;
        var list = [];
        if (r > 0) list.push(i - size);
        if (r < size - 1) list.push(i + size);
        if (c > 0) list.push(i - 1);
        if (c < size - 1) list.push(i + 1);
        if (wallSet && wallSet.size) {
          list = list.filter(function (n) { return !wallSet.has(edgeId(i, n, total)); });
        }
        adj[i] = list;
      }
    }
    return adj;
  }

  function wallSetOf(walls, total) {
    var set = new Set();
    for (var i = 0; i < walls.length; i++) set.add(edgeId(walls[i][0], walls[i][1], total));
    return set;
  }

  /*
   * 残りのマスを「今いるマスから一筆で全部通れる可能性があるか」で枝刈りする。
   *   - 未訪問マスが分断されていたら不可
   *   - 出口が 0 のマスがあれば不可
   *   - 出口が 1 のマス(行き止まり)は終点にしかなれない
   */
  function makeFeasibility(total, adj) {
    var seen = new Int32Array(total);
    var queue = new Int32Array(total);
    var stamp = 0;
    return function feasible(visited, cur, endCell, remaining) {
      if (remaining === 0) return true;
      stamp++;
      var head = 0, tail = 0, reached = 0, leaves = 0;
      var allowedLeaves = endCell >= 0 ? 0 : 1;
      var nbs = adj[cur], k, nb;
      for (k = 0; k < nbs.length; k++) {
        nb = nbs[k];
        if (!visited[nb] && seen[nb] !== stamp) { seen[nb] = stamp; queue[tail++] = nb; }
      }
      if (tail === 0) return false;
      while (head < tail) {
        var u = queue[head++];
        reached++;
        var deg = 0;
        var un = adj[u];
        for (k = 0; k < un.length; k++) {
          var v = un[k];
          if (v === cur) { deg++; continue; }
          if (!visited[v]) {
            deg++;
            if (seen[v] !== stamp) { seen[v] = stamp; queue[tail++] = v; }
          }
        }
        if (deg === 0) return false;
        if (deg === 1 && u !== endCell) {
          leaves++;
          if (leaves > allowedLeaves) return false;
        }
      }
      return reached === remaining;
    };
  }

  // ---------------------------------------------------------- 経路の生成

  function randomHamiltonianPath(size, rng, attempts) {
    var total = size * size;
    var adj = buildAdj(size, null);
    var feasible = makeFeasibility(total, adj);
    var visited = new Uint8Array(total);
    attempts = attempts || 30;

    for (var a = 0; a < attempts; a++) {
      visited.fill(0);
      var start = Math.floor(rng() * total);
      var path = [start];
      visited[start] = 1;
      var nodes = 0;

      var ok = (function dfs(cur) {
        if (path.length === total) return true;
        if (++nodes > PATH_BUDGET) return false;
        if (!feasible(visited, cur, -1, total - path.length)) return false;

        var cands = [];
        for (var k = 0; k < adj[cur].length; k++) {
          if (!visited[adj[cur][k]]) cands.push(adj[cur][k]);
        }
        shuffle(cands, rng);
        // Warnsdorff: 出口の少ないマスから埋める
        cands.sort(function (x, y) { return openDeg(x) - openDeg(y); });
        for (var i = 0; i < cands.length; i++) {
          var nb = cands[i];
          visited[nb] = 1; path.push(nb);
          if (dfs(nb)) return true;
          path.pop(); visited[nb] = 0;
        }
        return false;

        function openDeg(cell) {
          var d = 0;
          for (var j = 0; j < adj[cell].length; j++) if (!visited[adj[cell][j]]) d++;
          return d;
        }
      })(start);

      if (ok) return path;
    }
    return null;
  }

  function pickWalls(size, path, rng, density) {
    var total = size * size;
    var used = new Set();
    for (var i = 0; i + 1 < path.length; i++) used.add(edgeId(path[i], path[i + 1], total));

    var candidates = [];
    for (var r = 0; r < size; r++) {
      for (var c = 0; c < size; c++) {
        var cell = r * size + c;
        if (c < size - 1 && !used.has(edgeId(cell, cell + 1, total))) candidates.push([cell, cell + 1]);
        if (r < size - 1 && !used.has(edgeId(cell, cell + size, total))) candidates.push([cell, cell + size]);
      }
    }
    shuffle(candidates, rng);
    var n = Math.round(candidates.length * density);
    return candidates.slice(0, n).map(function (e) {
      return e[0] < e[1] ? e : [e[1], e[0]];
    });
  }

  // ---------------------------------------------------------- 解の数え上げ

  /*
   * numAt: マス -> 番号(0 は番号なし)。maxNum は最大番号。
   * limit 個見つかった時点で打ち切る。budget を超えたら exceeded=true。
   */
  function countSolutions(size, adj, numAt, maxNum, limit, budget) {
    var total = size * size;
    var start = numAt.indexOf(1);
    var endCell = numAt.indexOf(maxNum);
    if (start < 0 || endCell < 0) return { count: 0, exceeded: false };

    var visited = new Uint8Array(total);
    var feasible = makeFeasibility(total, adj);
    var count = 0, nodes = 0, exceeded = false;
    limit = limit || 2;
    budget = budget || UNIQUE_BUDGET;

    visited[start] = 1;
    (function dfs(cur, depth, nextNum) {
      if (depth === total) { if (cur === endCell) count++; return; }
      if (++nodes > budget) { exceeded = true; return; }
      if (!feasible(visited, cur, endCell, total - depth)) return;

      var nbs = adj[cur];
      for (var k = 0; k < nbs.length; k++) {
        var nb = nbs[k];
        if (visited[nb]) continue;
        var v = numAt[nb];
        if (v !== 0 && v !== nextNum) continue;          // 番号は昇順にしか踏めない
        if (nb === endCell && depth + 1 !== total) continue; // 最大番号は最後のマス
        visited[nb] = 1;
        dfs(nb, depth + 1, v !== 0 ? nextNum + 1 : nextNum);
        visited[nb] = 0;
        if (exceeded || count >= limit) return;
      }
    })(start, 1, 2);

    return { count: count, exceeded: exceeded };
  }

  // ---------------------------------------------------------- 番号の配置

  function numbersFrom(path, indices, total) {
    var numAt = new Array(total).fill(0);
    var sorted = indices.slice().sort(function (a, b) { return a - b; });
    for (var i = 0; i < sorted.length; i++) numAt[path[sorted[i]]] = i + 1;
    return numAt;
  }

  // いちばん広い区間の真ん中に番号を 1 つ足す
  function addDot(indices) {
    var best = -1, bestGap = 1;
    for (var i = 0; i + 1 < indices.length; i++) {
      var gap = indices[i + 1] - indices[i];
      if (gap > bestGap) { bestGap = gap; best = i; }
    }
    if (best < 0) return false;
    var mid = indices[best] + Math.floor((indices[best + 1] - indices[best]) / 2);
    if (mid === indices[best] || mid === indices[best + 1]) return false;
    indices.splice(best + 1, 0, mid);
    return true;
  }

  function initialIndices(pathLen, total) {
    var k = Math.max(3, Math.round(total / 6));
    var idx = [];
    for (var i = 0; i < k; i++) {
      idx.push(Math.round(i * (pathLen - 1) / (k - 1)));
    }
    // 重複除去
    return idx.filter(function (v, i, a) { return i === 0 || v !== a[i - 1]; });
  }

  function isUnique(size, adj, path, indices, budget) {
    var numAt = numbersFrom(path, indices, size * size);
    var res = countSolutions(size, adj, numAt, indices.length, 2, budget);
    return !res.exceeded && res.count === 1;
  }

  // 端点以外の番号を、一意性を保てる範囲で間引く
  function pruneDots(size, adj, path, indices, rng) {
    var order = [];
    for (var i = 1; i + 1 < indices.length; i++) order.push(i);
    shuffle(order, rng);
    var current = indices.slice();
    for (var n = 0; n < order.length; n++) {
      var value = indices[order[n]];
      var pos = current.indexOf(value);
      if (pos < 0) continue;
      var trial = current.slice();
      trial.splice(pos, 1);
      if (trial.length >= 2 && isUnique(size, adj, path, trial, PRUNE_BUDGET)) current = trial;
    }
    return current;
  }

  // ---------------------------------------------------------------- 生成

  function generate(difficultyKey, seed, attempts) {
    var cfg = DIFFICULTIES[difficultyKey] || DIFFICULTIES.normal;
    var size = cfg.size, total = size * size;
    var rng = mulberry32(seed >>> 0);
    attempts = attempts || 40;

    for (var attempt = 0; attempt < attempts; attempt++) {
      var path = randomHamiltonianPath(size, rng);
      if (!path) continue;

      var walls = pickWalls(size, path, rng, cfg.wallDensity);
      var adj = buildAdj(size, wallSetOf(walls, total));

      var indices = initialIndices(path.length, total);
      var unique = false;
      for (var step = 0; step < total; step++) {
        if (isUnique(size, adj, path, indices, UNIQUE_BUDGET)) { unique = true; break; }
        if (!addDot(indices)) break;
      }
      if (!unique) continue;

      indices = pruneDots(size, adj, path, indices, rng);
      for (var e = 0; e < cfg.extraDots; e++) addDot(indices);
      indices.sort(function (a, b) { return a - b; });

      return {
        size: size,
        difficulty: cfg.key,
        seed: seed >>> 0,
        numbers: numbersFrom(path, indices, total),
        dotCount: indices.length,
        walls: walls,
        solution: path
      };
    }
    return null;
  }

  // seed を変えながら必ず 1 問返す
  function generateWithRetry(difficultyKey, seed, tries) {
    tries = tries || 8;
    for (var i = 0; i < tries; i++) {
      var puzzle = generate(difficultyKey, (seed + i * 0x9E3779B1) >>> 0);
      if (puzzle) { puzzle.baseSeed = seed >>> 0; return puzzle; }
    }
    return null;
  }

  function dailySeed(dateStr, difficultyKey) {
    return hashSeed('zip|' + dateStr + '|' + difficultyKey);
  }

  return {
    DIFFICULTIES: DIFFICULTIES,
    DIFFICULTY_ORDER: DIFFICULTY_ORDER,
    mulberry32: mulberry32,
    hashSeed: hashSeed,
    edgeId: edgeId,
    buildAdj: buildAdj,
    wallSetOf: wallSetOf,
    randomHamiltonianPath: randomHamiltonianPath,
    countSolutions: countSolutions,
    numbersFrom: numbersFrom,
    generate: generate,
    generateWithRetry: generateWithRetry,
    dailySeed: dailySeed
  };
});
