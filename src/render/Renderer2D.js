// Ultra-lightweight HTML/DOM battery-saver 2D renderer. (spec §4.1 / §4.3)
//
// Renders the entire board as a single 16×16 grid of identical square cells
// using semantic DOM + CSS transforms only (zero WebGL). Animations run via
// requestAnimationFrame tweens strictly on demand — when idle, 0 rAF cycles
// execute. Pointer hover/click is resolved against the whole board surface
// (full-row/column launching, no pixel hunting), and the aim preview uses
// Physics.getAimPath() against the live grid reference.

import {
  GRID_SIZE,
  WALL_DEPTH,
  WALL_SIDES,
  DIR,
  DIRECTION_GLYPHS,
  COLOR_LIST,
} from '../core/Constants.js';
import { getAimPath, isLaneLaunchable } from '../core/Physics.js';

const CELL_PCT = 100 / 16; // each cell is 1/16 of the board

// Exact hex → CSS class suffix (spec §4.3 color parity).
const COLOR_CLASS = {
  '#e60026': 'crimson',
  '#2962ff': 'cobalt',
  '#00c853': 'emerald',
  '#ffd600': 'amber',
};

function colorClass(color) {
  return 'bricks2d-tile--' + (COLOR_CLASS[color] || 'crimson');
}

function key(cell) {
  return cell.col + ',' + cell.row;
}

// 16×16 0-indexed cell mapping (spec §4.3).
function fieldCell(x, y) {
  return { col: x + 3, row: y + 3 };
}

function wallCell(side, lane, layer) {
  switch (side) {
    case 'TOP':
      return { col: lane + 3, row: 2 - layer };
    case 'BOTTOM':
      return { col: lane + 3, row: 13 + layer };
    case 'LEFT':
      return { col: 2 - layer, row: lane + 3 };
    case 'RIGHT':
      return { col: 13 + layer, row: lane + 3 };
    default:
      return { col: 0, row: 0 };
  }
}

const STYLE_ID = 'bricks2d-style';

let styleInjected = false;

function ensureStyle() {
  if (styleInjected || typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) {
    styleInjected = true;
    return;
  }
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.append(style);
  styleInjected = true;
}

