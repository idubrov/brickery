// Board state management: the 10×10 central field + 4 wall queues
// (10 lanes × 3 layers each). (spec §2 / §6)
//
// Coordinate convention: x = column (0..9), y = row (0..9), origin top-left,
// +y = down. `field[y][x]` holds a Brick or null.
// `walls[side][lane][layer]` holds a Brick; layer 0 = innermost/clickable.
// Lane ↔ field mapping (wall mouth = the field cell adjacent to that wall):
//   TOP    lane = column x → mouth (x, 0),  shoots South
//   BOTTOM lane = column x → mouth (x, 9),  shoots North
//   LEFT   lane = row    y → mouth (0, y),  shoots East
//   RIGHT  lane = row    y → mouth (9, y),  shoots West

import { GRID_SIZE, WALL_DEPTH, WALL_SIDES, COLOR_LIST, DIR } from './Constants.js';
import { Brick } from './Brick.js';

function makeWalls() {
  const w = {};
  for (const side of WALL_SIDES) {
    w[side] = Array.from({ length: GRID_SIZE }, () => new Array(WALL_DEPTH).fill(null));
  }
  return w;
}

function randomColor(random) {
  const idx = Math.floor(random() * COLOR_LIST.length) % COLOR_LIST.length;
  return COLOR_LIST[idx];
}

function randomInt(random, min, max) {
  return min + Math.floor(random() * (max - min + 1));
}

export class Grid {
  constructor(field, walls) {
    this.field = field; // 10×10, field[y][x] = Brick | null
    this.walls = walls; // { TOP: [[l0,l1,l2] × 10 lanes], ... }
  }

  // Build a fresh board: empty field + fully populated walls, then place
  // `count` static (direction NONE) bricks at distinct random cells.
  static generate({ random = Math.random, count } = {}) {
    const field = Array.from({ length: GRID_SIZE }, () => new Array(GRID_SIZE).fill(null));
    const walls = makeWalls();
    for (const side of WALL_SIDES) {
      for (let lane = 0; lane < GRID_SIZE; lane++) {
        for (let layer = 0; layer < WALL_DEPTH; layer++) {
          walls[side][lane][layer] = new Brick({ color: randomColor(random) });
        }
      }
    }
    const grid = new Grid(field, walls);
    const n = count != null ? count : randomInt(random, 5, 14);
    grid.placeRandomBricks(n, random);
    return grid;
  }

  // Place `count` static bricks at distinct random cells (Fisher–Yates with
  // the injected RNG for determinism).
  placeRandomBricks(count, random = Math.random) {
    const cells = [];
    for (let y = 0; y < GRID_SIZE; y++) {
      for (let x = 0; x < GRID_SIZE; x++) cells.push({ x, y });
    }
    for (let i = cells.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [cells[i], cells[j]] = [cells[j], cells[i]];
    }
    for (let k = 0; k < Math.min(count, cells.length); k++) {
      const { x, y } = cells[k];
      this.field[y][x] = new Brick({ color: randomColor(random), direction: DIR.NONE });
    }
    return this;
  }

  clone() {
    const field = this.field.map((row) => row.map((b) => (b ? new Brick(b) : null)));
    const walls = {};
    for (const side of WALL_SIDES) {
      walls[side] = this.walls[side].map((lane) => lane.map((b) => new Brick(b)));
    }
    return new Grid(field, walls);
  }

  cellAt(x, y) {
    if (x < 0 || x >= GRID_SIZE || y < 0 || y >= GRID_SIZE) return null;
    return this.field[y][x];
  }

  setCell(x, y, brick) {
    this.field[y][x] = brick;
  }

  wallAt(side, lane, layer) {
    return this.walls[side][lane][layer];
  }

  // Ordered field cell coords for a lane, wall mouth → far side (spec §3.2).
  laneCells(side, lane) {
    const cells = [];
    for (let i = 0; i < GRID_SIZE; i++) {
      switch (side) {
        case 'TOP': cells.push({ x: lane, y: i }); break;
        case 'BOTTOM': cells.push({ x: lane, y: GRID_SIZE - 1 - i }); break;
        case 'LEFT': cells.push({ x: i, y: lane }); break;
        case 'RIGHT': cells.push({ x: GRID_SIZE - 1 - i, y: lane }); break;
        default: throw new Error(`Unknown side: ${side}`);
      }
    }
    return cells;
  }

