// BoardView: 3D field platform, recessed wall trays, chassis frame, grid
// lines, aim laser beam + ghost landing pad, and the 40 lane hitboxes.
// (spec §4.2 / §6)
//
// Coordinate mapping (shared with Renderer3D):
//   x = column 0..9, y = row 0..9, origin top-left, +y = down.
//   worldX = (x - 4.5) * CELL, worldZ = (y - 4.5) * CELL.
//   Wall layer 0 sits one cell beyond the adjacent field edge cell.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { GRID_SIZE, WALL_DEPTH } from '../core/Constants.js';

export const CELL = 1;
const HALF = (GRID_SIZE - 1) / 2; // 4.5
const WALL_OFFSET = 1.0; // wall layer 0 center is 1 cell beyond field edge cell
const GHOST_W = 0.9;
const GHOST_RADIUS = 0.16;
const BRICK_TOP = 0.55; // pinned brick top-surface height (spec §4.2)
const HITBOX_H = 0.58;
const HITBOX_Y = 0.29;

export function fieldToWorld(x, y) {
  return { x: (x - HALF) * CELL, z: (y - HALF) * CELL };
}

export function wallToWorld(side, lane, layer) {
  const c = (lane - HALF) * CELL;
  const outer = HALF * CELL + WALL_OFFSET + layer * CELL;
  switch (side) {
    case 'TOP': return { x: c, z: -outer };
    case 'BOTTOM': return { x: c, z: outer };
    case 'LEFT': return { x: -outer, z: c };
    case 'RIGHT': return { x: outer, z: c };
    default: return { x: 0, z: 0 };
  }
}

export class BoardView {
  constructor(scene) {
    this.scene = scene;
    this.root = new THREE.Group();
    scene.add(this.root);
    this.laneHitboxes = [];
    this._aim = null;
    this._buildBoard();
    this._buildHitboxes();
  }

