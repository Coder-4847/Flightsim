import * as THREE from 'three';

// The airport perimeter fence: chain-link bays between steel posts, drawn as two instanced meshes so that single
// bays and posts can be removed. An aircraft that runs through the fence tears the bays it touches off their posts
// and flings them as rigid plates (gravity, tumbling, bouncing and sliding to rest on the ground); posts that are
// hit hard snap off, slower hits bend them over. The aircraft is slowed by the momentum it gives the debris but is
// never destroyed by a fence. All coordinates are in the airport frame (local +Y up, ground at y = 0).

const BAY = 4; // target bay width (m); also the width of the fence texture cell
const POST_H = 2.9;
const PANEL_MASS = 16; // kg per bay
const POST_MASS = 14;
const G = 9.81;
const MAX_DEBRIS = 400;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _n = new THREE.Vector3();
const _r = new THREE.Vector3();
const _vc = new THREE.Vector3();
const _J = new THREE.Vector3();
const _Rm = new THREE.Matrix3();
const _Iinv = new THREE.Matrix3();
const _T = new THREE.Matrix3();
const _UP = new THREE.Vector3(0, 1, 0);
const _Y = new THREE.Vector3(0, 1, 0);
const _ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const _hit = { mass: 0, px: 0, py: 0, pz: 0 };
const _pw = new THREE.Vector3();
const _rw = new THREE.Vector3();
const _vw = new THREE.Vector3();
const _Jw = new THREE.Vector3();
const _ww = new THREE.Vector3();

function withWhiteColors(geo) {
  const n = geo.attributes.position.count;
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
  return geo;
}

/** Deterministic pseudo-random in [0, 1) for scatter that must not change between runs. */
function hash(i) { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }

/** A rigid body with a handful of contact points that bounces and slides on the flat ground at y = 0. */
class Debris {
  constructor(mesh, points, mass, dims) {
    this.mesh = mesh;
    this.points = points; // contact points in body space
    this.mass = mass;
    this.p = mesh.position; this.q = mesh.quaternion;
    this.v = new THREE.Vector3(); this.w = new THREE.Vector3();
    // diagonal inertia (body axes) of a box with dims (x, y, z)
    this.invI = new THREE.Vector3(
      12 / (mass * (dims.y * dims.y + dims.z * dims.z)),
      12 / (mass * (dims.x * dims.x + dims.z * dims.z)),
      12 / (mass * (dims.x * dims.x + dims.y * dims.y)),
    );
    this.asleep = false;
    this.rest = 0;
  }

  /** Inverse inertia tensor in world axes into `out`. */
  worldInvI(out) {
    _Rm.setFromMatrix4(_m.makeRotationFromQuaternion(this.q));
    const e = _Rm.elements; const d = this.invI;
    // out = R * diag(d) * R^T
    const t = _T.elements;
    for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) t[c * 3 + r] = e[c * 3 + r] * d.getComponent(c);
    const o = out.elements;
    for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) {
      let sum = 0;
      for (let k = 0; k < 3; k++) sum += t[k * 3 + r] * e[k * 3 + c];
      o[c * 3 + r] = sum;
    }
    return out;
  }

  step(dt) {
    if (this.asleep) return;
    const damp = Math.exp(-0.35 * dt);
    this.v.y -= G * dt;
    this.v.multiplyScalar(damp);
    this.w.multiplyScalar(Math.exp(-0.6 * dt));
    this.p.addScaledVector(this.v, dt);
    // q += 0.5 * (w, 0) * q * dt
    _qb.set(this.w.x * dt * 0.5, this.w.y * dt * 0.5, this.w.z * dt * 0.5, 0).multiply(this.q);
    this.q.set(this.q.x + _qb.x, this.q.y + _qb.y, this.q.z + _qb.z, this.q.w + _qb.w).normalize();

    this.worldInvI(_Iinv);
    let touching = false;
    for (let pass = 0; pass < 2; pass++) {
      for (const c of this.points) {
        _r.copy(c).applyQuaternion(this.q);
        const y = this.p.y + _r.y;
        if (y >= 0) continue;
        touching = true;
        this.p.y -= y; // push out
        _vc.crossVectors(this.w, _r).add(this.v);
        const vn = _vc.y;
        if (vn >= 0) continue;
        // normal impulse, restitution 0.25 (chain-link and thin posts barely bounce)
        _a.crossVectors(_r, _UP).applyMatrix3(_Iinv); // I^-1 (r x n)
        _b.crossVectors(_a, _r);
        const k = 1 / this.mass + _b.y;
        const e = vn < -2 ? 0.25 : 0;
        const j = -(1 + e) * vn / k;
        _J.set(0, j, 0);
        // Coulomb friction along the surface
        const vt = Math.hypot(_vc.x, _vc.z);
        if (vt > 1e-4) {
          const jt = Math.min(0.55 * j, vt / k);
          _J.x -= (_vc.x / vt) * jt; _J.z -= (_vc.z / vt) * jt;
        }
        this.v.addScaledVector(_J, 1 / this.mass);
        _n.crossVectors(_r, _J).applyMatrix3(_Iinv);
        this.w.add(_n);
      }
    }
    if (touching && this.v.lengthSq() < 0.04 && this.w.lengthSq() < 0.12) {
      this.rest += dt;
      if (this.rest > 0.5) { this.asleep = true; this.v.set(0, 0, 0); this.w.set(0, 0, 0); }
    } else this.rest = 0;
  }
}

