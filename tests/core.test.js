// Deterministic unit tests for the core engine: Brick, Grid, Physics,
// Matcher, and GameEngine equilibrium cascades. 100% deterministic via
// seeded RNG (mulberry32) and hand-built boards. (spec §6)

import { describe, it, expect } from 'vitest';
import { Grid } from '../src/core/Grid.js';
import { Brick } from '../src/core/Brick.js';
import { GameEngine } from '../src/core/GameEngine.js';
import {
  isLaneLaunchable,
  calculateLanding,
  getAimPath,
  resolveCascade,
} from '../src/core/Physics.js';
import { findMatches, runScore, scoreRuns } from '../src/core/Matcher.js';
import {
  DIR,
  COLORS,
  COLOR_LIST,
  GRID_SIZE,
  WALL_DEPTH,
  WALL_SIDES,
  WAVE_CLEAR_BONUS,
  STORAGE_STATE_KEY,
} from '../src/core/Constants.js';

const R = COLORS.crimson;
const B = COLORS.cobalt;
const G = COLORS.emerald;
const Y = COLORS.amber;

function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeWalls(layerColors = [R, B, G]) {
  const walls = {};
  for (const side of WALL_SIDES) {
    walls[side] = [];
    for (let lane = 0; lane < GRID_SIZE; lane++) {
      walls[side].push(layerColors.map((c) => new Brick({ color: c })));
    }
  }
  return walls;
}

function emptyField() {
  return Array.from({ length: GRID_SIZE }, () => new Array(GRID_SIZE).fill(null));
}

function makeGrid(cells = [], layerColors = [R, B, G]) {
  const field = emptyField();
  for (const { x, y, color = R, direction = DIR.NONE } of cells) {
    field[y][x] = new Brick({ color, direction });
  }
  return new Grid(field, makeWalls(layerColors));
}

function engineWithGrid(cells, layerColors) {
  const e = new GameEngine({ random: mulberry32(1) });
  e.grid = makeGrid(cells, layerColors);
  return e;
}

function makeStorage() {
  const store = {};
  return {
    store,
    storage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => {
        store[k] = v;
      },
      removeItem: (k) => {
        delete store[k];
      },
    },
  };
}

describe('Brick', () => {
  it('defaults to a valid color and NONE direction', () => {
    const b = new Brick({});
    expect(COLOR_LIST).toContain(b.color);
    expect(b.direction).toBe(DIR.NONE);
    expect(b.isMoving).toBe(false);
    expect(typeof b.id).toBe('string');
    expect(b.id.length).toBeGreaterThan(0);
  });

  it('preserves valid color and direction', () => {
    const b = new Brick({ color: B, direction: DIR.EAST });
    expect(b.color).toBe(B);
    expect(b.direction).toBe(DIR.EAST);
    expect(b.isMoving).toBe(true);
  });

  it('rejects invalid color and direction with safe defaults', () => {
    const b = new Brick({ color: '#000000', direction: 'SIDEWAYS' });
    expect(b.color).toBe(COLORS.crimson);
    expect(b.direction).toBe(DIR.NONE);
  });

  it('serializes id, color, direction', () => {
    const b = new Brick({ id: 'abc', color: G, direction: DIR.SOUTH });
    expect(b.toJSON()).toEqual({ id: 'abc', color: G, direction: DIR.SOUTH });
  });

  it('fromJSON(null) yields a default brick (no throw)', () => {
    const b = Brick.fromJSON(null);
    expect(b).toBeInstanceOf(Brick);
    expect(b.direction).toBe(DIR.NONE);
  });

  it('fromJSON preserves fields and defaults missing ones', () => {
    const b = Brick.fromJSON({ color: Y, direction: DIR.NORTH });
    expect(b.color).toBe(Y);
    expect(b.direction).toBe(DIR.NORTH);
    const c = Brick.fromJSON({ id: 'xyz' });
    expect(c.id).toBe('xyz');
    expect(c.direction).toBe(DIR.NONE);
  });
});

