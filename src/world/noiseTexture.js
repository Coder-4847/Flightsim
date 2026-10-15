import * as THREE from 'three';
import { hash2i, h01 } from './fields.js';

// A tileable 512x512 noise texture the terrain, water and vegetation shaders sample at several
// scales. R and G are two uncorrelated fractal noises (0.5 +/- 0.3); B and A hold the gradient of R
// per texel, encoded around 0.5 (decode: (t.ba - 0.5) * 0.102 = d(a)/d(texel), a in -1..1 units).

export const NOISE_SIZE = 512;

function periodicNoise(size, cells, seed) {
  const grid = new Float32Array(cells * cells);
  for (let j = 0; j < cells; j++) for (let i = 0; i < cells; i++) grid[j * cells + i] = h01(hash2i(i, j, seed)) * 2 - 1;
  const out = new Float32Array(size * size);
  const k = cells / size;
  for (let y = 0; y < size; y++) {
    const fy = y * k;
    const j0 = Math.floor(fy);
    const ty = fy - j0;
    const uy = ty * ty * (3 - 2 * ty);
    const j1 = (j0 + 1) % cells;
    for (let x = 0; x < size; x++) {
      const fx = x * k;
      const i0 = Math.floor(fx);
      const tx = fx - i0;
      const ux = tx * tx * (3 - 2 * tx);
      const i1 = (i0 + 1) % cells;
      const a = grid[j0 * cells + i0];
      const b = grid[j0 * cells + i1];
      const c = grid[j1 * cells + i0];
      const d = grid[j1 * cells + i1];
      out[y * size + x] = a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
    }
  }
  return out;
}

function fractal(size, baseCells, octaves, seed, gain = 0.52) {
  const sum = new Float32Array(size * size);
  let amp = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    const n = periodicNoise(size, baseCells << o, seed + o * 17);
    for (let i = 0; i < sum.length; i++) sum[i] += n[i] * amp;
    norm += amp;
    amp *= gain;
  }
  for (let i = 0; i < sum.length; i++) sum[i] /= norm;
  return sum;
}

export function makeTerrainNoiseTexture() {
  const S = NOISE_SIZE;
  const a = fractal(S, 4, 6, 101);
  const b = fractal(S, 8, 5, 977);
  const data = new Uint8Array(S * S * 4);
  const sat = (v) => Math.max(0, Math.min(255, Math.round(v)));
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const xl = a[y * S + ((x + S - 1) % S)];
      const xr = a[y * S + ((x + 1) % S)];
      const yu = a[((y + S - 1) % S) * S + x];
      const yd = a[((y + 1) % S) * S + x];
      data[i * 4] = sat(128 + a[i] * 150);
      data[i * 4 + 1] = sat(128 + b[i] * 150);
      data[i * 4 + 2] = sat(128 + (xr - xl) * 0.5 * 2500);
      data[i * 4 + 3] = sat(128 + (yd - yu) * 0.5 * 2500);
    }
  }
  const tex = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  tex.userData.shared = true;
  return tex;
}

let shared = null;
/** The shared terrain noise texture (one per page; never disposed while a map is loaded). */
export function getNoiseTexture() {
  if (!shared) shared = makeTerrainNoiseTexture();
  return shared;
}
