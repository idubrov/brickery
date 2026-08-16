// BrickMesh: high-contrast glossy "candy/jewel tile" brick mesh with a
// carved directional-glyph top-face texture. (spec §4.2)
//
// Pinned values:
//   - RoundedBoxGeometry corner radius 0.16, 5 bevel segments
//   - MeshPhysicalMaterial clearcoat 0.65, clearcoatRoughness 0.18,
//     roughness 0.28, reflectivity 0.50, zero resting emissive
//   - top-face 256×256 sRGB canvas texture: solid color + rounded beveled
//     perimeter highlight; moving bricks show deep carved indent arrows,
//     static bricks are solid with zero center dots.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { DIR } from '../core/Constants.js';

export const BRICK_W = 0.9;
export const BRICK_H = 0.55;
export const BRICK_D = 0.9;
export const BRICK_RADIUS = 0.16;
export const BRICK_SEGMENTS = 5;
export const RESTING_CLEARCOAT = 0.65;

// BoxGeometry/RoundedBoxGeometry material order: 0 +x, 1 -x, 2 +y (top),
// 3 -y, 4 +z, 5 -z.
const TOP_INDEX = 2;

export function colorStrToNum(s) {
  const n = parseInt(String(s).replace(/^#/, ''), 16);
  return Number.isFinite(n) ? n : 0xe60026;
}

function numToRgb(num) {
  return { r: (num >> 16) & 0xff, g: (num >> 8) & 0xff, b: num & 0xff };
}

// Darken (amt < 0) or lighten (amt > 0) a color, returning a css string.
function shade(num, amt) {
  let { r, g, b } = numToRgb(num);
  if (amt < 0) {
    r *= 1 + amt; g *= 1 + amt; b *= 1 + amt;
  } else {
    r += (255 - r) * amt; g += (255 - g) * amt; b += (255 - b) * amt;
  }
  const cl = (v) => Math.max(0, Math.min(255, Math.round(v)));
  return `rgb(${cl(r)},${cl(g)},${cl(b)})`;
}

function roundRectPath(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function arrowPath(ctx, direction, cx, cy, r) {
  ctx.beginPath();
  if (direction === 'NORTH') {
    ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r, cy + r * 0.9); ctx.lineTo(cx - r, cy + r * 0.9);
  } else if (direction === 'SOUTH') {
    ctx.moveTo(cx, cy + r); ctx.lineTo(cx - r, cy - r * 0.9); ctx.lineTo(cx + r, cy - r * 0.9);
  } else if (direction === 'EAST') {
    ctx.moveTo(cx + r, cy); ctx.lineTo(cx - r * 0.9, cy - r); ctx.lineTo(cx - r * 0.9, cy + r);
  } else if (direction === 'WEST') {
    ctx.moveTo(cx - r, cy); ctx.lineTo(cx + r * 0.9, cy - r); ctx.lineTo(cx + r * 0.9, cy + r);
  }
  ctx.closePath();
}

// Deep carved/sunken indent arrow: dark cast-shadow cavity + inner shadow
// bevel + lower specular lip catching the light.
function drawCarvedArrow(ctx, num, direction, size) {
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.27;

  // cast shadow cavity (offset down)
  ctx.save();
  ctx.translate(2.5, 4);
  arrowPath(ctx, direction, cx, cy, r);
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fill();
  ctx.restore();

  // main carved cavity: gradient darkening toward the tip
  let grad;
  if (direction === 'NORTH') grad = ctx.createLinearGradient(0, cy - r, 0, cy + r * 0.9);
  else if (direction === 'SOUTH') grad = ctx.createLinearGradient(0, cy + r, 0, cy - r * 0.9);
  else if (direction === 'EAST') grad = ctx.createLinearGradient(cx + r, 0, cx - r * 0.9, 0);
  else grad = ctx.createLinearGradient(cx - r, 0, cx + r * 0.9, 0);
  grad.addColorStop(0, shade(num, -0.55));
  grad.addColorStop(0.6, shade(num, -0.3));
  grad.addColorStop(1, shade(num, -0.05));
  arrowPath(ctx, direction, cx, cy, r);
  ctx.fillStyle = grad;
  ctx.fill();

  // inner shadow bevel
  ctx.save();
  arrowPath(ctx, direction, cx, cy, r);
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 7;
  ctx.stroke();
  ctx.restore();

  // lower specular lip (bright line along the base opposite the tip)
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  if (direction === 'NORTH') {
    ctx.moveTo(cx - r * 0.85, cy + r * 0.78); ctx.lineTo(cx + r * 0.85, cy + r * 0.78);
  } else if (direction === 'SOUTH') {
    ctx.moveTo(cx - r * 0.85, cy - r * 0.78); ctx.lineTo(cx + r * 0.85, cy - r * 0.78);
  } else if (direction === 'EAST') {
    ctx.moveTo(cx - r * 0.78, cy - r * 0.85); ctx.lineTo(cx - r * 0.78, cy + r * 0.85);
  } else {
    ctx.moveTo(cx + r * 0.78, cy - r * 0.85); ctx.lineTo(cx + r * 0.78, cy + r * 0.85);
  }
  ctx.stroke();
  ctx.restore();
}

function makeTopTexture(num, direction) {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const { r, g, b } = numToRgb(num);
  const solid = `rgb(${r},${g},${b})`;

  // uniform solid face
  ctx.fillStyle = solid;
  ctx.fillRect(0, 0, size, size);

  // rounded beveled perimeter highlight
  const pad = 16;
  const radius = 44;
  ctx.save();
  roundRectPath(ctx, pad, pad, size - pad * 2, size - pad * 2, radius);
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 5;
  ctx.stroke();
  ctx.restore();
  ctx.save();
  roundRectPath(ctx, pad + 5, pad + 5, size - (pad + 5) * 2, size - (pad + 5) * 2, radius - 6);
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.lineWidth = 6;
  ctx.stroke();
  ctx.restore();
  ctx.save();
  roundRectPath(ctx, pad + 4, pad + 4, size - (pad + 4) * 2, size - (pad + 4) * 2, radius - 5);
  ctx.strokeStyle = 'rgba(0,0,0,0.28)';
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.restore();

  if (direction && direction !== DIR.NONE) {
    drawCarvedArrow(ctx, num, direction, size);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

function uniqueMaterials(materials) {
  return Array.from(new Set(materials));
}

function disposeMaterials(materials) {
  if (Array.isArray(materials)) {
    for (const m of materials) if (m && m.dispose) m.dispose();
  }
}

export class BrickMesh {
  static _geom = null;
  static _textures = new Map(); // `${num}|${dir}` → CanvasTexture
  static _topTemplates = new Map(); // `${num}|${dir}` → MeshPhysicalMaterial
  static _sideTemplates = new Map(); // `${num}` → MeshPhysicalMaterial

  static _getGeometry() {
    if (!BrickMesh._geom) {
      BrickMesh._geom = new RoundedBoxGeometry(BRICK_W, BRICK_H, BRICK_D, BRICK_SEGMENTS, BRICK_RADIUS);
    }
    return BrickMesh._geom;
  }

  static _getTexture(num, direction) {
    const key = `${num}|${direction}`;
    if (!BrickMesh._textures.has(key)) {
      BrickMesh._textures.set(key, makeTopTexture(num, direction));
    }
    return BrickMesh._textures.get(key);
  }

  static _getTopTemplate(num, direction) {
    const key = `${num}|${direction}`;
    if (!BrickMesh._topTemplates.has(key)) {
      BrickMesh._topTemplates.set(key, new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        map: BrickMesh._getTexture(num, direction),
        roughness: 0.28,
        metalness: 0.0,
        clearcoat: RESTING_CLEARCOAT,
        clearcoatRoughness: 0.18,
        reflectivity: 0.5,
        emissive: 0x000000,
        emissiveIntensity: 1.0,
      }));
    }
    return BrickMesh._topTemplates.get(key);
  }

  static _getSideTemplate(num) {
    if (!BrickMesh._sideTemplates.has(num)) {
      BrickMesh._sideTemplates.set(num, new THREE.MeshPhysicalMaterial({
        color: num,
        roughness: 0.28,
        metalness: 0.0,
        clearcoat: RESTING_CLEARCOAT,
        clearcoatRoughness: 0.18,
        reflectivity: 0.5,
        emissive: 0x000000,
        emissiveIntensity: 1.0,
      }));
    }
    return BrickMesh._sideTemplates.get(num);
  }

  // Per-brick cloned material set (5 side faces share one clone; the top
  // face gets its own textured clone) so hover never cross-talks.
  static createMaterials(colorNum, direction) {
    const side = BrickMesh._getSideTemplate(colorNum).clone();
    const top = BrickMesh._getTopTemplate(colorNum, direction).clone();
    return [side, side, top, side, side, side];
  }

  static create(brick) {
    const colorNum = colorStrToNum(brick.color);
    const direction = brick.direction || DIR.NONE;
    const materials = BrickMesh.createMaterials(colorNum, direction);
    const mesh = new THREE.Mesh(BrickMesh._getGeometry(), materials);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData = {
      id: brick.id,
      color: brick.color,
      colorNum,
      direction,
      materials: uniqueMaterials(materials),
    };
    return mesh;
  }

  static setAppearance(mesh, { color, direction, id }) {
    const colorNum = colorStrToNum(color);
    const dir = direction || DIR.NONE;
    const ud = mesh.userData;
    if (id != null) ud.id = id;
    const changed = ud.color !== color || ud.direction !== dir;
    ud.color = color;
    ud.colorNum = colorNum;
    ud.direction = dir;
    if (changed) {
      disposeMaterials(ud.materials);
      const materials = BrickMesh.createMaterials(colorNum, dir);
      ud.materials = uniqueMaterials(materials);
      mesh.material = materials;
    }
  }

  static setHover(mesh, on) {
    const ud = mesh.userData;
    if (!ud || !ud.materials) return;
    for (const m of ud.materials) {
      m.clearcoat = on ? 1.0 : RESTING_CLEARCOAT;
      if (on) {
        m.emissive.setHex(ud.colorNum);
        m.emissiveIntensity = 0.55;
      } else {
        m.emissive.setHex(0x000000);
        m.emissiveIntensity = 1.0;
      }
    }
  }

  static disposeMesh(mesh) {
    disposeMaterials(mesh.userData && mesh.userData.materials);
    if (mesh.parent) mesh.parent.remove(mesh);
  }

  static disposeAll() {
    if (BrickMesh._geom) {
      BrickMesh._geom.dispose();
      BrickMesh._geom = null;
    }
    for (const t of BrickMesh._textures.values()) t.dispose();
    BrickMesh._textures.clear();
    for (const m of BrickMesh._topTemplates.values()) m.dispose();
    BrickMesh._topTemplates.clear();
    for (const m of BrickMesh._sideTemplates.values()) m.dispose();
    BrickMesh._sideTemplates.clear();
  }
}