describe('Grid', () => {
  it('generate places the requested brick count with static bricks', () => {
    const g = Grid.generate({ random: mulberry32(42), count: 10 });
    let n = 0;
    for (const { brick } of g.fieldBricks()) {
      n += 1;
      expect(brick.direction).toBe(DIR.NONE);
    }
    expect(n).toBe(10);
  });

  it('generate fills all 120 wall slots', () => {
    const g = Grid.generate({ random: mulberry32(1) });
    for (const side of WALL_SIDES) {
      for (let lane = 0; lane < GRID_SIZE; lane++) {
        for (let layer = 0; layer < WALL_DEPTH; layer++) {
          expect(g.wallAt(side, lane, layer)).toBeInstanceOf(Brick);
        }
      }
    }
  });

  it('laneCells returns mouth-first ordering for every side', () => {
    const g = makeGrid();
    expect(g.laneCells('TOP', 3)[0]).toEqual({ x: 3, y: 0 });
    expect(g.laneCells('TOP', 3)[9]).toEqual({ x: 3, y: 9 });
    expect(g.laneCells('BOTTOM', 3)[0]).toEqual({ x: 3, y: 9 });
    expect(g.laneCells('BOTTOM', 3)[9]).toEqual({ x: 3, y: 0 });
    expect(g.laneCells('LEFT', 4)[0]).toEqual({ x: 0, y: 4 });
    expect(g.laneCells('LEFT', 4)[9]).toEqual({ x: 9, y: 4 });
    expect(g.laneCells('RIGHT', 4)[0]).toEqual({ x: 9, y: 4 });
    expect(g.laneCells('RIGHT', 4)[9]).toEqual({ x: 0, y: 4 });
  });

  it('popAndShiftWall shifts inward and adds a fresh layer-2 brick', () => {
    const g = makeGrid();
    const l0 = g.wallAt('TOP', 2, 0);
    const l1 = g.wallAt('TOP', 2, 1);
    const l2 = g.wallAt('TOP', 2, 2);
    const popped = g.popAndShiftWall('TOP', 2, mulberry32(5));
    expect(popped).toBe(l0);
    expect(g.wallAt('TOP', 2, 0)).toBe(l1);
    expect(g.wallAt('TOP', 2, 1)).toBe(l2);
    expect(g.wallAt('TOP', 2, 2)).toBeInstanceOf(Brick);
    expect(g.wallAt('TOP', 2, 2)).not.toBe(l2);
  });

  it('pushInnermostWall docks at layer 0, ejects layer 2, resets direction', () => {
    const g = makeGrid();
    const incoming = new Brick({ color: Y, direction: DIR.EAST });
    const ejected = g.pushInnermostWall('LEFT', 5, incoming);
    expect(ejected).toBeInstanceOf(Brick);
    const docked = g.wallAt('LEFT', 5, 0);
    expect(docked.id).toBe(incoming.id);
    expect(docked.color).toBe(Y);
    expect(docked.direction).toBe(DIR.NONE);
  });

  it('isFieldEmpty reflects occupancy', () => {
    expect(makeGrid().isFieldEmpty()).toBe(true);
    expect(makeGrid([{ x: 3, y: 3 }]).isFieldEmpty()).toBe(false);
  });

  it('toJSON/fromJSON round-trips and preserves null cells', () => {
    const g = makeGrid([
      { x: 0, y: 0, color: R },
      { x: 5, y: 5, color: G, direction: DIR.SOUTH },
    ]);
    const g2 = Grid.fromJSON(g.toJSON());
    for (let y = 0; y < GRID_SIZE; y++) {
      for (let x = 0; x < GRID_SIZE; x++) {
        const a = g.cellAt(x, y);
        const b = g2.cellAt(x, y);
        expect(a === null).toBe(b === null);
        if (a) {
          expect(b.color).toBe(a.color);
          expect(b.direction).toBe(a.direction);
        }
      }
    }
  });

  it('fromJSON deduplicates colliding IDs', () => {
    const shared = 'deadbeef-0000-0000-0000-000000000001';
    const g = makeGrid();
    g.setCell(0, 0, new Brick({ id: shared, color: R }));
    g.setCell(1, 0, new Brick({ id: shared, color: R }));
    const g2 = Grid.fromJSON(g.toJSON());
    expect(g2.cellAt(0, 0).id).not.toBe(g2.cellAt(1, 0).id);
  });

  it('fromJSON is defensive against corrupted input', () => {
    const g = Grid.fromJSON({ field: 'garbage', walls: {} });
    expect(g.field).toHaveLength(GRID_SIZE);
    for (const side of WALL_SIDES) {
      for (let lane = 0; lane < GRID_SIZE; lane++) {
        for (let layer = 0; layer < WALL_DEPTH; layer++) {
          expect(g.wallAt(side, lane, layer)).toBeInstanceOf(Brick);
        }
      }
    }
  });
});

