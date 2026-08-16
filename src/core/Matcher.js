// Straight-line match-3 detection and run scoring. (spec §3.3 / §6)

import { GRID_SIZE, SCORE_BASE, RUN_LENGTH_MULTIPLIER } from './Constants.js';

// Detect all strict straight lines of ≥3 consecutive same-color bricks
// (horizontal and vertical). Returns runs; each run is
// { color, length, cells: [{x,y},...] }. Intersecting runs share cells.
export function findMatches(grid) {
  const runs = [];

  const flush = (run) => {
    if (run.length >= 3) {
      runs.push({
        color: run[0].brick.color,
        length: run.length,
        cells: run.map(({ x, y }) => ({ x, y })),
      });
    }
  };

  // Horizontal runs.
  for (let y = 0; y < GRID_SIZE; y++) {
    let run = [];
    for (let x = 0; x < GRID_SIZE; x++) {
      const b = grid.cellAt(x, y);
      if (b) {
        if (run.length && run[run.length - 1].brick.color === b.color) {
          run.push({ x, y, brick: b });
        } else {
          flush(run);
          run = [{ x, y, brick: b }];
        }
      } else {
        flush(run);
        run = [];
      }
    }
    flush(run);
  }

  // Vertical runs.
  for (let x = 0; x < GRID_SIZE; x++) {
    let run = [];
    for (let y = 0; y < GRID_SIZE; y++) {
      const b = grid.cellAt(x, y);
      if (b) {
        if (run.length && run[run.length - 1].brick.color === b.color) {
          run.push({ x, y, brick: b });
        } else {
          flush(run);
          run = [{ x, y, brick: b }];
        }
      } else {
        flush(run);
        run = [];
      }
    }
    flush(run);
  }

  return runs;
}

// Base score for a single run of `len` bricks (before combo multiplier).
export function runScore(len) {
  return SCORE_BASE * len * RUN_LENGTH_MULTIPLIER(len);
}

// Total base score for a set of runs. Intersecting runs naturally count a
// shared brick once per run, because each run is scored independently.
export function scoreRuns(runs) {
  return runs.reduce((sum, r) => sum + runScore(r.length), 0);
}
