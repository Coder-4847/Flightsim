import * as THREE from 'three';

// Crash sequence: the aircraft breaks into chunks that fly, tumble and bounce, with a fireball and smoke.
// In the air the blast is small and the pieces fall burning; on the ground it is a big explosion.
// A cinematic camera orbits the wreck (see CameraSystem 'crash' mode) before the crash menu appears.

const G = 9.81;
const _box = new THREE.Box3();
const _c = new THREE.Vector3();
const _v = new THREE.Vector3();
const _inv = new THREE.Matrix4();

let fireTex = null;
let smokeTex = null;
function blobTexture(stops) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  for (const [at, col] of stops) grad.addColorStop(at, col);
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class CrashFx {
  constructor(scene, groundHeight) {
    this.scene = scene;
    this.groundHeight = groundHeight;
    this.root = new THREE.Group();
    this.root.visible = false;
    scene.add(this.root);
    this.chunks = [];
    this.puffs = [];
    this.active = false;
    this.time = 0;
    this.center = new THREE.Vector3();
    this.size = 20;
    this.big = false;
    this.fire = 0; // seconds of fire left at the wreck
  }

  /** `view` the AircraftView (hidden here), `model` the frozen FlightModel. Returns the wreck centre. */
  start(view, model) {
    this.clear();
    fireTex ??= blobTexture([[0, 'rgba(255,250,210,1)'], [0.25, 'rgba(255,170,60,0.95)'], [0.6, 'rgba(210,70,20,0.5)'], [1, 'rgba(120,20,0,0)']]);
    smokeTex ??= blobTexture([[0, 'rgba(40,40,40,0.85)'], [0.6, 'rgba(30,30,30,0.45)'], [1, 'rgba(20,20,20,0)']]);
    this.active = true;
    this.time = 0;
    this.root.visible = true;
    const agl = model.pos.y - this.groundHeight(model.pos.x, model.pos.z);
    this.big = agl < 12 || model.gear.weightOnWheels;
    this.center.copy(model.pos);
    if (this.big) this.center.y = Math.max(this.center.y, this.groundHeight(model.pos.x, model.pos.z) + 1);
    this.fire = this.big ? 14 : 5;

    // Split the visible LOD level into chunks by position along and across the aircraft.
    view.root.updateMatrixWorld(true);
    const level = view.lod.levels[0].object;
    _inv.copy(view.root.matrixWorld).invert();
    const kids = [...level.children];
    _box.makeEmpty();
    const boxes = kids.map((k) => { const b = new THREE.Box3().setFromObject(k).applyMatrix4(_inv); _box.union(b); return b; });
    const size = _box.getSize(new THREE.Vector3());
    this.size = Math.max(size.x, size.z, 8);
    const buckets = new Map();
    kids.forEach((k, i) => {
      boxes[i].getCenter(_c);
      const ix = Math.min(3, Math.max(0, Math.floor(((_c.x - _box.min.x) / Math.max(size.x, 1)) * 4)));
      const side = Math.abs(_c.z) > size.z * 0.18 ? (_c.z > 0 ? 1 : -1) : 0; // wings and engines peel off sideways
      const key = `${ix}:${side}`;
      if (!buckets.has(key)) buckets.set(key, { ix, side, items: [] });
      buckets.get(key).items.push(k);
    });
    const vel = model.vel;
    for (const b of buckets.values()) {
      const g = new THREE.Group();
      g.position.setFromMatrixPosition(view.root.matrixWorld);
      g.quaternion.setFromRotationMatrix(view.root.matrixWorld);
      g.matrixAutoUpdate = true;
      for (const k of b.items) g.add(k.clone(true));
      // Chunk centre in world space, for the outward blast direction.
      const bb = new THREE.Box3();
      b.items.forEach((k) => bb.union(new THREE.Box3().setFromObject(k)));
      bb.getCenter(_c);
      const dir = _v.copy(_c).sub(this.center);
      if (dir.lengthSq() < 0.01) dir.set(Math.random() - 0.5, 0.5, Math.random() - 0.5);
      dir.normalize();
      const speed = (this.big ? 10 : 7) + Math.random() * (this.big ? 22 : 12);
      this.root.add(g);
      this.chunks.push({
        g,
        v: new THREE.Vector3(vel.x * (this.big ? 0.35 : 0.9), vel.y * (this.big ? 0.2 : 0.9), vel.z * (this.big ? 0.35 : 0.9)).addScaledVector(dir, speed).add(new THREE.Vector3(0, 4 + Math.random() * (this.big ? 12 : 5), 0)),
        w: new THREE.Vector3((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6),
        rest: false,
        burn: 0.6 + Math.random() * 0.5,
        size: Math.max(b.items.length, 1),
      });
    }
    view.root.visible = false;
    // The blast.
    const n = this.big ? 46 : 16;
    for (let i = 0; i < n; i++) {
      const r = (this.big ? 16 : 6) * Math.random();
      this.#puff(true, this.center.x + (Math.random() - 0.5) * r, this.center.y + Math.random() * r * 0.6, this.center.z + (Math.random() - 0.5) * r,
        (this.big ? 26 : 11) * (0.35 + Math.random()), this.big ? 1.6 + Math.random() * 1.6 : 0.9 + Math.random() * 0.8, (Math.random() - 0.5) * 8, 2 + Math.random() * (this.big ? 12 : 5), (Math.random() - 0.5) * 8);
    }
    // A bright flash sprite stands in for a light (adding a real light would recompile every material).
    this.#puff(true, this.center.x, this.center.y + 2, this.center.z, this.big ? 200 : 70, this.big ? 0.8 : 0.45, 0, 0, 0);
    return this.center;
  }

  #puff(fire, x, y, z, size, life, vx, vy, vz) {
    const mat = new THREE.SpriteMaterial({ map: fire ? fireTex : smokeTex, transparent: true, depthWrite: false, blending: fire ? THREE.AdditiveBlending : THREE.NormalBlending, fog: false });
    const s = new THREE.Sprite(mat);
    s.position.set(x, y, z);
    s.scale.setScalar(size);
    this.root.add(s);
    this.puffs.push({ s, fire, life, age: 0, size, v: new THREE.Vector3(vx, vy, vz) });
  }

  update(dt) {
    if (!this.active) return;
    dt = Math.min(dt, 0.05);
    this.time += dt;
    for (const c of this.chunks) {
      if (c.rest) { c.burn -= dt * 0.1; continue; }
      c.v.y -= G * dt;
      c.v.multiplyScalar(1 - 0.05 * dt);
      c.g.position.addScaledVector(c.v, dt);
      c.g.rotation.x += c.w.x * dt;
      c.g.rotation.y += c.w.y * dt;
      c.g.rotation.z += c.w.z * dt;
      const ground = this.groundHeight(c.g.position.x, c.g.position.z);
      if (c.g.position.y < ground + 0.3) {
        c.g.position.y = ground + 0.3;
        if (c.v.y < -3) { c.v.y *= -0.28; c.v.x *= 0.7; c.v.z *= 0.7; c.w.multiplyScalar(0.6); this.#puff(false, c.g.position.x, ground + 1, c.g.position.z, 4 + c.size * 0.2, 3, 0, 2, 0); }
        else { c.v.set(0, 0, 0); c.w.set(0, 0, 0); c.rest = true; }
      }
      // Burning pieces trail fire and smoke while they fall.
      if (c.burn > 0 && Math.random() < dt * 24) {
        const p = c.g.position;
        this.#puff(true, p.x, p.y, p.z, 5 + c.size * 0.2, 0.6, 0, 1, 0);
        this.#puff(false, p.x, p.y, p.z, 3 + c.size * 0.15, 2.8, (Math.random() - 0.5) * 2, 2 + Math.random() * 3, (Math.random() - 0.5) * 2);
      }
    }
    // Wreck fire and a smoke column.
    if (this.fire > 0) {
      this.fire -= dt;
      if (Math.random() < dt * (this.big ? 40 : 14)) {
        const r = this.size * (this.big ? 0.4 : 0.15);
        this.#puff(true, this.center.x + (Math.random() - 0.5) * r, this.center.y + Math.random() * 2, this.center.z + (Math.random() - 0.5) * r, 5 + Math.random() * 6, 1.1, 0, 5 + Math.random() * 7, 0);
        this.#puff(false, this.center.x + (Math.random() - 0.5) * r, this.center.y + 4, this.center.z + (Math.random() - 0.5) * r, 8 + Math.random() * 10, 7, 1.5, 5 + Math.random() * 4, 0.5);
      }
    }
    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const p = this.puffs[i];
      p.age += dt;
      const k = p.age / p.life;
      if (k >= 1) { this.root.remove(p.s); p.s.material.dispose(); this.puffs.splice(i, 1); continue; }
      p.s.position.addScaledVector(p.v, dt);
      p.s.scale.setScalar(p.size * (p.fire ? 1 + k * 0.8 : 1 + k * 2.2));
      p.s.material.opacity = p.fire ? 1 - k * k : (1 - k) * 0.8;
      if (!p.fire) p.v.y += dt * 1.2;
    }
  }

  clear() {
    for (const c of this.chunks) this.root.remove(c.g);
    for (const p of this.puffs) { this.root.remove(p.s); p.s.material.dispose(); }
    this.chunks = [];
    this.puffs = [];
    this.root.visible = false;
    this.active = false;
  }

  dispose() {
    this.clear();
    this.scene.remove(this.root);
  }
}
