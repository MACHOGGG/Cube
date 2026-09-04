// 由 scripts/build-wxgame.mjs 从 wxgame/src 打包生成，不要手改。
"use strict";
(() => {
  // src/engine/types.ts
  function effColor(t) {
    return t.face === "dot" ? t.dotColor : t.color;
  }
  function cellKey(r, c) {
    return r + "," + c;
  }

  // src/engine/rng.ts
  var source = Math.random;
  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(source() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // src/engine/scoring.ts
  function createStreakTracker() {
    let streakLevel = 0;
    function reset() {
      streakLevel = 0;
    }
    function currentMultiplier() {
      return 1 + 0.5 * streakLevel;
    }
    function apply(points) {
      if (points <= 0) {
        reset();
        return 0;
      }
      const delta = points * currentMultiplier();
      streakLevel++;
      return delta;
    }
    return { apply, currentMultiplier, reset };
  }
  var TOGGLE_STEP_CAP = 12;
  function dedupe(matches) {
    const seen = /* @__PURE__ */ new Set();
    const kept = [];
    for (const m of matches) {
      const signature = m.cells.map(([r, c]) => cellKey(r, c)).sort().join("|");
      if (seen.has(signature)) continue;
      seen.add(signature);
      kept.push(m);
    }
    return kept;
  }
  function createCascadeStepper(cfg, initialMask, labels, ledger) {
    let mask = initialMask;
    let terminal = false;
    let steps = 0;
    function next() {
      var _a;
      if (terminal) return null;
      if (cfg.toggleOnMatch && steps >= TOGGLE_STEP_CAP) {
        terminal = true;
        return null;
      }
      steps++;
      const lineBonuses = cfg.findLineBonuses();
      if (lineBonuses.length) {
        const points = lineBonuses.reduce((sum, cells) => sum + cells.length ** 2, 0);
        const clearedDotColors = lineBonuses.map(([[r, c]]) => cfg.tileAt(r, c).dotColor);
        cfg.onLineBonus(lineBonuses);
        if (cfg.resetMaskOnLineBonus) mask = null;
        if ((_a = cfg.isTerminalAfterLineBonus) == null ? void 0 : _a.call(cfg)) terminal = true;
        return {
          points,
          matchGroups: [],
          lineBonusGroups: lineBonuses,
          weight: 3 * lineBonuses.length,
          label: labels.line,
          clearedDotColors,
          commit() {
          }
        };
      }
      const nextMask = /* @__PURE__ */ new Set();
      const idsOf = (m) => m.cells.map(([r, c]) => cfg.tileAt(r, c).id);
      const matches = dedupe(
        cfg.findMatches(mask).filter((m) => m.cells.some(([r, c]) => cfg.tileAt(r, c).face === "flavor"))
      ).filter((m) => !ledger || ledger.allows(idsOf(m)));
      if (matches.length) {
        let points = 0;
        const toFlip = /* @__PURE__ */ new Set();
        for (const m of matches) {
          ledger == null ? void 0 : ledger.note(idsOf(m));
          points += m.points;
          for (const [r, c] of m.cells) {
            nextMask.add(cellKey(r, c));
            if (cfg.toggleOnMatch || cfg.tileAt(r, c).face === "flavor") toFlip.add(cellKey(r, c));
          }
        }
        mask = nextMask;
        return {
          points,
          matchGroups: matches.map((m) => m.cells),
          lineBonusGroups: [],
          // A pattern that grew past its 4-cell seed is worth two actions.
          weight: matches.reduce((sum, m) => sum + (m.cells.length > 4 ? 2 : 1), 0),
          label: matches.map((m) => {
            var _a2;
            return (_a2 = m.label) != null ? _a2 : labels.pattern;
          }).join(" \xB7 "),
          clearedDotColors: [],
          commit() {
            for (const key of toFlip) {
              const [r, c] = key.split(",").map(Number);
              const t = cfg.tileAt(r, c);
              t.face = cfg.toggleOnMatch && t.face === "dot" ? "flavor" : "dot";
            }
          }
        };
      }
      terminal = true;
      return null;
    }
    return { next };
  }

  // src/engine/stalemate.ts
  var MIN_MATCH_SIZE = 4;
  function findStuckColorGroups(liveTiles, _clearedDotColors, minMatch = MIN_MATCH_SIZE, lineMin) {
    var _a, _b, _c;
    const need = Math.max(1, Math.round(minMatch));
    const lineNeed = Math.max(1, Math.round(lineMin));
    const fronts = liveTiles.filter((lt) => lt.tile.face === "flavor");
    if (fronts.length === 0) return [];
    const dotCount = /* @__PURE__ */ new Map();
    for (const lt of liveTiles) {
      if (lt.tile.face !== "dot") continue;
      dotCount.set(lt.tile.dotColor, ((_a = dotCount.get(lt.tile.dotColor)) != null ? _a : 0) + 1);
    }
    for (const n of dotCount.values()) if (n >= lineNeed) return [];
    const shownColor = (lt) => lt.tile.face === "dot" ? lt.tile.dotColor : lt.tile.color;
    const up = /* @__PURE__ */ new Map();
    for (const lt of liveTiles) up.set(shownColor(lt), ((_b = up.get(shownColor(lt))) != null ? _b : 0) + 1);
    const frontCount = /* @__PURE__ */ new Map();
    for (const lt of fronts) frontCount.set(lt.tile.color, ((_c = frontCount.get(lt.tile.color)) != null ? _c : 0) + 1);
    const reachable = /* @__PURE__ */ new Set();
    for (const [color, count] of up) if (count >= need) reachable.add(color);
    for (; ; ) {
      let pool = 0;
      for (const [color, count] of frontCount) if (reachable.has(color)) pool += count;
      let grew = false;
      for (const [color, count] of up) {
        if (reachable.has(color)) continue;
        if (count + pool >= need) {
          reachable.add(color);
          grew = true;
        }
      }
      if (!grew) break;
    }
    for (const color of frontCount.keys()) if (reachable.has(color)) return [];
    const byColor = /* @__PURE__ */ new Map();
    for (const lt of fronts) {
      const arr = byColor.get(lt.tile.color);
      if (arr) arr.push(lt.cell);
      else byColor.set(lt.tile.color, [lt.cell]);
    }
    return [...byColor.values()];
  }
  function countRemainingTiles(liveTiles) {
    let neverFlipped = 0;
    let flippedButRemaining = 0;
    for (const { tile } of liveTiles) {
      if (tile.face === "flavor") neverFlipped++;
      else flippedButRemaining++;
    }
    return { neverFlipped, flippedButRemaining };
  }

  // wxgame/src/squareBoard.ts
  var BOARD_DIM = 6;
  var PALETTE = ["#C46A4E", "#9C8A3D", "#4A9573", "#4C7EAD", "#8067A8", "#AD5C82"];
  function createSquareBoard(labels) {
    let rows = BOARD_DIM;
    let cols = BOARD_DIM;
    let grid = [];
    let nextTileId = 0;
    let pendingRowClears = [];
    let pendingColClears = [];
    function newTile(color, dotColor) {
      return { id: nextTileId++, color, face: "flavor", dotColor };
    }
    function shuffledDeck() {
      const deck = [];
      for (let c = 0; c < PALETTE.length; c++) for (let i = 0; i < BOARD_DIM; i++) deck.push(c);
      return shuffle(deck);
    }
    function assignDotColors(deck) {
      const dotColors = new Array(deck.length);
      for (let color = 0; color < PALETTE.length; color++) {
        const assignments = shuffle([
          ...Array.from({ length: PALETTE.length }, (_, k) => k).filter((k) => k !== color),
          color
        ]);
        const indices = [];
        deck.forEach((c, idx) => {
          if (c === color) indices.push(idx);
        });
        indices.forEach((idx, i) => {
          dotColors[idx] = assignments[i];
        });
      }
      return dotColors;
    }
    function boardFromDeck(deck) {
      const dots = assignDotColors(deck);
      const g = [];
      for (let r = 0; r < BOARD_DIM; r++) {
        const row = [];
        for (let c = 0; c < BOARD_DIM; c++) {
          const idx = r * BOARD_DIM + c;
          row.push(newTile(deck[idx], dots[idx]));
        }
        g.push(row);
      }
      return g;
    }
    function hasInitialClump(g) {
      const R = g.length;
      const C = g[0].length;
      const col = (r, c) => g[r][c].color;
      for (let r = 0; r < R; r++)
        for (let c = 0; c < C; c++) {
          if (c <= C - 3 && col(r, c) === col(r, c + 1) && col(r, c) === col(r, c + 2)) return true;
          if (r <= R - 3 && col(r, c) === col(r + 1, c) && col(r, c) === col(r + 2, c)) return true;
          if (r <= R - 2 && c <= C - 2 && col(r, c) === col(r, c + 1) && col(r, c) === col(r + 1, c) && col(r, c) === col(r + 1, c + 1))
            return true;
          if (r <= R - 3 && c <= C - 3 && col(r, c) === col(r + 1, c + 1) && col(r, c) === col(r + 2, c + 2)) return true;
          if (r <= R - 3 && c >= 2 && col(r, c) === col(r + 1, c - 1) && col(r, c) === col(r + 2, c - 2)) return true;
        }
      return false;
    }
    function deal() {
      let g;
      let tries = 0;
      do {
        g = boardFromDeck(shuffledDeck());
        tries++;
      } while (hasInitialClump(g) && tries < 500);
      grid = g;
      rows = BOARD_DIM;
      cols = BOARD_DIM;
      pendingRowClears = [];
      pendingColClears = [];
    }
    function shift(axis, index, by) {
      const mask = /* @__PURE__ */ new Set();
      if (axis === "row") {
        const r = index;
        const n = cols;
        grid[r] = grid[r].map((_, i) => grid[r][((i - by) % n + n) % n]);
        for (let c = 0; c < cols; c++) mask.add(cellKey(r, c));
      } else {
        const c = index;
        const n = rows;
        const colVals = grid.map((row) => row[c]);
        const shifted = colVals.map((_, i) => colVals[((i - by) % n + n) % n]);
        for (let r = 0; r < rows; r++) grid[r][c] = shifted[r];
        for (let r = 0; r < rows; r++) mask.add(cellKey(r, c));
      }
      return mask;
    }
    function effColorAt(r, c) {
      return effColor(grid[r][c]);
    }
    function cellsSameColor(cells) {
      const c0 = effColorAt(cells[0][0], cells[0][1]);
      return cells.every(([r, c]) => effColorAt(r, c) === c0);
    }
    function touches(cells, mask) {
      if (!mask) return true;
      return cells.some(([r, c]) => mask.has(cellKey(r, c)));
    }
    function extendRunHoriz(r, cStart, cEnd) {
      const color = effColorAt(r, cStart);
      let lo = cStart;
      let hi = cEnd;
      while (lo - 1 >= 0 && effColorAt(r, lo - 1) === color) lo--;
      while (hi + 1 < cols && effColorAt(r, hi + 1) === color) hi++;
      const cells = [];
      for (let c = lo; c <= hi; c++) cells.push([r, c]);
      return cells;
    }
    function extendRunVert(c, rStart, rEnd) {
      const color = effColorAt(rStart, c);
      let lo = rStart;
      let hi = rEnd;
      while (lo - 1 >= 0 && effColorAt(lo - 1, c) === color) lo--;
      while (hi + 1 < rows && effColorAt(hi + 1, c) === color) hi++;
      const cells = [];
      for (let r = lo; r <= hi; r++) cells.push([r, c]);
      return cells;
    }
    function rowSpanMatches(r, c0, c1, color) {
      for (let c = c0; c <= c1; c++) if (effColorAt(r, c) !== color) return false;
      return true;
    }
    function colSpanMatches(c, r0, r1, color) {
      for (let r = r0; r <= r1; r++) if (effColorAt(r, c) !== color) return false;
      return true;
    }
    function extendRect(r0, c0, r1, c1) {
      const color = effColorAt(r0, c0);
      let grew = true;
      while (grew) {
        grew = false;
        if (r0 - 1 >= 0 && rowSpanMatches(r0 - 1, c0, c1, color)) {
          r0--;
          grew = true;
        }
        if (r1 + 1 < rows && rowSpanMatches(r1 + 1, c0, c1, color)) {
          r1++;
          grew = true;
        }
        if (c0 - 1 >= 0 && colSpanMatches(c0 - 1, r0, r1, color)) {
          c0--;
          grew = true;
        }
        if (c1 + 1 < cols && colSpanMatches(c1 + 1, r0, r1, color)) {
          c1++;
          grew = true;
        }
      }
      const cells = [];
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) cells.push([r, c]);
      return cells;
    }
    function findMatches(mask) {
      const matches = [];
      for (let r = 0; r < rows - 1; r++)
        for (let c = 0; c < cols - 1; c++) {
          const seed = [[r, c], [r, c + 1], [r + 1, c], [r + 1, c + 1]];
          if (!cellsSameColor(seed) || !touches(seed, mask)) continue;
          const region = extendRect(r, c, r + 1, c + 1);
          matches.push({ cells: region, points: Math.max(4, region.length), label: labels.block22 });
        }
      for (let r = 0; r < rows; r++)
        for (let c = 0; c <= cols - 4; c++) {
          const seed = [[r, c], [r, c + 1], [r, c + 2], [r, c + 3]];
          if (!cellsSameColor(seed) || !touches(seed, mask)) continue;
          const region = extendRunHoriz(r, c, c + 3);
          matches.push({ cells: region, points: Math.max(4, region.length), label: labels.run4 });
        }
      for (let c = 0; c < cols; c++)
        for (let r = 0; r <= rows - 4; r++) {
          const seed = [[r, c], [r + 1, c], [r + 2, c], [r + 3, c]];
          if (!cellsSameColor(seed) || !touches(seed, mask)) continue;
          const region = extendRunVert(c, r, r + 3);
          matches.push({ cells: region, points: Math.max(4, region.length), label: labels.run4 });
        }
      return matches;
    }
    function isFullDotMatch(tiles) {
      if (tiles.some((t) => t.face !== "dot")) return false;
      const c0 = tiles[0].dotColor;
      return tiles.every((t) => t.dotColor === c0);
    }
    function findLineBonuses() {
      const rowClears = [];
      for (let r = 0; r < rows; r++) if (isFullDotMatch(grid[r])) rowClears.push(r);
      const colClears = [];
      for (let c = 0; c < cols; c++) if (isFullDotMatch(grid.map((row) => row[c]))) colClears.push(c);
      pendingRowClears = rowClears;
      pendingColClears = colClears;
      const groups = [];
      for (const r of rowClears) groups.push(Array.from({ length: cols }, (_, c) => [r, c]));
      for (const c of colClears) groups.push(Array.from({ length: rows }, (_, r) => [r, c]));
      return groups;
    }
    function removeLines(rowClears, colClears) {
      if (rowClears.length) {
        const keep = new Set(Array.from({ length: rows }, (_, i) => i));
        rowClears.forEach((r) => keep.delete(r));
        grid = Array.from(keep).sort((a, b) => a - b).map((r) => grid[r]);
        rows = grid.length;
      }
      if (colClears.length && rows > 0) {
        const keep = new Set(Array.from({ length: cols }, (_, i) => i));
        colClears.forEach((c) => keep.delete(c));
        grid = grid.map(
          (row) => Array.from(keep).sort((a, b) => a - b).map((c) => row[c])
        );
        cols = grid[0] ? grid[0].length : 0;
      }
    }
    function applyLineBonus() {
      removeLines(pendingRowClears, pendingColClears);
      pendingRowClears = [];
      pendingColClears = [];
    }
    function cascadeConfig() {
      return {
        tileAt: (r, c) => grid[r][c],
        findMatches,
        findLineBonuses,
        onLineBonus: applyLineBonus,
        resetMaskOnLineBonus: true,
        isTerminalAfterLineBonus: () => rows === 0 || cols === 0
      };
    }
    function liveTiles() {
      const live = [];
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) live.push({ cell: [r, c], tile: grid[r][c] });
      return live;
    }
    function linesThrough(r, c) {
      const row = Array.from({ length: cols }, (_, i) => [r, i]);
      const col = Array.from({ length: rows }, (_, i) => [i, c]);
      return [
        { id: "R" + r, cells: row, vec: [1, 0] },
        { id: "C" + c, cells: col, vec: [0, 1] }
      ];
    }
    function shiftLine(id, by) {
      const index = Number(id.slice(1));
      return shift(id[0] === "R" ? "row" : "col", index, by);
    }
    return {
      kind: "square",
      palette: PALETTE,
      get rows() {
        return rows;
      },
      get cols() {
        return cols;
      },
      cellsInRow: () => cols,
      tileAt: (r, c) => grid[r][c],
      isBlankAt: () => false,
      // 一格是 2×2 个单位（1 个单位 = 半格），所以中心在奇数格点上。
      centerOf: (r, c) => [c * 2 + 1, r * 2 + 1],
      extent: () => ({ minX: 0, minY: 0, w: cols * 2, h: rows * 2 }),
      linesThrough,
      shiftLine,
      deal,
      shift,
      cascade: (mask) => createCascadeStepper(cascadeConfig(), mask, { pattern: labels.pattern, line: labels.line }),
      isGameOver: () => grid.length > 0 && grid.every((row) => row.every((t) => t.face === "dot")) || rows === 0 || cols === 0,
      // 反面自己只靠整行 / 整列得分，行列会随消除变短——门槛跟着当前较短的边长走。
      stuckGroups: () => findStuckColorGroups(liveTiles(), /* @__PURE__ */ new Set(), void 0, Math.min(rows, cols)),
      remaining: () => countRemainingTiles(liveTiles())
    };
  }

  // src/engine/matchGrowth.ts
  function extendRunInLine(lineCells, seedStart, seedEnd, effColorAt, isLive) {
    const [sr, sc] = lineCells[seedStart];
    const color = effColorAt(sr, sc);
    let lo = seedStart;
    let hi = seedEnd;
    while (lo - 1 >= 0) {
      const [r, c] = lineCells[lo - 1];
      if (!isLive(r, c) || effColorAt(r, c) !== color) break;
      lo--;
    }
    while (hi + 1 < lineCells.length) {
      const [r, c] = lineCells[hi + 1];
      if (!isLive(r, c) || effColorAt(r, c) !== color) break;
      hi++;
    }
    return lineCells.slice(lo, hi + 1);
  }
  function growParallelogram(positionAt, effColorAt, isLive) {
    const anchor = positionAt(0, 0);
    const color = effColorAt(anchor[0], anchor[1]);
    const lineMatches = (fixedAxis, fixedVal, otherLo, otherHi) => {
      for (let k = otherLo; k <= otherHi; k++) {
        const cell = fixedAxis === "u" ? positionAt(fixedVal, k) : positionAt(k, fixedVal);
        if (!cell) return false;
        const [r, c] = cell;
        if (!isLive(r, c) || effColorAt(r, c) !== color) return false;
      }
      return true;
    };
    let u0 = 0;
    let u1 = 1;
    let v0 = 0;
    let v1 = 1;
    let grew = true;
    while (grew) {
      grew = false;
      if (lineMatches("u", u0 - 1, v0, v1)) {
        u0--;
        grew = true;
      }
      if (lineMatches("u", u1 + 1, v0, v1)) {
        u1++;
        grew = true;
      }
      if (lineMatches("v", v0 - 1, u0, u1)) {
        v0--;
        grew = true;
      }
      if (lineMatches("v", v1 + 1, u0, u1)) {
        v1++;
        grew = true;
      }
    }
    const cells = [];
    for (let u = u0; u <= u1; u++) for (let v = v0; v <= v1; v++) cells.push(positionAt(u, v));
    return cells;
  }

  // wxgame/src/circleBoard.ts
  var CIRCLE_ROWS = 7;
  var PER_COLOR = 7;
  var MIN_LINE_BONUS_LEN = 3;
  var BLANK = -1;
  var CIRCLE_PALETTE = ["#C0666B", "#DDA857", "#7A9C4A", "#4F72C4"];
  function cellValid(r, c) {
    return r >= 0 && r < CIRCLE_ROWS && c >= 0 && c <= r;
  }
  function lineA(d) {
    const cells = [];
    for (let r = d; r < CIRCLE_ROWS; r++) cells.push([r, r - d]);
    return cells;
  }
  function lineB(e) {
    const cells = [];
    for (let r = e; r < CIRCLE_ROWS; r++) cells.push([r, e]);
    return cells;
  }
  function lineRow(r) {
    const cells = [];
    for (let c = 0; c <= r; c++) cells.push([r, c]);
    return cells;
  }
  var LINES = (() => {
    const out = [];
    for (let d = 0; d < CIRCLE_ROWS; d++) out.push({ id: "A" + d, fam: "A", cells: lineA(d) });
    for (let e = 0; e < CIRCLE_ROWS; e++) out.push({ id: "B" + e, fam: "B", cells: lineB(e) });
    for (let r = 0; r < CIRCLE_ROWS; r++) out.push({ id: "R" + r, fam: "R", cells: lineRow(r) });
    return out;
  })();
  var FAM_VEC = {
    R: [1, 0],
    B: [0.5, Math.sqrt(3) / 2],
    A: [-0.5, Math.sqrt(3) / 2]
  };
  function rhombus22B(r, c) {
    const cells = [[r, c], [r, c + 1], [r + 1, c], [r + 1, c + 1]];
    return cells.every(([rr, cc]) => cellValid(rr, cc)) ? cells : null;
  }
  function rhombus22A(r, c) {
    const cells = [[r, c], [r, c + 1], [r + 1, c + 1], [r + 1, c + 2]];
    return cells.every(([rr, cc]) => cellValid(rr, cc)) ? cells : null;
  }
  function diamond121(r, c) {
    const cells = [[r, c], [r + 1, c], [r + 1, c + 1], [r + 2, c + 1]];
    return cells.every(([rr, cc]) => cellValid(rr, cc)) ? cells : null;
  }
  var CLUSTERS = (() => {
    const groups = [];
    for (let r = 0; r < CIRCLE_ROWS; r++)
      for (let c = 0; c <= r; c++) {
        const b = rhombus22B(r, c);
        if (b) groups.push(b);
        const a = rhombus22A(r, c);
        if (a) groups.push(a);
        const d = diamond121(r, c);
        if (d) groups.push(d);
      }
    return groups;
  })();
  function createCircleBoard(labels) {
    let grid = [];
    let nextTileId = 0;
    let bonusedSignatures = /* @__PURE__ */ new Set();
    let pendingBonus = [];
    const newTile = (color, dotColor) => ({ id: nextTileId++, color, face: "flavor", dotColor });
    const isBlank = (t) => t.color === BLANK;
    const anyBlank = (cells) => cells.some(([r, c]) => isBlank(grid[r][c]));
    const effColorAt = (r, c) => effColor(grid[r][c]);
    const isLiveCell = (r, c) => cellValid(r, c) && !isBlank(grid[r][c]);
    function shuffledDeck() {
      const deck = [];
      for (let c = 0; c < CIRCLE_PALETTE.length; c++) for (let i = 0; i < PER_COLOR; i++) deck.push(c);
      return shuffle(deck);
    }
    function assignDotColors(deck) {
      const dots = new Array(deck.length);
      for (let color = 0; color < CIRCLE_PALETTE.length; color++) {
        const others = [];
        for (let k = 0; k < CIRCLE_PALETTE.length; k++) if (k !== color) others.push(k, k);
        others.push(color);
        shuffle(others);
        const idxs = [];
        deck.forEach((c, i) => {
          if (c === color) idxs.push(i);
        });
        idxs.forEach((idx, i) => {
          dots[idx] = others[i];
        });
      }
      return dots;
    }
    function boardFromDeck(deck) {
      const dots = assignDotColors(deck);
      const g = [];
      let idx = 0;
      for (let r = 0; r < CIRCLE_ROWS; r++) {
        const row = [];
        for (let c = 0; c <= r; c++) row.push(newTile(deck[idx], dots[idx++]));
        g.push(row);
      }
      return g;
    }
    function hasInitialClump(g) {
      for (const line of LINES) {
        const colors = line.cells.map(([r, c]) => g[r][c].color);
        for (let i = 0; i + 3 < colors.length; i++)
          if (colors[i] === colors[i + 1] && colors[i] === colors[i + 2] && colors[i] === colors[i + 3]) return true;
      }
      for (const cells of CLUSTERS) {
        const c0 = g[cells[0][0]][cells[0][1]].color;
        if (cells.every(([r, c]) => g[r][c].color === c0)) return true;
      }
      return false;
    }
    function deal() {
      let g;
      let tries = 0;
      do {
        g = boardFromDeck(shuffledDeck());
        tries++;
      } while (hasInitialClump(g) && tries < 500);
      grid = g;
      bonusedSignatures = /* @__PURE__ */ new Set();
      pendingBonus = [];
    }
    function shiftLine(id, by) {
      const line = LINES.find((l) => l.id === id);
      const mask = /* @__PURE__ */ new Set();
      if (!line) return mask;
      const n = line.cells.length;
      const step = (by % n + n) % n;
      if (step !== 0) {
        const vals = line.cells.map(([r, c]) => grid[r][c]);
        const shifted = vals.map((_, i) => vals[((i - by) % n + n) % n]);
        line.cells.forEach(([r, c], i) => {
          grid[r][c] = shifted[i];
        });
      }
      for (const [r, c] of line.cells) mask.add(cellKey(r, c));
      return mask;
    }
    function qualifies(seed, mask) {
      if (anyBlank(seed)) return false;
      const c0 = effColorAt(seed[0][0], seed[0][1]);
      if (!seed.every(([r, c]) => effColorAt(r, c) === c0)) return false;
      if (mask && !seed.some(([r, c]) => mask.has(cellKey(r, c)))) return false;
      return true;
    }
    function findMatches(mask) {
      const matches = [];
      for (const line of LINES) {
        const cells = line.cells;
        for (let i = 0; i + 3 < cells.length; i++) {
          const seed = cells.slice(i, i + 4);
          if (!qualifies(seed, mask)) continue;
          const region = extendRunInLine(cells, i, i + 3, effColorAt, isLiveCell);
          matches.push({ cells: region, points: Math.max(4, region.length), label: labels.run4 });
        }
      }
      for (let r = 0; r < CIRCLE_ROWS; r++)
        for (let c = 0; c <= r; c++) {
          const b = rhombus22B(r, c);
          if (b && qualifies(b, mask)) {
            const at = (u, v) => cellValid(r + v, c + u) ? [r + v, c + u] : null;
            const region = growParallelogram(at, effColorAt, isLiveCell);
            matches.push({ cells: region, points: Math.max(4, region.length), label: labels.block22 });
          }
          const a = rhombus22A(r, c);
          if (a && qualifies(a, mask)) {
            const at = (u, v) => cellValid(r + v, c + u + v) ? [r + v, c + u + v] : null;
            const region = growParallelogram(at, effColorAt, isLiveCell);
            matches.push({ cells: region, points: Math.max(4, region.length), label: labels.block22 });
          }
          const d = diamond121(r, c);
          if (d && qualifies(d, mask)) matches.push({ cells: d, points: 4, label: labels.diamond121 });
        }
      return matches;
    }
    function isFullDotMatch(cells) {
      if (cells.some(([r, c]) => grid[r][c].face !== "dot")) return false;
      const c0 = grid[cells[0][0]][cells[0][1]].dotColor;
      return cells.every(([r, c]) => grid[r][c].dotColor === c0);
    }
    function findLineBonuses() {
      const found = [];
      for (const line of LINES) {
        if (line.cells.length < MIN_LINE_BONUS_LEN) continue;
        if (anyBlank(line.cells)) continue;
        if (!isFullDotMatch(line.cells)) continue;
        const sig = line.cells.map(([r, c]) => grid[r][c].id).sort((a, b) => a - b).join(",");
        if (bonusedSignatures.has(sig)) continue;
        bonusedSignatures.add(sig);
        found.push(line.cells);
      }
      pendingBonus = found;
      return found;
    }
    function applyLineBonus() {
      for (const cells of pendingBonus)
        for (const [r, c] of cells) {
          const t = grid[r][c];
          if (t.face === "flavor") t.face = "dot";
          t.color = BLANK;
          t.dotColor = BLANK;
        }
      pendingBonus = [];
    }
    function liveTiles() {
      const live = [];
      for (let r = 0; r < CIRCLE_ROWS; r++)
        for (let c = 0; c <= r; c++) {
          const t = grid[r][c];
          if (!isBlank(t)) live.push({ cell: [r, c], tile: t });
        }
      return live;
    }
    return {
      kind: "circle",
      palette: CIRCLE_PALETTE,
      get rows() {
        return CIRCLE_ROWS;
      },
      cellsInRow: (r) => r + 1,
      tileAt: (r, c) => grid[r][c],
      isBlankAt: (r, c) => isBlank(grid[r][c]),
      // 一颗的中心，单位是半径的倍数：横向一步 2，纵向一排 √3，每往下一排整排
      // 往左错半步——这就是三角形堆球的摆法。
      centerOf: (r, c) => [(c - r / 2) * 2, r * Math.sqrt(3)],
      // 中心的 x 从 -(排数-1) 到 +(排数-1)，y 从 0 到 (排数-1)×√3；每颗还有 1
      // 个单位的半径要算进去，所以四边各往外让 1。
      extent: () => ({
        minX: -(CIRCLE_ROWS - 1) - 1,
        minY: -1,
        w: (CIRCLE_ROWS - 1) * 2 + 2,
        h: (CIRCLE_ROWS - 1) * Math.sqrt(3) + 2
      }),
      linesThrough(r, c) {
        return LINES.filter((l) => l.cells.some(([rr, cc]) => rr === r && cc === c)).map((l) => ({
          id: l.id,
          cells: l.cells,
          vec: FAM_VEC[l.fam]
        }));
      },
      shiftLine,
      deal,
      cascade: (mask) => createCascadeStepper(
        {
          tileAt: (r, c) => grid[r][c],
          findMatches,
          findLineBonuses,
          onLineBonus: applyLineBonus,
          resetMaskOnLineBonus: false
        },
        mask,
        { pattern: labels.pattern, line: labels.line }
      ),
      isGameOver: () => grid.every((row) => row.every((t) => isBlank(t) || t.face === "dot")),
      // 反面自己只靠整线得分，这副棋盘最短的整线是 3 颗。
      stuckGroups: () => findStuckColorGroups(liveTiles(), /* @__PURE__ */ new Set(), void 0, MIN_LINE_BONUS_LEN),
      remaining: () => countRemainingTiles(liveTiles())
    };
  }

  // wxgame/src/platform.ts
  function createPlatform() {
    if (typeof wx !== "undefined" && typeof wx.createCanvas === "function") return wxPlatform();
    return browserPlatform();
  }
  function wxPlatform() {
    const canvas = wx.createCanvas();
    const info = typeof wx.getWindowInfo === "function" ? wx.getWindowInfo() : wx.getSystemInfoSync();
    const dpr = info.pixelRatio || 1;
    const width = info.windowWidth;
    const height = info.windowHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    const at = (e) => {
      var _a, _b, _c;
      const t = (_c = (_a = e == null ? void 0 : e.touches) == null ? void 0 : _a[0]) != null ? _c : (_b = e == null ? void 0 : e.changedTouches) == null ? void 0 : _b[0];
      return t ? [t.clientX, t.clientY] : null;
    };
    return {
      ctx,
      width,
      height,
      isWx: true,
      onTouch(h) {
        wx.onTouchStart((e) => {
          const p2 = at(e);
          if (p2) h.start(p2[0], p2[1]);
        });
        wx.onTouchMove((e) => {
          const p2 = at(e);
          if (p2) h.move(p2[0], p2[1]);
        });
        wx.onTouchEnd((e) => {
          const p2 = at(e);
          if (p2) h.end(p2[0], p2[1]);
        });
        wx.onTouchCancel((e) => {
          const p2 = at(e);
          if (p2) h.end(p2[0], p2[1]);
        });
      },
      vibrate() {
        var _a;
        try {
          (_a = wx.vibrateShort) == null ? void 0 : _a.call(wx, { type: "light" });
        } catch (e) {
        }
      },
      requestFrame(fn) {
        requestAnimationFrame(fn);
      },
      now: () => Date.now()
    };
  }
  function browserPlatform() {
    const canvas = document.createElement("canvas");
    const dpr = window.devicePixelRatio || 1;
    const width = window.innerWidth;
    const height = window.innerHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = width + "px";
    canvas.style.height = height + "px";
    canvas.style.display = "block";
    canvas.style.touchAction = "none";
    canvas.id = "wxgame";
    document.body.style.margin = "0";
    document.body.appendChild(canvas);
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    return {
      ctx,
      width,
      height,
      isWx: false,
      onTouch(h) {
        let down = false;
        canvas.addEventListener("pointerdown", (e) => {
          down = true;
          canvas.setPointerCapture(e.pointerId);
          h.start(e.clientX, e.clientY);
        });
        canvas.addEventListener("pointermove", (e) => {
          if (down) h.move(e.clientX, e.clientY);
        });
        const up = (e) => {
          if (!down) return;
          down = false;
          h.end(e.clientX, e.clientY);
        };
        canvas.addEventListener("pointerup", up);
        canvas.addEventListener("pointercancel", up);
      },
      vibrate() {
        var _a;
        try {
          (_a = navigator.vibrate) == null ? void 0 : _a.call(navigator, 8);
        } catch (e) {
        }
      },
      requestFrame(fn) {
        requestAnimationFrame(fn);
      },
      now: () => Date.now()
    };
  }

  // wxgame/src/render.ts
  var STEP_UNITS = 2;
  var COLORS = {
    page: "#FAF6EC",
    board: "rgba(251, 248, 241, 0.6)",
    boardEdge: "rgba(61, 49, 40, 0.18)",
    ink: "#2E2430",
    inkSoft: "#7A5C48",
    outline: "#FFFFFF",
    stuck: "#C0392B",
    accent: "#B23A3A",
    /** 消掉之后留在原地的空球（网页版的 --ink-faint，压到三成半）。 */
    blank: "rgba(154, 139, 152, 0.35)"
  };
  function roundRect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }
  function piecePath(ctx, kind, cx, cy, radius) {
    if (kind === "circle") {
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      return;
    }
    roundRect(ctx, cx - radius, cy - radius, radius * 2, radius * 2, radius * 0.36);
  }
  function drawPiece(ctx, tile, kind, cx, cy, unit, palette) {
    const radius = unit * 0.94;
    const color = tile.face === "dot" ? tile.dotColor : tile.color;
    if (color < 0) {
      ctx.fillStyle = COLORS.blank;
      piecePath(ctx, kind, cx, cy, radius);
      ctx.fill();
      return;
    }
    if (tile.face !== "dot") {
      ctx.fillStyle = palette[color];
      piecePath(ctx, kind, cx, cy, radius);
      ctx.fill();
      return;
    }
    if (kind === "circle") {
      const k = radius * 0.95 / 12;
      ctx.strokeStyle = palette[color];
      ctx.lineWidth = 5.5 * k;
      ctx.lineCap = "round";
      const seg = (x1, y1, x2, y2) => {
        ctx.beginPath();
        ctx.moveTo(cx + (x1 - 12) * k, cy + (y1 - 12) * k);
        ctx.lineTo(cx + (x2 - 12) * k, cy + (y2 - 12) * k);
        ctx.stroke();
      };
      seg(12, 2.5, 12, 21.5);
      seg(4, 6.75, 20, 17.25);
      seg(20, 6.75, 4, 17.25);
      return;
    }
    ctx.fillStyle = palette[color];
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 0.86, 0, Math.PI * 2);
    ctx.fill();
  }
  function pixelOf(board2, layout2, r, c) {
    const [ux, uy] = board2.centerOf(r, c);
    const e = board2.extent();
    return [layout2.x + (ux - e.minX) * layout2.unit, layout2.y + (uy - e.minY) * layout2.unit];
  }
  function cellAtPoint(board2, layout2, px, py) {
    let best = null;
    let bestD = Infinity;
    for (let r = 0; r < board2.rows; r++)
      for (let c = 0; c < board2.cellsInRow(r); c++) {
        const [x, y] = pixelOf(board2, layout2, r, c);
        const d = (x - px) ** 2 + (y - py) ** 2;
        if (d < bestD) {
          bestD = d;
          best = [r, c];
        }
      }
    const reach = layout2.unit * 1.6;
    return best && bestD <= reach * reach ? best : null;
  }
  function drawBoard(ctx, board2, layout2, drag2, highlights2, stuck) {
    const e = board2.extent();
    const { x, y, unit } = layout2;
    const w = e.w * unit;
    const h = e.h * unit;
    const palette = board2.palette;
    ctx.fillStyle = COLORS.board;
    roundRect(ctx, x - 8, y - 8, w + 16, h + 16, 14);
    ctx.fill();
    ctx.strokeStyle = COLORS.boardEdge;
    ctx.lineWidth = 1;
    ctx.stroke();
    const onDrag = /* @__PURE__ */ new Set();
    if (drag2) for (const [r, c] of drag2.cells) onDrag.add(cellKey(r, c));
    ctx.save();
    roundRect(ctx, x - 8, y - 8, w + 16, h + 16, 14);
    ctx.clip();
    for (let r = 0; r < board2.rows; r++)
      for (let c = 0; c < board2.cellsInRow(r); c++) {
        if (onDrag.has(cellKey(r, c))) continue;
        const [px, py] = pixelOf(board2, layout2, r, c);
        drawPiece(ctx, board2.tileAt(r, c), board2.kind, px, py, unit, palette);
      }
    if (drag2) {
      const span = drag2.cells.length * STEP_UNITS * unit;
      for (let k = -1; k <= 1; k++) {
        const off = drag2.offsetPx + k * span;
        for (const [r, c] of drag2.cells) {
          const [px, py] = pixelOf(board2, layout2, r, c);
          drawPiece(
            ctx,
            board2.tileAt(r, c),
            board2.kind,
            px + drag2.vec[0] * off,
            py + drag2.vec[1] * off,
            unit,
            palette
          );
        }
      }
    }
    const ring = (cells, color) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(2, unit * 0.16);
      for (const [r, c] of cells) {
        const [px, py] = pixelOf(board2, layout2, r, c);
        piecePath(ctx, board2.kind, px, py, unit * 0.94);
        ctx.stroke();
      }
    };
    for (const hl of highlights2) ring(hl.cells, hl.kind === "line" ? COLORS.accent : COLORS.outline);
    if (stuck) {
      const cells = [];
      for (let r = 0; r < board2.rows; r++)
        for (let c = 0; c < board2.cellsInRow(r); c++) if (stuck.has(cellKey(r, c))) cells.push([r, c]);
      ring(cells, COLORS.stuck);
    }
    ctx.restore();
  }
  function fmtTime(sec) {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return m + ":" + (s < 10 ? "0" : "") + s;
  }
  function drawHud(ctx, width, top, hud) {
    const slots = [
      [hud.labels.score, String(hud.score)],
      [hud.labels.rate, hud.ratePercent + "%"],
      [hud.labels.time, fmtTime(hud.elapsedSec)]
    ];
    const gap = 10;
    const slotW = (width - 32 - gap * 2) / 3;
    slots.forEach(([label, value], i) => {
      const sx = 16 + i * (slotW + gap);
      ctx.fillStyle = "rgba(255,255,255,0.7)";
      roundRect(ctx, sx, top, slotW, 58, 12);
      ctx.fill();
      ctx.fillStyle = COLORS.inkSoft;
      ctx.font = "600 11px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      ctx.fillText(label, sx + slotW / 2, top + 20);
      ctx.fillStyle = COLORS.ink;
      ctx.font = "700 22px monospace";
      ctx.fillText(value, sx + slotW / 2, top + 47);
    });
  }
  function drawEndCard(ctx, width, height, d) {
    ctx.fillStyle = "rgba(46, 36, 48, 0.45)";
    ctx.fillRect(0, 0, width, height);
    const cw = Math.min(320, width - 40);
    const ch = 278 + d.lines.length * 22;
    const cx = (width - cw) / 2;
    const cy = (height - ch) / 2;
    ctx.fillStyle = "#FBF8F1";
    roundRect(ctx, cx, cy, cw, ch, 18);
    ctx.fill();
    ctx.textAlign = "center";
    ctx.fillStyle = COLORS.inkSoft;
    ctx.font = "600 14px sans-serif";
    ctx.fillText(d.title, width / 2, cy + 34);
    ctx.fillStyle = COLORS.ink;
    ctx.font = "700 44px monospace";
    ctx.fillText(String(d.total), width / 2, cy + 88);
    ctx.font = "500 13px sans-serif";
    ctx.fillStyle = COLORS.inkSoft;
    d.lines.forEach((line, i) => ctx.fillText(line, width / 2, cy + 122 + i * 22));
    const bw = 180;
    const bh = 46;
    const bx = width / 2 - bw / 2;
    const hy = cy + ch - bh - 20;
    const by = hy - bh - 12;
    ctx.fillStyle = COLORS.accent;
    roundRect(ctx, bx, by, bw, bh, 23);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.font = "700 16px sans-serif";
    ctx.fillText(d.again, width / 2, by + 30);
    ctx.strokeStyle = COLORS.boardEdge;
    ctx.lineWidth = 2;
    roundRect(ctx, bx, hy, bw, bh, 23);
    ctx.stroke();
    ctx.fillStyle = COLORS.inkSoft;
    ctx.font = "600 15px sans-serif";
    ctx.fillText(d.home, width / 2, hy + 29);
    return { again: [bx, by, bw, bh], home: [bx, hy, bw, bh] };
  }

  // wxgame/src/menu.ts
  var MARK_BG = "#A8A5A0";
  var MARK_COLORS = ["#4C7EAD", "#E2941F", "#C0392B", "#2E8B45"];
  function iconSquare(ctx, x, y, s) {
    ctx.fillStyle = MARK_BG;
    roundRect(ctx, x, y, s, s, s * 0.16);
    ctx.fill();
    const pad = s * 0.16;
    const gap = s * 0.045;
    const cell = (s - pad * 2 - gap) / 2;
    for (let i = 0; i < 4; i++) {
      const cx = x + pad + i % 2 * (cell + gap);
      const cy = y + pad + Math.floor(i / 2) * (cell + gap);
      ctx.fillStyle = MARK_COLORS[i];
      roundRect(ctx, cx, cy, cell, cell, cell * 0.22);
      ctx.fill();
      ctx.strokeStyle = COLORS.outline;
      ctx.lineWidth = Math.max(1.5, s * 0.022);
      ctx.stroke();
    }
  }
  function iconCircle(ctx, x, y, s) {
    ctx.fillStyle = MARK_BG;
    ctx.beginPath();
    ctx.arc(x + s / 2, y + s / 2, s / 2, 0, Math.PI * 2);
    ctx.fill();
    const r = s * 0.115;
    const spots = [
      [0.5, 0.28, 1],
      [0.32, 0.5, 3],
      [0.68, 0.5, 0],
      [0.5, 0.72, 2]
    ];
    for (const [fx, fy, ci] of spots) {
      ctx.fillStyle = MARK_COLORS[ci];
      ctx.beginPath();
      ctx.arc(x + s * fx, y + s * fy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = COLORS.outline;
      ctx.lineWidth = Math.max(1.5, s * 0.022);
      ctx.stroke();
    }
  }
  function drawMenu(ctx, width, height, entries, text) {
    ctx.fillStyle = COLORS.page;
    ctx.fillRect(0, 0, width, height);
    const titleY = Math.max(72, height * 0.14);
    ctx.textAlign = "center";
    ctx.fillStyle = COLORS.ink;
    ctx.font = `700 ${Math.round(Math.min(width * 0.11, 46))}px sans-serif`;
    ctx.fillText(text.title, width / 2, titleY);
    ctx.fillStyle = COLORS.inkSoft;
    ctx.font = `${Math.round(Math.min(width * 0.038, 16))}px sans-serif`;
    ctx.fillText(text.tagline, width / 2, titleY + 26);
    const perRow = Math.min(3, Math.max(1, entries.length));
    const rows = Math.ceil(entries.length / perRow);
    const gap = Math.round(width * 0.05);
    const side = Math.round(width * 0.06);
    const byWidth = (width - side * 2 - gap * (perRow - 1)) / perRow;
    const top = titleY + 56;
    const bottom = height - Math.max(40, height * 0.08);
    const byHeight = (bottom - top - gap * (rows - 1)) / rows - 26;
    const size = Math.max(64, Math.min(byWidth, byHeight, 190));
    const hits = [];
    const blockH = size + 26;
    const startY = top + Math.max(0, (bottom - top - (blockH * rows + gap * (rows - 1))) / 2);
    for (let i = 0; i < entries.length; i++) {
      const row = Math.floor(i / perRow);
      const inRow = Math.min(perRow, entries.length - row * perRow);
      const col = i - row * perRow;
      const rowW = size * inRow + gap * (inRow - 1);
      const x = Math.round((width - rowW) / 2 + col * (size + gap));
      const y = Math.round(startY + row * (blockH + gap));
      entries[i].icon(ctx, x, y, size);
      ctx.fillStyle = COLORS.ink;
      ctx.font = `600 ${Math.round(Math.min(size * 0.16, 18))}px sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText(entries[i].name, x + size / 2, y + size + 20);
      hits.push({ id: entries[i].id, rect: [x, y, size, size + 26] });
    }
    return hits;
  }
  function drawCountdown(ctx, width, height, entry, n, phase) {
    ctx.fillStyle = COLORS.page;
    ctx.fillRect(0, 0, width, height);
    const size = Math.min(width * 0.42, 180);
    const x = (width - size) / 2;
    const y = height * 0.28 - size / 2;
    entry.icon(ctx, x, y, size);
    ctx.textAlign = "center";
    ctx.fillStyle = COLORS.ink;
    ctx.font = `600 ${Math.round(Math.min(width * 0.05, 20))}px sans-serif`;
    ctx.fillText(entry.name, width / 2, y + size + 30);
    const scale = 1.5 - 0.5 * Math.min(1, phase * 3);
    const fs = Math.round(Math.min(width * 0.28, 120) * scale);
    ctx.fillStyle = COLORS.accent;
    ctx.font = `700 ${fs}px sans-serif`;
    ctx.fillText(String(n), width / 2, height * 0.72);
  }

  // wxgame/src/composite.ts
  var TIME_GAIN = 1.5;
  var UNFLIPPED_SCALE = 0.95;
  function timeMultiplierFor(elapsedSec2, gain = TIME_GAIN) {
    const t = Math.max(0, elapsedSec2);
    const base = t <= 300 ? 2 - t / 300 : 0.5 + 0.5 * Math.exp(-(t - 300) / 150);
    return 1 + gain * (base - 1);
  }
  function compositeScore(i) {
    const timeMult = timeMultiplierFor(i.elapsedSec);
    const bonusMult = 1 + i.ratePercent / 100;
    const unflippedScale = UNFLIPPED_SCALE ** i.neverFlipped;
    const total = Math.max(0, Math.round(i.score * timeMult * bonusMult * unflippedScale));
    return { total, timeMult, bonusMult, unflippedScale };
  }

  // src/engine/performance.ts
  function createPerformanceGauge() {
    let scoredActions = 0;
    let totalActions = 0;
    function onMove(weight) {
      const w = Math.max(0, Math.round(weight));
      scoredActions += w;
      totalActions += Math.max(1, w);
    }
    function valuePercent() {
      if (totalActions === 0) return 0;
      return Math.round(scoredActions / totalActions * 100);
    }
    function reset() {
      scoredActions = 0;
      totalActions = 0;
    }
    return { onMove, valuePercent, reset };
  }

  // wxgame/src/main.ts
  var T = {
    score: "\u5F97\u5206",
    rate: "\u6709\u6548\u5F97\u5206\u7387",
    time: "\u7528\u65F6",
    block22: "2\xD72",
    run4: "1\xD74",
    line: "\u6574\u7EBF",
    pattern: "\u56FE\u6848",
    diamond121: "1-2-1",
    over: "\u6311\u6218\u7ED3\u675F \xB7 \u7EFC\u5408\u5F97\u5206",
    again: "\u518D\u6765",
    rawScore: "\u5F97\u5206",
    timeMult: "\u7528\u65F6\u7CFB\u6570",
    rateBonus: "\u6709\u6548\u5F97\u5206\u7387\u52A0\u6210",
    unflipped: "\u4ECE\u672A\u7FFB\u9762",
    moves: "\u6B65",
    title: "Slides",
    tagline: "\u6ED1\u52A8 \u2013 \u5F97\u5206 \u2013 \u6D88\u9664",
    home: "\u56DE\u4E3B\u83DC\u5355",
    square: "\u65B9\u5757",
    circle: "\u5C0F\u7403"
  };
  var GAMES = [
    { id: "square", name: T.square, icon: iconSquare, create: createSquareBoard },
    { id: "circle", name: T.circle, icon: iconCircle, create: createCircleBoard }
  ];
  var screen = "menu";
  var menuHits = [];
  var current = GAMES[0];
  var COUNT_FROM = 4;
  var countStartedAt = 0;
  var homeRect = null;
  var CASCADE_COMBO_FACTOR = 3;
  var HIGHLIGHT_MS = 450;
  var STEP_GAP_MS = 260;
  var BONUS_GAP_MS = 650;
  var STUCK_END_MS = 1400;
  var DEAD_ZONE_PX = 6;
  var p = createPlatform();
  var LABELS = {
    block22: T.block22,
    run4: T.run4,
    line: T.line,
    pattern: T.pattern,
    diamond121: T.diamond121
  };
  var board = GAMES[0].create(LABELS);
  var streak = createStreakTracker();
  var perf = createPerformanceGauge();
  var score = 0;
  var moves = 0;
  var startedAt = 0;
  var over = false;
  var resolving = false;
  var highlights = [];
  var stuckKeys = null;
  var endCard = null;
  var againRect = null;
  var drag = null;
  var along = (line, dx, dy) => dx * line.vec[0] + dy * line.vec[1];
  var HUD_TOP = 48;
  var HUD_H = 58;
  function layout() {
    const top = HUD_TOP + HUD_H + 22;
    const availW = p.width - 32;
    const availH = p.height - top - 40;
    const e = board.extent();
    const unit = Math.min(availW / e.w, availH / e.h);
    const x = Math.round((p.width - e.w * unit) / 2);
    const y = Math.round(top + (availH - e.h * unit) / 2);
    return { x, y, unit };
  }
  function elapsedSec() {
    return over ? endElapsed : (p.now() - startedAt) / 1e3;
  }
  var endElapsed = 0;
  function startCountdown(entry) {
    current = entry;
    screen = "count";
    countStartedAt = p.now();
  }
  function newGame() {
    screen = "play";
    board = current.create(LABELS);
    board.deal();
    score = 0;
    moves = 0;
    streak.reset();
    perf.reset();
    highlights = [];
    stuckKeys = null;
    endCard = null;
    againRect = null;
    over = false;
    resolving = false;
    drag = null;
    homeRect = null;
    startedAt = p.now();
  }
  function goHome() {
    screen = "menu";
    over = false;
    resolving = false;
    drag = null;
    endCard = null;
    againRect = null;
    homeRect = null;
  }
  function endGame() {
    if (over) return;
    over = true;
    resolving = false;
    endElapsed = (p.now() - startedAt) / 1e3;
    const ratePercent = perf.valuePercent();
    const remaining = board.remaining();
    const comp = compositeScore({ score, elapsedSec: endElapsed, ratePercent, neverFlipped: remaining.neverFlipped });
    endCard = {
      total: comp.total,
      lines: [
        `${T.rawScore} ${score}`,
        `${T.timeMult} \xD7${comp.timeMult.toFixed(2)} \xB7 ${T.rateBonus} \xD7${comp.bonusMult.toFixed(2)}`,
        `${T.unflipped} \xD7 ${remaining.neverFlipped} \u2192 \xD7${comp.unflippedScale.toFixed(2)}`,
        `${moves} ${T.moves} \xB7 ${fmtTime(endElapsed)}`
      ]
    };
  }
  function resolveMove(mask) {
    if (over || resolving) return;
    moves++;
    resolving = true;
    p.vibrate();
    const stepper = board.cascade(mask);
    const multiplier = streak.currentMultiplier();
    let comboMult = 1;
    let totalRaw = 0;
    let moveWeight = 0;
    const finish = () => {
      streak.apply(totalRaw);
      perf.onMove(moveWeight);
      highlights = [];
      if (board.isGameOver()) {
        endGame();
        return;
      }
      const stuck = board.stuckGroups();
      if (stuck.length) {
        stuckKeys = new Set(stuck.flat().map(([r, c]) => cellKey(r, c)));
        setTimeout(() => endGame(), STUCK_END_MS);
      }
      resolving = false;
    };
    const step = () => {
      const s = stepper.next();
      if (!s) {
        finish();
        return;
      }
      totalRaw += s.points;
      moveWeight += s.weight;
      const delta = Math.round(s.points * multiplier * comboMult);
      comboMult *= CASCADE_COMBO_FACTOR;
      const isBonus = s.lineBonusGroups.length > 0;
      highlights = [
        ...s.matchGroups.map((cells) => ({ cells, kind: "match" })),
        ...s.lineBonusGroups.map((cells) => ({ cells, kind: "line" }))
      ];
      p.vibrate();
      const proceed = () => {
        s.commit();
        score += delta;
        highlights = [];
        setTimeout(step, isBonus ? BONUS_GAP_MS : STEP_GAP_MS);
      };
      if (s.matchGroups.length) setTimeout(proceed, HIGHLIGHT_MS);
      else proceed();
    };
    step();
  }
  var inRect = (r, x, y) => !!r && x >= r[0] && x <= r[0] + r[2] && y >= r[1] && y <= r[1] + r[3];
  p.onTouch({
    start(x, y) {
      if (screen === "menu") {
        const hit2 = menuHits.find((h) => inRect(h.rect, x, y));
        const entry = hit2 && GAMES.find((g) => g.id === hit2.id);
        if (entry) {
          p.vibrate();
          startCountdown(entry);
        }
        return;
      }
      if (screen === "count") return;
      if (over) {
        if (inRect(againRect, x, y)) newGame();
        else if (inRect(homeRect, x, y)) goHome();
        return;
      }
      if (resolving) return;
      const hit = cellAtPoint(board, layout(), x, y);
      if (!hit) return;
      drag = { line: null, lines: board.linesThrough(hit[0], hit[1]), x0: x, y0: y, dx: 0, dy: 0, lastShift: 0 };
    },
    move(x, y) {
      if (screen !== "play" || !drag) return;
      drag.dx = x - drag.x0;
      drag.dy = y - drag.y0;
      if (!drag.line) {
        if (Math.abs(drag.dx) < DEAD_ZONE_PX && Math.abs(drag.dy) < DEAD_ZONE_PX) return;
        let best = null;
        let bestProj = 0;
        for (const line of drag.lines) {
          const proj = Math.abs(along(line, drag.dx, drag.dy));
          if (proj > bestProj) {
            bestProj = proj;
            best = line;
          }
        }
        drag.line = best;
        if (!drag.line) return;
      }
      const L = layout();
      const shift = Math.round(along(drag.line, drag.dx, drag.dy) / (L.unit * STEP_UNITS));
      if (shift !== drag.lastShift) {
        drag.lastShift = shift;
        p.vibrate();
      }
    },
    end(x, y) {
      const d = drag;
      drag = null;
      if (screen !== "play" || !d || !d.line) return;
      d.dx = x - d.x0;
      d.dy = y - d.y0;
      const L = layout();
      const by = Math.round(along(d.line, d.dx, d.dy) / (L.unit * STEP_UNITS));
      if (by === 0) return;
      resolveMove(board.shiftLine(d.line.id, by));
    }
  });
  function draw() {
    const ctx = p.ctx;
    if (screen === "menu") {
      menuHits = drawMenu(ctx, p.width, p.height, GAMES, { title: T.title, tagline: T.tagline });
      return;
    }
    if (screen === "count") {
      const left = COUNT_FROM * 1e3 - (p.now() - countStartedAt);
      if (left <= 0) {
        newGame();
        return;
      }
      const n = Math.ceil(left / 1e3);
      drawCountdown(ctx, p.width, p.height, current, n, 1 - left % 1e3 / 1e3);
      return;
    }
    ctx.fillStyle = COLORS.page;
    ctx.fillRect(0, 0, p.width, p.height);
    drawHud(ctx, p.width, HUD_TOP, {
      score,
      ratePercent: perf.valuePercent(),
      elapsedSec: elapsedSec(),
      labels: { score: T.score, rate: T.rate, time: T.time }
    });
    const L = layout();
    let dv = null;
    if (drag == null ? void 0 : drag.line) {
      dv = { cells: drag.line.cells, vec: drag.line.vec, offsetPx: along(drag.line, drag.dx, drag.dy) };
    }
    if (board.rows > 0) drawBoard(ctx, board, L, dv, highlights, stuckKeys);
    if (over && endCard) {
      const r = drawEndCard(ctx, p.width, p.height, {
        title: T.over,
        total: endCard.total,
        lines: endCard.lines,
        again: T.again,
        home: T.home
      });
      againRect = r.again;
      homeRect = r.home;
    }
  }
  function loop() {
    draw();
    p.requestFrame(loop);
  }
  loop();
  if (!p.isWx) {
    globalThis.__slidesWx = {
      get board() {
        return board;
      },
      layout,
      games: GAMES.map((g) => g.id),
      get screen() {
        return screen;
      },
      get menuHits() {
        return menuHits;
      },
      /** 回归脚本用：直接开一局，不等那四秒。 */
      startNow(id) {
        var _a;
        current = (_a = GAMES.find((g) => g.id === id)) != null ? _a : GAMES[0];
        newGame();
      },
      /** 回归脚本用：照着屏幕坐标拖一条线，和真手指走同一段代码。 */
      get drag() {
        return drag;
      },
      goHome,
      /** 回归脚本用：这一颗的中心在屏幕上的哪儿——好照着它拖。 */
      pixelOf: (r, c) => pixelOf(board, layout(), r, c),
      /** 一步有多长（像素）：拖这么远正好滑一格。 */
      stepPx: () => layout().unit * STEP_UNITS,
      get score() {
        return score;
      },
      get over() {
        return over;
      },
      get resolving() {
        return resolving;
      }
    };
  }
})();
