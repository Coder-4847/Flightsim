// Gradient noise with analytic derivatives plus the fractal combinations the landforms are made of
// (plain fBm, erosion-damped fBm, ridged multifractals, terraces). All functions are deterministic
// for a given seed. Values are signed (about -1..1) unless a function says otherwise.

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ROT_C = 0.8;
const ROT_S = 0.6;
const SQ2 = 1.4142;

export function createGradNoise(seed = 1) {
  const rnd = mulberry32(seed * 7919 + 17);
  const perm = new Uint8Array(512);
  const p0 = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [p0[i], p0[j]] = [p0[j], p0[i]]; }
  for (let i = 0; i < 512; i++) perm[i] = p0[i & 255];
  const gx = new Float32Array(256);
  const gy = new Float32Array(256);
  for (let i = 0; i < 256; i++) { const a = rnd() * Math.PI * 2; gx[i] = Math.cos(a); gy[i] = Math.sin(a); }

  const out = { v: 0, dx: 0, dy: 0 };

  /** Gradient noise and its derivatives, written into the shared `out` record (also returned). */
  function noised(x, y) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
    const uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
    const dux = 30 * fx * fx * (fx - 1) * (fx - 1);
    const duy = 30 * fy * fy * (fy - 1) * (fy - 1);
    const i0 = perm[(ix & 255)] + (iy & 255);
    const i1 = perm[((ix + 1) & 255)] + (iy & 255);
    const ha = perm[i0];
    const hb = perm[i1];
    const hc = perm[i0 + 1];
    const hd = perm[i1 + 1];
    const a = gx[ha] * fx + gy[ha] * fy;
    const b = gx[hb] * (fx - 1) + gy[hb] * fy;
    const c = gx[hc] * fx + gy[hc] * (fy - 1);
    const d = gx[hd] * (fx - 1) + gy[hd] * (fy - 1);
    const k0 = b - a;
    const k1 = c - a;
    const k2 = a - b - c + d;
    out.v = (a + ux * k0 + uy * k1 + ux * uy * k2) * SQ2;
    out.dx = (gx[ha] + ux * (gx[hb] - gx[ha]) + uy * (gx[hc] - gx[ha]) + ux * uy * (gx[ha] - gx[hb] - gx[hc] + gx[hd]) + dux * (k0 + uy * k2)) * SQ2;
    out.dy = (gy[ha] + ux * (gy[hb] - gy[ha]) + uy * (gy[hc] - gy[ha]) + ux * uy * (gy[ha] - gy[hb] - gy[hc] + gy[hd]) + duy * (k1 + ux * k2)) * SQ2;
    return out;
  }

  /** Plain value, signed -1..1. */
  const s = (x, y) => noised(x, y).v;

  /** Standard fBm, normalised to about -1..1. */
  function fbm(x, y, octaves = 4, gain = 0.5) {
    let sum = 0;
    let amp = 1;
    let norm = 0;
    let px = x;
    let py = y;
    for (let i = 0; i < octaves; i++) {
      sum += amp * noised(px, py).v;
      norm += amp;
      amp *= gain;
      const rx = (px * ROT_C - py * ROT_S) * 2.01;
      py = (px * ROT_S + py * ROT_C) * 2.01;
      px = rx;
    }
    return sum / norm;
  }

  /**
   * Erosion-damped fBm: octaves are damped where the accumulated slope is steep, which leaves
   * flat valley floors and sharp-ish interfluves. About -0.6..0.6.
   */
  function erode(x, y, octaves = 5, strength = 1.0, gain = 0.5) {
    let sum = 0;
    let amp = 0.5;
    let ddx = 0;
    let ddy = 0;
    let px = x;
    let py = y;
    for (let i = 0; i < octaves; i++) {
      const n = noised(px, py);
      ddx += n.dx;
      ddy += n.dy;
      sum += amp * n.v / (1 + strength * (ddx * ddx + ddy * ddy));
      amp *= gain;
      const rx = (px * ROT_C - py * ROT_S) * 2.0;
      py = (px * ROT_S + py * ROT_C) * 2.0;
      px = rx;
    }
    return sum;
  }

  /** Ridged multifractal 0..1 (sharp crests); `damp` > 0 adds erosion-style damping of fine octaves. */
  function ridged(x, y, octaves = 5, damp = 0.6, gain = 0.5) {
    let sum = 0;
    let amp = 0.5;
    let norm = 0;
    let ddx = 0;
    let ddy = 0;
    let weight = 1;
    let px = x;
    let py = y;
    for (let i = 0; i < octaves; i++) {
      const n = noised(px, py);
      ddx += n.dx; ddy += n.dy;
      let r = 1 - Math.abs(n.v);
      r *= r;
      sum += r * amp * weight / (1 + damp * (ddx * ddx + ddy * ddy) * 0.25);
      norm += amp;
      weight = Math.min(1, Math.max(0.15, r * 2));
      amp *= gain;
      const rx = (px * ROT_C - py * ROT_S) * 2.03;
      py = (px * ROT_S + py * ROT_C) * 2.03;
      px = rx;
    }
    return sum / norm;
  }

  return { noised, s, fbm, erode, ridged };
}

export const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const sstep = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
/** Signed noise (-1..1) to 0..1. */
export const unit = (v) => 0.5 + 0.5 * v;

/** Stepped profile: plateaus every `step` metres joined by risers (sharpness 0..1). */
export function terrace(h, step, sharp = 0.7) {
  const t = h / step;
  const i = Math.floor(t);
  const f = t - i;
  const k = Math.max(0.02, 1 - sharp);
  const r = f < 1 - k ? 0 : (f - (1 - k)) / k;
  return (i + r * r * (3 - 2 * r)) * step;
}
