// Launch feasibility, obstacle landing calculation, and cascade simultaneous
// slides with off-board wall push-out. (spec §3.2 / §3.4 / §6)

import { GRID_SIZE, DIR_VECTORS, EXIT_WALL } from './Constants.js';

// A wall lane is launchable only if it contains ≥1 obstacle AND its mouth
// cell (the field cell adjacent to that wall) is empty — otherwise there is
// no rest cell for the landing projectile. Empty lanes are always disabled.
export function isLaneLaunchable(grid, side, lane) {
  const cells = grid.laneCells(side, lane);
  if (grid.cellAt(cells[0].x, cells[0].y) != null) return false; // mouth blocked
  for (let i = 1; i < cells.length; i++) {
    if (grid.cellAt(cells[i].x, cells[i].y) != null) return true; // obstacle ahead
  }
  return false; // empty lane
}

// First obstacle cell along a lane, or null if the lane is empty.
export function firstObstacle(grid, side, lane) {
  for (const { x, y } of grid.laneCells(side, lane)) {
    if (grid.cellAt(x, y) != null) return { x, y };
  }
  return null;
}

// Landing cell = the empty cell immediately before the first obstacle, or
// null when unlaunchable (mouth blocked, or empty lane). (spec §3.2)
export function calculateLanding(grid, side, lane) {
  const cells = grid.laneCells(side, lane);
  if (grid.cellAt(cells[0].x, cells[0].y) != null) return null; // mouth blocked
  for (let i = 1; i < cells.length; i++) {
    if (grid.cellAt(cells[i].x, cells[i].y) != null) return cells[i - 1];
  }
  return null; // empty lane
}

// Aim path for hover preview (spec §3.1): mouth → landing (inclusive) when
// launchable; the full 10-cell path on an empty lane (full-path highlight);
// empty path when the mouth is blocked.
export function getAimPath(grid, side, lane) {
  const cells = grid.laneCells(side, lane);
  const landing = calculateLanding(grid, side, lane);
  if (landing != null) {
    const idx = cells.findIndex((c) => c.x === landing.x && c.y === landing.y);
    return { launchable: true, landing, path: cells.slice(0, idx + 1) };
  }
  if (firstObstacle(grid, side, lane) == null) {
    return { launchable: false, landing: null, path: cells.slice() };
  }
  return { launchable: false, landing: null, path: [] };
}

// Resolve all simultaneous slides (spec §3.4 steps 2–3). Three passes:
//   1. compute movement ability against a SNAPSHOT (memoized dependency
//      chains; tentative-false breaks head-on cycles so facing movers stay);
//   2. claim in-bounds target cells in canonical (row-major) order;
//   3. apply atomically — clear ALL sources, then set targets + wall pushes.
// Returns { moved, moves, wallPush } where each wallPush entry is
// { from, side, lane, brick, ejected }.
export function resolveCascade(grid) {
  const movers = [];
  for (const { x, y, brick } of grid.fieldBricks()) {
    if (brick.isMoving) movers.push({ x, y, brick });
  }
  if (movers.length === 0) return { moved: false, moves: [], wallPush: [] };

  const occ = new Map(); // "x,y" → mover index (snapshot occupancy)
  for (let i = 0; i < movers.length; i++) occ.set(key(movers[i].x, movers[i].y), i);
  const staticCells = new Set(); // "x,y" → occupied by a STATIC brick (obstacle)
  for (const { x, y, brick } of grid.fieldBricks()) {
    if (!brick.isMoving) staticCells.add(key(x, y));
  }

  const canMove = new Array(movers.length).fill(null);
  const compute = (i, stack) => {
    if (canMove[i] != null) return canMove[i];
    if (stack.has(i)) return (canMove[i] = false); // cycle → both stay
    stack.add(i);
    const m = movers[i];
    const v = DIR_VECTORS[m.brick.direction];
    const tx = m.x + v.x;
    const ty = m.y + v.y;
    let result;
    if (tx < 0 || tx >= GRID_SIZE || ty < 0 || ty >= GRID_SIZE) {
      result = true; // off-board exit → always moves into a wall
    } else {
      const occupant = occ.get(key(tx, ty));
      if (occupant != null) {
        result = compute(occupant, stack); // mover ahead → move only if it moves
      } else if (staticCells.has(key(tx, ty))) {
        result = false; // static brick blocks the path
      } else {
        result = true; // empty target
      }
    }
    stack.delete(i);
    canMove[i] = result;
    return result;
  };
  for (let i = 0; i < movers.length; i++) compute(i, new Set());

  const moving = movers.map((m, i) => i).filter((i) => canMove[i]);
  moving.sort((a, b) => movers[a].y - movers[b].y || movers[a].x - movers[b].x);

  const claimed = new Set();
  const moves = [];
  const wallPush = [];
  for (const i of moving) {
    const m = movers[i];
    const v = DIR_VECTORS[m.brick.direction];
    const tx = m.x + v.x;
    const ty = m.y + v.y;
    if (tx < 0 || tx >= GRID_SIZE || ty < 0 || ty >= GRID_SIZE) {
      const side = EXIT_WALL[m.brick.direction];
      const lane = side === 'TOP' || side === 'BOTTOM' ? m.x : m.y;
      wallPush.push({ from: { x: m.x, y: m.y }, side, lane, brick: m.brick });
    } else {
      const k = key(tx, ty);
      if (claimed.has(k)) continue; // lost the claim → stay put
      claimed.add(k);
      moves.push({ from: { x: m.x, y: m.y }, to: { x: tx, y: ty }, brick: m.brick });
    }
  }

  if (moves.length === 0 && wallPush.length === 0) {
    return { moved: false, moves: [], wallPush: [] };
  }

  // Atomic apply: clear every source first, then set targets and push walls.
  for (const m of moves) grid.setCell(m.from.x, m.from.y, null);
  for (const w of wallPush) grid.setCell(w.from.x, w.from.y, null);
  for (const m of moves) grid.setCell(m.to.x, m.to.y, m.brick);
  for (const w of wallPush) w.ejected = grid.pushInnermostWall(w.side, w.lane, w.brick);

  return { moved: true, moves, wallPush };
}

function key(x, y) {
  return x + ',' + y;
}
