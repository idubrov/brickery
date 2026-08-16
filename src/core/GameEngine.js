// Equilibrium-loop turn orchestration, cascade chains, scoring, wave
// lifecycle, and state persistence. (spec §3 / §4.6 / §4.7 / §6)

import {
  GRID_SIZE,
  WALL_SIDES,
  LAUNCH_DIRECTION,
  WAVE_CLEAR_BONUS,
  INITIAL_BRICKS_MIN,
  INITIAL_BRICKS_MAX,
  STORAGE_STATE_KEY,
} from './Constants.js';
import { Grid } from './Grid.js';
import { isLaneLaunchable, calculateLanding, getAimPath, resolveCascade } from './Physics.js';
import { findMatches, scoreRuns } from './Matcher.js';

function randomInt(random, min, max) {
  return min + Math.floor(random() * (max - min + 1));
}

// Field density for a wave (spec §1 / §3.4): wave 1 → [5,14]; later waves
// increase density by +3 per wave (capped at 60 of 100 cells).
function brickCountForWave(wave, random) {
  const lo = Math.min(60, INITIAL_BRICKS_MIN + (wave - 1) * 3);
  const hi = Math.min(60, INITIAL_BRICKS_MAX + (wave - 1) * 3);
  return randomInt(random, lo, hi);
}

const VALID_STATES = ['READY', 'WAVE_CLEAR', 'GAME_OVER'];

const DEFAULT_STORAGE = {
  getItem() {
    return null;
  },
  setItem() {},
  removeItem() {},
};

export class GameEngine {
  constructor({ random = Math.random, storage = DEFAULT_STORAGE, highScore = 0 } = {}) {
    this.random = random;
    this.storage = storage;
    this.highScore = highScore;
    this.wave = 1;
    this.score = 0;
    this.waveStartScore = 0;
    this.state = 'READY';
    this.turnCount = 0;
    this.grid = Grid.generate({ random, count: brickCountForWave(1, random) });
  }

  // ---- queries ----

  get fieldEmpty() {
    return this.grid.isFieldEmpty();
  }

  getAimPath(side, lane) {
    return getAimPath(this.grid, side, lane);
  }

  isLaneLaunchable(side, lane) {
    return isLaneLaunchable(this.grid, side, lane);
  }

  // ---- turn resolution ----

  // Resolve one launch. Returns a TurnTimeline, or null if not launchable.
  launch(side, lane) {
    if (this.state !== 'READY') return null;
    if (!isLaneLaunchable(this.grid, side, lane)) return null;

    const direction = LAUNCH_DIRECTION[side];
    const projectile = this.grid.popAndShiftWall(side, lane, this.random);
    projectile.direction = direction;

    const cells = this.grid.laneCells(side, lane);
    const landing = calculateLanding(this.grid, side, lane);
    const landingIdx = cells.findIndex((c) => c.x === landing.x && c.y === landing.y);
    const path = cells.slice(0, landingIdx + 1);

    this.grid.setCell(landing.x, landing.y, projectile);

    const timeline = {
      type: 'launch',
      side,
      lane,
      direction,
      projectile: projectile.toJSON(),
      path,
      landing,
      wallFeed: {
        side,
        lane,
        newBrick: this.grid.wallAt(side, lane, 2).toJSON(),
      },
      steps: [],
      result: null,
    };

    // Equilibrium loop (spec §3.4): match → slide → (off-board push) → repeat.
    let combo = 0;
    for (;;) {
      let changed = false;

      // 1. Match phase.
      const runs = findMatches(this.grid);
      if (runs.length > 0) {
        combo += 1;
        const awarded = scoreRuns(runs) * combo;
        this.score += awarded;
        const clearedCells = [];
        const seenCells = new Set();
        for (const run of runs) {
          for (const c of run.cells) {
            const k = c.x + ',' + c.y;
            if (seenCells.has(k)) continue;
            seenCells.add(k);
            const brick = this.grid.cellAt(c.x, c.y);
            clearedCells.push({ x: c.x, y: c.y, color: brick ? brick.color : null });
            this.grid.setCell(c.x, c.y, null);
          }
        }
        timeline.steps.push({ type: 'match', cells: clearedCells, score: awarded, combo });
        changed = true;
      }

      // 2. Slide phase (simultaneous slides + off-board wall push).
      const slide = resolveCascade(this.grid);
      if (slide.moved) {
        timeline.steps.push({
          type: 'slide',
          moves: slide.moves.map((m) => ({
            from: m.from,
            to: m.to,
            brick: m.brick.toJSON(),
          })),
          wallPush: slide.wallPush.map((w) => ({
            side: w.side,
            lane: w.lane,
            brick: w.brick.toJSON(),
            ejected: w.ejected ? w.ejected.toJSON() : null,
          })),
        });
        changed = true;
      }

      if (!changed) break;
    }

    this.turnCount += 1;
    if (this.score > this.highScore) this.highScore = this.score;

    // 3. Wave completion / jam detection.
    let waveCleared = false;
    if (this.grid.isFieldEmpty()) {
      this.score += WAVE_CLEAR_BONUS;
      if (this.score > this.highScore) this.highScore = this.score;
      this.state = 'WAVE_CLEAR';
      waveCleared = true;
    } else if (this.isJammed()) {
      this.state = 'GAME_OVER';
    }

    timeline.result = {
      state: this.state,
      score: this.score,
      highScore: this.highScore,
      wave: this.wave,
      waveStartScore: this.waveStartScore,
      turnCount: this.turnCount,
      fieldEmpty: this.grid.isFieldEmpty(),
      waveClearBonus: waveCleared ? WAVE_CLEAR_BONUS : 0,
    };

    this.saveState();
    return timeline;
  }

