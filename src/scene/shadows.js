import * as THREE from 'three';

// One sun shadow map that follows the camera. Its box is centred on the ground ahead of the view
// and grows with the height above the ground, so the aircraft, the airport and the nearby
// scenery are covered at a useful resolution. Off on Low quality, and faded out when the sun is
// close to the horizon, at night, high above the ground or in heavy overcast.

const MAP_SIZE = { low: 0, medium: 1024, high: 2048, auto: 1536 };
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _centre = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export class ShadowRig {
  constructor(renderer, env) {
    this.renderer = renderer;
    this.env = env;
    this.size = 0;
    this.active = false;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.shadowMap.autoUpdate = false;
    this.radius = 600;
    this.primed = false;
  }

  setQuality(level) {
    const size = MAP_SIZE[level] ?? 1536;
    if (size === this.size) return;
    this.size = size;
    const sun = this.env.sun;
    sun.castShadow = size > 0;
    if (size > 0) {
      if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
      sun.shadow.mapSize.set(size, size);
      this.primed = false;
      sun.shadow.radius = 2.2;
      sun.shadow.bias = -0.00015;
      const c = sun.shadow.camera;
      c.near = 20;
      c.far = 5200;
    }
  }

  /** `groundY` is the terrain height below the camera; `forward` the camera's horizontal heading. */
  update(camera, groundY, enabledHint = true) {
    const sun = this.env.sun;
    if (this.size === 0) return;
    const env = this.env;
    const agl = Math.max(0, camera.position.y - groundY);
    const lightEl = env.lightDir.y;
    const day = env.sunElevation > 0.07 && env.dayAmt > 0.2;
    const fade = Math.min(1, Math.max(0, (3200 - agl) / 700)); // shadows fade out with height instead of switching off
    const strength = enabledHint && day ? (1 - 0.9 * env.cloudDim) * Math.min(1, (lightEl - 0.05) * 6) * fade : 0;
    this.active = strength > 0.02;
    this.renderer.shadowMap.autoUpdate = this.active;
    if (!this.active && !this.primed) { this.renderer.shadowMap.needsUpdate = true; this.primed = true; } // allocate the map once
    if (this.active) this.primed = true;
    sun.shadow.intensity = this.active ? strength : 0;
    if (!this.active) return;

    // The box size moves in steps (a geometric ladder with hysteresis): a radius that follows the height continuously
    // rescales the shadow map every frame, so every shadow edge crawls while the aircraft climbs or descends.
    const want = Math.min(2600, Math.max(260, agl * 0.9 + 330));
    let R = this.radius;
    if (!R || want > R * 1.12 || want < R / 1.5) R = Math.min(2600, Math.max(260, 260 * 1.3 ** Math.ceil(Math.log(want / 260) / Math.log(1.3))));
    this.radius = R;
    // Centre ahead of the camera on the ground (the part of the world actually seen).
    camera.getWorldDirection(_fwd);
    _fwd.y = 0;
    if (_fwd.lengthSq() < 1e-4) _fwd.set(0, 0, -1);
    _fwd.normalize();
    const ahead = Math.min(R * 0.55, agl * 0.8 + 120);
    _centre.set(camera.position.x + _fwd.x * ahead, groundY, camera.position.z + _fwd.z * ahead);

    // Light-space basis, to snap the centre to whole texels (no shimmering while moving).
    const dir = env.lightDir;
    _right.crossVectors(UP, dir).normalize();
    _up.crossVectors(dir, _right).normalize();
    const texel = (2 * R) / this.size;
    const sx = Math.round(_centre.dot(_right) / texel) * texel;
    const sy = Math.round(_centre.dot(_up) / texel) * texel;
    const sz = _centre.dot(dir);
    _centre.copy(_right).multiplyScalar(sx).addScaledVector(_up, sy).addScaledVector(dir, sz);

    sun.target.position.copy(_centre);
    sun.position.copy(_centre).addScaledVector(dir, 2600);
    sun.target.updateMatrixWorld();
    const c = sun.shadow.camera;
    if (c.right !== R) {
      c.left = -R; c.right = R; c.top = R; c.bottom = -R;
      c.updateProjectionMatrix();
    }
    sun.shadow.normalBias = Math.max(0.35, texel * 0.9);
  }
}

/** Mark meshes below `root` as shadow casters/receivers (once). */
export function enableShadows(root, { cast = true, receive = true, skip = null } = {}) {
  root.traverse((o) => {
    if (!o.isMesh && !o.isInstancedMesh) return;
    if (skip && skip(o)) return;
    if (o.userData.shadowSet) return;
    o.userData.shadowSet = true;
    if (o.userData.noShadow) { if (receive) o.receiveShadow = true; return; } // receives, never casts
    const m = o.material;
    const transparent = Array.isArray(m) ? m.some((x) => x.transparent) : m?.transparent;
    if (cast && !transparent) o.castShadow = true;
    if (receive) o.receiveShadow = true;
  });
}
