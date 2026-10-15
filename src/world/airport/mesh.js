import * as THREE from 'three';

// Tiny geometry accumulator used by every airport module. Parts are written straight into flat
// arrays (position, normal, uv, vertex colour, index), so a whole airport's buildings, markings
// and props collapse into one mesh per material. Side-face UVs are in metres (u across, v up) so a
// tiled texture keeps a constant scale on every part; set `texture.repeat` to 1 / tileSize.

const rot = (lx, lz, c, s) => [lx * c + lz * s, -lx * s + lz * c]; // three.js rotation.y convention

export class MeshBuf {
  constructor() {
    this.pos = []; this.nor = []; this.uv = []; this.col = []; this.idx = [];
    this.n = 0;
  }

  get empty() { return this.n === 0; }

  vert(x, y, z, nx, ny, nz, u, v, r = 1, g = r, b = r) {
    this.pos.push(x, y, z); this.nor.push(nx, ny, nz); this.uv.push(u, v); this.col.push(r, g, b);
    return this.n++;
  }

  tri(a, b, c) { this.idx.push(a, b, c); }

  /** Quad from four corners (counter-clockwise seen from the front). `uvs` = [u0,v0,u1,v1,u2,v2,u3,v3]. */
  quad(p0, p1, p2, p3, uvs, colors, normal = null) {
    let nx; let ny; let nz;
    if (normal) [nx, ny, nz] = normal;
    else {
      const ax = p1[0] - p0[0]; const ay = p1[1] - p0[1]; const az = p1[2] - p0[2];
      const bx = p2[0] - p0[0]; const by = p2[1] - p0[1]; const bz = p2[2] - p0[2];
      nx = ay * bz - az * by; ny = az * bx - ax * bz; nz = ax * by - ay * bx;
      const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    }
    const u = uvs ?? [0, 0, 1, 0, 1, 1, 0, 1];
    const c = colors ?? [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1];
    const a = this.vert(p0[0], p0[1], p0[2], nx, ny, nz, u[0], u[1], c[0], c[1], c[2]);
    const b = this.vert(p1[0], p1[1], p1[2], nx, ny, nz, u[2], u[3], c[3], c[4], c[5]);
    const d = this.vert(p2[0], p2[1], p2[2], nx, ny, nz, u[4], u[5], c[6], c[7], c[8]);
    const e = this.vert(p3[0], p3[1], p3[2], nx, ny, nz, u[6], u[7], c[9], c[10], c[11]);
    this.idx.push(a, b, d, a, d, e);
  }

  /** Horizontal quad (facing up) in the plane y; corners (x0,z0)-(x1,z1) given as the usual rectangle. */
  flat(x0, z0, x1, z1, y, uv = null, color = 1) {
    const u = uv ?? [x0, z0, x1, z1];
    // viewed from above with +X right and +Z down the screen: (x0,z0) (x0,z1) (x1,z1) (x1,z0) is counter-clockwise from above
    this.quad([x0, y, z0], [x0, y, z1], [x1, y, z1], [x1, y, z0], [u[0], u[1], u[0], u[3], u[2], u[3], u[2], u[1]], new Array(12).fill(color), [0, 1, 0]);
  }

  /** Oriented flat rectangle on the ground: centre (cx,cz), `len` along local X, `wid` along local Z, yaw `ry`. */
  flatRect(cx, cz, len, wid, ry, y, { uv = null, color = 1, glyph = null } = {}) {
    const c = Math.cos(ry); const s = Math.sin(ry);
    const hl = len / 2; const hw = wid / 2;
    const P = (lx, lz) => { const [x, z] = rot(lx, lz, c, s); return [cx + x, y, cz + z]; };
    // local u runs along X, v along Z
    const p0 = P(-hl, -hw); const p1 = P(-hl, hw); const p2 = P(hl, hw); const p3 = P(hl, -hw);
    const t = uv ?? [0, 0, 1, 1];
    // glyph: [u0, v0, u1, v1] atlas rect; local +X is the glyph's right, local -Z its top
    const col = new Array(12).fill(color);
    this.quad(p0, p1, p2, p3, [t[0], t[3], t[0], t[1], t[2], t[1], t[2], t[3]], col, [0, 1, 0]);
  }

