// Seeded 2D gradient (Perlin-style) noise + fractal Brownian motion. Deterministic for a given
// seed, so terrain is identical on every load. `value`/`fbm` return roughly 0..1.

function hash2(ix, iy, seed) {
  let h = (ix * 374761393 + iy * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return h >>> 0;
}

const smooth = (t) => t * t * t * (t * (t * 6 - 15) + 10); // quintic fade: no grid creases

// 16 unit gradient directions.
const GRAD = Array.from({ length: 16 }, (_, i) => [Math.cos((i / 16) * Math.PI * 2), Math.sin((i / 16) * Math.PI * 2)]);

const ROT_C = Math.cos(0.5);
const ROT_S = Math.sin(0.5);

export function createNoise(seed = 1) {
  const grad = (ix, iy, dx, dy) => {
    const g = GRAD[hash2(ix, iy, seed) & 15];
    return g[0] * dx + g[1] * dy;
  };

  const value = (x, y) => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const u = smooth(fx);
    const v = smooth(fy);
    const a = grad(ix, iy, fx, fy);
    const b = grad(ix + 1, iy, fx - 1, fy);
    const c = grad(ix, iy + 1, fx, fy - 1);
    const d = grad(ix + 1, iy + 1, fx - 1, fy - 1);
    const n = a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v; // about -0.7..0.7
    return Math.min(1, Math.max(0, 0.5 + n * 0.72));
  };

  /** fBm in roughly 0..1. Each octave is rotated slightly so lattice directions never line up. */
  const fbm = (x, y, octaves = 5, lacunarity = 2, gain = 0.5) => {
    let sum = 0;
    let amp = 0.5;
    let norm = 0;
    let fx = x;
    let fy = y;
    for (let i = 0; i < octaves; i++) {
      sum += value(fx, fy) * amp;
      norm += amp;
      amp *= gain;
      const rx = (fx * ROT_C - fy * ROT_S) * lacunarity;
      fy = (fx * ROT_S + fy * ROT_C) * lacunarity;
      fx = rx;
    }
    return sum / norm;
  };

  return { value, fbm };
}

export const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