  _buildBoard() {
    const L = HALF + 0.5; // field half-extent (5.0)
    const wallOuter = L + WALL_OFFSET + WALL_DEPTH; // 8.0

    // Deep chassis frame (darkest base).
    const chassis = new THREE.Mesh(
      new THREE.BoxGeometry(18.2, 0.5, 18.2),
      new THREE.MeshStandardMaterial({ color: 0x090f1a, roughness: 0.9, metalness: 0.1 }),
    );
    chassis.position.y = -0.55;
    chassis.receiveShadow = true;
    this.root.add(chassis);

    // Central navy-slate field floor (top at y = 0).
    const floor = new THREE.Mesh(
      new THREE.BoxGeometry(10, 0.24, 10),
      new THREE.MeshStandardMaterial({ color: 0x16243b, roughness: 0.92, metalness: 0.05 }),
    );
    floor.position.y = -0.12;
    floor.receiveShadow = true;
    this.root.add(floor);

    // Recessed wall trays (slightly below field floor).
    const trayMat = new THREE.MeshStandardMaterial({ color: 0x0e1726, roughness: 0.95, metalness: 0.05 });
    const trays = [
      { size: [10, 0.14, 3], pos: [0, -0.19, -(wallOuter - 1.5)] },
      { size: [10, 0.14, 3], pos: [0, -0.19, wallOuter - 1.5] },
      { size: [3, 0.14, 10], pos: [-(wallOuter - 1.5), -0.19, 0] },
      { size: [3, 0.14, 10], pos: [wallOuter - 1.5, -0.19, 0] },
    ];
    for (const t of trays) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(...t.size), trayMat);
      m.position.set(t.pos[0], t.pos[1], t.pos[2]);
      m.receiveShadow = true;
      this.root.add(m);
    }

    this._buildGridLines(L);
  }

  _buildGridLines(L) {
    const major = [];
    const minor = [];
    for (let i = 0; i <= GRID_SIZE; i++) {
      const c = -L + i * CELL;
      const arr = i === 0 || i === GRID_SIZE ? major : minor;
      arr.push(c, 0.006, -L, c, 0.006, L);
      arr.push(-L, 0.006, c, L, 0.006, c);
    }
    this._addLines(major, 0x475569);
    this._addLines(minor, 0x27364f);
  }

  _addLines(positions, color) {
    if (positions.length === 0) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.85 });
    const lines = new THREE.LineSegments(geo, mat);
    lines.raycast = () => {};
    this.root.add(lines);
  }

  // 40 wall lanes × one 3D hitbox covering the full 3-layer channel.
  // Invisible (zero GPU) but still raycastable because THREE.Raycaster does
  // not filter on `visible`. Height 0.58 @ posY 0.29 matches brick top 0.55.
  _buildHitboxes() {
    const mat = new THREE.MeshBasicMaterial();
    const tbGeo = new THREE.BoxGeometry(1, HITBOX_H, 3);
    const lrGeo = new THREE.BoxGeometry(3, HITBOX_H, 1);
    for (const side of ['TOP', 'BOTTOM', 'LEFT', 'RIGHT']) {
      const vertical = side === 'TOP' || side === 'BOTTOM';
      const geo = vertical ? tbGeo : lrGeo;
      for (let lane = 0; lane < GRID_SIZE; lane++) {
        const mesh = new THREE.Mesh(geo, mat);
        mesh.visible = false;
        const pos = wallToWorld(side, lane, 1); // center of 3-layer channel
        mesh.position.set(pos.x, HITBOX_Y, pos.z);
        mesh.userData = { type: 'laneHitbox', side, lane };
        this.root.add(mesh);
        this.laneHitboxes.push(mesh);
      }
    }
  }

  getLaneHitboxes() {
    return this.laneHitboxes;
  }

  // Aim laser beam (bold 0.20-cell wide + inner high-intensity core) from
  // the wall mouth to the obstacle (or across to the opposite wall on empty
  // lanes) + a translucent glowing ghost landing pad when landing != null.
  showAim({ side, lane, colorNum, path, landing }) {
    this.hideAim();
    if (!path || path.length === 0) return;

    const start = fieldToWorld(path[0].x, path[0].y);
    const end = fieldToWorld(path[path.length - 1].x, path[path.length - 1].y);
    const vertical = side === 'TOP' || side === 'BOTTOM';
    if (!landing) {
      // Empty lane: extend the beam to the opposite wall boundary.
      const ext = 0.5;
      if (vertical) end.z += side === 'TOP' ? -ext : ext;
      else end.x += side === 'LEFT' ? -ext : ext;
    }

    const beamLen = vertical ? Math.abs(end.z - start.z) : Math.abs(end.x - start.x);
    const midX = vertical ? start.x : (start.x + end.x) / 2;
    const midZ = vertical ? (start.z + end.z) / 2 : start.z;

    const group = new THREE.Group();
    const disposables = [];

    const beamGeo = new THREE.BoxGeometry(vertical ? 0.2 : beamLen, 0.03, vertical ? beamLen : 0.2);
    const coreGeo = new THREE.BoxGeometry(vertical ? 0.06 : beamLen, 0.03, vertical ? beamLen : 0.06);
    const beamMat = new THREE.MeshBasicMaterial({
      color: colorNum, transparent: true, opacity: 0.42,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const coreMat = new THREE.MeshBasicMaterial({
      color: colorNum, transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });

    const beam = new THREE.Mesh(beamGeo, beamMat);
    beam.position.set(midX, 0.03, midZ);
    const core = new THREE.Mesh(coreGeo, coreMat);
    core.position.set(midX, 0.03, midZ);

    group.add(beam);
    group.add(core);
    disposables.push(beamGeo, coreGeo, beamMat, coreMat);

    if (landing) {
      const gp = fieldToWorld(landing.x, landing.y);
      const ghostGeo = new RoundedBoxGeometry(GHOST_W, 0.16, GHOST_W, 5, GHOST_RADIUS);
      const ghostMat = new THREE.MeshBasicMaterial({
        color: colorNum, transparent: true, opacity: 0.4,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const ghost = new THREE.Mesh(ghostGeo, ghostMat);
      ghost.position.set(gp.x, 0.02, gp.z);
      group.add(ghost);
      disposables.push(ghostGeo, ghostMat);
    }

    this.root.add(group);
    this._aim = { group, disposables };
  }

  hideAim() {
    if (this._aim) {
      this.root.remove(this._aim.group);
      for (const d of this._aim.disposables) {
        if (d && d.dispose) d.dispose();
      }
      this._aim = null;
    }
  }

  dispose() {
    this.hideAim();
    this.root.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) if (m && m.dispose) m.dispose();
      }
    });
    this.scene.remove(this.root);
    this.laneHitboxes = [];
  }
}