  /**
   * Box with its base centre at (x, y, z), size w (X) x h (Y) x d (Z), yaw ry. UVs in metres unless
   * `uvTile` is given. `ao` darkens the bottom edge of the side faces (0 = none).
   */
  box(x, y, z, w, h, d, { ry = 0, color = 1, ao = 0.16, bottom = false, top = true, sides = true, uvOff = [0, 0], tint = null } = {}) {
    const c = Math.cos(ry); const s = Math.sin(ry);
    const hw = w / 2; const hd = d / 2;
    const P = (lx, ly, lz) => { const [rx, rz] = rot(lx, lz, c, s); return [x + rx, y + ly, z + rz]; };
    const N = (lx, lz) => { const [rx, rz] = rot(lx, lz, c, s); return [rx, 0, rz]; };
    const lo = color * (1 - ao);
    const cT = tint ?? [color, color, color];
    const cB = tint ? [tint[0] * (1 - ao), tint[1] * (1 - ao), tint[2] * (1 - ao)] : [lo, lo, lo];
    const side = (p0, p1, p2, p3, n, len) => {
      const u0 = uvOff[0]; const v0 = uvOff[1];
      this.quad(p0, p1, p2, p3, [u0, v0, u0 + len, v0, u0 + len, v0 + h, u0, v0 + h],
        [...cB, ...cB, ...cT, ...cT], n);
    };
    if (sides) {
      side(P(-hw, 0, hd), P(hw, 0, hd), P(hw, h, hd), P(-hw, h, hd), N(0, 1), w);
      side(P(hw, 0, hd), P(hw, 0, -hd), P(hw, h, -hd), P(hw, h, hd), N(1, 0), d);
      side(P(hw, 0, -hd), P(-hw, 0, -hd), P(-hw, h, -hd), P(hw, h, -hd), N(0, -1), w);
      side(P(-hw, 0, -hd), P(-hw, 0, hd), P(-hw, h, hd), P(-hw, h, -hd), N(-1, 0), d);
    }
    if (top) {
      const col = [...cT, ...cT, ...cT, ...cT];
      this.quad(P(-hw, h, hd), P(hw, h, hd), P(hw, h, -hd), P(-hw, h, -hd), [uvOff[0], uvOff[1], uvOff[0] + w, uvOff[1], uvOff[0] + w, uvOff[1] + d, uvOff[0], uvOff[1] + d], col, [0, 1, 0]);
    }
    if (bottom) {
      const col = [...cB, ...cB, ...cB, ...cB];
      this.quad(P(-hw, 0, -hd), P(hw, 0, -hd), P(hw, 0, hd), P(-hw, 0, hd), [0, 0, w, 0, w, d, 0, d], col, [0, -1, 0]);
    }
  }

  /** Frustum/cylinder with base centre (x, y, z); yaw/tilt are not supported (cylinders stay upright). */
  cyl(x, y, z, rTop, rBot, h, seg = 12, { color = 1, ao = 0.14, capTop = true, capBot = false, uvTile = 4, open = false, tint = null, arc = null } = {}) {
    const a0 = arc ? arc[0] : 0; const a1 = arc ? arc[1] : Math.PI * 2;
    const slope = (rBot - rTop) / h;
    const lo = color * (1 - ao);
    const cT = tint ?? [color, color, color];
    const cB = tint ? [tint[0] * (1 - ao), tint[1] * (1 - ao), tint[2] * (1 - ao)] : [lo, lo, lo];
    const circ = ((a1 - a0) * Math.max(rTop, rBot));
    const rings = [];
    for (let i = 0; i <= seg; i++) {
      const a = a0 + (a1 - a0) * (i / seg);
      const nx = Math.cos(a); const nz = Math.sin(a);
      const nl = Math.hypot(1, slope);
      const u = (i / seg) * circ;
      const b = this.vert(x + nx * rBot, y, z + nz * rBot, nx / nl, slope / nl, nz / nl, u, 0, ...cB);
      const t = this.vert(x + nx * rTop, y + h, z + nz * rTop, nx / nl, slope / nl, nz / nl, u, h, ...cT);
      rings.push([b, t]);
    }
    for (let i = 0; i < seg; i++) {
      const [b0, t0] = rings[i]; const [b1, t1] = rings[i + 1];
      this.idx.push(b0, t0, t1, b0, t1, b1);
    }
    void open; void uvTile;
    const cap = (yy, r, up, col) => {
      if (r <= 0) return;
      const ny = up ? 1 : -1;
      const ctr = this.vert(x, yy, z, 0, ny, 0, 0, 0, ...col);
      const vs = [];
      for (let i = 0; i <= seg; i++) {
        const a = a0 + (a1 - a0) * (i / seg);
        vs.push(this.vert(x + Math.cos(a) * r, yy, z + Math.sin(a) * r, 0, ny, 0, Math.cos(a) * r, Math.sin(a) * r, ...col));
      }
      for (let i = 0; i < seg; i++) { if (up) this.idx.push(ctr, vs[i + 1], vs[i]); else this.idx.push(ctr, vs[i], vs[i + 1]); }
    };
    if (capTop) cap(y + h, rTop, true, cT);
    if (capBot) cap(y, rBot, false, cB);
  }