  // Board jam: no lane is launchable across all 4 walls while bricks remain.
  isJammed() {
    if (this.grid.isFieldEmpty()) return false;
    for (const side of WALL_SIDES) {
      for (let lane = 0; lane < GRID_SIZE; lane++) {
        if (isLaneLaunchable(this.grid, side, lane)) return false;
      }
    }
    return true;
  }

  // ---- wave lifecycle (spec §4.6) ----

  startNextWave() {
    this.wave += 1;
    this.waveStartScore = this.score;
    this.state = 'READY';
    this.grid = Grid.generate({ random: this.random, count: brickCountForWave(this.wave, this.random) });
    this.saveState();
  }

  restartWave() {
    this.score = this.waveStartScore;
    this.state = 'READY';
    this.grid = Grid.generate({ random: this.random, count: brickCountForWave(this.wave, this.random) });
    this.saveState();
  }

  resetToWave1() {
    this.wave = 1;
    this.score = 0;
    this.waveStartScore = 0;
    this.highScore = Math.max(this.highScore, 0);
    this.state = 'READY';
    this.turnCount = 0;
    this.grid = Grid.generate({ random: this.random, count: brickCountForWave(1, this.random) });
    this.saveState();
  }

  // ---- persistence (spec §4.7) ----

  toJSON() {
    return {
      score: this.score,
      waveStartScore: this.waveStartScore,
      highScore: this.highScore,
      wave: this.wave,
      state: this.state,
      turnCount: this.turnCount,
      grid: this.grid.toJSON(),
    };
  }

  saveState() {
    try {
      this.storage.setItem(STORAGE_STATE_KEY, JSON.stringify(this.toJSON()));
    } catch {
      // Storage may be unavailable (private mode / throwing backend).
    }
  }

  loadState() {
    let raw = null;
    try {
      raw = this.storage.getItem(STORAGE_STATE_KEY);
    } catch {
      raw = null;
    }
    if (!raw) return false;
    try {
      this.restore(JSON.parse(raw));
      return true;
    } catch {
      return false; // corrupted payload → ignore gracefully
    }
  }

  restore(data) {
    if (!data || typeof data !== 'object') data = {};
    this.score = Number.isFinite(data.score) ? data.score : 0;
    this.waveStartScore = Number.isFinite(data.waveStartScore) ? data.waveStartScore : this.score;
    this.highScore = Number.isFinite(data.highScore)
      ? Math.max(data.highScore, this.score)
      : this.score;
    this.wave = Number.isInteger(data.wave) && data.wave >= 1 ? data.wave : 1;
    this.state = VALID_STATES.includes(data.state) ? data.state : 'READY';
    this.turnCount = Number.isInteger(data.turnCount) && data.turnCount >= 0 ? data.turnCount : 0;
    this.grid = Grid.fromJSON(data.grid);
  }

  static fromJSON(data, { random = Math.random, storage = DEFAULT_STORAGE } = {}) {
    const engine = new GameEngine({ random, storage });
    engine.restore(data);
    return engine;
  }
}
