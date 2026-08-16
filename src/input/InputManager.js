// InputManager: 3D raycaster mouse/touch interaction. Reports (side, lane)
// on hover and fires callbacks.onLaunch ONLY for launchable lanes (disabled
// on empty lanes / blocked mouths). (spec §4.2 / §6)

import * as THREE from 'three';

export class InputManager {
  constructor({ domElement, camera, getRaycastTargets, isLaunchable, onHover, onLaunch }) {
    this.domElement = domElement;
    this.camera = camera;
    this.getRaycastTargets = getRaycastTargets;
    this.isLaunchable = isLaunchable;
    this.onHover = onHover || (() => {});
    this.onLaunch = onLaunch || (() => {});
    this.enabled = true;

    this.raycaster = new THREE.Raycaster();
    this._pointer = new THREE.Vector2();
    this._lastHover = null;
    this._downHit = null;

    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);
    this._onPointerLeave = this._onPointerLeave.bind(this);

    this._attach();
  }

  _attach() {
    const el = this.domElement;
    el.addEventListener('pointermove', this._onPointerMove);
    el.addEventListener('pointerdown', this._onPointerDown);
    el.addEventListener('pointerup', this._onPointerUp);
    el.addEventListener('pointercancel', this._onPointerLeave);
    el.addEventListener('pointerleave', this._onPointerLeave);
    if (el.style) el.style.touchAction = 'none';
  }

  _setPointer(e) {
    const rect = this.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    this._pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this._pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  }

  _pick() {
    this.raycaster.setFromCamera(this._pointer, this.camera);
    const targets = this.getRaycastTargets();
    if (!targets || targets.length === 0) return null;
    const hits = this.raycaster.intersectObjects(targets, false);
    for (const h of hits) {
      const ud = h.object.userData;
      if (ud && (ud.type === 'laneHitbox' || ud.type === 'wall')) {
        return { side: ud.side, lane: ud.lane };
      }
    }
    return null;
  }

  _onPointerMove(e) {
    if (!this.enabled) return;
    this._setPointer(e);
    const hit = this._pick();
    const key = hit ? `${hit.side}:${hit.lane}` : null;
    if (key !== this._lastHover) {
      this._lastHover = key;
      if (hit) {
        this.onHover({ side: hit.side, lane: hit.lane, launchable: this.isLaunchable(hit.side, hit.lane) });
      } else {
        this.onHover(null);
      }
    }
  }

  _onPointerDown(e) {
    if (!this.enabled) return;
    this._setPointer(e);
    this._downHit = this._pick();
  }

  _onPointerUp(e) {
    if (!this.enabled) return;
    this._setPointer(e);
    const hit = this._pick();
    if (
      hit &&
      this._downHit &&
      hit.side === this._downHit.side &&
      hit.lane === this._downHit.lane
    ) {
      if (this.isLaunchable(hit.side, hit.lane)) {
        this.onLaunch(hit.side, hit.lane);
      }
    }
    this._downHit = null;
  }

  _onPointerLeave() {
    this._downHit = null;
    if (this._lastHover != null) {
      this._lastHover = null;
      this.onHover(null);
    }
  }

  setEnabled(enabled) {
    this.enabled = !!enabled;
    if (!this.enabled) {
      this._downHit = null;
      this._lastHover = null;
      this.onHover(null);
    }
  }

  dispose() {
    const el = this.domElement;
    el.removeEventListener('pointermove', this._onPointerMove);
    el.removeEventListener('pointerdown', this._onPointerDown);
    el.removeEventListener('pointerup', this._onPointerUp);
    el.removeEventListener('pointercancel', this._onPointerLeave);
    el.removeEventListener('pointerleave', this._onPointerLeave);
  }
}