  /** UV sphere (or upper hemisphere with `half`) centred at (x, y, z). */
  sphere(x, y, z, r, seg = 12, rings = 8, { color = 1, half = false, sy = 1, tint = null } = {}) {
    const rows = half ? Math.ceil(rings / 2) : rings;
    const base = this.n;
    const c = tint ?? [color, color, color];
    for (let j = 0; j <= rows; j++) {
      const phi = half ? (j / rows) * (Math.PI / 2) : (j / rows) * Math.PI;
      const yy = Math.cos(phi); const rr = Math.sin(phi);
      for (let i = 0; i <= seg; i++) {
        const th = (i / seg) * Math.PI * 2;
        const nx = Math.cos(th) * rr; const nz = Math.sin(th) * rr;
        this.vert(x + nx * r, y + yy * r * sy, z + nz * r, nx, yy, nz, (i / seg) * r * 6, (j / rows) * r * 3, ...c);
      }
    }
    for (let j = 0; j < rows; j++) for (let i = 0; i < seg; i++) {
      const a = base + j * (seg + 1) + i; const b = a + seg + 1;
      this.idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }

  /**
   * Extrude a 2D profile (x, y pairs in a local XY plane, counter-clockwise) along local Z from z0 to z1.
   * The result is positioned at (x, y, z) and yawed by ry. `smooth` averages normals around the profile.
   */
  extrude(profile, z0, z1, { x = 0, y = 0, z = 0, ry = 0, color = 1, ao = 0.1, smooth = false, caps = true, uvScale = 1, tint = null } = {}) {
    const c = Math.cos(ry); const s = Math.sin(ry);
    const P = (px, py, pz) => { const [rx, rz] = rot(px, pz, c, s); return [x + rx, y + py, z + rz]; };
    const N = (nx, ny, nz) => { const [rx, rz] = rot(nx, nz, c, s); return [rx, ny, rz]; };
    const n = profile.length;
    const len = z1 - z0;
    const col = (py) => { const f = color * (1 - ao * Math.max(0, 1 - py / 6)); return tint ? [tint[0] * f / color, tint[1] * f / color, tint[2] * f / color] : [f, f, f]; };
    let acc = 0;
    for (let i = 0; i < n; i++) {
      const [ax, ay] = profile[i]; const [bx, by] = profile[(i + 1) % n];
      const ex = bx - ax; const ey = by - ay; const el = Math.hypot(ex, ey) || 1;
      const nx = ey / el; const ny = -ex / el; // outward for a counter-clockwise profile
      let n0 = [nx, ny, 0]; let n1 = n0;
      if (smooth) {
        const [px, py] = profile[(i - 1 + n) % n]; const [qx, qy] = profile[(i + 2) % n];
        const e0x = ax - px; const e0y = ay - py; const l0 = Math.hypot(e0x, e0y) || 1;
        const e1x = qx - bx; const e1y = qy - by; const l1 = Math.hypot(e1x, e1y) || 1;
        const m0 = [(e0y / l0 + nx), (-e0x / l0 + ny)]; const m1 = [(nx + e1y / l1), (ny - e1x / l1)];
        const a = Math.hypot(...m0) || 1; const b = Math.hypot(...m1) || 1;
        n0 = [m0[0] / a, m0[1] / a, 0]; n1 = [m1[0] / b, m1[1] / b, 0];
      }
      const c0 = col(ay); const c1 = col(by);
      const u0 = acc * uvScale; const u1 = (acc + el) * uvScale;
      acc += el;
      const v00 = this.vert(...P(ax, ay, z0), ...N(...n0), u0, 0, ...c0);
      const v10 = this.vert(...P(bx, by, z0), ...N(...n1), u1, 0, ...c1);
      const v11 = this.vert(...P(bx, by, z1), ...N(...n1), u1, len * uvScale, ...c1);
      const v01 = this.vert(...P(ax, ay, z1), ...N(...n0), u0, len * uvScale, ...c0);
      this.idx.push(v00, v10, v11, v00, v11, v01);
    }
    if (caps) {
      const tris = THREE.ShapeUtils.triangulateShape(profile.map(([px, py]) => new THREE.Vector2(px, py)), []);
      for (const [zz, nzz, flip] of [[z1, 1, false], [z0, -1, true]]) {
        const base = this.n;
        const cc = col(2);
        for (const [px, py] of profile) this.vert(...P(px, py, zz), ...N(0, 0, nzz), px, py, ...cc);
        for (const t of tris) {
          const [ax, ay] = profile[t[0]]; const [bx, by] = profile[t[1]]; const [cx, cy] = profile[t[2]];
          const ccw = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax) > 0;
          const front = ccw !== flip;
          if (front) this.idx.push(base + t[0], base + t[1], base + t[2]); else this.idx.push(base + t[0], base + t[2], base + t[1]);
        }
      }
    }
  }