const CSS = `
.bricks2d{position:absolute;inset:0;display:flex;align-items:center;justify-content:center}
.bricks2d-board{
  position:relative;
  background:#131c2e;
  border-radius:10px;
  overflow:hidden;
  user-select:none;-webkit-user-select:none;
  touch-action:manipulation;
  box-shadow:0 4px 24px rgba(0,0,0,.5),inset 0 0 0 1px rgba(71,85,105,.3);
  cursor:default;
}
.bricks2d-layer{position:absolute;inset:0;pointer-events:none}
.bricks2d-layer--tiles{z-index:10}
.bricks2d-layer--aim{z-index:20}
.bricks2d-layer--fx{z-index:30}

/* static floor: field, wall trays, corner bezels */
.bricks2d-floor{position:absolute}
.bricks2d-floor--field{
  left:18.75%;top:18.75%;width:62.5%;height:62.5%;
  background:#16243b;
  background-image:
    repeating-linear-gradient(to right,transparent 0 calc(10% - 1px),rgba(71,85,105,.28) calc(10% - 1px) 10%),
    repeating-linear-gradient(to bottom,transparent 0 calc(10% - 1px),rgba(71,85,105,.28) calc(10% - 1px) 10%);
}
.bricks2d-floor--wall{background:#0e1726}
.bricks2d-floor--corner{background:#090f1a}

/* brick tiles */
.bricks2d-tile{position:absolute;will-change:left,top}
.bricks2d-brick{
  position:absolute;inset:6%;
  border-radius:24%;
  background:var(--c,#e60026);
  display:flex;align-items:center;justify-content:center;
  box-shadow:inset 0 2px 3px rgba(255,255,255,.35),inset 0 -2px 5px rgba(0,0,0,.28),0 2px 4px rgba(0,0,0,.45);
  transition:filter .12s ease,box-shadow .12s ease;
}
.bricks2d-brick::after{
  content:'';position:absolute;left:8%;top:6%;width:60%;height:34%;
  background:linear-gradient(180deg,rgba(255,255,255,.5),rgba(255,255,255,0));
  border-radius:40%;pointer-events:none;
}
.bricks2d-glyph{
  display:none;position:relative;z-index:1;
  color:#fff;font-weight:800;line-height:1;
  font-size:calc(var(--cell,20px) * .5);
  text-shadow:0 1px 2px rgba(0,0,0,.65);
}
.bricks2d-tile.has-glyph .bricks2d-glyph{display:block}

.bricks2d-tile--crimson{--c:#e60026}
.bricks2d-tile--cobalt{--c:#2962ff}
.bricks2d-tile--emerald{--c:#00c853}
.bricks2d-tile--amber{--c:#ffd600}

/* hover channel highlight (focus on layer 0) */
.bricks2d-tile.is-hovered .bricks2d-brick{
  filter:brightness(1.18);
  box-shadow:inset 0 2px 3px rgba(255,255,255,.5),inset 0 -2px 5px rgba(0,0,0,.25),0 0 8px 2px var(--c);
}
.bricks2d-tile.is-focus .bricks2d-brick{
  filter:brightness(1.32);
  box-shadow:inset 0 2px 4px rgba(255,255,255,.6),inset 0 -2px 5px rgba(0,0,0,.22),0 0 14px 4px var(--c);
}

/* aim preview overlays */
.bricks2d-aim-cell{
  position:absolute;width:6.25%;height:6.25%;
  border-radius:20%;
  background:var(--c,#fff);
  opacity:.28;
}
.bricks2d-ghost{
  position:absolute;width:6.25%;height:6.25%;
  border-radius:20%;
  border:2px dashed var(--c,#fff);
  background:var(--c,#fff);
  opacity:.35;
  box-shadow:0 0 10px 1px var(--c,#fff);
}

/* particles + confetti */
.bricks2d-particle{
  position:absolute;border-radius:50%;background:var(--c,#fff);
  pointer-events:none;
  animation:bricks2d-burst var(--dur,.5s) ease-out forwards;
}
@keyframes bricks2d-burst{
  0%{transform:translate(-50%,-50%) scale(1);opacity:1}
  100%{transform:translate(-50%,-50%) translate(var(--dx,0px),var(--dy,-40px)) scale(.15);opacity:0}
}
.bricks2d-confetti{
  position:absolute;border-radius:2px;background:var(--c,#fff);
  pointer-events:none;
  animation:bricks2d-confetti var(--dur,1.4s) cubic-bezier(.2,.6,.4,1) forwards;
}
@keyframes bricks2d-confetti{
  0%{transform:translate3d(0,0,0) rotate(0deg);opacity:1}
  100%{transform:translate3d(var(--dx,0px),var(--fall,400px),0) rotate(var(--spin,720deg));opacity:0}
}
`;

export default class Renderer2D {
  constructor({ callbacks, sound } = {}) {
    this.callbacks = callbacks || {};
    this.sound = sound || null;
    this.grid = null;
    this._enabled = true;
    this._playing = false;
    this._destroyed = false;
    this._boardSize = 400;
    this._hover = null;

    this._root = null;
    this._board = null;
    this._tileLayer = null;
    this._aimLayer = null;
    this._fxLayer = null;
    this._container = null;

    // id → { el, col, row } bookkeeping.
    this._tiles = new Map(); // id → element
    this._pos = new Map(); // id → {col,row} float (visual)
    this._cell = new Map(); // id → {col,row} integer (committed)
    this._cellOf = new Map(); // "col,row" → id
    this._active = new Set(); // active tweens
  }

  // ---- lifecycle (spec §4.1) ----