export class FenceField {
  /**
   * @param spec     result of addFence(): { edges: [{x, z, dx, dz, len, spans}], height }
   * @param mats     airport materials ({ fence, steel })
   * @param parent   group (in the airport frame) that receives the meshes
   */
  constructor(spec, mats, parent) {
    this.H = spec.height;
    this.parent = parent;
    this.mats = mats;
    this.edges = [];
    this.debris = [];
    this.broken = 0;

    // geometry: bay hangs from y = 0 to H; centred copies are used for the loose pieces
    this.bayGeo = withWhiteColors(new THREE.PlaneGeometry(BAY, this.H).translate(0, this.H / 2, 0));
    this.bayLooseGeo = withWhiteColors(new THREE.PlaneGeometry(BAY, this.H));
    this.postGeo = withWhiteColors(new THREE.BoxGeometry(0.12, POST_H, 0.12).translate(0, POST_H / 2, 0));
    this.postLooseGeo = withWhiteColors(new THREE.BoxGeometry(0.12, POST_H, 0.12));

    let nb = 0; let np = 0;
    for (const e of spec.edges) {
      const edge = { ...e, bays: [], posts: [] };
      for (const [s0, s1] of e.spans) {
        if (s1 - s0 < 1) continue;
        const n = Math.max(1, Math.round((s1 - s0) / BAY));
        const w = (s1 - s0) / n;
        for (let k = 0; k <= n; k++) edge.posts.push({ t: s0 + k * w, idx: np++, state: 0 });
        for (let k = 0; k < n; k++) edge.bays.push({ a: s0 + k * w, b: s0 + (k + 1) * w, idx: nb++, alive: true });
      }
      this.edges.push(edge);
    }
    this.bayMesh = new THREE.InstancedMesh(this.bayGeo, mats.fence, Math.max(1, nb));
    this.postMesh = new THREE.InstancedMesh(this.postGeo, mats.steel, Math.max(1, np));
    for (const m of [this.bayMesh, this.postMesh]) { m.frustumCulled = false; m.name = 'fence'; }
    for (const edge of this.edges) {
      const yaw = Math.atan2(-edge.dz, edge.dx); // three.js rotation.y: local +X onto the fence direction
      _q.setFromAxisAngle(_Y, yaw);
      for (const bay of edge.bays) {
        const t = (bay.a + bay.b) / 2;
        _p.set(edge.x + edge.dx * t, 0, edge.z + edge.dz * t);
        _s.set((bay.b - bay.a) / BAY, 1, 1);
        this.bayMesh.setMatrixAt(bay.idx, _m.compose(_p, _q, _s));
      }
      for (const post of edge.posts) {
        _p.set(edge.x + edge.dx * post.t, 0, edge.z + edge.dz * post.t);
        this.postMesh.setMatrixAt(post.idx, _m.compose(_p, _q, _s.set(1, 1, 1)));
      }
      edge.yaw = yaw;
    }
    this.bayMesh.instanceMatrix.needsUpdate = true;
    this.postMesh.instanceMatrix.needsUpdate = true;
    this.root = new THREE.Group();
    this.root.add(this.bayMesh, this.postMesh);
    parent.add(this.root);
    this.dirty = false;
  }