  /** Flat ribbon on the ground following a polyline (points {x,z}), half-width hw, at height y. */
  ribbon(pts, hw, y, { color = 1, shoulder = 0, shoulderShade = 0.8, uvScale = 1 } = {}) {
    if (pts.length < 2) return;
    const left = []; const right = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const a = pts[Math.max(0, i - 1)]; const b = pts[Math.min(pts.length - 1, i + 1)];
      let tx = b.x - a.x; let tz = b.z - a.z; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
      // normal to the right of travel in x/z with z down: (-tz, tx)... use (tz, -tx) as "left"
      const nx = -tz; const nz = tx;
      // widen on the outside of sharp corners
      let k = 1;
      if (i > 0 && i < pts.length - 1) {
        const t0x = p.x - a.x; const t0z = p.z - a.z; const l0 = Math.hypot(t0x, t0z) || 1;
        const t1x = b.x - p.x; const t1z = b.z - p.z; const l1 = Math.hypot(t1x, t1z) || 1;
        const cosHalf = Math.max(0.35, (t0x * t1x + t0z * t1z) / (l0 * l1));
        k = 1 / Math.sqrt((1 + cosHalf) / 2);
      }
      left.push([p.x - nx * (hw + shoulder) * k, p.z - nz * (hw + shoulder) * k, p.x - nx * hw * k, p.z - nz * hw * k]);
      right.push([p.x + nx * hw * k, p.z + nz * hw * k, p.x + nx * (hw + shoulder) * k, p.z + nz * (hw + shoulder) * k]);
    }
    const rows = [];
    let acc = 0;
    for (let i = 0; i < pts.length; i++) {
      if (i > 0) acc += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
      const L = left[i]; const R = right[i];
      const sh = color * shoulderShade;
      const v = [];
      if (shoulder > 0) v.push(this.vert(L[0], y, L[1], 0, 1, 0, L[0] * uvScale, L[1] * uvScale, sh));
      v.push(this.vert(L[2], y, L[3], 0, 1, 0, L[2] * uvScale, L[3] * uvScale, color));
      v.push(this.vert(R[0], y, R[1], 0, 1, 0, R[0] * uvScale, R[1] * uvScale, color));
      if (shoulder > 0) v.push(this.vert(R[2], y, R[3], 0, 1, 0, R[2] * uvScale, R[3] * uvScale, sh));
      rows.push(v);
    }
    void acc;
    for (let i = 0; i < rows.length - 1; i++) {
      const a = rows[i]; const b = rows[i + 1];
      for (let k = 0; k < a.length - 1; k++) {
        // wound so that the face normal points up for a ribbon laid out with "left" on the -normal side
        this.idx.push(a[k], b[k + 1], b[k], a[k], a[k + 1], b[k + 1]);
      }
    }
  }

  /** Append another buffer, optionally translated/yawed. */
  append(o, { x = 0, y = 0, z = 0, ry = 0 } = {}) {
    const base = this.n;
    const c = Math.cos(ry); const s = Math.sin(ry);
    for (let i = 0; i < o.n; i++) {
      const [rx, rz] = rot(o.pos[i * 3], o.pos[i * 3 + 2], c, s);
      this.pos.push(x + rx, y + o.pos[i * 3 + 1], z + rz);
      const [nx, nz] = rot(o.nor[i * 3], o.nor[i * 3 + 2], c, s);
      this.nor.push(nx, o.nor[i * 3 + 1], nz);
    }
    for (let i = 0; i < o.uv.length; i++) this.uv.push(o.uv[i]);
    for (let i = 0; i < o.col.length; i++) this.col.push(o.col[i]);
    for (let i = 0; i < o.idx.length; i++) this.idx.push(o.idx[i] + base);
    this.n += o.n;
  }

  toGeometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.n > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

/** A set of named buffers, one per material key. */
export class BufSet {
  constructor() { this.map = new Map(); }

  get(key) {
    let b = this.map.get(key);
    if (!b) { b = new MeshBuf(); this.map.set(key, b); }
    return b;
  }

  /** Create meshes for every non-empty buffer using `materials[key]`; returns the list. */
  build(materials, parent, { frustumCulled = true, uvTile = {} } = {}) {
    const out = [];
    for (const [key, buf] of this.map) {
      if (buf.empty) continue;
      const mat = materials[key];
      if (!mat) { console.warn('airport: missing material', key); continue; }
      const tile = uvTile[key];
      if (tile) for (let i = 0; i < buf.uv.length; i += 2) { buf.uv[i] /= tile[0]; buf.uv[i + 1] /= tile[1]; }
      const mesh = new THREE.Mesh(buf.toGeometry(), mat);
      mesh.name = key;
      mesh.frustumCulled = frustumCulled;
      parent?.add(mesh);
      out.push(mesh);
    }
    return out;
  }
}