  // Pop the innermost (layer 0) brick as the projectile, shift 1→0, 2→1,
  // drop a fresh random brick into layer 2 (spec §3.1). Returns the projectile.
  popAndShiftWall(side, lane, random = Math.random) {
    const queue = this.walls[side][lane];
    const popped = queue[0];
    queue[0] = queue[1];
    queue[1] = queue[2];
    queue[2] = new Brick({ color: randomColor(random) });
    return popped;
  }

  // Dock an arriving brick into layer 0 (direction reset to NONE), shift
  // 0→1, 1→2, eject layer 2 (spec §3.4). Returns the ejected brick.
  pushInnermostWall(side, lane, brick) {
    const queue = this.walls[side][lane];
    const ejected = queue[2];
    queue[2] = queue[1];
    queue[1] = queue[0];
    queue[0] = new Brick({ id: brick.id, color: brick.color, direction: DIR.NONE });
    return ejected;
  }

  isFieldEmpty() {
    for (let y = 0; y < GRID_SIZE; y++) {
      for (let x = 0; x < GRID_SIZE; x++) {
        if (this.field[y][x] != null) return false;
      }
    }
    return true;
  }

  // Iterate all non-null field bricks as { x, y, brick }.
  *fieldBricks() {
    for (let y = 0; y < GRID_SIZE; y++) {
      for (let x = 0; x < GRID_SIZE; x++) {
        const b = this.field[y][x];
        if (b) yield { x, y, brick: b };
      }
    }
  }

  toJSON() {
    return {
      field: this.field.map((row) => row.map((b) => (b ? b.toJSON() : null))),
      walls: Object.fromEntries(
        WALL_SIDES.map((side) => [
          side,
          this.walls[side].map((lane) => lane.map((b) => (b ? b.toJSON() : null))),
        ]),
      ),
    };
  }

  // Defensive deserialization with ID deduplication (spec §6 / §4.7): null
  // cells stay null (no phantom bricks), missing rows/cols are padded, and
  // any duplicate IDs are regenerated so no two bricks collide across loads.
  static fromJSON(data) {
    const seen = new Set();
    const dedupe = (cell) => {
      if (cell == null || typeof cell !== 'object') return new Brick({});
      const hasId = typeof cell.id === 'string' && cell.id.length > 0;
      if (hasId && seen.has(cell.id)) {
        return new Brick({ color: cell.color, direction: cell.direction });
      }
      if (hasId) seen.add(cell.id);
      return Brick.fromJSON(cell);
    };

    let field;
    if (Array.isArray(data && data.field)) {
      field = data.field.slice(0, GRID_SIZE).map((row) =>
        (Array.isArray(row) ? row : []).slice(0, GRID_SIZE).map((cell) =>
          cell == null ? null : dedupe(cell),
        ),
      );
      while (field.length < GRID_SIZE) field.push(new Array(GRID_SIZE).fill(null));
      for (const row of field) while (row.length < GRID_SIZE) row.push(null);
    } else {
      field = Array.from({ length: GRID_SIZE }, () => new Array(GRID_SIZE).fill(null));
    }

    const walls = makeWalls();
    if (data && data.walls && typeof data.walls === 'object') {
      for (const side of WALL_SIDES) {
        const lanes = data.walls[side];
        if (!Array.isArray(lanes)) continue;
        for (let lane = 0; lane < GRID_SIZE; lane++) {
          const queue = lanes[lane];
          if (!Array.isArray(queue)) continue;
          for (let layer = 0; layer < WALL_DEPTH; layer++) {
            walls[side][lane][layer] = dedupe(queue[layer]);
          }
        }
      }
    }
    // Self-heal: wall slots must never be left null.
    for (const side of WALL_SIDES) {
      for (let lane = 0; lane < GRID_SIZE; lane++) {
        for (let layer = 0; layer < WALL_DEPTH; layer++) {
          if (walls[side][lane][layer] == null) walls[side][lane][layer] = new Brick({});
        }
      }
    }

    return new Grid(field, walls);
  }
}