  mount(container) {
    if (this._root) return;
    this._container = container;
    ensureStyle();

    this._root = document.createElement('div');
    this._root.className = 'bricks2d';

    this._board = document.createElement('div');
    this._board.className = 'bricks2d-board';

    this._buildFloor(this._board);

    this._tileLayer = document.createElement('div');
    this._tileLayer.className = 'bricks2d-layer bricks2d-layer--tiles';
    this._aimLayer = document.createElement('div');
    this._aimLayer.className = 'bricks2d-layer bricks2d-layer--aim';
    this._fxLayer = document.createElement('div');
    this._fxLayer.className = 'bricks2d-layer bricks2d-layer--fx';

    this._board.append(this._tileLayer, this._aimLayer, this._fxLayer);
    this._root.append(this._board);
    container.append(this._root);

    this._attachListeners();
    this._resize();
    if (!this._enabled) this._root.classList.add('is-disabled');
    if (this.grid) this.syncFromGrid(this.grid);
  }

  unmount() {
    this._cancelTweens();
    this._clearHover();
    this._detachListeners();
    if (this._root) {
      this._root.remove();
      this._root = null;
      this._board = null;
      this._tileLayer = null;
      this._aimLayer = null;
      this._fxLayer = null;
    }
  }

  destroy() {
    this.unmount();
    this._destroyed = true;
    this._tiles.clear();
    this._pos.clear();
    this._cell.clear();
    this._cellOf.clear();
    this._container = null;
    this.grid = null;
    this.callbacks = {};
    this.sound = null;
  }

  // ---- authoritative board sync ----

  // Hard (re)sync every field brick + all 120 wall slots from the live grid,
  // and store the grid reference for hover aim previews.
  syncFromGrid(grid) {
    this.grid = grid;
    this._clearHover();
    for (const el of this._tiles.values()) el.remove();
    this._tiles.clear();
    this._pos.clear();
    this._cell.clear();
    this._cellOf.clear();
    if (!this._tileLayer || !grid) return;

    for (let y = 0; y < GRID_SIZE; y++) {
      for (let x = 0; x < GRID_SIZE; x++) {
        const b = grid.field[y][x];
        if (!b) continue;
        this._addTile(b, fieldCell(x, y));
      }
    }
    for (const side of WALL_SIDES) {
      for (let lane = 0; lane < GRID_SIZE; lane++) {
        for (let layer = 0; layer < WALL_DEPTH; layer++) {
          const b = grid.wallAt(side, lane, layer);
          if (!b) continue;
          this._addTile(b, wallCell(side, lane, layer));
        }
      }
    }
  }

  setEnabled(enabled) {
    this._enabled = Boolean(enabled);
    if (this._root) this._root.classList.toggle('is-disabled', !this._enabled);
    if (!this._enabled) this._clearHover();
  }

  // ---- turn timeline animation ----

  async playTurnTimeline(tl) {
    if (!tl || tl.type !== 'launch' || !this._root || !this.grid) return;
    this._playing = true;
    try {
      if (this.sound) this.sound.playLaunch();
      const flight = this._animateFlight(tl);
      const feed = this._animateWallFeed(tl);
      await Promise.all([flight, feed]);

      for (const step of tl.steps || []) {
        if (step.type === 'match') {
          if (this.sound) this.sound.playMatch(step.combo);
          await this._animateMatch(step);
        } else if (step.type === 'slide') {
          await this._animateSlide(step);
        }
      }

      if (tl.result) {
        if (tl.result.state === 'WAVE_CLEAR') {
          if (this.sound) this.sound.playWaveClear();
          await this._celebrateWaveClear();
        } else if (tl.result.state === 'GAME_OVER') {
          if (this.sound) this.sound.playGameOver();
        }
      }

      // Authoritative end-of-turn re-sync against the (already final) grid.
      this.syncFromGrid(this.grid);
    } finally {
      this._playing = false;
    }
  }

  // ---- building blocks ----