describe('Matcher', () => {
  it('detects a horizontal 3-run', () => {
    const g = makeGrid([
      { x: 1, y: 2, color: R },
      { x: 2, y: 2, color: R },
      { x: 3, y: 2, color: R },
    ]);
    const runs = findMatches(g);
    expect(runs).toHaveLength(1);
    expect(runs[0].length).toBe(3);
    expect(runs[0].cells).toEqual([{ x: 1, y: 2 }, { x: 2, y: 2 }, { x: 3, y: 2 }]);
  });

  it('detects a vertical 3-run', () => {
    const g = makeGrid([
      { x: 4, y: 0, color: B },
      { x: 4, y: 1, color: B },
      { x: 4, y: 2, color: B },
    ]);
    expect(findMatches(g)).toHaveLength(1);
  });

  it('does not match runs shorter than 3', () => {
    const g = makeGrid([
      { x: 1, y: 1, color: R },
      { x: 2, y: 1, color: R },
    ]);
    expect(findMatches(g)).toHaveLength(0);
  });

  it('intersecting cross shares the center cell across both runs', () => {
    const g = makeGrid([
      { x: 1, y: 2, color: R },
      { x: 2, y: 2, color: R },
      { x: 3, y: 2, color: R },
      { x: 2, y: 0, color: R },
      { x: 2, y: 1, color: R },
    ]);
    const runs = findMatches(g);
    expect(runs).toHaveLength(2);
    const center = runs.flatMap((r) => r.cells).filter((c) => c.x === 2 && c.y === 2);
    expect(center).toHaveLength(2);
  });

  it('run scores use the length multiplier (3/4/5/6)', () => {
    expect(runScore(3)).toBe(300);
    expect(runScore(4)).toBe(600);
    expect(runScore(5)).toBe(1000);
    expect(runScore(6)).toBe(1200);
  });

  it('scoreRuns sums each run independently', () => {
    const g = makeGrid([
      { x: 0, y: 0, color: R },
      { x: 1, y: 0, color: R },
      { x: 2, y: 0, color: R },
      { x: 0, y: 1, color: R },
      { x: 1, y: 1, color: R },
      { x: 2, y: 1, color: R },
    ]);
    expect(scoreRuns(findMatches(g))).toBe(600); // two 3-runs, shared? none — two separate rows
  });
});