  /**
   * Test one point of an aircraft against the fence.
   * @param x,y,z   position in the airport frame (y above the airport ground)
   * @param vx,vy,vz velocity of the point in the airport frame
   * @param radius  size of the part (m)
   * @param dt      time step, so a fast part cannot tunnel through
   * @param momentum accumulator { mass, px, py, pz } of the momentum the debris carries away (airport axes)
   * @returns number of pieces broken
   */
  hit(x, y, z, vx, vy, vz, radius, dt, momentum) {
    if (y > this.H + radius || y < -radius * 0.5) return 0;
    const speed = Math.hypot(vx, vz);
    if (speed < 0.5) return 0;
    let broken = 0;
    for (const edge of this.edges) {
      const rx = x - edge.x; const rz = z - edge.z;
      const t = rx * edge.dx + rz * edge.dz;
      if (t < -radius || t > edge.len + radius) continue;
      const d = rx * edge.dz - rz * edge.dx; // signed distance from the fence line
      const vperp = vx * edge.dz - vz * edge.dx;
      const reach = radius + 0.2 + Math.abs(vperp) * dt;
      if (Math.abs(d) > reach) continue;
      // bays whose span overlaps [t - radius, t + radius]
      const guess = Math.floor(t / BAY);
      for (let i = Math.max(0, guess - 5); i < Math.min(edge.bays.length, guess + 6); i++) {
        const bay = edge.bays[i];
        if (!bay.alive || t + radius < bay.a || t - radius > bay.b) continue;
        this.#breakBay(edge, bay, vx, vy, vz, momentum);
        broken++;
      }
      for (const post of edge.posts) {
        if (post.state === 2 || Math.abs(post.t - t) > radius + 0.4) continue;
        if (y > POST_H) continue;
        if (speed > 9 || post.state === 1) this.#breakPost(edge, post, vx, vy, vz, momentum);
        else this.#bendPost(edge, post, vx, vz);
        broken++;
      }
    }
    return broken;
  }

  #hide(mesh, idx) { mesh.setMatrixAt(idx, _ZERO); mesh.instanceMatrix.needsUpdate = true; }

