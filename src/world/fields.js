// Integer hashing and the analytic farmland lattice. The same functions exist in GLSL (FIELD_GLSL)
// so the terrain shader paints exactly the field boundaries, hedgerows and orchards where the
// scenery builder places trees. Everything here is pure and deterministic.

export function ihash(x) {
  x >>>= 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
}
export const hash2i = (ix, iz, seed = 0) => ihash((Math.imul(ix, 0x9e3779b1) ^ ihash((iz + Math.imul(seed, 0x85ebca6b)) >>> 0)) >>> 0);
/** 0..1 from a hash. */
export const h01 = (h) => (h >>> 8) / 16777216;
export const rnd2 = (ix, iz, seed = 0) => h01(hash2i(ix, iz, seed));

export const REGION = 2600; // metres: one farmland region shares a field orientation and size

/** Properties of the region containing (x, z): lattice rotation and field size. */
export function regionAt(x, z) {
  const mz = Math.floor(z / REGION);
  const mx = Math.floor((x + (mz & 1) * REGION * 0.5) / REGION);
  const rot = rnd2(mx, mz, 1) * 1.5708 + (rnd2(mx, mz, 2) - 0.5) * 0.3;
  const sx = 120 + 190 * rnd2(mx, mz, 3);
  const sy = sx * (0.55 + 0.95 * rnd2(mx, mz, 4));
  return { mx, mz, cos: Math.cos(rot), sin: Math.sin(rot), sx, sy, seed: (mx * 73856093) ^ (mz * 19349663) };
}

// Crop classes by hash (0..1).
export const CROP = { PASTURE: 0, WHEAT: 1, BARLEY: 2, CORN: 3, RAPE: 4, PLOUGH: 5, FALLOW: 6, ROWS: 7, ORCHARD: 8, VINE: 9, HAY: 10 };
export function cropOf(h) {
  if (h < 0.1) return CROP.PASTURE;
  if (h < 0.22) return CROP.WHEAT;
  if (h < 0.3) return CROP.BARLEY;
  if (h < 0.4) return CROP.CORN;
  if (h < 0.48) return CROP.RAPE;
  if (h < 0.58) return CROP.PLOUGH;
  if (h < 0.66) return CROP.FALLOW;
  if (h < 0.74) return CROP.ROWS;
  if (h < 0.8) return CROP.ORCHARD;
  if (h < 0.85) return CROP.VINE;
  return CROP.HAY;
}

/** Cell (field) at a point: indices in the region's rotated lattice. */
export function fieldAt(x, z, out = {}) {
  const r = regionAt(x, z);
  const qx = (r.cos * x + r.sin * z) / r.sx;
  const qy = (-r.sin * x + r.cos * z) / r.sy;
  const ci = Math.floor(qx);
  const cj = Math.floor(qy);
  const h = rnd2(ci, cj, r.seed);
  out.region = r; out.ci = ci; out.cj = cj; out.h = h; out.crop = cropOf(h);
  out.fx = qx - ci; out.fy = qy - cj;
  out.hedge = hedgeFlag(ci, cj, r.seed);
  return out;
}
export const hedgeFlag = (ci, cj, seed) => rnd2(ci, cj, seed + 11) < 0.72;
/** A boundary that is a farm track rather than a hedge. */
export const trackFlag = (ci, cj, seed) => rnd2(ci, cj, seed + 17) < 0.12;

/**
 * Visit points along the hedgerow lines inside a rectangle: cb(x, z, kind) every ~`step` metres
 * with kind 0 = hedge, 1 = track. Used to plant tree lines on the same lines the shader paints.
 */
export function forEachHedgePoint(x0, z0, x1, z1, step, cb) {
  const rm0 = Math.floor(z0 / REGION) - 1;
  const rm1 = Math.floor(z1 / REGION) + 1;
  for (let mz = rm0; mz <= rm1; mz++) {
    for (let mx = Math.floor(x0 / REGION) - 2; mx <= Math.floor(x1 / REGION) + 1; mx++) {
      const bx0 = mx * REGION - (mz & 1) * REGION * 0.5;
      const bz0 = mz * REGION;
      const rx0 = Math.max(bx0, x0);
      const rx1 = Math.min(bx0 + REGION, x1);
      const rz0 = Math.max(bz0, z0);
      const rz1 = Math.min(bz0 + REGION, z1);
      if (rx0 >= rx1 || rz0 >= rz1) continue;
      const cxm = (rx0 + rx1) / 2;
      const r = regionAt(cxm, (rz0 + rz1) / 2);
      if (r.mx !== mx || r.mz !== mz) continue;
      // Rotated-lattice bounds of the clipped rectangle.
      let qxMin = Infinity; let qxMax = -Infinity; let qyMin = Infinity; let qyMax = -Infinity;
      for (const [cx, cz] of [[rx0, rz0], [rx1, rz0], [rx0, rz1], [rx1, rz1]]) {
        const qx = (r.cos * cx + r.sin * cz) / r.sx;
        const qy = (-r.sin * cx + r.cos * cz) / r.sy;
        qxMin = Math.min(qxMin, qx); qxMax = Math.max(qxMax, qx); qyMin = Math.min(qyMin, qy); qyMax = Math.max(qyMax, qy);
      }
      // Lines of constant qx (running along the lattice y axis) and of constant qy.
      for (let axis = 0; axis < 2; axis++) {
        const [aMin, aMax, bMin, bMax] = axis === 0 ? [qxMin, qxMax, qyMin, qyMax] : [qyMin, qyMax, qxMin, qxMax];
        const sa = axis === 0 ? r.sx : r.sy;
        const sb = axis === 0 ? r.sy : r.sx;
        for (let i = Math.ceil(aMin); i <= Math.floor(aMax); i++) {
          const nb = Math.ceil(((bMax - bMin) * sb) / step) + 1;
          for (let k = 0; k <= nb; k++) {
            const b = bMin + (k * step) / sb;
            const qx = axis === 0 ? i : b;
            const qy = axis === 0 ? b : i;
            const x = r.cos * qx * r.sx - r.sin * qy * r.sy;
            const z = r.sin * qx * r.sx + r.cos * qy * r.sy;
            if (x < rx0 || x >= rx1 || z < rz0 || z >= rz1) continue;
            const cj = Math.floor(axis === 0 ? b : i - 0);
            const ci = Math.floor(axis === 0 ? i : b);
            // Cells on both sides of the line.
            const a = axis === 0 ? [ci - 1, cj] : [ci, cj - 1];
            const bb = axis === 0 ? [ci, cj] : [ci, cj];
            const ha = hedgeFlag(a[0], a[1], r.seed);
            const hb = hedgeFlag(bb[0], bb[1], r.seed);
            if (!ha && !hb) continue;
            const tr = trackFlag(a[0], a[1], r.seed) || trackFlag(bb[0], bb[1], r.seed);
            cb(x, z, tr ? 1 : 0, (i * 131 + k * 7) | 0);
          }
        }
      }
    }
  }
}