describe('Physics', () => {
  it('empty lane is not launchable', () => {
    expect(isLaneLaunchable(makeGrid(), 'LEFT', 3)).toBe(false);
  });

  it('mouth-blocked lane is not launchable', () => {
    const g = makeGrid([{ x: 0, y: 3, color: R }, { x: 5, y: 3, color: R }]);
    expect(isLaneLaunchable(g, 'LEFT', 3)).toBe(false);
  });

  it('lane with an obstacle beyond the mouth is launchable', () => {
    const g = makeGrid([{ x: 4, y: 3, color: R }]);
    expect(isLaneLaunchable(g, 'LEFT', 3)).toBe(true);
  });

  it('calculateLanding returns the cell before the first obstacle', () => {
    const g = makeGrid([{ x: 4, y: 3, color: R }]);
    expect(calculateLanding(g, 'LEFT', 3)).toEqual({ x: 3, y: 3 });
  });

  it('calculateLanding returns null for empty and mouth-blocked lanes', () => {
    expect(calculateLanding(makeGrid(), 'LEFT', 3)).toBeNull();
    const g = makeGrid([{ x: 0, y: 3, color: R }]);
    expect(calculateLanding(g, 'LEFT', 3)).toBeNull();
  });

  it('getAimPath spans the full lane on an empty lane', () => {
    const g = makeGrid();
    const aim = getAimPath(g, 'LEFT', 3);
    expect(aim.launchable).toBe(false);
    expect(aim.path).toHaveLength(10);
  });

  it('getAimPath ends at the landing on a launchable lane', () => {
    const g = makeGrid([{ x: 4, y: 3, color: R }]);
    const aim = getAimPath(g, 'LEFT', 3);
    expect(aim.launchable).toBe(true);
    expect(aim.landing).toEqual({ x: 3, y: 3 });
    expect(aim.path).toHaveLength(4);
    expect(aim.path[3]).toEqual({ x: 3, y: 3 });
  });

  it('resolveCascade slides a train of same-direction bricks atomically', () => {
    const g = makeGrid([
      { x: 0, y: 0, color: R, direction: DIR.EAST },
      { x: 1, y: 0, color: R, direction: DIR.EAST },
      { x: 2, y: 0, color: R, direction: DIR.EAST },
    ]);
    const res = resolveCascade(g);
    expect(res.moved).toBe(true);
    expect(res.moves).toHaveLength(3);
    expect(g.cellAt(0, 0)).toBeNull();
    expect(g.cellAt(1, 0)).not.toBeNull();
    expect(g.cellAt(3, 0)).not.toBeNull();
  });

  it('head-on movers both stay (cycle broken)', () => {
    const g = makeGrid([
      { x: 3, y: 0, color: R, direction: DIR.EAST },
      { x: 4, y: 0, color: R, direction: DIR.WEST },
    ]);
    const res = resolveCascade(g);
    expect(res.moved).toBe(false);
    expect(g.cellAt(3, 0)).not.toBeNull();
    expect(g.cellAt(4, 0)).not.toBeNull();
  });

  it('off-board slide pushes into the correct wall and ejects layer 2', () => {
    const g = makeGrid([{ x: 9, y: 2, color: G, direction: DIR.EAST }]);
    const res = resolveCascade(g);
    expect(res.moved).toBe(true);
    expect(res.wallPush).toHaveLength(1);
    expect(res.wallPush[0].side).toBe('RIGHT');
    expect(res.wallPush[0].lane).toBe(2);
    expect(res.wallPush[0].ejected).toBeInstanceOf(Brick);
    expect(g.cellAt(9, 2)).toBeNull();
    expect(g.wallAt('RIGHT', 2, 0).color).toBe(G);
    expect(g.wallAt('RIGHT', 2, 0).direction).toBe(DIR.NONE);
  });

  it('dependency chain lets a follower advance behind a mover', () => {
    const g = makeGrid([
      { x: 0, y: 0, color: R, direction: DIR.EAST },
      { x: 1, y: 0, color: R, direction: DIR.EAST },
    ]);
    const res = resolveCascade(g);
    expect(res.moves).toHaveLength(2);
    expect(g.cellAt(2, 0)).not.toBeNull();
    expect(g.cellAt(1, 0)).not.toBeNull();
    expect(g.cellAt(0, 0)).toBeNull();
  });

  it('canonical claim order resolves competing movers (first wins)', () => {
    const g = makeGrid([
      { x: 0, y: 0, color: R, direction: DIR.EAST },
      { x: 2, y: 0, color: B, direction: DIR.WEST },
    ]);
    const res = resolveCascade(g);
    expect(res.moved).toBe(true);
    // A (x=0) claims the shared target (1,0); B (x=2) stays.
    expect(g.cellAt(1, 0).color).toBe(R);
    expect(g.cellAt(2, 0).color).toBe(B);
  });
});