  _buildFloor(board) {
    const field = document.createElement('div');
    field.className = 'bricks2d-floor bricks2d-floor--field';
    board.append(field);

    const walls = [
      { name: 'top', style: 'left:18.75%;top:0;width:62.5%;height:18.75%' },
      { name: 'bottom', style: 'left:18.75%;top:81.25%;width:62.5%;height:18.75%' },
      { name: 'left', style: 'left:0;top:18.75%;width:18.75%;height:62.5%' },
      { name: 'right', style: 'left:81.25%;top:18.75%;width:18.75%;height:62.5%' },
    ];
    for (const w of walls) {
      const el = document.createElement('div');
      el.className = 'bricks2d-floor bricks2d-floor--wall';
      el.setAttribute('style', w.style);
      board.append(el);
    }

    const corners = [
      'left:0;top:0;width:18.75%;height:18.75%',
      'left:81.25%;top:0;width:18.75%;height:18.75%',
      'left:0;top:81.25%;width:18.75%;height:18.75%',
      'left:81.25%;top:81.25%;width:18.75%;height:18.75%',
    ];
    for (const c of corners) {
      const el = document.createElement('div');
      el.className = 'bricks2d-floor bricks2d-floor--corner';
      el.setAttribute('style', c);
      board.append(el);
    }
  }

  _addTile(brick, cell) {
    const el = document.createElement('div');
    el.className = 'bricks2d-tile ' + colorClass(brick.color);
    el.dataset.id = brick.id;

    const inner = document.createElement('div');
    inner.className = 'bricks2d-brick';
    const glyph = document.createElement('span');
    glyph.className = 'bricks2d-glyph';
    glyph.textContent = DIRECTION_GLYPHS[brick.direction] || '';
    inner.append(glyph);
    el.append(inner);

    this._placeTile(el, cell.col, cell.row);
    this._tileLayer.append(el);

    this._tiles.set(brick.id, el);
    this._pos.set(brick.id, { col: cell.col, row: cell.row });
    this._cell.set(brick.id, { col: cell.col, row: cell.row });
    this._cellOf.set(key(cell), brick.id);
  }

  _placeTile(el, col, row) {
    el.style.left = col * CELL_PCT + '%';
    el.style.top = row * CELL_PCT + '%';
    el.style.width = CELL_PCT + '%';
    el.style.height = CELL_PCT + '%';
  }

  _setGlyph(el, direction) {
    const glyph = el.querySelector('.bricks2d-glyph');
    if (glyph) glyph.textContent = DIRECTION_GLYPHS[direction] || '';
    el.classList.toggle('has-glyph', !!direction && direction !== DIR.NONE);
  }

  _removeTile(id) {
    const el = this._tiles.get(id);
    if (el) el.remove();
    this._tiles.delete(id);
    this._pos.delete(id);
    const c = this._cell.get(id);
    if (c && this._cellOf.get(key(c)) === id) this._cellOf.delete(key(c));
    this._cell.delete(id);
  }

  _commitPos(id, col, row) {
    const el = this._tiles.get(id);
    const old = this._cell.get(id);
    if (old && this._cellOf.get(key(old)) === id) this._cellOf.delete(key(old));
    const c = { col: Math.round(col), row: Math.round(row) };
    this._cell.set(id, c);
    this._cellOf.set(key(c), id);
    this._pos.set(id, { col: c.col, row: c.row });
    if (el) {
      this._placeTile(el, c.col, c.row);
      el.style.zIndex = '';
      el.style.transform = '';
      el.style.opacity = '';
    }
  }

  // ---- rAF tween utilities (0 rAF when idle) ----