  #addDebris(geo, mat, matrix, points, mass, dims, v, w, scaleX = 1) {
    if (this.debris.length >= MAX_DEBRIS) this.#retire(this.debris.shift());
    const mesh = new THREE.Mesh(geo, mat);
    matrix.decompose(mesh.position, mesh.quaternion, _s);
    mesh.scale.set(scaleX, 1, 1);
    mesh.castShadow = true;
    this.root.add(mesh);
    const d = new Debris(mesh, points, mass, dims);
    d.v.copy(v); d.w.copy(w);
    this.debris.push(d);
    return d;
  }

  #retire(d) { if (d) this.root.remove(d.mesh); }

  /** Velocity a torn-off piece leaves with: it picks up most of the speed of whatever hit it, plus a toss. */
  #fling(vx, vy, vz, seed, out) {
    const k = 0.55 + 0.3 * hash(seed);
    return out.set(vx * k + (hash(seed + 1) - 0.5) * 3, Math.max(0, vy * k) + 1 + hash(seed + 2) * 2.5, vz * k + (hash(seed + 3) - 0.5) * 3);
  }

  #breakBay(edge, bay, vx, vy, vz, momentum) {
    bay.alive = false;
    this.#hide(this.bayMesh, bay.idx);
    this.broken++;
    const seed = this.broken * 7 + bay.idx;
    const t = (bay.a + bay.b) / 2;
    const w = bay.b - bay.a;
    _p.set(edge.x + edge.dx * t, this.H / 2, edge.z + edge.dz * t);
    _q.setFromAxisAngle(_Y, edge.yaw);
    _m.compose(_p, _q, _s.set(1, 1, 1));
    const v = this.#fling(vx, vy, vz, seed, new THREE.Vector3());
    const speed = Math.hypot(vx, vz);
    const spin = new THREE.Vector3((hash(seed + 4) - 0.5) * 2, (hash(seed + 5) - 0.5) * 1.5, (hash(seed + 6) - 0.5) * 2).multiplyScalar(0.6 + speed * 0.12);
    const hw = w / 2; const hh = this.H / 2;
    const pts = [[-hw, -hh], [hw, -hh], [-hw, hh], [hw, hh], [0, -hh], [0, hh], [-hw, 0], [hw, 0]].map(([a, b]) => new THREE.Vector3(a, b, 0));
    this.#addDebris(this.bayLooseGeo, this.mats.fence, _m, pts, PANEL_MASS * w / BAY, { x: w, y: this.H, z: 0.05 }, v, spin, w / BAY);
    momentum.mass += PANEL_MASS * w / BAY;
    // The aircraft has to accelerate the panel, so it loses the speed the piece picks up.
    momentum.px += v.x * PANEL_MASS * w / BAY; momentum.pz += v.z * PANEL_MASS * w / BAY; momentum.py += v.y * PANEL_MASS * w / BAY;
  }

  #bendPost(edge, post, vx, vz) {
    post.state = 1;
    // lean away from the aircraft, up to about 40 degrees
    const sgn = Math.sign(vx * edge.dz - vz * edge.dx) || 1;
    const lean = 0.5 + 0.2 * hash(post.idx);
    _a.set(edge.dx, 0, edge.dz); // axis along the fence: the post tips across it
    _qb.setFromAxisAngle(_a, -sgn * lean);
    _q.setFromAxisAngle(_Y, edge.yaw).premultiply(_qb);
    _p.set(edge.x + edge.dx * post.t, 0, edge.z + edge.dz * post.t);
    this.postMesh.setMatrixAt(post.idx, _m.compose(_p, _q, _s.set(1, 1, 1)));
    this.postMesh.instanceMatrix.needsUpdate = true;
  }

  #breakPost(edge, post, vx, vy, vz, momentum) {
    post.state = 2;
    this.#hide(this.postMesh, post.idx);
    this.broken++;
    const seed = this.broken * 11 + post.idx;
    _p.set(edge.x + edge.dx * post.t, POST_H / 2 + 0.05, edge.z + edge.dz * post.t);
    _q.setFromAxisAngle(_Y, edge.yaw);
    _m.compose(_p, _q, _s.set(1, 1, 1));
    const v = this.#fling(vx, vy, vz, seed, new THREE.Vector3());
    const speed = Math.hypot(vx, vz);
    const spin = new THREE.Vector3((hash(seed + 4) - 0.5) * 6, (hash(seed + 5) - 0.5) * 4, (hash(seed + 6) - 0.5) * 6).multiplyScalar(0.5 + speed * 0.08);
    const pts = [[0, -POST_H / 2, 0], [0, POST_H / 2, 0], [0, 0, 0]].map(([a, b, c]) => new THREE.Vector3(a, b, c));
    this.#addDebris(this.postLooseGeo, this.mats.steel, _m, pts, POST_MASS, { x: 0.12, y: POST_H, z: 0.12 }, v, spin);
    momentum.mass += POST_MASS;
    momentum.px += v.x * POST_MASS; momentum.pz += v.z * POST_MASS; momentum.py += v.y * POST_MASS;
  }

  /** Whether (x, z) is within `range` of any fence line (cheap reject for the collision test). */
  near(x, z, range) {
    for (const e of this.edges) {
      const rx = x - e.x; const rz = z - e.z;
      const t = Math.min(e.len, Math.max(0, rx * e.dx + rz * e.dz));
      if (Math.hypot(rx - e.dx * t, rz - e.dz * t) < range) return true;
    }
    return false;
  }

  /**
   * Run the aircraft's hull through the fence for one physics step and give the aircraft the reaction of the pieces it
   * knocked off. `site` = { x, y, z (airport origin in the world), yaw (rotation of the airport frame) }.
   * Returns the number of pieces broken.
   */
  collide(model, hull, site, dt) {
    const c = Math.cos(site.yaw); const s = Math.sin(site.yaw);
    const dxw = model.pos.x - site.x; const dzw = model.pos.z - site.z;
    if (!this.near(dxw * c - dzw * s, dxw * s + dzw * c, hull.radius + 4)) return 0;
    const gearDown = model.gear.extension > 0.5;
    const wq = model.q; const w = model.w;
    _ww.copy(w).applyQuaternion(wq); // body rates to world axes
    let total = 0;
    for (const h of hull.points) {
      if (h.gear && !gearDown) continue;
      _rw.copy(h.p).applyQuaternion(wq);
      _pw.copy(model.pos).add(_rw);
      _vw.crossVectors(_ww, _rw).add(model.vel);
      const px = _pw.x - site.x; const pz = _pw.z - site.z;
      const lx = px * c - pz * s; const lz = px * s + pz * c; const ly = _pw.y - site.y;
      const vx = _vw.x * c - _vw.z * s; const vz = _vw.x * s + _vw.z * c;
      _hit.mass = _hit.px = _hit.py = _hit.pz = 0;
      const n = this.hit(lx, ly, lz, vx, _vw.y, vz, h.r, dt, _hit);
      if (!n) continue;
      total += n;
      // reaction on the aircraft: the debris leaves with momentum p, so the aircraft receives -p (back to world axes)
      _Jw.set(-(_hit.px * c + _hit.pz * s), -_hit.py, -(-_hit.px * s + _hit.pz * c));
      model.applyImpulse(_rw, _Jw);
    }
    return total;
  }

  update(dt) {
    if (dt <= 0 || this.debris.length === 0) return;
    const sub = Math.min(4, Math.ceil(dt / (1 / 90)));
    const h = Math.min(dt, 0.1) / sub;
    for (const d of this.debris) {
      if (d.asleep) continue;
      for (let i = 0; i < sub; i++) d.step(h);
    }
  }

  dispose() {
    for (const g of [this.bayGeo, this.bayLooseGeo, this.postGeo, this.postLooseGeo]) g.dispose();
    this.bayMesh.dispose(); this.postMesh.dispose();
    this.parent.remove(this.root);
  }
}