describe('GameEngine', () => {
  it('launch rejects empty and mouth-blocked lanes', () => {
    const e = engineWithGrid([]);
    expect(e.launch('LEFT', 3)).toBeNull();
    const e2 = engineWithGrid([{ x: 0, y: 3, color: R }]);
    expect(e2.launch('LEFT', 3)).toBeNull();
  });

  it('launch inherits the projectile color from the wall queue', () => {
    const e = engineWithGrid([{ x: 4, y: 3, color: R }]);
    e.grid.walls.LEFT[3][0] = new Brick({ color: Y });
    const tl = e.launch('LEFT', 3);
    expect(tl.projectile.color).toBe(Y);
  });

  it('launch lands adjacent to the obstacle and clears a match', () => {
    const e = engineWithGrid([
      { x: 1, y: 2, color: R },
      { x: 2, y: 2, color: R },
      { x: 5, y: 5, color: G },
    ]);
    e.grid.walls.LEFT[2][0] = new Brick({ color: R });
    const tl = e.launch('LEFT', 2);
    expect(tl).not.toBeNull();
    expect(tl.landing).toEqual({ x: 0, y: 2 });
    expect(tl.steps.some((s) => s.type === 'match')).toBe(true);
    expect(e.score).toBe(300);
    expect(e.state).toBe('READY');
    expect(e.grid.cellAt(0, 2)).toBeNull();
    expect(e.grid.cellAt(1, 2)).toBeNull();
    expect(e.grid.cellAt(2, 2)).toBeNull();
  });

  it('wave clear awards +2500 and flips state', () => {
    const e = engineWithGrid([
      { x: 1, y: 2, color: R },
      { x: 2, y: 2, color: R },
    ]);
    e.grid.walls.LEFT[2][0] = new Brick({ color: R });
    const tl = e.launch('LEFT', 2);
    expect(e.state).toBe('WAVE_CLEAR');
    expect(e.score).toBe(300 + WAVE_CLEAR_BONUS);
    expect(tl.result.waveClearBonus).toBe(WAVE_CLEAR_BONUS);
  });

  it('equilibrium cascade scores match→slide→match with combo multipliers', () => {
    const e = engineWithGrid([
      // First match: vertical 3-run at column 7.
      { x: 7, y: 3, color: R },
      { x: 7, y: 4, color: R },
      { x: 7, y: 5, color: R },
      // Mover that slides into a horizontal 3-run.
      { x: 5, y: 0, color: R, direction: DIR.EAST },
      { x: 7, y: 0, color: R },
      { x: 8, y: 0, color: R },
      // Obstacle for the LEFT lane-2 launch.
      { x: 3, y: 2, color: G },
    ]);
    e.grid.walls.LEFT[2][0] = new Brick({ color: R });
    const tl = e.launch('LEFT', 2);
    expect(tl.steps.map((s) => s.type)).toEqual(['match', 'slide', 'match']);
    expect(tl.steps[0].combo).toBe(1);
    expect(tl.steps[2].combo).toBe(2);
    expect(e.score).toBe(300 + 600);
    expect(e.state).toBe('READY');
    // Mover left (5,0); horizontal run cleared.
    expect(e.grid.cellAt(5, 0)).toBeNull();
    expect(e.grid.cellAt(6, 0)).toBeNull();
    expect(e.grid.cellAt(7, 0)).toBeNull();
    expect(e.grid.cellAt(8, 0)).toBeNull();
    expect(e.grid.cellAt(7, 3)).toBeNull();
    expect(e.grid.cellAt(7, 4)).toBeNull();
    expect(e.grid.cellAt(7, 5)).toBeNull();
    // Projectile remains at landing, obstacle intact.
    expect(e.grid.cellAt(2, 2)).not.toBeNull();
    expect(e.grid.cellAt(2, 2).direction).toBe(DIR.EAST);
    expect(e.grid.cellAt(3, 2).color).toBe(G);
  });

  it('a fully-jammed board after a launch sets GAME_OVER', () => {
    const e = new GameEngine({ random: mulberry32(1) });
    // Checkerboard full field → no matches ever; leave (0,0) open as the mouth.
    const field = emptyField();
    for (let y = 0; y < GRID_SIZE; y++) {
      for (let x = 0; x < GRID_SIZE; x++) {
        if (x === 0 && y === 0) continue;
        field[y][x] = new Brick({ color: (x + y) % 2 === 0 ? R : B });
      }
    }
    e.grid = new Grid(field, makeWalls());
    e.grid.walls.LEFT[0][0] = new Brick({ color: R });
    const tl = e.launch('LEFT', 0);
    expect(tl).not.toBeNull();
    expect(e.state).toBe('GAME_OVER');
    expect(e.grid.cellAt(0, 0)).not.toBeNull();
  });

  it('turnCount increments and highScore tracks the max', () => {
    const e = engineWithGrid([
      { x: 1, y: 2, color: R },
      { x: 2, y: 2, color: R },
    ]);
    e.grid.walls.LEFT[2][0] = new Brick({ color: R });
    e.launch('LEFT', 2);
    expect(e.turnCount).toBe(1);
    expect(e.highScore).toBe(e.score);
  });

  it('persists and restores full state via storage', () => {
    const { storage } = makeStorage();
    const e1 = new GameEngine({ random: mulberry32(3), storage });
    e1.score = 555;
    e1.wave = 4;
    e1.waveStartScore = 100;
    e1.turnCount = 7;
    e1.state = 'READY';
    e1.saveState();
    const e2 = new GameEngine({ random: mulberry32(3), storage });
    expect(e2.loadState()).toBe(true);
    expect(e2.score).toBe(555);
    expect(e2.wave).toBe(4);
    expect(e2.waveStartScore).toBe(100);
    expect(e2.turnCount).toBe(7);
  });

  it('persists under the spec storage key', () => {
    const { store, storage } = makeStorage();
    const e = new GameEngine({ random: mulberry32(1), storage });
    e.saveState();
    expect(STORAGE_STATE_KEY in store).toBe(true);
  });

  it('restore is defensive against invalid fields', () => {
    const e = new GameEngine({ random: mulberry32(1) });
    e.restore({ score: 'NaN', wave: -5, state: 'BOGUS', grid: { field: 'garbage' } });
    expect(e.score).toBe(0);
    expect(e.wave).toBe(1);
    expect(e.state).toBe('READY');
  });

  it('loadState returns false on corrupted JSON', () => {
    const { store, storage } = makeStorage();
    store[STORAGE_STATE_KEY] = '{not json';
    const e = new GameEngine({ random: mulberry32(1), storage });
    expect(e.loadState()).toBe(false);
  });

  it('throwing storage never crashes save or load', () => {
    const throwing = {
      getItem() {
        throw new Error('boom');
      },
      setItem() {
        throw new Error('boom');
      },
      removeItem() {
        throw new Error('boom');
      },
    };
    const e = new GameEngine({ random: mulberry32(1), storage: throwing });
    expect(() => e.saveState()).not.toThrow();
    expect(e.loadState()).toBe(false);
  });

  it('startNextWave increments wave and snapshots waveStartScore', () => {
    const e = new GameEngine({ random: mulberry32(5) });
    e.score = 1000;
    e.startNextWave();
    expect(e.wave).toBe(2);
    expect(e.waveStartScore).toBe(1000);
    expect(e.state).toBe('READY');
  });

  it('restartWave rolls score back to waveStartScore', () => {
    const e = new GameEngine({ random: mulberry32(5) });
    e.score = 1000;
    e.waveStartScore = 250;
    e.restartWave();
    expect(e.score).toBe(250);
    expect(e.state).toBe('READY');
  });

  it('resetToWave1 clears score/wave but preserves highScore', () => {
    const e = new GameEngine({ random: mulberry32(5) });
    e.score = 3000;
    e.highScore = 9999;
    e.wave = 6;
    e.turnCount = 42;
    e.resetToWave1();
    expect(e.wave).toBe(1);
    expect(e.score).toBe(0);
    expect(e.state).toBe('READY');
    expect(e.turnCount).toBe(0);
    expect(e.highScore).toBe(9999);
  });

  it('later waves generate higher field density', () => {
    const e1 = new GameEngine({ random: mulberry32(9) });
    const c1 = [...e1.grid.fieldBricks()].length;
    e1.startNextWave();
    e1.startNextWave();
    const c3 = [...e1.grid.fieldBricks()].length;
    expect(c3).toBeGreaterThan(c1);
  });
});
