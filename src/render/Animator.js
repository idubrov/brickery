// Animator: eased tween animations for 3D slides, pops, and wall queue
// shifts. (spec §4.1 / §4.2 / §6)
//
// Generic Promise-based tween engine driven by the render loop's dt.
// Every tween resolves its promise on completion so playTurnTimeline can
// await phase boundaries; cancelAll() resolves all outstanding promises so
// teardown never hangs an in-flight timeline.

import * as THREE from 'three';

export const Easing = {
  linear: (t) => t,
  easeInQuad: (t) => t * t,
  easeOutQuad: (t) => t * (2 - t),
  easeInOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  easeOutCubic: (t) => 1 - Math.pow(1 - t, 3),
  easeInBack: (t) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return c3 * t * t * t - c1 * t * t;
  },
  easeOutBack: (t) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
};

export class Animator {
  constructor() {
    this._tweens = new Set();
  }

  tween({ object, position, scale, duration = 0.3, delay = 0, easing = Easing.easeInOutCubic, onUpdate, onComplete }) {
    return new Promise((resolve) => {
      const start = {
        position: position ? object.position.clone() : null,
        scale: scale ? object.scale.clone() : null,
      };
      this._tweens.add({
        object,
        position,
        scale,
        start,
        duration,
        delay,
        elapsed: 0,
        easing,
        onUpdate,
        onComplete,
        resolve,
      });
    });
  }

  move(object, to, opts = {}) {
    const v = to && to.isVector3 ? to : new THREE.Vector3(to.x, to.y, to.z);
    return this.tween({ object, position: v, ...opts });
  }

  scaleTo(object, to, opts = {}) {
    const v = to && to.isVector3 ? to : new THREE.Vector3(to.x, to.y, to.z);
    return this.tween({ object, scale: v, ...opts });
  }

  update(dt) {
    if (this._tweens.size === 0) return;
    for (const t of Array.from(this._tweens)) {
      if (t.delay > 0) {
        t.delay -= dt;
        continue;
      }
      t.elapsed += dt;
      const raw = t.duration > 0 ? Math.min(t.elapsed / t.duration, 1) : 1;
      const k = t.easing(raw);
      if (t.position) t.object.position.lerpVectors(t.start.position, t.position, k);
      if (t.scale) t.object.scale.lerpVectors(t.start.scale, t.scale, k);
      if (t.onUpdate) t.onUpdate(k, t.object);
      if (raw >= 1) {
        if (t.position) t.object.position.copy(t.position);
        if (t.scale) t.object.scale.copy(t.scale);
        this._tweens.delete(t);
        if (t.onComplete) t.onComplete();
        t.resolve();
      }
    }
  }

  cancelAll() {
    for (const t of Array.from(this._tweens)) {
      this._tweens.delete(t);
      t.resolve();
    }
  }

  get active() {
    return this._tweens.size;
  }
}
