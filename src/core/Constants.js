// Core game constants — the single source of truth shared by the engine,
// renderers, UI, and tests. Every value here is pinned by the spec.

export const GRID_SIZE = 10; // central field is 10×10
export const WALL_DEPTH = 3; // 3 wall layers (0 = innermost / clickable)
export const WALL_SIDES = ['TOP', 'BOTTOM', 'LEFT', 'RIGHT'];

// High-contrast 4-quadrant color palette (spec §2.3 / §4.2 / §4.3).
export const COLORS = {
  crimson: '#e60026',
  cobalt: '#2962ff',
  emerald: '#00c853',
  amber: '#ffd600',
};

// Numeric 0xRRGGBB variants for Three.js materials — exact parity with 2D hex.
export const COLOR_HEX = {
  crimson: 0xe60026,
  cobalt: 0x2962ff,
  emerald: 0x00c853,
  amber: 0xffd600,
};

// Canonical ordered list used for random color selection.
export const COLOR_LIST = [COLORS.crimson, COLORS.cobalt, COLORS.emerald, COLORS.amber];

// Directions.
export const DIR = {
  NONE: 'NONE',
  EAST: 'EAST',
  WEST: 'WEST',
  SOUTH: 'SOUTH',
  NORTH: 'NORTH',
};

export const DIR_VECTORS = {
  [DIR.NONE]: { x: 0, y: 0 },
  [DIR.EAST]: { x: 1, y: 0 },
  [DIR.WEST]: { x: -1, y: 0 },
  [DIR.SOUTH]: { x: 0, y: 1 },
  [DIR.NORTH]: { x: 0, y: -1 },
};

// Launch direction per wall (spec §3.1).
export const LAUNCH_DIRECTION = {
  LEFT: DIR.EAST,
  RIGHT: DIR.WEST,
  TOP: DIR.SOUTH,
  BOTTOM: DIR.NORTH,
};

// Wall a brick exits into when it slides off a given perimeter edge (spec §3.4).
export const EXIT_WALL = {
  [DIR.EAST]: 'RIGHT',
  [DIR.WEST]: 'LEFT',
  [DIR.SOUTH]: 'BOTTOM',
  [DIR.NORTH]: 'TOP',
};

// Direction glyphs (spec §4.2 / §4.3).
export const DIRECTION_GLYPHS = {
  [DIR.NORTH]: '▲',
  [DIR.SOUTH]: '▼',
  [DIR.WEST]: '◄',
  [DIR.EAST]: '►',
};

// Scoring (spec §3.3).
export const SCORE_BASE = 100; // points per brick in a match
// Run-length multiplier: 3 → 1.0×, 4 → 1.5×, ≥5 → 2.0×.
export const RUN_LENGTH_MULTIPLIER = (len) => (len === 3 ? 1.0 : len === 4 ? 1.5 : 2.0);
export const WAVE_CLEAR_BONUS = 2500; // spec §1 / §3.4

// Initial field density (spec §2.1): 5–14 random bricks.
export const INITIAL_BRICKS_MIN = 5;
export const INITIAL_BRICKS_MAX = 14;

// localStorage keys (spec §4.4 / §4.7).
export const STORAGE_STATE_KEY = 'bricks_puzzle_game_state';
export const STORAGE_RENDER_MODE_KEY = 'bricks_render_mode';
