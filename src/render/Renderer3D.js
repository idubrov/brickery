// Renderer3D: Three.js WebGL renderer coordinating SceneManager, BoardView,
// BrickMesh, Animator, ParticleSystem, and InputManager. (spec §4.1 / §4.2)
//
// Implements the pluggable renderer contract:
//   mount(container) · unmount() · syncFromGrid(grid) · playTurnTimeline(tl)
//   setEnabled(enabled) · destroy()

import * as THREE from 'three';
import { DIR } from '../core/Constants.js';
import { isLaneLaunchable, getAimPath } from '../core/Physics.js';
import { SceneManager } from './SceneManager.js';
import { BoardView, fieldToWorld, wallToWorld } from './BoardView.js';
import { BrickMesh, colorStrToNum } from './BrickMesh.js';
import { Animator, Easing } from './Animator.js';
import { ParticleSystem } from './ParticleSystem.js';
import { InputManager } from '../input/InputManager.js';

const GRID_SIZE = 10;
const WALL_SIDES = ['TOP', 'BOTTOM', 'LEFT', 'RIGHT'];

function cellKey(x, y) {
  return `${x},${y}`;
}

function wallKey(side, lane, layer) {
  return `${side}:${lane}:${layer}`;
}

export default class Renderer3D {
  constructor({ callbacks, sound } = {}) {
    this.callbacks = callbacks || {};
    this.sound = sound || null;
    this.grid = null;
    this.enabled = true;
    this._destroyed = false;
    this._container = null;
    this._root = null;
    this._resizeHandler = null;
    this._hover = null;

    this.scene = new SceneManager();
    this.board = new BoardView(this.scene.scene);
    this.animator = new Animator();
    this.particles = new ParticleSystem(this.scene.scene);

    this.brickGroup = new THREE.Group();
    this.scene.scene.add(this.brickGroup);
    this.fieldMeshes = new Map(); // "x,y" → Mesh
    this.wallMeshes = new Map(); // "side:lane:layer" → Mesh

    this.input = new InputManager({
      domElement: this.scene.domElement,
      camera: this.scene.camera,
      getRaycastTargets: () => this._raycastTargets(),
      isLaunchable: (side, lane) => this._isLaunchable(side, lane),
      onHover: (info) => this._onHover(info),
      onLaunch: (side, lane) => this._onLaunch(side, lane),
    });
  }

  // ---- renderer contract -------------------------------------------------

  mount(container) {
    if (!container) return;
    this._container = container;

    const root = document.createElement('div');
    root.className = 'renderer-3d-root';
    root.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;overflow:hidden;';
    const canvas = this.scene.domElement;
    canvas.style.cssText = 'width:100%;height:100%;display:block;touch-action:none;';
    root.appendChild(canvas);
    container.appendChild(root);
    this._root = root;

    this._resize();
    this._resizeHandler = () => this._resize();
    window.addEventListener('resize', this._resizeHandler);

    this.scene.start((dt) => {
      this.animator.update(dt);
      this.particles.update(dt);
    });
  }

  unmount() {
    this.scene.stop();
    if (this._resizeHandler) {
      window.removeEventListener('resize', this._resizeHandler);
      this._resizeHandler = null;
    }
    this._clearHover();
    if (this._root && this._root.parentNode) {
      this._root.parentNode.removeChild(this._root);
    }
    this._root = null;
    this._container = null;
  }

  // Authoritative diff-based resync of every field brick + all 120 wall
  // slots. Reuses matching meshes, recreates changed/missing ones, and
  // removes stale ones (defensive self-heal). Stores the grid ref for hover
  // previews.
  syncFromGrid(grid) {
    if (grid) this.grid = grid;
    const g = this.grid;
    if (!g) return;
    this._syncField(g);
    this._syncWalls(g);
  }

