/* Zip の UI（盤面描画・入力・タイマー・記録） */
(function () {
  'use strict';

  var Z = window.ZipEngine;
  var SVGNS = 'http://www.w3.org/2000/svg';
  var CELL = 100;
  var PAD = 8;

  var el = {
    board: document.getElementById('board'),
    loading: document.getElementById('loading'),
    difficulty: document.getElementById('difficulty'),
    dailyBtn: document.getElementById('dailyBtn'),
    randomBtn: document.getElementById('randomBtn'),
    themeBtn: document.getElementById('themeBtn'),
    undoBtn: document.getElementById('undoBtn'),
    resetBtn: document.getElementById('resetBtn'),
    hintBtn: document.getElementById('hintBtn'),
    timer: document.getElementById('timer'),
    progress: document.getElementById('progress'),
    best: document.getElementById('best'),
    puzzleLabel: document.getElementById('puzzleLabel'),
    status: document.getElementById('status'),
    rulesBtn: document.getElementById('rulesBtn'),
    rulesOverlay: document.getElementById('rulesOverlay'),
    rulesCloseBtn: document.getElementById('rulesCloseBtn'),
    winOverlay: document.getElementById('winOverlay'),
    winTime: document.getElementById('winTime'),
    winSub: document.getElementById('winSub'),
    shareBtn: document.getElementById('shareBtn'),
    nextBtn: document.getElementById('nextBtn')
  };

  var state = {
    difficulty: load('zip.difficulty', 'normal'),
    mode: 'daily',       // 'daily' | 'random'
    puzzle: null,
    adj: null,
    path: [],
    hints: 0,
    solved: false,
    startedAt: 0,
    elapsed: 0,
    ticker: null,
    dragging: false
  };

  var layers = {};

  // ------------------------------------------------------------ ユーティリティ

  function load(key, fallback) {
    try { var v = localStorage.getItem(key); return v === null ? fallback : v; }
    catch (e) { return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* プライベートモード等 */ }
  }
  function fmtTime(sec) {
    sec = Math.max(0, Math.floor(sec));
    var m = Math.floor(sec / 60);
    return m + ':' + String(sec % 60).padStart(2, '0');
  }
  // 端末のタイムゾーンに関係なく日本時間の日付を使う（誰がいつ開いても同じ問題になる）
  function todayStr() {
    var jst = new Date(Date.now() + 9 * 3600000);
    return jst.getUTCFullYear() + '-' +
      String(jst.getUTCMonth() + 1).padStart(2, '0') + '-' +
      String(jst.getUTCDate()).padStart(2, '0');
  }
  function svg(tag, attrs) {
    var node = document.createElementNS(SVGNS, tag);
    for (var k in attrs) node.setAttribute(k, attrs[k]);
    return node;
  }
  function rowOf(cell) { return Math.floor(cell / state.puzzle.size); }
  function colOf(cell) { return cell % state.puzzle.size; }
  function cx(cell) { return colOf(cell) * CELL + CELL / 2; }
  function cy(cell) { return rowOf(cell) * CELL + CELL / 2; }

  function setStatus(msg, warn) {
    el.status.textContent = msg;
    el.status.classList.toggle('warn', !!warn);
  }

  function labelOf(key) { return Z.DIFFICULTIES[key].label; }

  // ------------------------------------------------ 今日の問題の進み具合
  //
  //  かんたん → ふつう → むずかしい → エキスパート の順にクリアしていき、
  //  4 問そろってはじめてランダム出題が解放される。
  //  記録は localStorage（使えない環境ではセッション内のメモリ）に持つ。

  var ORDER = Z.DIFFICULTY_ORDER;
  var memoryRecords = {};

  function dailyRecordKey(key) { return 'zip.daily.' + todayStr() + '.' + key; }

  function dailyRecord(key) {
    var v = load(dailyRecordKey(key), null);
    if (v !== null) return Number(v);
    var m = memoryRecords[dailyRecordKey(key)];
    return m === undefined ? null : m;
  }

  function saveDailyRecord(key, secs) {
    var prev = dailyRecord(key);
    if (prev !== null && prev <= secs) return;
    memoryRecords[dailyRecordKey(key)] = secs;
    save(dailyRecordKey(key), String(secs));
  }

  function nextDaily() {
    for (var i = 0; i < ORDER.length; i++) if (dailyRecord(ORDER[i]) === null) return ORDER[i];
    return null;
  }

  function dailyClearedCount() {
    var n = 0;
    for (var i = 0; i < ORDER.length; i++) if (dailyRecord(ORDER[i]) !== null) n++;
    return n;
  }

  function randomUnlocked() { return nextDaily() === null; }

  // 今日の問題モードでは「クリア済み」と「次に挑む 1 問」だけ選べる
  function difficultyLocked(key) {
    if (state.mode === 'random') return false;
    return dailyRecord(key) === null && key !== nextDaily();
  }

  function updateLocks() {
    Array.prototype.forEach.call(el.difficulty.children, function (b) {
      var key = b.dataset.key;
      var done = dailyRecord(key) !== null;
      var locked = difficultyLocked(key);
      b.classList.toggle('done', done && state.mode === 'daily');
      b.classList.toggle('locked', locked);
      b.title = Z.DIFFICULTIES[key].size + '×' + Z.DIFFICULTIES[key].size +
        (locked ? '（本日の「' + labelOf(nextDaily()) + '」をクリアすると挑戦できます）' : done ? '（本日クリア済み）' : '');
    });
    var locked = !randomUnlocked();
    el.randomBtn.classList.toggle('locked', locked);
    el.randomBtn.title = locked
      ? '本日の 4 問をすべてクリアすると遊べます（あと ' + (ORDER.length - dailyClearedCount()) + ' 問）'
      : 'ランダムに出題します';
  }

  // ------------------------------------------------------------------ 生成

  function newPuzzle(mode) {
    if (mode) state.mode = mode;
    el.loading.hidden = false;
    setStatus('');
    stopTimer();

    var difficulty = state.difficulty;
    var seed = state.mode === 'daily'
      ? Z.dailySeed(todayStr(), difficulty)
      : (Math.floor(Math.random() * 0xFFFFFFFF) >>> 0);

    // 生成は数百 ms かかることがあるので、ローディング表示を先に描かせる
    requestAnimationFrame(function () {
      setTimeout(function () {
        var puzzle = Z.generateWithRetry(difficulty, seed);
        el.loading.hidden = true;
        if (!puzzle) { setStatus('問題を生成できませんでした。もう一度お試しください。', true); return; }
        startPuzzle(puzzle);
      }, 20);
    });
  }

  function startPuzzle(puzzle) {
    state.puzzle = puzzle;
    state.adj = Z.buildAdj(puzzle.size, Z.wallSetOf(puzzle.walls, puzzle.size * puzzle.size));
    state.path = [];
    state.hints = 0;
    state.solved = false;
    state.elapsed = 0;
    state.startedAt = 0;
    drawBoard();
    updatePath();
    updateHud();
    startTimer();   // 問題が表示された時点から計測を始める
    updateLocks();
    setStatus(state.mode === 'daily'
      ? '本日の「' + labelOf(state.difficulty) + '」（' + dailyClearedCount() + '/' + ORDER.length + ' クリア済み）'
      : '1 のマスから指またはマウスでなぞってください。');
    el.puzzleLabel.textContent = state.mode === 'daily'
      ? '今日 ' + todayStr().slice(5)
      : '#' + puzzle.seed.toString(16).toUpperCase().padStart(8, '0').slice(0, 6);
  }

  // ------------------------------------------------------------------ 描画

  function drawBoard() {
    var p = state.puzzle, size = p.size, span = size * CELL;
    while (el.board.firstChild) el.board.removeChild(el.board.firstChild);
    el.board.setAttribute('viewBox', (-PAD) + ' ' + (-PAD) + ' ' + (span + PAD * 2) + ' ' + (span + PAD * 2));

    el.board.appendChild(svg('rect', {
      x: -2, y: -2, width: span + 4, height: span + 4, rx: 16,
      fill: 'var(--cell)', stroke: 'var(--grid)', 'stroke-width': 4
    }));

    // 罫線
    var grid = svg('g', { stroke: 'var(--grid)', 'stroke-width': 2, 'stroke-linecap': 'round' });
    for (var i = 1; i < size; i++) {
      grid.appendChild(svg('line', { x1: i * CELL, y1: 6, x2: i * CELL, y2: span - 6 }));
      grid.appendChild(svg('line', { x1: 6, y1: i * CELL, x2: span - 6, y2: i * CELL }));
    }
    el.board.appendChild(grid);

    layers.path = svg('path', {
      fill: 'none', stroke: 'var(--path)', 'stroke-width': 44,
      'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'stroke-opacity': .95, d: ''
    });
    el.board.appendChild(layers.path);

    layers.hint = svg('g', {});
    el.board.appendChild(layers.hint);

    // 番号
    var dots = svg('g', {});
    for (var cell = 0; cell < size * size; cell++) {
      var n = p.numbers[cell];
      if (!n) continue;
      dots.appendChild(svg('circle', { cx: cx(cell), cy: cy(cell), r: 31, fill: 'var(--dot)' }));
      var t = svg('text', {
        x: cx(cell), y: cy(cell), fill: 'var(--dot-text)',
        'text-anchor': 'middle', 'dominant-baseline': 'central',
        'font-size': 36, 'font-weight': 700, 'font-family': 'inherit'
      });
      t.textContent = String(n);
      dots.appendChild(t);
    }
    el.board.appendChild(dots);

    // 壁
    var walls = svg('g', { stroke: 'var(--wall)', 'stroke-width': 11, 'stroke-linecap': 'round' });
    p.walls.forEach(function (w) {
      var a = w[0], b = w[1];
      if (b === a + 1) {
        var x = (colOf(a) + 1) * CELL, y = rowOf(a) * CELL;
        walls.appendChild(svg('line', { x1: x, y1: y + 7, x2: x, y2: y + CELL - 7 }));
      } else {
        var x2 = colOf(a) * CELL, y2 = (rowOf(a) + 1) * CELL;
        walls.appendChild(svg('line', { x1: x2 + 7, y1: y2, x2: x2 + CELL - 7, y2: y2 }));
      }
    });
    el.board.appendChild(walls);
  }

  function updatePath() {
    var d = state.path.map(function (cell, i) {
      return (i === 0 ? 'M' : 'L') + cx(cell) + ' ' + cy(cell);
    }).join(' ');
    layers.path.setAttribute('d', d);
    layers.path.setAttribute('stroke', state.solved ? 'var(--path-done)' : 'var(--path)');
    clearHint();
    updateHud();
  }

  function clearHint() {
    while (layers.hint && layers.hint.firstChild) layers.hint.removeChild(layers.hint.firstChild);
  }

  function updateHud() {
    var total = state.puzzle ? state.puzzle.size * state.puzzle.size : 0;
    el.progress.textContent = state.path.length + '/' + total;
    el.timer.textContent = fmtTime(currentElapsed());
    var b = load(bestKey(), null);
    el.best.textContent = b ? fmtTime(Number(b)) : '—';
    el.undoBtn.disabled = state.path.length === 0;
  }

  function bestKey() { return 'zip.best.' + state.difficulty; }

  // ------------------------------------------------------------ タイマー

  function currentElapsed() {
    if (!state.startedAt) return state.elapsed;
    return state.elapsed + (Date.now() - state.startedAt) / 1000;
  }
  function startTimer() {
    if (state.startedAt || state.solved) return;
    state.startedAt = Date.now();
    state.ticker = setInterval(function () { el.timer.textContent = fmtTime(currentElapsed()); }, 250);
  }
  function stopTimer() {
    if (state.startedAt) { state.elapsed = currentElapsed(); state.startedAt = 0; }
    if (state.ticker) { clearInterval(state.ticker); state.ticker = null; }
  }

  // -------------------------------------------------------------- 線を引く

  function nextNumber() {
    var n = 1;
    for (var i = 0; i < state.path.length; i++) {
      if (state.puzzle.numbers[state.path[i]]) n++;
    }
    return n;
  }

  function tryStep(next) {
    if (state.solved) return false;
    var p = state.puzzle;
    var head = state.path[state.path.length - 1];
    if (head === undefined) return false;
    if (state.adj[head].indexOf(next) < 0) {
      if (isNeighborOnGrid(head, next)) reject('そこには壁があります。');
      return false;
    }
    if (state.path.indexOf(next) >= 0) return false;
    if (p.numbers[head] === p.dotCount) {
      reject('最後の番号に着いています。すべてのマスを通れていれば完成です。');
      return false;
    }
    var n = p.numbers[next];
    if (n !== 0 && n !== nextNumber()) {
      reject(nextNumber() + ' の番号を先に通ってください。');
      return false;
    }
    state.path.push(next);
    startTimer();
    updatePath();
    checkWin();
    return true;
  }

  function isNeighborOnGrid(a, b) {
    var size = state.puzzle.size;
    return Math.abs(rowOf(a) - rowOf(b)) + Math.abs(colOf(a) - colOf(b)) === 1 &&
      b >= 0 && b < size * size;
  }

  function reject(msg) {
    setStatus(msg, true);
    el.board.classList.remove('shake');
    void el.board.offsetWidth;
    el.board.classList.add('shake');
  }

  function moveTo(target) {
    if (target == null || state.solved) return;
    var guard = 0;
    while (guard++ < 24) {
      var head = state.path[state.path.length - 1];
      if (head === target) return;

      var at = state.path.indexOf(target);
      if (at >= 0) {                       // 通った線を逆になぞる → そこまで消す
        state.path.length = at + 1;
        updatePath();
        setStatus('');
        return;
      }
      if (head === undefined) {            // まだ引き始めていない
        if (state.puzzle.numbers[target] === 1) {
          state.path.push(target);
          startTimer();
          updatePath();
          setStatus('');
        }
        return;
      }
      var dr = rowOf(target) - rowOf(head), dc = colOf(target) - colOf(head);
      var order = Math.abs(dr) >= Math.abs(dc) ? ['v', 'h'] : ['h', 'v'];
      var moved = false;
      for (var i = 0; i < order.length && !moved; i++) {
        var nr = rowOf(head), nc = colOf(head);
        if (order[i] === 'v') { if (!dr) continue; nr += Math.sign(dr); }
        else { if (!dc) continue; nc += Math.sign(dc); }
        moved = tryStep(nr * state.puzzle.size + nc);
      }
      if (!moved) return;
    }
  }

  function cellFromEvent(ev) {
    var p = state.puzzle;
    if (!p) return null;
    var rect = el.board.getBoundingClientRect();
    if (!rect.width) return null;
    var units = p.size * CELL + PAD * 2;
    var ux = (ev.clientX - rect.left) / rect.width * units - PAD;
    var uy = (ev.clientY - rect.top) / rect.height * units - PAD;
    var c = Math.floor(ux / CELL), r = Math.floor(uy / CELL);
    if (r < 0 || c < 0 || r >= p.size || c >= p.size) return null;
    return r * p.size + c;
  }

  function checkWin() {
    var p = state.puzzle;
    if (state.path.length !== p.size * p.size) return;
    state.solved = true;
    stopTimer();
    updatePath();
    var secs = Math.floor(currentElapsed());   // HUD の表示（切り捨て）と揃える

    var prev = load(bestKey(), null);
    var isBest = !prev || secs < Number(prev);
    if (isBest) save(bestKey(), String(secs));
    if (state.mode === 'daily') saveDailyRecord(state.difficulty, secs);
    updateHud();
    updateLocks();

    el.winTime.textContent = fmtTime(secs);
    var detail = (isBest ? '自己ベスト更新！ ' : '') +
      (state.hints ? 'ヒント ' + state.hints + ' 回' : 'ヒントなし');
    var next = state.mode === 'daily' ? nextDaily() : null;

    if (state.mode === 'daily' && next) {
      // まだ今日の 4 問が残っている → 次の難易度へ誘導する
      el.winSub.textContent = '本日の問題 ' + dailyClearedCount() + '/' + ORDER.length + ' クリア　' + detail;
      el.nextBtn.textContent = '本日の「' + labelOf(next) + '」をプレイ';
      el.nextBtn.dataset.action = 'daily:' + next;
    } else if (state.mode === 'daily') {
      el.winSub.textContent = '本日の 4 問をすべてクリア！ ランダム出題が解放されました。　' + detail;
      el.nextBtn.textContent = 'ランダムで遊ぶ';
      el.nextBtn.dataset.action = 'random';
    } else {
      el.winSub.textContent = detail;
      el.nextBtn.textContent = '次の問題';
      el.nextBtn.dataset.action = 'random';
    }
    el.winOverlay.hidden = false;
    setStatus('クリア！おめでとうございます。');
  }

  // ------------------------------------------------------------ 入力ハンドラ

  el.board.addEventListener('pointerdown', function (ev) {
    var cell = cellFromEvent(ev);
    if (cell == null) return;
    ev.preventDefault();
    el.board.focus({ preventScroll: true });
    el.board.setPointerCapture(ev.pointerId);
    state.dragging = true;
    moveTo(cell);
  });

  el.board.addEventListener('pointermove', function (ev) {
    if (!state.dragging) return;
    var cell = cellFromEvent(ev);
    if (cell != null) moveTo(cell);
  });

  ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (type) {
    el.board.addEventListener(type, function () { state.dragging = false; });
  });

  el.board.addEventListener('keydown', function (ev) {
    var deltas = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    if (deltas[ev.key]) {
      ev.preventDefault();
      var head = state.path[state.path.length - 1];
      if (head === undefined) return;
      var r = rowOf(head) + deltas[ev.key][0], c = colOf(head) + deltas[ev.key][1];
      if (r < 0 || c < 0 || r >= state.puzzle.size || c >= state.puzzle.size) return;
      moveTo(r * state.puzzle.size + c);
    } else if (ev.key === 'Backspace') {
      ev.preventDefault(); undo();
    } else if (ev.key.toLowerCase() === 'r') {
      resetPath();
    }
  });

  function undo() {
    if (state.solved || !state.path.length) return;
    state.path.pop();
    updatePath();
    setStatus('');
  }

  function resetPath() {
    if (!state.puzzle) return;
    state.path = [];
    state.solved = false;
    updatePath();
    setStatus('線を消しました。1 のマスからやり直せます。');
  }

  function showHint() {
    if (!state.puzzle || state.solved) return;
    var sol = state.puzzle.solution;
    var i = 0;
    while (i < state.path.length && state.path[i] === sol[i]) i++;

    if (i < state.path.length) {          // 正解とずれている → ずれた所まで戻す
      state.path.length = i;
      state.hints++;
      updatePath();
      setStatus('この先は正解とずれていたので、そこまで戻しました。', true);
      return;
    }
    state.hints++;
    var next = sol[i];                    // 次に進むべきマス
    state.path.push(next);
    startTimer();
    updatePath();
    var ring = svg('circle', { cx: cx(next), cy: cy(next), r: 40, fill: 'none', stroke: 'var(--path-done)', 'stroke-width': 6 });
    layers.hint.appendChild(ring);
    setStatus('1 マス進めました（ヒント ' + state.hints + ' 回）。');
    checkWin();
  }

  function shareText() {
    var p = state.puzzle;
    var cfg = Z.DIFFICULTIES[state.difficulty];
    return 'Zip ' + cfg.label + ' ' + p.size + '×' + p.size + '\n' +
      (state.mode === 'daily' ? todayStr() : '#' + p.seed.toString(16).toUpperCase().slice(0, 6)) +
      '  ⏱ ' + fmtTime(currentElapsed()) +
      '  💡 ' + state.hints;
  }

  el.undoBtn.addEventListener('click', undo);
  el.resetBtn.addEventListener('click', resetPath);
  el.hintBtn.addEventListener('click', showHint);
  el.dailyBtn.addEventListener('click', function () { playDaily(); });

  el.randomBtn.addEventListener('click', function () {
    if (!randomUnlocked()) {
      var next = nextDaily();
      setStatus('本日の 4 問をクリアするとランダムが遊べます。まずは「' + labelOf(next) + '」から（あと ' +
        (ORDER.length - dailyClearedCount()) + ' 問）。', true);
      return;
    }
    setMode('random');
    newPuzzle('random');
  });

  el.nextBtn.addEventListener('click', function () {
    el.winOverlay.hidden = true;
    var action = el.nextBtn.dataset.action || 'random';
    if (action.indexOf('daily:') === 0) playDaily(action.slice(6));
    else { setMode('random'); newPuzzle('random'); }
  });

  // 今日の問題を開く（難易度の指定がなければ、まだクリアしていない一番やさしいもの）
  function playDaily(difficulty) {
    var key = difficulty;
    if (!key) {
      var cur = state.difficulty;
      var playable = dailyRecord(cur) !== null || cur === nextDaily();
      key = playable ? cur : (nextDaily() || cur);
    }
    setDifficulty(key);
    setMode('daily');
    newPuzzle('daily');
  }

  function setDifficulty(key) {
    state.difficulty = key;
    save('zip.difficulty', key);
    Array.prototype.forEach.call(el.difficulty.children, function (child) {
      child.setAttribute('aria-pressed', String(child.dataset.key === key));
    });
  }
  el.shareBtn.addEventListener('click', function () {
    var text = shareText();
    var done = function () { el.shareBtn.textContent = 'コピーしました'; setTimeout(function () { el.shareBtn.textContent = '結果をコピー'; }, 1600); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () { window.prompt('コピーしてください', text); });
    else window.prompt('コピーしてください', text);
  });
  el.winOverlay.addEventListener('click', function (ev) {
    if (ev.target === el.winOverlay) el.winOverlay.hidden = true;
  });

  el.rulesBtn.addEventListener('click', function () { el.rulesOverlay.hidden = false; });
  el.rulesCloseBtn.addEventListener('click', function () { el.rulesOverlay.hidden = true; });
  el.rulesOverlay.addEventListener('click', function (ev) {
    if (ev.target === el.rulesOverlay) el.rulesOverlay.hidden = true;
  });
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape') el.rulesOverlay.hidden = true;
  });

  function setMode(mode) {
    state.mode = mode;
    el.dailyBtn.setAttribute('aria-pressed', String(mode === 'daily'));
    el.randomBtn.setAttribute('aria-pressed', String(mode === 'random'));
    updateLocks();
  }

  // ------------------------------------------------------------ 難易度・配色

  ORDER.forEach(function (key) {
    var cfg = Z.DIFFICULTIES[key];
    var b = document.createElement('button');
    b.type = 'button';
    b.dataset.key = key;
    b.textContent = cfg.label;
    b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', function () {
      if (difficultyLocked(key)) {
        setStatus('本日の問題は やさしい順に挑戦します。まずは「' + labelOf(nextDaily()) + '」から。', true);
        return;
      }
      if (state.difficulty === key) return;
      setDifficulty(key);
      newPuzzle();
    });
    el.difficulty.appendChild(b);
  });

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    save('zip.theme', theme);
  }
  var storedTheme = load('zip.theme', null);
  applyTheme(storedTheme || (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  el.themeBtn.addEventListener('click', function () {
    applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
  });

  // -------------------------------------------------------------- 起動

  if (randomUnlocked()) {          // 本日の 4 問を制覇済みならランダムから始める
    setDifficulty(state.difficulty);
    setMode('random');
    newPuzzle('random');
  } else {                         // まだ残っていれば、やさしい順に今日の問題を出す
    playDaily();
  }

  window.__zip = { state: state, newPuzzle: newPuzzle }; // 動作確認・デバッグ用
})();