export const FIELD_GLSL = /* glsl */ `
uint ihash(uint x){ x ^= x >> 16u; x *= 0x7feb352du; x ^= x >> 15u; x *= 0x846ca68bu; x ^= x >> 16u; return x; }
uint hash2i(ivec2 p, int seed){ return ihash((uint(p.x) * 0x9e3779b1u) ^ ihash(uint(p.y) + uint(seed) * 0x85ebca6bu)); }
float rnd2(ivec2 p, int seed){ return float(hash2i(p, seed) >> 8u) / 16777216.0; }
const float REGION = 2600.0;

struct Field {
  int crop;      // crop class
  float h;       // 0..1 cell hash
  vec2 q;        // rotated lattice coordinates in metres (x along the rows' normal)
  vec2 size;     // field size in metres
  vec2 f;        // 0..1 within the cell
  float edge;    // metres to the nearest boundary
  float hedge;   // 1 when the nearest boundary is a hedge, 0.5 for a track, 0 for open
  float region;  // distance to the region border (farm tracks run along it)
  vec2 cell;
};

int cropOf(float h) {
  if (h < 0.10) return 0; if (h < 0.22) return 1; if (h < 0.30) return 2; if (h < 0.40) return 3; if (h < 0.48) return 4;
  if (h < 0.58) return 5; if (h < 0.66) return 6; if (h < 0.74) return 7; if (h < 0.80) return 8; if (h < 0.85) return 9; return 10;
}
bool hedgeFlag(ivec2 c, int seed) { return rnd2(c, seed + 11) < 0.72; }
bool trackFlag(ivec2 c, int seed) { return rnd2(c, seed + 17) < 0.12; }

Field fieldAt(vec2 p) {
  Field F;
  int mz = int(floor(p.y / REGION));
  float shift = float(mz & 1) * REGION * 0.5;
  int mx = int(floor((p.x + shift) / REGION));
  float rot = rnd2(ivec2(mx, mz), 1) * 1.5708 + (rnd2(ivec2(mx, mz), 2) - 0.5) * 0.3;
  float sx = 120.0 + 190.0 * rnd2(ivec2(mx, mz), 3);
  float sy = sx * (0.55 + 0.95 * rnd2(ivec2(mx, mz), 4));
  int seed = (mx * 73856093) ^ (mz * 19349663);
  float c = cos(rot); float s = sin(rot);
  vec2 q = vec2(c * p.x + s * p.y, -s * p.x + c * p.y);
  vec2 qs = q / vec2(sx, sy);
  ivec2 cell = ivec2(floor(qs));
  vec2 f = qs - vec2(cell);
  F.h = rnd2(cell, seed);
  F.crop = cropOf(F.h);
  F.q = q; F.size = vec2(sx, sy); F.f = f; F.cell = vec2(cell);
  vec2 dEdge = min(f, 1.0 - f) * vec2(sx, sy);
  F.edge = min(dEdge.x, dEdge.y);
  // Which neighbour shares the nearest boundary?
  ivec2 nb = cell;
  if (dEdge.x < dEdge.y) nb.x += (f.x < 0.5) ? -1 : 1; else nb.y += (f.y < 0.5) ? -1 : 1;
  bool hedge = hedgeFlag(cell, seed) || hedgeFlag(nb, seed);
  bool track = trackFlag(cell, seed) || trackFlag(nb, seed);
  F.hedge = hedge ? (track ? 0.5 : 1.0) : 0.0;
  vec2 rb = vec2(mod(p.x + shift, REGION), mod(p.y, REGION));
  F.region = min(min(rb.x, REGION - rb.x), min(rb.y, REGION - rb.y));
  return F;
}
`;