  setEnabled(enabled) {
    this.enabled = !!enabled;
    this.input.setEnabled(this.enabled);
    if (!this.enabled) this._clearHover();
  }

  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    this.animator.cancelAll();
    this.input.dispose();
    this.unmount();
    this._clearHover();
    for (const mesh of this.fieldMeshes.values()) BrickMesh.disposeMesh(mesh);
    for (const mesh of this.wallMeshes.values()) BrickMesh.disposeMesh(mesh);
    this.fieldMeshes.clear();
    this.wallMeshes.clear();
    this.board.dispose();
    this.particles.dispose();
    BrickMesh.disposeAll();
    this.scene.dispose();
    this.brickGroup.clear();
    this.grid = null;
  }

  // ---- turn timeline animation ------------------------------------------

  // Animate flight → source wall feed → steps (match/slide/wallPush) → result
  // celebration. Resolves when the full sequence completes.
  async playTurnTimeline(tl) {
    if (!tl || this._destroyed) return;
    this._clearHover();

    if (tl.type === 'launch') {
      if (this.sound && this.sound.playLaunch) this.sound.playLaunch();
      const flight = this._animateFlight(tl);
      const feed = this._animateWallFeed(tl.wallFeed);
      await Promise.all([flight, feed]);
      if (this._destroyed) return;
      if (this.sound && this.sound.playImpact) this.sound.playImpact();
    }

    for (const step of tl.steps || []) {
      if (this._destroyed) return;
      if (step.type === 'match') await this._animateMatch(step);
      else if (step.type === 'slide') await this._animateSlide(step);
    }

    if (this._destroyed) return;
    if (tl.result) {
      if (tl.result.state === 'WAVE_CLEAR') {
        if (this.sound && this.sound.playWaveClear) this.sound.playWaveClear();
        this.scene.shake(0.15);
        await this.particles.celebrate();
      } else if (tl.result.state === 'GAME_OVER') {
        if (this.sound && this.sound.playGameOver) this.sound.playGameOver();
      }
    }

    // Authoritative reconciliation (self-heal any missing/stale meshes).
    if (!this._destroyed) this.syncFromGrid(this.grid);
  }

  // ---- internals ---------------------------------------------------------

  _resize() {
    if (!this._container) return;
    const w = this._container.clientWidth || 1;
    const h = this._container.clientHeight || 1;
    this.scene.setSize(w, h);
  }

  _raycastTargets() {
    const targets = this.board.getLaneHitboxes();
    for (const mesh of this.wallMeshes.values()) targets.push(mesh);
    return targets;
  }

  _isLaunchable(side, lane) {
    return !!this.grid && isLaneLaunchable(this.grid, side, lane);
  }

  _createBrickMesh(brick) {
    const mesh = BrickMesh.create(brick);
    this.brickGroup.add(mesh);
    return mesh;
  }

  _removeMesh(mesh) {
    BrickMesh.disposeMesh(mesh);
  }

  _syncField(g) {
    const desired = new Map();
    for (let y = 0; y < GRID_SIZE; y++) {
      for (let x = 0; x < GRID_SIZE; x++) {
        const b = g.field[y][x];
        if (b) desired.set(cellKey(x, y), b);
      }
    }
    for (const [key, mesh] of Array.from(this.fieldMeshes)) {
      const b = desired.get(key);
      if (!b) {
        this._removeMesh(mesh);
        this.fieldMeshes.delete(key);
      } else {
        const [x, y] = key.split(',').map(Number);
        if (mesh.userData.id !== b.id || mesh.userData.color !== b.color || mesh.userData.direction !== b.direction) {
          BrickMesh.setAppearance(mesh, { color: b.color, direction: b.direction, id: b.id });
        }
        const w = fieldToWorld(x, y);
        mesh.position.set(w.x, 0, w.z);
        mesh.visible = true;
      }
    }
    for (const [key, b] of desired) {
      if (this.fieldMeshes.has(key)) continue;
      const [x, y] = key.split(',').map(Number);
      const mesh = this._createBrickMesh(b);
      mesh.userData.type = 'field';
      mesh.userData.x = x;
      mesh.userData.y = y;
      const w = fieldToWorld(x, y);
      mesh.position.set(w.x, 0, w.z);
      this.fieldMeshes.set(key, mesh);
    }
  }

  _syncWalls(g) {
    const desired = new Map();
    for (const side of WALL_SIDES) {
      for (let lane = 0; lane < GRID_SIZE; lane++) {
        for (let layer = 0; layer < 3; layer++) {
          const b = g.walls[side][lane][layer];
          if (b) desired.set(wallKey(side, lane, layer), { side, lane, layer, b });
        }
      }
    }
    for (const [key, mesh] of Array.from(this.wallMeshes)) {
      const d = desired.get(key);
      if (!d) {
        this._removeMesh(mesh);
        this.wallMeshes.delete(key);
      } else {
        if (mesh.userData.id !== d.b.id || mesh.userData.color !== d.b.color || mesh.userData.direction !== d.b.direction) {
          BrickMesh.setAppearance(mesh, { color: d.b.color, direction: d.b.direction, id: d.b.id });
        }
        const w = wallToWorld(d.side, d.lane, d.layer);
        mesh.position.set(w.x, 0, w.z);
        mesh.visible = true;
      }
    }
    for (const [key, d] of desired) {
      if (this.wallMeshes.has(key)) continue;
      const mesh = this._createBrickMesh(d.b);
      mesh.userData.type = 'wall';
      mesh.userData.side = d.side;
      mesh.userData.lane = d.lane;
      mesh.userData.layer = d.layer;
      const w = wallToWorld(d.side, d.lane, d.layer);
      mesh.position.set(w.x, 0, w.z);
      this.wallMeshes.set(key, mesh);
    }
  }

  _onHover(info) {
    if (!info) {
      this._clearHover();
      return;
    }
    const { side, lane } = info;
    const aim = this.grid ? getAimPath(this.grid, side, lane) : null;
    const hasPath = !!(aim && aim.path && aim.path.length > 0);
    if (!hasPath) {
      // Mouth blocked → no highlight, no aim, click does nothing.
      this._clearHover();
      return;
    }
    const brick = this.grid.walls[side][lane][0];
    const colorNum = brick ? colorStrToNum(brick.color) : 0xe60026;
    this._setLaneHighlight(side, lane, true);
    this.board.showAim({ side, lane, colorNum, path: aim.path, landing: aim.landing });
    this._hover = { side, lane };
  }

  _setLaneHighlight(side, lane, on) {
    for (let layer = 0; layer < 3; layer++) {
      const mesh = this.wallMeshes.get(wallKey(side, lane, layer));
      if (!mesh) continue;
      BrickMesh.setHover(mesh, on);
      if (layer === 0) {
        mesh.position.y = on ? 0.18 : 0;
      }
    }
  }

  _clearHover() {
    if (this._hover) {
      this._setLaneHighlight(this._hover.side, this._hover.lane, false);
      this._hover = null;
    }
    this.board.hideAim();
  }

  _onLaunch(side, lane) {
    if (this._destroyed) return;
    this._clearHover();
    if (this.callbacks.onLaunch) this.callbacks.onLaunch(side, lane);
  }

  // Flight: source wall layer-0 mesh becomes the projectile and flies to the
  // landing cell (two-segment hop arc). Wall feed runs concurrently.
  _animateFlight(tl) {
    const srcKey = wallKey(tl.side, tl.lane, 0);
    const proj = this.wallMeshes.get(srcKey);
    this.wallMeshes.delete(srcKey);

    const landing = fieldToWorld(tl.landing.x, tl.landing.y);

    if (!proj) {
      // Self-heal: recreate the projectile mesh directly at the landing.
      const mesh = this._createBrickMesh(tl.projectile);
      BrickMesh.setAppearance(mesh, { color: tl.projectile.color, direction: tl.projectile.direction, id: tl.projectile.id });
      mesh.userData.type = 'field';
      mesh.userData.x = tl.landing.x;
      mesh.userData.y = tl.landing.y;
      mesh.position.set(landing.x, 0, landing.z);
      this.fieldMeshes.set(cellKey(tl.landing.x, tl.landing.y), mesh);
      return Promise.resolve();
    }

    proj.userData.type = 'field';
    proj.userData.x = tl.landing.x;
    proj.userData.y = tl.landing.y;
    BrickMesh.setAppearance(proj, { color: tl.projectile.color, direction: tl.projectile.direction, id: tl.projectile.id });
    this.fieldMeshes.set(cellKey(tl.landing.x, tl.landing.y), proj);

    const from = wallToWorld(tl.side, tl.lane, 0);
    const mid = new THREE.Vector3((from.x + landing.x) / 2, 1.15, (from.z + landing.z) / 2);
    const up = this.animator.tween({ object: proj, position: mid, duration: 0.16, easing: Easing.easeOutCubic });
    return up.then(() =>
      this.animator.tween({
        object: proj,
        position: new THREE.Vector3(landing.x, 0, landing.z),
        duration: 0.2,
        easing: Easing.easeInQuad,
      }),
    );
  }

  // Source wall inward feed: layer1→0, layer2→1, fresh brick drops into 2.
  _animateWallFeed(wf) {
    if (!wf) return Promise.resolve();
    const { side, lane, newBrick } = wf;
    const l1 = this.wallMeshes.get(wallKey(side, lane, 1));
    const l2 = this.wallMeshes.get(wallKey(side, lane, 2));

    if (l1) this.wallMeshes.set(wallKey(side, lane, 0), l1);
    if (l2) this.wallMeshes.set(wallKey(side, lane, 1), l2);

    const fresh = this._createBrickMesh(newBrick);
    fresh.userData.type = 'wall';
    fresh.userData.side = side;
    fresh.userData.lane = lane;
    fresh.userData.layer = 2;
    const fw = wallToWorld(side, lane, 2);
    fresh.position.set(fw.x, 1.1, fw.z);
    this.wallMeshes.set(wallKey(side, lane, 2), fresh);

    const anims = [];
    if (l1) {
      l1.userData.layer = 0;
      const w = wallToWorld(side, lane, 0);
      anims.push(this.animator.tween({ object: l1, position: new THREE.Vector3(w.x, 0, w.z), duration: 0.18 }));
    }
    if (l2) {
      l2.userData.layer = 1;
      const w = wallToWorld(side, lane, 1);
      anims.push(this.animator.tween({ object: l2, position: new THREE.Vector3(w.x, 0, w.z), duration: 0.18 }));
    }
    anims.push(
      this.animator.tween({ object: fresh, position: new THREE.Vector3(fw.x, 0, fw.z), duration: 0.22, easing: Easing.easeOutCubic }),
    );
    return Promise.all(anims);
  }

  _animateMatch(step) {
    if (this.sound && this.sound.playMatch) this.sound.playMatch(step.combo || 1);
    if ((step.combo || 1) >= 2) this.scene.shake(0.06 * (step.combo || 1));
    const pops = [];
    for (const cell of step.cells) {
      const key = cellKey(cell.x, cell.y);
      const mesh = this.fieldMeshes.get(key);
      if (!mesh) continue;
      this.fieldMeshes.delete(key);
      this.particles.burst(fieldToWorld(cell.x, cell.y), cell.color);
      pops.push(
        this.animator.tween({
          object: mesh,
          scale: new THREE.Vector3(0.001, 0.001, 0.001),
          duration: 0.22,
          easing: Easing.easeInBack,
          onComplete: () => this._removeMesh(mesh),
        }),
      );
    }
    return Promise.all(pops);
  }

  _animateSlide(step) {
    const anims = [];
    for (const move of step.moves) {
      const fromKey = cellKey(move.from.x, move.from.y);
      const toKey = cellKey(move.to.x, move.to.y);
      const mesh = this.fieldMeshes.get(fromKey);
      if (!mesh) continue;
      this.fieldMeshes.delete(fromKey);
      this.fieldMeshes.set(toKey, mesh);
      mesh.userData.x = move.to.x;
      mesh.userData.y = move.to.y;
      if (move.brick) {
        BrickMesh.setAppearance(mesh, { color: move.brick.color, direction: move.brick.direction, id: move.brick.id });
      }
      const w = fieldToWorld(move.to.x, move.to.y);
      anims.push(
        this.animator.tween({ object: mesh, position: new THREE.Vector3(w.x, 0, w.z), duration: 0.2, easing: Easing.easeInOutCubic }),
      );
    }
    for (const wp of step.wallPush) {
      anims.push(this._animateWallPush(wp));
    }
    return Promise.all(anims);
  }

  _animateWallPush(wp) {
    const { side, lane, brick, ejected } = wp;
    const anims = [];

    // Locate the entering brick's field mesh by id (it slid off the board).
    let enter = null;
    for (const [key, mesh] of this.fieldMeshes) {
      if (mesh.userData.id === brick.id) {
        enter = mesh;
        this.fieldMeshes.delete(key);
        break;
      }
    }
    if (!enter) {
      enter = this._createBrickMesh({ id: brick.id, color: brick.color, direction: DIR.NONE });
    }

    const l0 = this.wallMeshes.get(wallKey(side, lane, 0));
    const l1 = this.wallMeshes.get(wallKey(side, lane, 1));
    const l2 = this.wallMeshes.get(wallKey(side, lane, 2));

    this.wallMeshes.set(wallKey(side, lane, 0), enter);
    this.wallMeshes.set(wallKey(side, lane, 1), l0);
    this.wallMeshes.set(wallKey(side, lane, 2), l1);

    // Docked brick is static (direction NONE), per Grid.pushInnermostWall.
    enter.userData.type = 'wall';
    enter.userData.side = side;
    enter.userData.lane = lane;
    enter.userData.layer = 0;
    BrickMesh.setAppearance(enter, { color: brick.color, direction: DIR.NONE, id: brick.id });

    const w0 = wallToWorld(side, lane, 0);
    if (enter.position.distanceToSquared(new THREE.Vector3(w0.x, 0, w0.z)) > 0.001) {
      anims.push(this.animator.tween({ object: enter, position: new THREE.Vector3(w0.x, 0, w0.z), duration: 0.2 }));
    }
    if (l0) {
      l0.userData.layer = 1;
      const w = wallToWorld(side, lane, 1);
      anims.push(this.animator.tween({ object: l0, position: new THREE.Vector3(w.x, 0, w.z), duration: 0.2 }));
    }
    if (l1) {
      l1.userData.layer = 2;
      const w = wallToWorld(side, lane, 2);
      anims.push(this.animator.tween({ object: l1, position: new THREE.Vector3(w.x, 0, w.z), duration: 0.2 }));
    }
    if (l2) {
      // Ejected layer-2 brick pops away with a burst.
      const ew = wallToWorld(side, lane, 2);
      this.particles.burst(ew, ejected ? ejected.color : brick.color);
      anims.push(
        this.animator.tween({
          object: l2,
          scale: new THREE.Vector3(0.001, 0.001, 0.001),
          duration: 0.2,
          easing: Easing.easeInBack,
          onComplete: () => this._removeMesh(l2),
        }),
      );
    }
    return Promise.all(anims);
  }
}
