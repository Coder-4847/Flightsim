import * as THREE from 'three';
import { createNoise } from '../util/noise.js';

// All textures are generated on canvases: no external image files.

// Small seeded PRNG so generated textures are identical on every load.
function mulberry32(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function finish(c, { repeat = false, anisotropy = 8 } = {}) {
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = anisotropy;
  if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** Neutral grey-green noise; tinted per-vertex by the terrain. Tiles seamlessly enough at this scale. */
export function makeGroundDetailTexture(seed = 7) {
  const size = 256;
  const c = canvas(size, size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const n = createNoise(seed);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const v = 0.55 * n.fbm(x / 24, y / 24, 4) + 0.45 * n.value(x / 3, y / 3);
      const g = 150 + v * 90;
      const i = (y * size + x) * 4;
      img.data[i] = g;
      img.data[i + 1] = g;
      img.data[i + 2] = g;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return finish(c, { repeat: true });
}

/**
 * Runway texture, length along the canvas Y axis. Canvas top maps to the north
 * (-Z) end. Numbers are painted so they read correctly to a pilot landing over
 * each threshold, so the north-end number appears upside-down on this map.
 */
export function makeRunwayTexture({ widthM, lengthM, northNumber, southNumber }) {
  // Pixels per metre: 4 across, 1.6 along. The long axis stays <= 4096 px, the
  // smallest max-texture-size we expect on mobile GPUs.
  const ppm = 4;
  const sy = 1.6;
  const w = widthM * ppm;
  const h = Math.round(lengthM * sy);
  const c = canvas(w, h);
  const ctx = c.getContext('2d');

  ctx.fillStyle = '#3a3d42';
  ctx.fillRect(0, 0, w, h);
  const n = createNoise(21);
  const rand = mulberry32(99);
  for (let i = 0; i < 3500; i++) {
    const x = rand() * w; const y = rand() * h;
    const light = n.value(x / 20, y / 60) > 0.5 ? 255 : 0;
    ctx.fillStyle = `rgba(${light},${light},${light},0.045)`;
    ctx.fillRect(x, y, 2 + rand() * 6, 2);
  }
  // Rubber streaks in the touchdown zones.
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  for (const end of [0, 1]) {
    const y0 = end ? h - 520 * sy : 120 * sy;
    ctx.fillRect(w * 0.38, y0, w * 0.08, 400 * sy);
    ctx.fillRect(w * 0.54, y0, w * 0.08, 400 * sy);
  }

  ctx.fillStyle = '#e8e8e2';
  const edge = 0.5 * ppm;
  ctx.fillRect(1.2 * ppm, 0, edge, h);
  ctx.fillRect(w - 1.2 * ppm - edge, 0, edge, h);

  // Centreline dashes: 30 m dash, 20 m gap.
  const lineW = 0.9 * ppm;
  for (let m = 60; m < lengthM - 60; m += 50) {
    ctx.fillRect(w / 2 - lineW / 2, m * sy, lineW, 30 * sy);
  }

  // Threshold piano keys.
  const keys = 8;
  const keyW = 1.8 * ppm;
  const span = w - 6 * ppm;
  for (const end of [0, 1]) {
    const y = end ? h - 42 * sy : 12 * sy;
    for (let k = 0; k < keys; k++) {
      const x = 3 * ppm + (span / keys) * (k + 0.5) - keyW / 2;
      ctx.fillRect(x, y, keyW, 30 * sy);
    }
  }

  // Touchdown-zone markers.
  for (const end of [0, 1]) {
    for (const off of [150, 300]) {
      const y = end ? h - (off + 22) * sy : off * sy;
      ctx.fillRect(w * 0.3 - 1.5 * ppm, y, 3 * ppm, 22 * sy);
      ctx.fillRect(w * 0.7 - 1.5 * ppm, y, 3 * ppm, 22 * sy);
    }
  }

  // Runway numbers, stretched on Y to undo the anisotropic pixel scale.
  const drawNumber = (text, y, flipped) => {
    ctx.save();
    ctx.translate(w / 2, y);
    if (flipped) ctx.rotate(Math.PI);
    ctx.scale(1, sy / ppm);
    ctx.font = `bold ${9 * ppm}px "Arial Narrow", Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 0, 0);
    ctx.restore();
  };
  drawNumber(northNumber, 78 * sy, true);
  drawNumber(southNumber, h - 78 * sy, false);

  return finish(c, { anisotropy: 16 });
}

export function makeApronTexture() {
  const c = canvas(256, 256);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#6b6e72';
  ctx.fillRect(0, 0, 256, 256);
  const n = createNoise(5);
  for (let y = 0; y < 256; y += 2) {
    for (let x = 0; x < 256; x += 2) {
      const v = n.value(x / 12, y / 12);
      ctx.fillStyle = `rgba(0,0,0,${(v - 0.4) * 0.12})`;
      ctx.fillRect(x, y, 2, 2);
    }
  }
  ctx.strokeStyle = 'rgba(0,0,0,0.25)'; // expansion joints
  ctx.lineWidth = 1;
  for (let i = 0; i <= 256; i += 64) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 256); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(256, i); ctx.stroke();
  }
  return finish(c, { repeat: true });
}
