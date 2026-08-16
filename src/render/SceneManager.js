// SceneManager: Three.js scene, camera, lighting, shadows, and the
// start/stop render loop. (spec §4.2 / §6)
//
// Pinned values (spec §4.2):
//   - near-orthographic top-down isometric perspective, FOV 33°
//   - camera position (0, 27.5, 15.0), target (0, -0.2, 0.8)
//   - ACESFilmicToneMapping, exposure 0.98
//   - key warm directional 1.4 + PCFSoftShadowMap 2048×2048
//   - hemisphere 0.50 (sky 0xe0f2fe / ground 0x0f172a)
//   - cyan rim 0x7dd3fc @ 0.45, ambient point 0xffffff @ 0.2

import * as THREE from 'three';

export const BASE_POSITION = new THREE.Vector3(0, 27.5, 15.0);
export const BASE_TARGET = new THREE.Vector3(0, -0.2, 0.8);
export const BASE_DISTANCE = BASE_POSITION.distanceTo(BASE_TARGET);
export const CAMERA_FOV = 33;

// World-space bounding box of the whole board (field + 4 wall layers +
// chassis). Used for responsive framing that keeps everything in view.
const BOARD_EXTENT = 8.9;
const BOARD_TOP = 0.6;
const BOARD_BOTTOM = -0.35;
const FIT_MARGIN = 1.03;

const BOARD_CORNERS = [];
for (const x of [-BOARD_EXTENT, BOARD_EXTENT]) {
  for (const z of [-BOARD_EXTENT, BOARD_EXTENT]) {
    for (const y of [BOARD_BOTTOM, BOARD_TOP]) {
      BOARD_CORNERS.push([x, y, z]);
    }
  }
}

export class SceneManager {
  constructor() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.1, 300);
    this.camera.position.copy(BASE_POSITION);
    this.camera.lookAt(BASE_TARGET);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    const dpr = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1;
    this.renderer.setPixelRatio(dpr);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.98;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this._target = BASE_TARGET.clone();
    this._basePos = BASE_POSITION.clone();
    this._running = false;
    this._raf = null;
    this._last = 0;
    this._onFrame = null;
    this._shake = 0;
    this.aspect = 1;

    this._buildLights();
  }

  _buildLights() {
    // Key warm directional sun light with PCF soft shadows.
    this.keyLight = new THREE.DirectionalLight(0xfff1dd, 1.4);
    this.keyLight.position.set(10, 24, 12);
    this.keyLight.castShadow = true;
    this.keyLight.shadow.mapSize.set(2048, 2048);
    const sc = this.keyLight.shadow.camera;
    sc.left = -16;
    sc.right = 16;
    sc.top = 16;
    sc.bottom = -16;
    sc.near = 1;
    sc.far = 90;
    this.keyLight.shadow.bias = -0.0004;
    this.keyLight.shadow.normalBias = 0.02;
    this.scene.add(this.keyLight);
    this.scene.add(this.keyLight.target);

    // Balanced hemispherical fill.
    this.hemiLight = new THREE.HemisphereLight(0xe0f2fe, 0x0f172a, 0.5);
    this.scene.add(this.hemiLight);

    // Soft cyan rim light catching top bevels.
    this.rimLight = new THREE.DirectionalLight(0x7dd3fc, 0.45);
    this.rimLight.position.set(-9, 14, -11);
    this.scene.add(this.rimLight);
    this.scene.add(this.rimLight.target);

    // Ambient point glow for center-board clarity.
    this.pointLight = new THREE.PointLight(0xffffff, 0.2, 50, 1);
    this.pointLight.position.set(0, 9, 0);
    this.scene.add(this.pointLight);
  }

  // Responsive framing: keep the camera at the pinned isometric direction,
  // pulling back only as much as needed so the full board stays in view on
  // every aspect ratio. On typical desktop it sits exactly at the pinned
  // position (scale === 1).
  fit() {
    this.camera.aspect = this.aspect;
    this.camera.updateProjectionMatrix();
    this.camera.position.copy(BASE_POSITION);
    this.camera.lookAt(this._target);
    this.camera.updateMatrixWorld(true);

    let maxNdc = 0;
    const v = new THREE.Vector3();
    for (const c of BOARD_CORNERS) {
      v.set(c[0], c[1], c[2]).project(this.camera);
      maxNdc = Math.max(maxNdc, Math.abs(v.x), Math.abs(v.y));
    }
    const scale = Math.max(1, maxNdc * FIT_MARGIN);

    const dir = this._target.clone().sub(BASE_POSITION).normalize();
    this._basePos.copy(this._target).addScaledVector(dir, -BASE_DISTANCE * scale);
    this.camera.position.copy(this._basePos);
    this.camera.lookAt(this._target);
    this.camera.updateMatrixWorld(true);
  }

  setSize(width, height) {
    const w = Math.max(1, width);
    const h = Math.max(1, height);
    this.aspect = w / h;
    this.renderer.setSize(w, h, false);
    this.fit();
  }

  start(onFrame) {
    this._onFrame = onFrame || null;
    if (this._running) return;
    this._running = true;
    this._last = performance.now();
    const loop = (now) => {
      if (!this._running) return;
      const dt = Math.min((now - this._last) / 1000, 0.05);
      this._last = now;
      if (this._onFrame) this._onFrame(dt, now);
      this._render();
      this._raf = requestAnimationFrame(loop);
    };
    this._raf = requestAnimationFrame(loop);
  }

  stop() {
    this._running = false;
    if (this._raf != null) {
      cancelAnimationFrame(this._raf);
      this._raf = null;
    }
  }

  _render() {
    if (this._shake > 0.001) {
      const s = this._shake;
      this.camera.position.set(
        this._basePos.x + (Math.random() - 0.5) * s,
        this._basePos.y + (Math.random() - 0.5) * s,
        this._basePos.z + (Math.random() - 0.5) * s,
      );
      this.camera.lookAt(this._target);
      this._shake *= 0.9;
    } else if (this._shake !== 0) {
      this._shake = 0;
      this.camera.position.copy(this._basePos);
      this.camera.lookAt(this._target);
    }
    this.renderer.render(this.scene, this.camera);
  }

  shake(amount) {
    this._shake = Math.max(this._shake, amount);
  }

  get domElement() {
    return this.renderer.domElement;
  }

  dispose() {
    this.stop();
    this.renderer.dispose();
    this.scene.clear();
  }
}
