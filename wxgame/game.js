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
  function createCascadeStepper(cfg, initialMask, labels) {
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
      const matches = dedupe(
        cfg.findMatches(mask).filter((m) => m.cells.some(([r, c]) => cfg.tileAt(r, c).face === "flavor"))
      );
      if (matches.length) {
        let points = 0;
        const toFlip = /* @__PURE__ */ new Set();
        for (const m of matches) {
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
    return {
      get rows() {
        return rows;
      },
      get cols() {
        return cols;
      },
      tileAt: (r, c) => grid[r][c],
      deal,
      shift,
      cascade: (mask) => createCascadeStepper(cascadeConfig(), mask, { pattern: labels.pattern, line: labels.line }),
      isGameOver: () => grid.length > 0 && grid.every((row) => row.every((t) => t.face === "dot")) || rows === 0 || cols === 0,
      // 反面自己只靠整行 / 整列得分，行列会随消除变短——门槛跟着当前较短的边长走。
      stuckGroups: () => findStuckColorGroups(liveTiles(), /* @__PURE__ */ new Set(), void 0, Math.min(rows, cols)),
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
  var COLORS = {
    page: "#FAF6EC",
    board: "rgba(251, 248, 241, 0.6)",
    boardEdge: "rgba(61, 49, 40, 0.18)",
    ink: "#2E2430",
    inkSoft: "#7A5C48",
    dotFace: "#3D3128",
    outline: "#FFFFFF",
    stuck: "#C0392B",
    accent: "#B23A3A"
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
  function drawTile(ctx, tile, x, y, cell, palette) {
    const pad = Math.max(2, cell * 0.06);
    const size = cell - pad * 2;
    const radius = size * 0.18;
    if (tile.face === "dot") {
      ctx.fillStyle = COLORS.dotFace;
      roundRect(ctx, x + pad, y + pad, size, size, radius);
      ctx.fill();
      ctx.fillStyle = palette[tile.dotColor];
      ctx.beginPath();
      ctx.arc(x + cell / 2, y + cell / 2, size * 0.43, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = palette[tile.color];
      roundRect(ctx, x + pad, y + pad, size, size, radius);
      ctx.fill();
    }
  }
  function drawBoard(ctx, board2, layout2, palette, drag2, highlights2, stuck) {
    const { x, y, cell } = layout2;
    const w = board2.cols * cell;
    const h = board2.rows * cell;
    ctx.fillStyle = COLORS.board;
    roundRect(ctx, x - 8, y - 8, w + 16, h + 16, 14);
    ctx.fill();
    ctx.strokeStyle = COLORS.boardEdge;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    for (let r = 0; r < board2.rows; r++)
      for (let c = 0; c < board2.cols; c++) {
        const onDragLine = drag2 && (drag2.axis === "row" ? drag2.index === r : drag2.index === c);
        if (onDragLine) continue;
        drawTile(ctx, board2.tileAt(r, c), x + c * cell, y + r * cell, cell, palette);
      }
    if (drag2) {
      const n = drag2.axis === "row" ? board2.cols : board2.rows;
      for (let k = -1; k <= 1; k++) {
        const wrap = k * n * cell;
        for (let i = 0; i < n; i++) {
          const r = drag2.axis === "row" ? drag2.index : i;
          const c = drag2.axis === "row" ? i : drag2.index;
          const tx = drag2.axis === "row" ? x + c * cell + drag2.offsetPx + wrap : x + c * cell;
          const ty = drag2.axis === "col" ? y + r * cell + drag2.offsetPx + wrap : y + r * cell;
          drawTile(ctx, board2.tileAt(r, c), tx, ty, cell, palette);
        }
      }
    }
    for (const hl of highlights2) {
      ctx.strokeStyle = hl.kind === "line" ? COLORS.accent : COLORS.outline;
      ctx.lineWidth = Math.max(2, cell * 0.08);
      for (const [r, c] of hl.cells) {
        const pad = Math.max(2, cell * 0.06);
        roundRect(ctx, x + c * cell + pad, y + r * cell + pad, cell - pad * 2, cell - pad * 2, (cell - pad * 2) * 0.18);
        ctx.stroke();
      }
    }
    if (stuck) {
      ctx.strokeStyle = COLORS.stuck;
      ctx.lineWidth = Math.max(2, cell * 0.08);
      for (let r = 0; r < board2.rows; r++)
        for (let c = 0; c < board2.cols; c++) {
          if (!stuck.has(cellKey(r, c))) continue;
          const pad = Math.max(2, cell * 0.06);
          roundRect(ctx, x + c * cell + pad, y + r * cell + pad, cell - pad * 2, cell - pad * 2, (cell - pad * 2) * 0.18);
          ctx.stroke();
        }
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
    const ch = 220 + d.lines.length * 22;
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
    const bw = 140;
    const bh = 46;
    const bx = width / 2 - bw / 2;
    const by = cy + ch - bh - 22;
    ctx.fillStyle = COLORS.accent;
    roundRect(ctx, bx, by, bw, bh, 23);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.font = "700 16px sans-serif";
    ctx.fillText(d.again, width / 2, by + 30);
    return { again: [bx, by, bw, bh] };
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
    over: "\u6311\u6218\u7ED3\u675F \xB7 \u7EFC\u5408\u5F97\u5206",
    again: "\u518D\u6765",
    rawScore: "\u5F97\u5206",
    timeMult: "\u7528\u65F6\u7CFB\u6570",
    rateBonus: "\u6709\u6548\u5F97\u5206\u7387\u52A0\u6210",
    unflipped: "\u4ECE\u672A\u7FFB\u9762",
    moves: "\u6B65"
  };
  var CASCADE_COMBO_FACTOR = 3;
  var HIGHLIGHT_MS = 450;
  var STEP_GAP_MS = 260;
  var BONUS_GAP_MS = 650;
  var STUCK_END_MS = 1400;
  var DEAD_ZONE_PX = 6;
  var p = createPlatform();
  var board = createSquareBoard({ block22: T.block22, run4: T.run4, line: T.line, pattern: T.pattern });
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
  var HUD_TOP = 48;
  var HUD_H = 58;
  function layout() {
    const top = HUD_TOP + HUD_H + 22;
    const availW = p.width - 32;
    const availH = p.height - top - 40;
    const cell = Math.floor(Math.min(availW / Math.max(1, board.cols), availH / Math.max(1, board.rows)));
    const x = Math.round((p.width - cell * board.cols) / 2);
    const y = Math.round(top + (availH - cell * board.rows) / 2);
    return { x, y, cell };
  }
  function elapsedSec() {
    return over ? endElapsed : (p.now() - startedAt) / 1e3;
  }
  var endElapsed = 0;
  function newGame() {
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
    startedAt = p.now();
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
  p.onTouch({
    start(x, y) {
      if (over) {
        const a = againRect;
        if (a && x >= a[0] && x <= a[0] + a[2] && y >= a[1] && y <= a[1] + a[3]) newGame();
        return;
      }
      if (resolving) return;
      const L = layout();
      const c = Math.floor((x - L.x) / L.cell);
      const r = Math.floor((y - L.y) / L.cell);
      if (r < 0 || c < 0 || r >= board.rows || c >= board.cols) return;
      drag = { r, c, axis: null, x0: x, y0: y, dx: 0, dy: 0, lastShift: 0 };
    },
    move(x, y) {
      if (!drag) return;
      drag.dx = x - drag.x0;
      drag.dy = y - drag.y0;
      if (!drag.axis) {
        if (Math.abs(drag.dx) < DEAD_ZONE_PX && Math.abs(drag.dy) < DEAD_ZONE_PX) return;
        drag.axis = Math.abs(drag.dx) > Math.abs(drag.dy) ? "row" : "col";
      }
      const L = layout();
      const shift = Math.round((drag.axis === "row" ? drag.dx : drag.dy) / L.cell);
      if (shift !== drag.lastShift) {
        drag.lastShift = shift;
        p.vibrate();
      }
    },
    end(x, y) {
      const d = drag;
      drag = null;
      if (!d || !d.axis) return;
      d.dx = x - d.x0;
      d.dy = y - d.y0;
      const L = layout();
      const by = Math.round((d.axis === "row" ? d.dx : d.dy) / L.cell);
      if (by === 0) return;
      const mask = board.shift(d.axis, d.axis === "row" ? d.r : d.c, by);
      resolveMove(mask);
    }
  });
  function draw() {
    const ctx = p.ctx;
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
    if (drag == null ? void 0 : drag.axis) {
      dv = {
        axis: drag.axis,
        index: drag.axis === "row" ? drag.r : drag.c,
        offsetPx: drag.axis === "row" ? drag.dx : drag.dy
      };
    }
    if (board.rows > 0 && board.cols > 0) drawBoard(ctx, board, L, PALETTE, dv, highlights, stuckKeys);
    if (over && endCard) {
      const r = drawEndCard(ctx, p.width, p.height, { title: T.over, total: endCard.total, lines: endCard.lines, again: T.again });
      againRect = r.again;
    }
  }
  function loop() {
    draw();
    p.requestFrame(loop);
  }
  newGame();
  loop();
  if (!p.isWx) {
    globalThis.__slidesWx = {
      board,
      layout,
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