  _easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }

  _easeInCubic(t) {
    return t * t * t;
  }

  _easeOutBack(t) {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  }

  _tween(duration, onUpdate) {
    return new Promise((resolve) => {
      if (this._destroyed) {
        resolve();
        return;
      }
      const t = { cancel: false };
      this._active.add(t);
      const start = performance.now();
      const step = (now) => {
        if (this._destroyed || t.cancel) {
          this._active.delete(t);
          resolve();
          return;
        }
        const p = Math.min(1, (now - start) / duration);
        onUpdate(p);
        if (p >= 1) {
          this._active.delete(t);
          resolve();
        } else {
          requestAnimationFrame(step);
        }
      };
      requestAnimationFrame(step);
    });
  }

  _cancelTweens() {
    for (const t of this._active) t.cancel = true;
    this._active.clear();
  }

  _moveTile(id, toCol, toRow, duration, opts = {}) {
    const el = this._tiles.get(id);
    if (!el) return Promise.resolve();
    const from = this._pos.get(id) || { col: toCol, row: toRow };
    const ease = opts.easing || this._easeOutCubic;
    if (opts.zIndex != null) el.style.zIndex = opts.zIndex;
    return this._tween(duration, (p) => {
      const e = ease(p);
      const col = from.col + (toCol - from.col) * e;
      const row = from.row + (toRow - from.row) * e;
      this._pos.set(id, { col, row });
      el.style.left = col * CELL_PCT + '%';
      el.style.top = row * CELL_PCT + '%';
      if (opts.fadeOut) el.style.opacity = String(1 - Math.max(0, (p - 0.35) / 0.65));
    }).then(() => {
      if (opts.remove) {
        this._removeTile(id);
      } else {
        this._commitPos(id, toCol, toRow);
      }
      if (opts.onComplete) opts.onComplete();
    });
  }

  _popTile(id, color) {
    const el = this._tiles.get(id);
    if (!el) return Promise.resolve();
    const c = this._cell.get(id);
    if (c) this._spawnBurst(c, color);
    return this._tween(240, (p) => {
      const s = p < 0.3 ? 1 + (p / 0.3) * 0.3 : 1.3 - ((p - 0.3) / 0.7) * 1.3;
      el.style.transform = 'scale(' + Math.max(0, s) + ')';
      el.style.opacity = String(p < 0.3 ? 1 : 1 - (p - 0.3) / 0.7);
    }).then(() => this._removeTile(id));
  }

  // ---- timeline steps ----

  _animateFlight(tl) {
    const id = tl.projectile.id;
    const el = this._tiles.get(id);
    if (!el) return Promise.resolve();
    this._setGlyph(el, tl.direction);
    // Release the projectile's committed wall-slot cell so the inward feed can claim it.
    const origin = this._cell.get(id);
    if (origin && this._cellOf.get(key(origin)) === id) this._cellOf.delete(key(origin));
    this._cell.delete(id);

    const landing = fieldCell(tl.landing.x, tl.landing.y);
    const cells = (tl.path && tl.path.length) || 1;
    const duration = Math.max(140, cells * 40);
    return this._moveTile(id, landing.col, landing.row, duration, { zIndex: 5 }).then(() => {
      if (this.sound) this.sound.playImpact();
    });
  }

  _animateWallFeed(tl) {
    const { side, lane, newBrick } = tl.wallFeed;
    const c0 = wallCell(side, lane, 0);
    const c1 = wallCell(side, lane, 1);
    const c2 = wallCell(side, lane, 2);
    // Current occupants of layer 1 / 2 (from DOM state, not the final grid,
    // since this lane may be pushed again later in the same turn).
    const cur1 = this._cellOf.get(key(c1));
    const cur2 = this._cellOf.get(key(c2));

    const tasks = [];
    if (cur1 && this._tiles.has(cur1)) tasks.push(this._moveTile(cur1, c0.col, c0.row, 160));
    if (cur2 && this._tiles.has(cur2)) tasks.push(this._moveTile(cur2, c1.col, c1.row, 160));

    // Fresh brick drops into layer 2 (pop-in).
    if (newBrick && !this._tiles.has(newBrick.id)) {
      this._addTile(newBrick, c2);
      const el = this._tiles.get(newBrick.id);
      if (el) {
        el.style.transform = 'scale(0)';
        el.style.opacity = '0';
        tasks.push(
          this._tween(180, (p) => {
            const e = this._easeOutBack(p);
            el.style.transform = 'scale(' + e + ')';
            el.style.opacity = String(Math.min(1, p * 2));
          }).then(() => {
            el.style.transform = '';
            el.style.opacity = '';
          }),
        );
      }
    }
    return Promise.all(tasks);
  }

  _animateMatch(step) {
    const tasks = [];
    for (const cell of step.cells || []) {
      const c = fieldCell(cell.x, cell.y);
      const id = this._cellOf.get(key(c));
      if (id) tasks.push(this._popTile(id, cell.color || '#e60026'));
    }
    return Promise.all(tasks);
  }

  _animateSlide(step) {
    const tasks = [];
    for (const m of step.moves || []) {
      if (!this._tiles.has(m.brick.id)) continue;
      const to = fieldCell(m.to.x, m.to.y);
      tasks.push(this._moveTile(m.brick.id, to.col, to.row, 220));
    }
    for (const w of step.wallPush || []) {
      const c0 = wallCell(w.side, w.lane, 0);
      const c1 = wallCell(w.side, w.lane, 1);
      const c2 = wallCell(w.side, w.lane, 2);
      const cur0 = this._cellOf.get(key(c0));
      const cur1 = this._cellOf.get(key(c1));
      const cur2 = this._cellOf.get(key(c2));

      // Arriving brick docks layer 0 (direction reset to NONE in the grid).
      if (w.brick && this._tiles.has(w.brick.id)) {
        tasks.push(this._moveTile(w.brick.id, c0.col, c0.row, 220));
      }
      // Queue shifts outward: 0→1, 1→2.
      if (cur0 && this._tiles.has(cur0)) tasks.push(this._moveTile(cur0, c1.col, c1.row, 220));
      if (cur1 && this._tiles.has(cur1)) tasks.push(this._moveTile(cur1, c2.col, c2.row, 220));
      // Layer 2 ejected.
      const ejectId = w.ejected && w.ejected.id ? w.ejected.id : cur2;
      if (ejectId && this._tiles.has(ejectId)) {
        const out = this._ejectTarget(w.side, w.lane);
        tasks.push(
          this._moveTile(ejectId, out.col, out.row, 260, { remove: true, fadeOut: true }),
        );
      }
    }
    return Promise.all(tasks);
  }

  _ejectTarget(side, lane) {
    const c = wallCell(side, lane, WALL_DEPTH - 1);
    switch (side) {
      case 'TOP':
        return { col: c.col, row: c.row - 4 };
      case 'BOTTOM':
        return { col: c.col, row: c.row + 4 };
      case 'LEFT':
        return { col: c.col - 4, row: c.row };
      case 'RIGHT':
        return { col: c.col + 4, row: c.row };
      default:
        return c;
    }
  }

  // ---- FX (match bursts + wave-clear celebration) ----

  _spawnBurst(cell, color, count = 10) {
    const cx = ((cell.col + 0.5) / 16) * 100;
    const cy = ((cell.row + 0.5) / 16) * 100;
    const size = Math.max(4, this._boardSize * 0.015);
    for (let i = 0; i < count; i++) {
      const p = document.createElement('div');
      p.className = 'bricks2d-particle';
      const ang = Math.random() * Math.PI * 2;
      const dist = (0.3 + Math.random() * 0.7) * this._boardSize * 0.18;
      p.style.left = cx + '%';
      p.style.top = cy + '%';
      p.style.width = size + 'px';
      p.style.height = size + 'px';
      p.style.setProperty('--c', color || '#ffffff');
      p.style.setProperty('--dx', Math.cos(ang) * dist + 'px');
      p.style.setProperty('--dy', Math.sin(ang) * dist + 'px');
      p.style.setProperty('--dur', 0.4 + Math.random() * 0.3 + 's');
      this._fxLayer.append(p);
      p.addEventListener('animationend', () => p.remove(), { once: true });
    }
  }

  _spawnFirework() {
    const x = 18.75 + Math.random() * 62.5;
    const y = 18.75 + Math.random() * 62.5;
    const color = COLOR_LIST[Math.floor(Math.random() * COLOR_LIST.length)];
    const n = 22;
    const size = Math.max(5, this._boardSize * 0.016);
    for (let i = 0; i < n; i++) {
      const p = document.createElement('div');
      p.className = 'bricks2d-particle';
      const ang = (i / n) * Math.PI * 2 + Math.random() * 0.3;
      const dist = (0.5 + Math.random() * 0.5) * this._boardSize * 0.16;
      p.style.left = x + '%';
      p.style.top = y + '%';
      p.style.width = size + 'px';
      p.style.height = size + 'px';
      p.style.setProperty('--c', color);
      p.style.setProperty('--dx', Math.cos(ang) * dist + 'px');
      p.style.setProperty('--dy', Math.sin(ang) * dist + 'px');
      p.style.setProperty('--dur', '0.7s');
      this._fxLayer.append(p);
      p.addEventListener('animationend', () => p.remove(), { once: true });
    }
  }

  _spawnConfetti() {
    const n = 60;
    const w = Math.max(3, this._boardSize * 0.012);
    const h = Math.max(8, this._boardSize * 0.03);
    for (let i = 0; i < n; i++) {
      const c = document.createElement('div');
      c.className = 'bricks2d-confetti';
      c.style.left = Math.random() * 100 + '%';
      c.style.top = -5 + Math.random() * 15 + '%';
      c.style.width = w + 'px';
      c.style.height = h + 'px';
      c.style.setProperty('--c', COLOR_LIST[i % COLOR_LIST.length]);
      c.style.setProperty('--dx', (Math.random() - 0.5) * this._boardSize * 0.4 + 'px');
      c.style.setProperty('--fall', this._boardSize * 1.15 + 'px');
      c.style.setProperty('--spin', (Math.random() * 2 - 1) * 1080 + 'deg');
      c.style.setProperty('--dur', 1.0 + Math.random() * 0.8 + 's');
      this._fxLayer.append(c);
      c.addEventListener('animationend', () => c.remove(), { once: true });
    }
  }

  // 2.0s celebration: synchronized multi-stage fireworks + confetti shower.
  async _celebrateWaveClear() {
    const bursts = [];
    for (let i = 0; i < 4; i++) {
      bursts.push(
        new Promise((res) => {
          setTimeout(() => {
            this._spawnFirework();
            res();
          }, 150 + i * 400);
        }),
      );
    }
    this._spawnConfetti();
    await Promise.all(bursts);
    await new Promise((res) => setTimeout(res, 250));
  }

  // ---- pointer interaction (spec §3.1) ----

  _attachListeners() {
    if (!this._board) return;
    this._onMove = (e) => this._handleMove(e);
    this._onLeave = () => this._clearHover();
    this._onClick = (e) => this._handleClick(e);
    this._onResize = () => this._resize();
    this._board.addEventListener('pointermove', this._onMove);
    this._board.addEventListener('pointerleave', this._onLeave);
    this._board.addEventListener('click', this._onClick);
    window.addEventListener('resize', this._onResize);
    if (typeof ResizeObserver !== 'undefined' && this._container) {
      this._ro = new ResizeObserver(this._onResize);
      this._ro.observe(this._container);
    }
  }

  _detachListeners() {
    if (this._board) {
      if (this._onMove) this._board.removeEventListener('pointermove', this._onMove);
      if (this._onLeave) this._board.removeEventListener('pointerleave', this._onLeave);
      if (this._onClick) this._board.removeEventListener('click', this._onClick);
    }
    if (this._onResize) window.removeEventListener('resize', this._onResize);
    if (this._ro) {
      this._ro.disconnect();
      this._ro = null;
    }
  }

  _resize() {
    if (!this._container || !this._board) return;
    const w = this._container.clientWidth;
    const h = this._container.clientHeight;
    const size = Math.max(1, Math.floor(Math.min(w, h) * 0.98));
    this._boardSize = size;
    this._board.style.width = size + 'px';
    this._board.style.height = size + 'px';
    this._board.style.setProperty('--cell', size / 16 + 'px');
  }

  // Map a pointer coordinate to a wall lane, or null when outside all walls.
  _posToLane(clientX, clientY) {
    if (!this._board) return null;
    const rect = this._board.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const fx = (clientX - rect.left) / rect.width;
    const fy = (clientY - rect.top) / rect.height;
    if (fx < 0 || fx > 1 || fy < 0 || fy > 1) return null;
    const col = Math.min(15, Math.floor(fx * 16));
    const row = Math.min(15, Math.floor(fy * 16));
    if (row <= 2 && col >= 3 && col <= 12) return { side: 'TOP', lane: col - 3 };
    if (row >= 13 && col >= 3 && col <= 12) return { side: 'BOTTOM', lane: col - 3 };
    if (col <= 2 && row >= 3 && row <= 12) return { side: 'LEFT', lane: row - 3 };
    if (col >= 13 && row >= 3 && row <= 12) return { side: 'RIGHT', lane: row - 3 };
    return null;
  }

  _handleMove(e) {
    if (!this._enabled || this._playing) return;
    const lane = this._posToLane(e.clientX, e.clientY);
    if (!lane) {
      this._clearHover();
      return;
    }
    if (this._hover && this._hover.side === lane.side && this._hover.lane === lane.lane) return;
    this._setHover(lane.side, lane.lane);
  }

  _handleClick(e) {
    if (this.sound) this.sound.unlock();
    if (!this._enabled || this._playing || !this.grid) return;
    const lane = this._posToLane(e.clientX, e.clientY);
    if (!lane) return;
    if (isLaneLaunchable(this.grid, lane.side, lane.lane)) {
      if (this.callbacks && typeof this.callbacks.onLaunch === 'function') {
        this.callbacks.onLaunch(lane.side, lane.lane);
      }
    }
  }

  _laneColor(side, lane) {
    const b = this.grid ? this.grid.wallAt(side, lane, 0) : null;
    return (b && b.color) || '#e60026';
  }

  // ---- hover aim preview (spec §3.1) ----

  _setHover(side, lane) {
    this._clearHover();
    if (!this.grid || !this._enabled) return;
    const aim = getAimPath(this.grid, side, lane);
    // Mouth-blocked → no highlight, clicking does nothing.
    if (!aim.path || aim.path.length === 0) return;

    const color = this._laneColor(side, lane);

    // Highlight the full 3-deep channel, focus on layer 0.
    for (let d = 0; d < WALL_DEPTH; d++) {
      const c = wallCell(side, lane, d);
      const id = this._cellOf.get(key(c));
      if (!id) continue;
      const el = this._tiles.get(id);
      if (el) {
        el.classList.add('is-hovered');
        if (d === 0) el.classList.add('is-focus');
      }
    }

    // Aim line across the path cells.
    for (const cell of aim.path) {
      const c = fieldCell(cell.x, cell.y);
      this._addAimCell(c.col, c.row, color);
    }

    // Ghost landing box only when launchable (empty lane → full path, no ghost).
    if (aim.launchable && aim.landing) {
      const c = fieldCell(aim.landing.x, aim.landing.y);
      this._addGhost(c.col, c.row, color);
    }

    this._hover = { side, lane };
  }

  _clearHover() {
    this._hover = null;
    if (this._aimLayer) this._aimLayer.textContent = '';
    if (this._tileLayer) {
      const els = this._tileLayer.querySelectorAll('.is-hovered, .is-focus');
      for (const el of els) el.classList.remove('is-hovered', 'is-focus');
    }
  }

  _addAimCell(col, row, color) {
    const el = document.createElement('div');
    el.className = 'bricks2d-aim-cell';
    el.style.left = col * CELL_PCT + '%';
    el.style.top = row * CELL_PCT + '%';
    el.style.setProperty('--c', color);
    this._aimLayer.append(el);
  }

  _addGhost(col, row, color) {
    const el = document.createElement('div');
    el.className = 'bricks2d-ghost';
    el.style.left = col * CELL_PCT + '%';
    el.style.top = row * CELL_PCT + '%';
    el.style.setProperty('--c', color);
    this._aimLayer.append(el);
  }
}
