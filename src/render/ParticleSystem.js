// ParticleSystem: 3D explosion bursts on matches + the 2.0s wave-clear
// celebration (staggered multi-stage fireworks with rocket ascent, radial
// bursts, spark trails, and end-over-end tumbling confetti ribbons).
// (spec §4.2)

import * as THREE from 'three';
import { COLOR_LIST } from '../core/Constants.js';

function colorStrToNum(s) {
  const n = parseInt(String(s).replace(/^#/, ''), 16);
  return Number.isFinite(n) ? n : 0xe60026;
}

export class ParticleSystem {
  constructor(scene) {
    this.scene = scene;
    this.root = new THREE.Group();
    scene.add(this.root);
    this._particles = [];
    this._disposed = false;
    this._boxGeo = new THREE.BoxGeometry(0.14, 0.14, 0.14);
    this._ribbonGeo = new THREE.PlaneGeometry(0.16, 0.64); // 1:4 aspect strip
  }

  _spawnBurst(pos, colorNum, count, speed, spread) {
    for (let i = 0; i < count; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: colorNum, transparent: true, opacity: 1,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const m = new THREE.Mesh(this._boxGeo, mat);
      m.position.copy(pos);
      this.root.add(m);
      this._particles.push({
        mesh: m,
        kind: 'burst',
        vel: new THREE.Vector3(
          (Math.random() - 0.5) * spread,
          Math.random() * speed + speed * 0.3,
          (Math.random() - 0.5) * spread,
        ),
        life: 0,
        maxLife: 0.5 + Math.random() * 0.5,
        gravity: -7,
        spin: (Math.random() - 0.5) * 8,
      });
    }
  }

  // Explosion burst at a world position ({x, z}) on a match elimination.
  burst(worldPos, colorStr) {
    if (this._disposed) return;
    const colorNum = colorStrToNum(colorStr);
    this._spawnBurst(new THREE.Vector3(worldPos.x, 0.35, worldPos.z), colorNum, 22, 4.5, 3.5);
  }

  _spawnRocket(delayMs, colorNum) {
    const mat = new THREE.MeshBasicMaterial({
      color: colorNum, transparent: true, opacity: 1,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const m = new THREE.Mesh(this._boxGeo, mat);
    m.position.set((Math.random() * 2 - 1) * 6, -0.2, (Math.random() * 2 - 1) * 6);
    m.visible = false;
    this.root.add(m);
    this._particles.push({
      mesh: m,
      kind: 'rocket',
      stage: 'waiting',
      delay: delayMs / 1000,
      vel: new THREE.Vector3(0, 13, 0),
      gravity: -20,
      life: 0,
      maxLife: 1.1,
      colorNum,
    });
  }

  _explode(pos, colorNum) {
    this._spawnBurst(pos.clone(), colorNum, 30, 6, 6);
    // glittering spark trails
    for (let i = 0; i < 12; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: colorNum, transparent: true, opacity: 0.9,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const m = new THREE.Mesh(this._boxGeo, mat);
      m.position.copy(pos);
      const ang = (i / 12) * Math.PI * 2;
      this.root.add(m);
      this._particles.push({
        mesh: m,
        kind: 'spark',
        vel: new THREE.Vector3(Math.cos(ang) * 1.6, Math.random() * 1.2, Math.sin(ang) * 1.6),
        life: 0,
        maxLife: 0.8 + Math.random() * 0.6,
        gravity: -3,
        spin: 0,
      });
    }
  }

  _spawnConfetti(count) {
    const colors = COLOR_LIST.map(colorStrToNum);
    for (let i = 0; i < count; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: colors[i % colors.length],
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 1,
        depthWrite: false,
      });
      const m = new THREE.Mesh(this._ribbonGeo, mat);
      m.position.set((Math.random() * 2 - 1) * 9, 4 + Math.random() * 6, (Math.random() * 2 - 1) * 9);
      m.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
      this.root.add(m);
      this._particles.push({
        mesh: m,
        kind: 'confetti',
        vel: new THREE.Vector3(
          (Math.random() - 0.5) * 1.2,
          -1.5 - Math.random() * 1.5,
          (Math.random() - 0.5) * 1.2,
        ),
        life: 0,
        maxLife: 3.5,
        gravity: -2.2,
        phase: Math.random() * Math.PI * 2,
        spinX: (Math.random() - 0.5) * 10,
        spinZ: (Math.random() - 0.5) * 10,
      });
    }
  }

  // 2.0s wave-clear celebration (resolves after ~2s of fireworks + confetti).
  celebrate() {
    if (this._disposed) return Promise.resolve();
    const colors = COLOR_LIST.map(colorStrToNum);
    const delays = [0, 320, 650, 980, 1300];
    delays.forEach((d, i) => this._spawnRocket(d, colors[i % colors.length]));
    this._spawnConfetti(120);
    return new Promise((resolve) => setTimeout(resolve, 2000));
  }

  update(dt) {
    if (this._disposed || this._particles.length === 0) return;

    const done = [];
    for (const p of this._particles) {
      if (p.kind === 'rocket') {
        if (p.stage === 'waiting') {
          p.delay -= dt;
          if (p.delay <= 0) {
            p.stage = 'ascending';
            p.mesh.visible = true;
          }
          continue;
        }
        // ascending
        p.vel.y += p.gravity * dt;
        p.mesh.position.addScaledVector(p.vel, dt);
        p.life += dt;
        if (p.vel.y <= 0 || p.life > p.maxLife) {
          this._explode(p.mesh.position, p.colorNum);
          done.push(p);
        }
        continue;
      }

      p.life += dt;
      if (p.life >= p.maxLife) {
        done.push(p);
        continue;
      }
      p.vel.y += p.gravity * dt;

      if (p.kind === 'confetti') {
        // aerodynamic tilt, angled drift + flutter, end-over-end tumble
        p.vel.x += Math.sin(p.life * 6 + p.phase) * 2.5 * dt;
        p.vel.z += Math.cos(p.life * 5 + p.phase) * 2.5 * dt;
        p.mesh.position.addScaledVector(p.vel, dt);
        p.mesh.rotation.x += p.spinX * dt;
        p.mesh.rotation.z += p.spinZ * dt;
        p.mesh.rotation.y = Math.atan2(p.vel.x, Math.abs(p.vel.y)) * 0.6;
      } else {
        p.mesh.position.addScaledVector(p.vel, dt);
        if (p.spin) p.mesh.rotation.y += p.spin * dt;
      }

      const ratio = 1 - p.life / p.maxLife;
      if (p.mesh.material) p.mesh.material.opacity = Math.max(0, ratio);

      if (p.kind === 'confetti' && p.mesh.position.y < -0.6) done.push(p);
    }

    for (const p of done) {
      const i = this._particles.indexOf(p);
      if (i >= 0) this._particles.splice(i, 1);
      this._removeMesh(p.mesh);
    }
  }

  _removeMesh(mesh) {
    if (mesh.parent) mesh.parent.remove(mesh);
    if (mesh.material && mesh.material.dispose) mesh.material.dispose();
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    for (const p of this._particles) this._removeMesh(p.mesh);
    this._particles = [];
    this._boxGeo.dispose();
    this._ribbonGeo.dispose();
    this.scene.remove(this.root);
  }
}