/** Points of an aircraft that can touch the fence: wheels, the strike points, a line along the wing and one along the fuselage. */
export function aircraftHull(spec) {
  const pts = [];
  const g = spec.gear;
  const rad = (g.wheelRadius ?? 0.3) + 0.15;
  for (const wh of [g.nose, g.mainLeft, g.mainRight]) pts.push({ p: new THREE.Vector3(wh.x, wh.y, wh.z), r: rad, gear: true });
  const strikes = spec.strike ?? [];
  for (const st of strikes) pts.push({ p: new THREE.Vector3(st.x, st.y, st.z), r: 0.45, gear: false });
  let left = null; let right = null;
  for (const st of strikes) { if (!left || st.z < left.z) left = st; if (!right || st.z > right.z) right = st; }
  if (left && right && right.z - left.z > 3) {
    const n = Math.ceil((right.z - left.z) / 2);
    for (let i = 1; i < n; i++) {
      const f = i / n;
      pts.push({ p: new THREE.Vector3(left.x + (right.x - left.x) * f, left.y + (right.y - left.y) * f, left.z + (right.z - left.z) * f), r: 0.5, gear: false });
    }
  }
  const body = strikes.filter((st) => Math.abs(st.z) < 1.5);
  const xs = [...strikes.map((st) => st.x), g.nose.x, g.mainLeft.x];
  const x0 = Math.min(...xs); const x1 = Math.max(...xs);
  const yb = body.length ? body.reduce((sum, st) => sum + st.y, 0) / body.length : 0;
  const n = Math.max(1, Math.ceil((x1 - x0) / 2));
  for (let i = 0; i <= n; i++) pts.push({ p: new THREE.Vector3(x0 + ((x1 - x0) * i) / n, yb, 0), r: 0.9, gear: false });
  const radius = Math.max(...pts.map((q) => q.p.length() + q.r));
  return { points: pts, radius };
}
